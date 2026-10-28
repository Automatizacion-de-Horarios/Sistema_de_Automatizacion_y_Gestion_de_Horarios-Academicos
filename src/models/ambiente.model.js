const db = require('../config/db');

const Ambiente = {
    async obtenerTodos() {
        const [filas] = await db.query('SELECT * FROM ambientes');
        return filas;
    },

    async obtenerPorId(id) {
        const [filas] = await db.query('SELECT * FROM ambientes WHERE id = ?', [id]);
        return filas[0];
    },

    async crear({ codigo_ambiente, id_tipo_ambiente, aforo_maximo, piso_ubicacion, pabellón, estado = 'DISPONIBLE' }) {
        const [resultado] = await db.query(
            'INSERT INTO ambientes (codigo_ambiente, id_tipo_ambiente, aforo_maximo, piso_ubicacion, pabellón, estado) VALUES (?, ?, ?, ?, ?, ?)',
            [codigo_ambiente, id_tipo_ambiente, aforo_maximo, piso_ubicacion, pabellón, estado]
        );
    
        return {
            id: resultado.insertId,
            codigo_ambiente,
            id_tipo_ambiente: Number(id_tipo_ambiente),
            aforo_maximo: Number(aforo_maximo),
            piso_ubicacion: Number(piso_ubicacion),
            pabellón,
            estado
        };
    },

    async actualizar(id, { codigo_ambiente, id_tipo_ambiente, aforo_maximo, piso_ubicacion, pabellón, estado = 'DISPONIBLE' }) {
        const [resultado] = await db.query(
            'UPDATE ambientes SET codigo_ambiente = ?, id_tipo_ambiente = ?, aforo_maximo = ?, piso_ubicacion = ?, pabellón = ?, estado = ? WHERE id = ?',
            [codigo_ambiente, id_tipo_ambiente, aforo_maximo, piso_ubicacion, pabellón, estado, id]
        );
        return resultado.affectedRows;
    },

    async eliminar(id) {
        const [resultado] = await db.query('DELETE FROM ambientes WHERE id = ?', [id]);
        return resultado.affectedRows;
    }
};

module.exports = Ambiente;
