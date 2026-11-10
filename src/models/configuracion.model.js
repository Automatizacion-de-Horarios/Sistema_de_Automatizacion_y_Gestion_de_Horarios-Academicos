const db = require('../config/db');

// 1. Obtener todas las direcciones zonales
const obtenerZonales = async () => {
    const [rows] = await db.query('SELECT * FROM sedes_zonales ORDER BY nombre_zonal ASC');
    return rows;
};

// 2. Obtener todas las sedes físicas
const obtenerSedes = async () => {
    const [rows] = await db.query('SELECT s.*, sz.nombre_zonal FROM sedes s JOIN sedes_zonales sz ON s.id_zonal = sz.id_zonal ORDER BY s.nombre_sede ASC');
    return rows;
};

// 3. Registrar una nueva sede en la BD
const crearSede = async ({ codigo_sede, id_zonal, nombre_sede, direccion_sede }) => {
    const [result] = await db.query(
        'INSERT INTO sedes (codigo_sede, id_zonal, nombre_sede, direccion_sede) VALUES (?, ?, ?, ?)',
        [codigo_sede, id_zonal, nombre_sede, direccion_sede]
    );
    return result.insertId;
};

// 4. Obtener todos los períodos lectivos
const obtenerPeriodos = async () => {
    const [rows] = await db.query(
        `SELECT id_periodo, codigo_periodo, descripcion, estado, cantidad_semanas,
                DATE_FORMAT(fecha_inicio, '%Y-%m-%d') AS fecha_inicio,
                DATE_FORMAT(fecha_fin, '%Y-%m-%d') AS fecha_fin
         FROM periodos
         ORDER BY codigo_periodo DESC`
    );
    return rows;
};

// 5. Obtener la franja horaria del período
const obtenerFranja = async (id_periodo) => {
    const [rows] = await db.query('SELECT * FROM configuracion_franja_horaria WHERE id_periodo = ?', [id_periodo]);
    return rows[0] || null;
};

