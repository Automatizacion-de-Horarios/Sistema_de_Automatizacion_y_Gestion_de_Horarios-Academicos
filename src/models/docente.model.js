const db = require('../config/db');
const { exigir, minutos, totalMinutos } = require('../utils/docentes.util');

async function buscarRegistrado(identificador, conexion = db, bloquear = false) {
    const [filas] = await conexion.query(
        'SELECT id_docente FROM docentes WHERE id_docente = ?' + (bloquear ? ' FOR UPDATE' : ''),
        [identificador]
    );
    exigir(filas.length, 'No se encontró el docente.', 404);
}

async function transaccion(identificador, operacion, verificar = true) {
    const conexion = await db.getConnection();
    try {
        await conexion.beginTransaction();
        if (verificar && identificador) await buscarRegistrado(identificador, conexion, true);
        const resultado = await operacion(conexion);
        await conexion.commit();
        return resultado;
    } catch (error) {
        await conexion.rollback();
        throw error;
    } finally {
        conexion.release();
    }
}

async function auditar(conexion, identificador, usuario) {
    await conexion.query(
        'UPDATE docentes SET usuario_modificacion = ?, fecha_modificacion = CURRENT_TIMESTAMP WHERE id_docente = ?',
        [usuario, identificador]
    );
}

// Los datos de auditoría se conservan en la tabla, pero no se exponen al panel.
const camposDocente = "id_docente, nombres, apellidos, especialidad, tipo_contrato, horas_semanales_meta, usa_restriccion_horaria, estado";

// La configuración cambia poco: se reutiliza durante un minuto para no repetir la consulta remota.
const cacheConfiguracion = new Map();
const VIGENCIA_CONFIGURACION = 60000;

