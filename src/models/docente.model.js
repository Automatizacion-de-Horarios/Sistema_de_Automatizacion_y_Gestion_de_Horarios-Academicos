const db = require('../config/db');
const { exigir, totalMinutos } = require('../utils/docentes.util');

async function buscarRegistrado(identificador, conexion = db, bloquear = false) {
    const [filas] = await conexion.query(
        "SELECT id_docente FROM docentes WHERE id_docente = ?" + (bloquear ? ' FOR UPDATE' : ''),
        [identificador]
    );
    exigir(filas.length, 'No se encontró el docente.', 404);
}

async function transaccion(identificador, operacion, permitirExistente = false) {
    const conexion = await db.getConnection();
    try {
        await conexion.beginTransaction();
        if (identificador && permitirExistente) {
            const [filas] = await conexion.query('SELECT id_docente FROM docentes WHERE id_docente = ? FOR UPDATE', [identificador]);
            exigir(filas.length, 'No se encontró el docente.', 404);
        } else if (identificador) await buscarRegistrado(identificador, conexion, true);
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
    await conexion.query('UPDATE docentes SET usuario_modificacion = ?, fecha_modificacion = CURRENT_TIMESTAMP WHERE id_docente = ?', [usuario, identificador]);
}

const camposDocente = "id_docente, nombres, apellidos, dni, especialidad, estado, usuario_modificacion, DATE_FORMAT(fecha_modificacion, '%Y-%m-%d %H:%i:%s') AS fecha_modificacion, DATE_FORMAT(fecha_registro, '%Y-%m-%d %H:%i:%s') AS fecha_registro";

const Docente = {
    async buscarPorDni(dni) {
        exigir(typeof dni === 'string' && /^\d{8}$/.test(dni), 'Ingresa un DNI de 8 dígitos.');
        const [filas] = await db.query('SELECT id_docente, nombres, apellidos, dni, especialidad, estado, registrado_en_panel FROM docentes WHERE dni = ? LIMIT 1', [dni]);
        return filas[0] || null;
    },

    async buscarPorNombre(nombre) {
        exigir(typeof nombre === 'string' && nombre.trim().length >= 2 && nombre.length <= 201, 'Escribe al menos dos letras del nombre.');
        const texto = nombre.replace(/[,\s]+/g, ' ').trim().replace(/=/g, '==').replace(/%/g, '=%').replace(/_/g, '=_');
        const patron = '%' + texto + '%';
        const [filas] = await db.query("SELECT id_docente, nombres, apellidos, dni, especialidad, estado, registrado_en_panel FROM docentes WHERE CONCAT(apellidos, ' ', nombres) LIKE ? ESCAPE '=' OR CONCAT(nombres, ' ', apellidos) LIKE ? ESCAPE '=' ORDER BY apellidos, nombres LIMIT 20", [patron, patron]);
        return filas;
    },

    async registrarExistente(identificador, usuario, dni = null) {
        return transaccion(identificador, async (conexion) => {
            const [filas] = await conexion.query('SELECT registrado_en_panel, dni FROM docentes WHERE id_docente = ?', [identificador]);
            const anterior = filas[0];
            const yaRegistrado = Number(anterior.registrado_en_panel) === 1;
            exigir(!dni || !anterior.dni || anterior.dni === dni, 'Ese docente ya tiene otro DNI. Usa Editar datos para cambiarlo.', 409);
            if (dni && !anterior.dni) {
                const [repetidos] = await conexion.query('SELECT id_docente FROM docentes WHERE dni = ? AND id_docente <> ? FOR UPDATE', [dni, identificador]);
                exigir(!repetidos.length, 'Ese DNI pertenece a otro docente.', 409);
            }
            const dniActualizado = Boolean(dni && !anterior.dni);
            if (yaRegistrado && !dniActualizado) return { yaRegistrado, dniActualizado };
            await conexion.query('UPDATE docentes SET registrado_en_panel = 1, dni = COALESCE(dni, ?), fecha_registro = COALESCE(fecha_registro, CURRENT_TIMESTAMP), usuario_modificacion = ?, fecha_modificacion = CURRENT_TIMESTAMP WHERE id_docente = ?', [dni, usuario, identificador]);
            return { yaRegistrado, dniActualizado };
        }, true);
    },

    async configuracion(codigoPeriodo) {
        exigir(typeof codigoPeriodo === 'string' && /^[A-Za-z0-9_-]{1,10}$/.test(codigoPeriodo), 'Selecciona un periodo académico válido.');
        const [periodos] = await db.query('SELECT id_periodo, codigo_periodo, descripcion, estado FROM periodos WHERE codigo_periodo = ?', [codigoPeriodo]);
        exigir(periodos.length, 'El periodo seleccionado todavía no está registrado en la base de datos.', 404);
        const [columnas] = await db.query("SELECT TABLE_NAME AS tabla, COLUMN_NAME AS columna FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('docentes','cursos_docentes')");
        const tiene = (tabla, columna) => columnas.some((campo) => campo.tabla.toLowerCase() === tabla && campo.columna.toLowerCase() === columna);
        const preparado = ['dni', 'registrado_en_panel', 'fecha_registro'].every((columna) => tiene('docentes', columna)) &&
            ['id_asignacion', 'id_docente', 'id_curso', 'id_periodo', 'estado', 'usuario_modificacion', 'fecha_modificacion'].every((columna) => tiene('cursos_docentes', columna));
        return { preparado, tiene_dni: tiene('docentes', 'dni'), periodo: periodos[0] };
    },

    async listar(configuracion) {
        if (!configuracion.preparado) return [];
        const [docentes] = await db.query('SELECT ' + camposDocente + ' FROM docentes ORDER BY apellidos, nombres, id_docente');
        const [franjas] = await db.query("SELECT dd.id_docente, dd.dia_semana, dd.hora_inicio, dd.hora_fin FROM disponibilidad_docentes dd JOIN docentes d ON d.id_docente = dd.id_docente WHERE dd.estado = 'A'");
        const [cantidades] = await db.query("SELECT id_docente, COUNT(DISTINCT id_curso) AS cantidad FROM cursos_docentes WHERE id_periodo = ? AND estado = 'A' GROUP BY id_docente", [configuracion.periodo.id_periodo]);
        return docentes.map((docente) => ({
            ...docente,
            minutos_disponibles: totalMinutos(franjas.filter((franja) => franja.id_docente === docente.id_docente)),
            cursos_asignados: Number(cantidades.find((fila) => fila.id_docente === docente.id_docente)?.cantidad || 0),
        }));
    },

    async guardar(identificador, datos, usuario) {
        return transaccion(identificador, async (conexion) => {
            if (!identificador) {
                const [mismosNombres] = await conexion.query('SELECT id_docente FROM docentes WHERE nombres = ? AND apellidos = ? AND (? IS NULL OR dni IS NULL OR dni = ?) LIMIT 1 FOR UPDATE', [datos.nombres, datos.apellidos, datos.dni, datos.dni]);
                exigir(!mismosNombres.length, 'Ya existe un docente con esos nombres. Búscalo y selecciónalo por su ID para evitar duplicados.', 409);
            }
            if (datos.dni) {
                const [repetidos] = await conexion.query('SELECT id_docente FROM docentes WHERE dni = ? AND id_docente <> ? FOR UPDATE', [datos.dni, identificador || 0]);
                exigir(!repetidos.length, 'Ya existe un docente con ese DNI, aunque no aparezca en esta pantalla.', 409);
            }
            const valores = [datos.nombres, datos.apellidos, datos.dni, datos.especialidad || null, 'A', usuario];
            if (identificador) {
                await conexion.query('UPDATE docentes SET nombres = ?, apellidos = ?, dni = ?, especialidad = ?, usuario_modificacion = ?, fecha_modificacion = CURRENT_TIMESTAMP WHERE id_docente = ?', [datos.nombres, datos.apellidos, datos.dni, datos.especialidad || null, usuario, identificador]);
                return identificador;
            }
            const [nuevo] = await conexion.query('INSERT INTO docentes (nombres, apellidos, dni, especialidad, estado, usuario_modificacion, registrado_en_panel, fecha_registro, fecha_modificacion) VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)', valores);
            return nuevo.insertId;
        });
    },

    async cambiarEstado(identificador, estado, usuario) {
        return transaccion(identificador, async (conexion) => {
            await conexion.query('UPDATE docentes SET estado = ?, usuario_modificacion = ?, fecha_modificacion = CURRENT_TIMESTAMP WHERE id_docente = ?', [estado, usuario, identificador]);
        });
    },

    async cursos(identificador, periodo) {
        await buscarRegistrado(identificador);
        const [cursos] = await db.query(
            "SELECT c.id_curso, c.mat_cur, c.nombre_curso, c.horario_sinfo, c.horas_teoria, c.horas_taller, c.horas_virtual, c.horas_evaluacion, c.total_horas, c.is_carrera, s.id_semestre, s.semestre, ca.id_carrera, ca.codigo_carrera, ca.nombre_carrera, " +
            "(c.estado = 'A' AND s.estado = 'A' AND ca.estado = 'A') AS habilitado, " +
            "EXISTS(SELECT 1 FROM cursos_docentes cd WHERE cd.id_docente = ? AND cd.id_periodo = ? AND cd.id_curso = c.id_curso AND cd.estado = 'A') AS seleccionado " +
            "FROM cursos c JOIN semestres s ON s.id_semestre = c.id_semestre JOIN carreras ca ON ca.id_carrera = s.id_carrera " +
            "WHERE (c.estado = 'A' AND s.estado = 'A' AND ca.estado = 'A') OR EXISTS(SELECT 1 FROM cursos_docentes cd WHERE cd.id_docente = ? AND cd.id_periodo = ? AND cd.id_curso = c.id_curso AND cd.estado = 'A') " +
            "ORDER BY ca.codigo_carrera, FIELD(s.semestre,'I','II','III','IV','V','VI'), c.mat_cur",
            [identificador, periodo.id_periodo, identificador, periodo.id_periodo]
        );
        return cursos;
    },

    async guardarCursos(identificador, periodo, identificadores, usuario) {
        return transaccion(identificador, async (conexion) => {
            const [periodos] = await conexion.query('SELECT estado FROM periodos WHERE id_periodo = ? FOR UPDATE', [periodo.id_periodo]);
            exigir(periodos[0]?.estado === 'A', 'El periodo está cerrado y no permite modificar las asignaciones.', 409);
            if (identificadores.length) {
                const [validos] = await conexion.query("SELECT c.id_curso FROM cursos c JOIN semestres s ON s.id_semestre = c.id_semestre JOIN carreras ca ON ca.id_carrera = s.id_carrera WHERE c.id_curso IN (?) AND c.estado = 'A' AND s.estado = 'A' AND ca.estado = 'A'", [identificadores]);
                exigir(validos.length === identificadores.length, 'Hay cursos que ya no están activos. Actualiza la selección.');
            }
            const [anteriores] = await conexion.query('SELECT id_asignacion, id_curso FROM cursos_docentes WHERE id_docente = ? AND id_periodo = ? FOR UPDATE', [identificador, periodo.id_periodo]);
            await conexion.query("UPDATE cursos_docentes SET estado = 'I', usuario_modificacion = ?, fecha_modificacion = CURRENT_TIMESTAMP WHERE id_docente = ? AND id_periodo = ? AND estado = 'A'", [usuario, identificador, periodo.id_periodo]);
            for (const curso of identificadores) {
                const anterior = anteriores.find((fila) => fila.id_curso === curso);
                if (anterior) {
                    await conexion.query("UPDATE cursos_docentes SET estado = 'A', usuario_modificacion = ?, fecha_modificacion = CURRENT_TIMESTAMP WHERE id_asignacion = ?", [usuario, anterior.id_asignacion]);
                } else {
                    await conexion.query("INSERT INTO cursos_docentes (id_docente, id_curso, id_periodo, estado, usuario_modificacion, fecha_modificacion) VALUES (?, ?, ?, 'A', ?, CURRENT_TIMESTAMP)", [identificador, curso, periodo.id_periodo, usuario]);
                }
            }
            await auditar(conexion, identificador, usuario);
        });
    },

    async disponibilidad(identificador) {
        await buscarRegistrado(identificador);
        const [franjas] = await db.query(
            "SELECT dia_semana, hora_inicio, hora_fin, usuario_modificacion, DATE_FORMAT(fecha_modificacion, '%Y-%m-%d %H:%i:%s') AS fecha_modificacion FROM disponibilidad_docentes WHERE id_docente = ? AND estado = 'A' ORDER BY FIELD(dia_semana,'LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO','DOMINGO'), hora_inicio",
            [identificador]
        );
        return franjas;
    },

    async guardarDisponibilidad(identificador, franjas, usuario) {
        return transaccion(identificador, async (conexion) => {
            const [anteriores] = await conexion.query('SELECT id_disponibilidad, dia_semana, hora_inicio, hora_fin FROM disponibilidad_docentes WHERE id_docente = ? FOR UPDATE', [identificador]);
            await conexion.query("UPDATE disponibilidad_docentes SET estado = 'I', usuario_modificacion = ?, fecha_modificacion = CURRENT_TIMESTAMP WHERE id_docente = ? AND estado = 'A'", [usuario, identificador]);
            for (const franja of franjas) {
                const anterior = anteriores.find((fila) => fila.dia_semana === franja.dia_semana && fila.hora_inicio === franja.hora_inicio && fila.hora_fin === franja.hora_fin);
                if (anterior) {
                    await conexion.query("UPDATE disponibilidad_docentes SET estado = 'A', usuario_modificacion = ?, fecha_modificacion = CURRENT_TIMESTAMP WHERE id_disponibilidad = ?", [usuario, anterior.id_disponibilidad]);
                } else {
                    await conexion.query("INSERT INTO disponibilidad_docentes (id_docente, dia_semana, hora_inicio, hora_fin, estado, usuario_modificacion, fecha_modificacion) VALUES (?, ?, ?, ?, 'A', ?, CURRENT_TIMESTAMP)", [identificador, franja.dia_semana, franja.hora_inicio, franja.hora_fin, usuario]);
                }
            }
            await auditar(conexion, identificador, usuario);
            return franjas;
        });
    },

    async ficha(identificador, configuracion) {
        const docentes = await Docente.listar(configuracion);
        const docente = docentes.find((fila) => fila.id_docente === identificador);
        exigir(docente, 'No se encontró el docente.', 404);
        const cursos = (await Docente.cursos(identificador, configuracion.periodo)).filter((curso) => Number(curso.seleccionado) === 1);
        const disponibilidad = await Docente.disponibilidad(identificador);
        return { docente, cursos, disponibilidad, periodo: configuracion.periodo };
    },
};

module.exports = Docente;