const crearPeriodo = async ({
    codigo_periodo,
    descripcion,
    estado = 'A',
    fecha_inicio,
    fecha_fin,
    cantidad_semanas
}) => {
    const [result] = await db.query(
        `INSERT INTO periodos
            (codigo_periodo, descripcion, estado, cantidad_semanas, fecha_inicio, fecha_fin)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [codigo_periodo, descripcion, estado, cantidad_semanas, fecha_inicio, fecha_fin]
    );
    const [rows] = await db.query(
        `SELECT id_periodo, codigo_periodo, descripcion, estado, cantidad_semanas,
                DATE_FORMAT(fecha_inicio, '%Y-%m-%d') AS fecha_inicio,
                DATE_FORMAT(fecha_fin, '%Y-%m-%d') AS fecha_fin
           FROM periodos
          WHERE id_periodo = ?`,
        [result.insertId]
    );
    return rows[0] || null;
};

const duplicarConfiguracionPeriodo = async ({
    idPeriodoOrigen,
    idPeriodoDestino,
    reemplazar = false
}) => {
    const conexion = await db.getConnection();
    try {
        await conexion.beginTransaction();

        const [[origen]] = await conexion.query(
            'SELECT id_periodo, codigo_periodo FROM periodos WHERE id_periodo = ? FOR UPDATE',
            [idPeriodoOrigen]
        );
        const [[destino]] = await conexion.query(
            'SELECT id_periodo, codigo_periodo FROM periodos WHERE id_periodo = ? FOR UPDATE',
            [idPeriodoDestino]
        );
        if (!origen || !destino) {
            throw Object.assign(new Error('El período de origen o destino no existe.'), { status: 400 });
        }
        if (Number(origen.id_periodo) === Number(destino.id_periodo)) {
            throw Object.assign(new Error('El período de origen y destino deben ser diferentes.'), { status: 400 });
        }

        const [[programacionDestino]] = await conexion.query(
            'SELECT COUNT(*) AS total FROM programacion_academica WHERE id_periodo = ?',
            [destino.id_periodo]
        );
        const [[compatibilidadDestino]] = await conexion.query(
            'SELECT COUNT(*) AS total FROM ambiente_cursos_permitidos WHERE id_periodo = ?',
            [destino.id_periodo]
        );
        const [[infraestructuraOrigen]] = await conexion.query(
            `SELECT COUNT(*) AS asignaciones,
                    COUNT(DISTINCT id_ambiente) AS ambientes,
                    COUNT(DISTINCT id_curso) AS cursos
               FROM ambiente_cursos_permitidos
              WHERE id_periodo = ?`,
            [origen.id_periodo]
        );
        const [[catalogoAmbientes]] = await conexion.query(
            'SELECT COUNT(*) AS total FROM ambientes'
        );
        const [[catalogoTiposAmbiente]] = await conexion.query(
            'SELECT COUNT(*) AS total FROM tipo_ambiente'
        );
        const [[borradoresDestino]] = await conexion.query(
            'SELECT COUNT(*) AS total FROM horarios_borradores WHERE id_periodo = ?',
            [destino.id_periodo]
        );
        const [[horariosDestino]] = await conexion.query(
            'SELECT COUNT(*) AS total FROM horarios_generados WHERE id_periodo = ?',
            [destino.id_periodo]
        );
        const datosDestino = {
            programacion: Number(programacionDestino.total),
            compatibilidad: Number(compatibilidadDestino.total),
            infraestructura: Number(compatibilidadDestino.total),
            borradores: Number(borradoresDestino.total),
            horarios: Number(horariosDestino.total)
        };
        const tieneDatos = Object.values(datosDestino).some((total) => total > 0);
        if (tieneDatos && !reemplazar) {
            throw Object.assign(
                new Error(
                    `El período ${destino.codigo_periodo} ya tiene datos configurados.`
                ),
                {
                    status: 409,
                    code: 'DESTINO_CON_DATOS',
                    data: datosDestino
                }
            );
        }

        if (reemplazar) {
            await conexion.query('DELETE FROM horarios_generados WHERE id_periodo = ?', [destino.id_periodo]);
            await conexion.query('DELETE FROM horarios_borradores WHERE id_periodo = ?', [destino.id_periodo]);
            await conexion.query('DELETE FROM ambiente_cursos_permitidos WHERE id_periodo = ?', [destino.id_periodo]);
            await conexion.query('DELETE FROM programacion_academica WHERE id_periodo = ?', [destino.id_periodo]);
        }

        const [programacion] = await conexion.query(
            `INSERT INTO programacion_academica
                (id_periodo, id_sede, id_curso, id_turno, grupo,
                 id_docente_tec, id_docente_tal, estado)
             SELECT ?, id_sede, id_curso, id_turno, grupo,
                    id_docente_tec, id_docente_tal, estado
               FROM programacion_academica
              WHERE id_periodo = ?`,
            [destino.id_periodo, origen.id_periodo]
        );

        const [compatibilidad] = await conexion.query(
            `INSERT IGNORE INTO ambiente_cursos_permitidos
                (id_periodo, id_ambiente, id_curso)
             SELECT DISTINCT ?, id_ambiente, id_curso
               FROM ambiente_cursos_permitidos
              WHERE id_periodo = ?`,
            [destino.id_periodo, origen.id_periodo]
        );

        let franja = 0;
        const [[franjaDestino]] = await conexion.query(
            'SELECT COUNT(*) AS total FROM configuracion_franja_horaria WHERE id_periodo = ?',
            [destino.id_periodo]
        );
        if (Number(franjaDestino.total) === 0) {
            const [franjaCopiada] = await conexion.query(
                `INSERT INTO configuracion_franja_horaria
                    (id_periodo, hora_inicio_mañana, hora_cierre_noche, incluir_domingo)
                 SELECT ?, hora_inicio_mañana, hora_cierre_noche, incluir_domingo
                   FROM configuracion_franja_horaria
                  WHERE id_periodo = ?`,
                [destino.id_periodo, origen.id_periodo]
            );
            franja = Number(franjaCopiada.affectedRows);
        }

        const [[franjaConfig]] = await conexion.query(
            `SELECT hora_inicio_mañana, hora_cierre_noche, incluir_domingo
               FROM configuracion_franja_horaria
              WHERE id_periodo = ?`,
            [destino.id_periodo]
        );

        await conexion.commit();
        return {
            programacion: Number(programacion.affectedRows),
            compatibilidad: Number(compatibilidad.affectedRows),
            infraestructura: {
                asignaciones: Number(compatibilidad.affectedRows),
                cursos: Number(infraestructuraOrigen.cursos),
                ambientes: Number(infraestructuraOrigen.ambientes),
                ambientesCompartidos: Number(catalogoAmbientes.total),
                tiposAmbienteCompartidos: Number(catalogoTiposAmbiente.total)
            },
            franja,
            franjaConfig: franjaConfig || null,
            origen: origen.codigo_periodo,
            destino: destino.codigo_periodo
        };
    } catch (error) {
        await conexion.rollback();
        throw error;
    } finally {
        conexion.release();
    }
};

const guardarConfiguracionPeriodo = async ({
    id_periodo,
    hora_inicio_mañana,
    hora_cierre_noche,
    incluir_domingo,
    fecha_inicio,
    fecha_fin,
    cantidad_semanas
}) => {
    const conexion = await db.getConnection();
    try {
        await conexion.beginTransaction();
        await conexion.query(
            `UPDATE periodos
             SET fecha_inicio = ?, fecha_fin = ?, cantidad_semanas = ?
             WHERE id_periodo = ?`,
            [fecha_inicio, fecha_fin, cantidad_semanas, id_periodo]
        );
        await conexion.query(
            `INSERT INTO configuracion_franja_horaria
                (id_periodo, hora_inicio_mañana, hora_cierre_noche, incluir_domingo)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                hora_inicio_mañana = VALUES(hora_inicio_mañana),
                hora_cierre_noche = VALUES(hora_cierre_noche),
                incluir_domingo = VALUES(incluir_domingo)`,
            [id_periodo, hora_inicio_mañana, hora_cierre_noche, incluir_domingo]
        );
        await conexion.commit();
    } catch (error) {
        await conexion.rollback();
        throw error;
    } finally {
        conexion.release();
    }
};

module.exports = {
    obtenerZonales,
    obtenerSedes,
    crearSede,
    obtenerPeriodos,
    obtenerFranja,
    crearPeriodo,
    duplicarConfiguracionPeriodo,
    guardarConfiguracionPeriodo
};