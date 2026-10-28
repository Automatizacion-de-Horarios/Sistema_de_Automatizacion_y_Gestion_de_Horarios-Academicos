const db = require('../config/db');

const User = {
    async buscarPorIdentificador(identificador) {
        const valor = identificador.trim();
        const [filas] = await db.query(
            `SELECT id_usuario, dni, correo_institucional, password_hash,
                    nombres, apellidos, rol, estado
               FROM usuarios
              WHERE dni = ? OR LOWER(correo_institucional) = LOWER(?)
              LIMIT 1`,
            [valor, valor]
        );
        return filas[0] || null;
    },

    async buscarPorId(id) {
        const [filas] = await db.query(
            `SELECT id_usuario, dni, correo_institucional, nombres, apellidos, rol, estado
               FROM usuarios WHERE id_usuario = ? LIMIT 1`,
            [id]
        );
        return filas[0] || null;
    },

    async actualizarUltimoAcceso(id) {
        await db.query('UPDATE usuarios SET ultimo_acceso = CURRENT_TIMESTAMP WHERE id_usuario = ?', [id]);
    }
};

module.exports = User;
