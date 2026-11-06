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
    guardarConfiguracionPeriodo
};