const Docente = {
    async configuracion(codigoPeriodo) {
        exigir(typeof codigoPeriodo === 'string' && /^[A-Za-z0-9_-]{1,10}$/.test(codigoPeriodo), 'Selecciona un periodo académico válido.');
        const guardada = cacheConfiguracion.get(codigoPeriodo);
        if (guardada && guardada.expira > Date.now()) return guardada.datos;

        const [filas] = await db.query(
            "SELECT p.id_periodo, p.codigo_periodo, p.descripcion, p.estado, " +
            "TIME_FORMAT(c.`hora_inicio_mañana`, '%H:%i:%s') AS hora_inicio, " +
            "TIME_FORMAT(c.hora_cierre_noche, '%H:%i:%s') AS hora_fin " +
            'FROM periodos p LEFT JOIN configuracion_franja_horaria c ON c.id_periodo = p.id_periodo ' +
            'WHERE p.codigo_periodo = ?',
            [codigoPeriodo]
        );
        exigir(filas.length, 'El periodo seleccionado todavía no está registrado en la base de datos.', 404);

        const fila = filas[0];
        exigir(fila.hora_inicio && fila.hora_fin, 'Configura el horario de inicio y cierre para este periodo antes de gestionar la disponibilidad.', 409);
        exigir(
            minutos(fila.hora_fin, true) > minutos(fila.hora_inicio),
            'La franja horaria configurada no es válida.',
            409
        );

        const datos = {
            preparado: true,
            periodo: { id_periodo: fila.id_periodo, codigo_periodo: fila.codigo_periodo, descripcion: fila.descripcion, estado: fila.estado },
            horario: { hora_inicio: fila.hora_inicio, hora_fin: fila.hora_fin },
        };
        if (cacheConfiguracion.size >= 50) cacheConfiguracion.clear();
        cacheConfiguracion.set(codigoPeriodo, { datos, expira: Date.now() + VIGENCIA_CONFIGURACION });
        return datos;
    },

    async listar() {
        const [[docentes], [franjas]] = await Promise.all([
            db.query('SELECT ' + camposDocente + ' FROM docentes ORDER BY apellidos, nombres, id_docente'),
            db.query("SELECT dd.id_docente, dd.dia_semana, dd.hora_inicio, dd.hora_fin FROM disponibilidad_docentes dd WHERE dd.estado = 'A'"),
        ]);

        // Agrupa una sola vez para no recorrer toda la disponibilidad por cada docente.
        const porDocente = new Map();
        for (const franja of franjas) {
            const lista = porDocente.get(franja.id_docente);
            if (lista) lista.push(franja);
            else porDocente.set(franja.id_docente, [franja]);
        }

        return docentes.map((docente) => {
            const propias = porDocente.get(docente.id_docente) || [];
            return {
                ...docente,
                minutos_disponibles: totalMinutos(propias),
                franjas: propias.map(({ dia_semana, hora_inicio, hora_fin }) => ({ dia_semana, hora_inicio, hora_fin })),
            };
        });
    },

    async guardar(identificador, datos, usuario) {
        const esParcial = datos.tipo_contrato === 'TIEMPO_PARCIAL';

        if (identificador) {
            const [actuales] = await db.query(
                'SELECT tipo_contrato, usa_restriccion_horaria FROM docentes WHERE id_docente = ?',
                [identificador]
            );
            exigir(actuales.length, 'No se encontró el docente.', 404);

            const anterior = actuales[0];
            let restriccion = Number(anterior.usa_restriccion_horaria) === 1 ? 1 : 0;

            // Sólo el cambio de contrato reinicia la bandera. Si el contrato no
            // cambia, se conserva la elección manual hecha en la cuadrícula.
            if (anterior.tipo_contrato !== datos.tipo_contrato) {
                restriccion = esParcial ? 1 : 0;
            } else if (esParcial) {
                restriccion = 1;
            }

            const [resultado] = await db.query(
                'UPDATE docentes SET nombres = ?, apellidos = ?, especialidad = ?, tipo_contrato = ?, horas_semanales_meta = ?, usa_restriccion_horaria = ?, usuario_modificacion = ?, fecha_modificacion = CURRENT_TIMESTAMP WHERE id_docente = ?',
                [datos.nombres, datos.apellidos, datos.especialidad || null, datos.tipo_contrato, datos.horas_semanales_meta, restriccion, usuario, identificador]
            );
            if (!resultado.affectedRows) {
                const [filas] = await db.query('SELECT id_docente FROM docentes WHERE id_docente = ?', [identificador]);
                exigir(filas.length, 'No se encontró el docente.', 404);
            }
            return { id_docente: identificador, usa_restriccion_horaria: restriccion };
        }

        const restriccion = esParcial ? 1 : 0;
        const [nuevo] = await db.query(
            "INSERT INTO docentes (nombres, apellidos, especialidad, tipo_contrato, horas_semanales_meta, usa_restriccion_horaria, estado, usuario_modificacion, fecha_modificacion) VALUES (?, ?, ?, ?, ?, ?, 'A', ?, CURRENT_TIMESTAMP)",
            [datos.nombres, datos.apellidos, datos.especialidad || null, datos.tipo_contrato, datos.horas_semanales_meta, restriccion, usuario]
        );
        return { id_docente: nuevo.insertId, usa_restriccion_horaria: restriccion };
    },

    async cambiarEstado(identificador, estado, usuario) {
        exigir(['A', 'I'].includes(estado), 'Selecciona activo o inactivo.');
        const [resultado] = await db.query(
            'UPDATE docentes SET estado = ?, usuario_modificacion = ?, fecha_modificacion = CURRENT_TIMESTAMP WHERE id_docente = ?',
            [estado, usuario, identificador]
        );
        if (!resultado.affectedRows) {
            const [filas] = await db.query('SELECT id_docente FROM docentes WHERE id_docente = ?', [identificador]);
            exigir(filas.length, 'No se encontró el docente.', 404);
        }
    },

    async cambiarContrato(identificador, tipoContrato, horasMeta, usuario) {
        const [filas] = await db.query(
            'SELECT tipo_contrato, usa_restriccion_horaria FROM docentes WHERE id_docente = ?',
            [identificador]
        );
        exigir(filas.length, 'No se encontró el docente.', 404);

        const anterior = filas[0];
        const esParcial = tipoContrato === 'TIEMPO_PARCIAL';
        let restriccion = Number(anterior.usa_restriccion_horaria) === 1 ? 1 : 0;

        if (anterior.tipo_contrato !== tipoContrato) {
            restriccion = esParcial ? 1 : 0;
        } else if (esParcial) {
            restriccion = 1;
        }

        await db.query(
            'UPDATE docentes SET tipo_contrato = ?, horas_semanales_meta = ?, usa_restriccion_horaria = ?, usuario_modificacion = ?, fecha_modificacion = CURRENT_TIMESTAMP WHERE id_docente = ?',
            [tipoContrato, horasMeta, restriccion, usuario, identificador]
        );

        return { usa_restriccion_horaria: restriccion };
    },

    async disponibilidad(identificador) {
        const [docentes] = await db.query(
            'SELECT usa_restriccion_horaria FROM docentes WHERE id_docente = ?',
            [identificador]
        );
        exigir(docentes.length, 'No se encontró el docente.', 404);

        const [franjas] = await db.query(
            "SELECT dia_semana, hora_inicio, hora_fin FROM disponibilidad_docentes WHERE id_docente = ? AND estado = 'A' ORDER BY FIELD(dia_semana,'LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO','DOMINGO'), hora_inicio",
            [identificador]
        );

        return {
            usa_restriccion_horaria: Number(docentes[0].usa_restriccion_horaria) === 1 ? 1 : 0,
            franjas,
        };
    },

    async guardarDisponibilidad(identificador, franjas, usuario, restriccionSolicitada = null) {
        return transaccion(identificador, async (conexion) => {
            const [docentes] = await conexion.query(
                'SELECT tipo_contrato, usa_restriccion_horaria FROM docentes WHERE id_docente = ? FOR UPDATE',
                [identificador]
            );
            exigir(docentes.length, 'No se encontró el docente.', 404);

            const docente = docentes[0];
            const esParcial = docente.tipo_contrato === 'TIEMPO_PARCIAL';
            let restriccion = restriccionSolicitada;

            if (esParcial) {
                exigir(
                    restriccion !== 0,
                    'El tiempo parcial requiere usar la restricción horaria de la cuadrícula.'
                );
                restriccion = 1;
            } else if (restriccion === null) {
                restriccion = Number(docente.usa_restriccion_horaria) === 1 ? 1 : 0;
            }

            exigir(
                restriccion === 0 || restriccion === 1,
                'La restricción horaria debe estar activa o inactiva.'
            );
            exigir(
                restriccion === 0 || franjas.length > 0,
                'Marca al menos una franja para activar la restricción horaria.'
            );

            // El contrato nunca borra la cuadrícula. Sólo esta acción la reemplaza.
            await conexion.query('DELETE FROM disponibilidad_docentes WHERE id_docente = ?', [identificador]);
            if (franjas.length) {
                const valores = franjas.map((franja) => [
                    identificador,
                    franja.dia_semana,
                    franja.hora_inicio,
                    franja.hora_fin,
                    'A',
                    usuario,
                ]);
                await conexion.query(
                    'INSERT INTO disponibilidad_docentes (id_docente, dia_semana, hora_inicio, hora_fin, estado, usuario_modificacion) VALUES ?',
                    [valores]
                );
            }

            await conexion.query(
                'UPDATE docentes SET usa_restriccion_horaria = ? WHERE id_docente = ?',
                [restriccion, identificador]
            );
            await auditar(conexion, identificador, usuario);

            return { franjas, usa_restriccion_horaria: restriccion };
        }, false);
    },
};

module.exports = Docente;
