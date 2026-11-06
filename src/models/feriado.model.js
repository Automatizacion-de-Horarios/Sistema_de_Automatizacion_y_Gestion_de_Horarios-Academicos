const db = require('../config/db');

const Feriado = {
    async obtenerTodos() {
        const [filas] = await db.query('SELECT * FROM feriados');
        return filas;
    },

    async obtenerPorId(id) {
        const [filas] = await db.query('SELECT * FROM feriados WHERE id_feriado = ?', [id]);
        return filas[0];
    },

    // NUEVA FUNCIÓN: Verifica si una fecha específica es feriado solo evaluando mes y día
    async verificarSiEsFeriado(fechaStr) {
        const [filas] = await db.query(
            `SELECT * FROM feriados 
             WHERE MONTH(fecha) = MONTH(?) 
               AND DAY(fecha) = DAY(?) 
               AND estado = 'ACTIVO'`,
            [fechaStr, fechaStr]
        );
        return filas.length > 0 ? filas[0] : null;
    },

    async crear({ fecha, descripcion, estado = 'ACTIVO' }) {
        const [resultado] = await db.query(
            'INSERT INTO feriados (fecha, descripcion, estado) VALUES (?, ?, ?)',
            [fecha, descripcion, estado]
        );
    
        return {
            id_feriado: resultado.insertId,
            fecha,
            descripcion,
            estado
        };
    },

    async actualizar(id, { fecha, descripcion, estado = 'ACTIVO' }) {
        const [resultado] = await db.query(
            'UPDATE feriados SET fecha = ?, descripcion = ?, estado = ? WHERE id_feriado = ?',
            [fecha, descripcion, estado, id]
        );
        return resultado.affectedRows;
    },

    async replicarSiguienteAnio(anioOrigen) {
        const anioDestino = Number(anioOrigen) + 1;
        const conexion = await db.getConnection();

        try {
            await conexion.beginTransaction();
            const [[{ totalOrigen }]] = await conexion.query(
                'SELECT COUNT(*) AS totalOrigen FROM feriados WHERE YEAR(fecha) = ?',
                [anioOrigen]
            );
            const [resultado] = await conexion.query(
                `INSERT INTO feriados (fecha, descripcion, estado)
                 SELECT DATE_ADD(origen.fecha, INTERVAL 1 YEAR), origen.descripcion, origen.estado
                 FROM feriados AS origen
                 LEFT JOIN feriados AS destino
                    ON destino.fecha = DATE_ADD(origen.fecha, INTERVAL 1 YEAR)
                 WHERE YEAR(origen.fecha) = ?
                   AND destino.id_feriado IS NULL`,
                [anioOrigen]
            );
            const [feriadosDestino] = await conexion.query(
                'SELECT * FROM feriados WHERE YEAR(fecha) = ?',
                [anioDestino]
            );
            await conexion.commit();

            return {
                anioDestino,
                creados: resultado.affectedRows,
                omitidos: totalOrigen - resultado.affectedRows,
                feriados: feriadosDestino
            };
        } catch (error) {
            await conexion.rollback();
            throw error;
        } finally {
            conexion.release();
        }
    },

    async eliminar(id) {
        const [resultado] = await db.query('DELETE FROM feriados WHERE id_feriado = ?', [id]);
        return resultado.affectedRows;
    }
};

module.exports = Feriado;