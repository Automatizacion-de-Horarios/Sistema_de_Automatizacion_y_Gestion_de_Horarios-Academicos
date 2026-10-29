const db = require('../config/db');

/**
 * Modelo de Carreras
 * Centraliza todas las consultas e inserciones a la base de datos que usa
 * el registro y listado de carreras.
 *
 * Cada función recibe opcionalmente una conexión con transacción activa.
 * Si no se envía, se usa el pool de conexiones (db).
 */

const obtenerEjecutor = (conexion) => conexion || db;

const Carrera = {
    /**
     * Ejecuta un bloque de trabajo dentro de una transacción.
     * Si el bloque lanza un error, se revierte todo y se libera la conexión.
     */
    async enTransaccion(trabajo) {
        const conexion = await db.getConnection();

        try {
            await conexion.beginTransaction();
            const resultado = await trabajo(conexion);
            await conexion.commit();
            return resultado;
        } catch (error) {
            try {
                await conexion.rollback();
            } catch (errorRollback) {
                console.error('Error al hacer rollback del registro de carrera:', errorRollback);
            }
            throw error;
        } finally {
            conexion.release();
        }
    },

    /**
     * Lista todas las carreras activas ordenadas por código.
     */
    async obtenerActivas(conexion) {
        const [filas] = await obtenerEjecutor(conexion).query(
            "SELECT id_carrera, codigo_carrera, nombre_carrera, estado FROM carreras WHERE estado = 'A' ORDER BY codigo_carrera ASC"
        );
        return filas;
    },

    /**
     * Busca una carrera por su código (sigla).
     */
    async obtenerPorCodigo(codigo, conexion) {
        const [filas] = await obtenerEjecutor(conexion).query(
            'SELECT id_carrera FROM carreras WHERE codigo_carrera = ?',
            [codigo]
        );
        return filas[0] || null;
    },

    /**
     * Registra una nueva carrera y devuelve su id.
     */
    async crear({ codigo, nombre, estado = 'A' }, conexion) {
        const [resultado] = await obtenerEjecutor(conexion).query(
            'INSERT INTO carreras (codigo_carrera, nombre_carrera, estado) VALUES (?, ?, ?)',
            [codigo, nombre, estado]
        );
        return resultado.insertId;
    },

    /**
     * Obtiene los semestres (ciclos) ya registrados de una carrera.
     */
    async obtenerSemestres(idCarrera, conexion) {
        const [filas] = await obtenerEjecutor(conexion).query(
            'SELECT semestre FROM semestres WHERE id_carrera = ?',
            [idCarrera]
        );
        return filas;
    },

    /**
     * Registra un nuevo semestre para una carrera y devuelve su id.
     */
    async crearSemestre({ idCarrera, semestre, horasMeta = 510, estado = 'A' }, conexion) {
        const [resultado] = await obtenerEjecutor(conexion).query(
            'INSERT INTO semestres (id_carrera, semestre, horas_semestre_meta, estado) VALUES (?, ?, ?, ?)',
            [idCarrera, semestre, horasMeta, estado]
        );
        return resultado.insertId;
    }
};

module.exports = Carrera;
