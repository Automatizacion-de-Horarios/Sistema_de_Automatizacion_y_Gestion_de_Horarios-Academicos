const db = require('../config/db');

/**
 * Modelo de Mallas y Cursos (Equipo 3)
 * Centraliza todas las consultas e inserciones a la base de datos que usa
 * la importación de Excel de mallas.
 *
 * Cada función recibe opcionalmente una conexión con transacción activa.
 * Si no se envía, se usa el pool de conexiones (db).
 */

const obtenerEjecutor = (conexion) => conexion || db;

const Malla = {
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
                console.error('Error al hacer rollback de la importación:', errorRollback);
            }
            throw error;
        } finally {
            conexion.release();
        }
    },

    /**
     * Busca una carrera por su código (sigla).
     */
    async obtenerCarreraPorCodigo(codigo, conexion) {
        const [filas] = await obtenerEjecutor(conexion).query(
            'SELECT id_carrera, nombre_carrera FROM carreras WHERE codigo_carrera = ?',
            [codigo]
        );
        return filas[0] || null;
    },

    /**
     * Devuelve todos los códigos (siglas) de carrera registrados en la BD.
     * Se usan para saber si el prefijo de un MAT CUR pertenece a una carrera.
     */
    async obtenerCodigosCarreras(conexion) {
        const [filas] = await obtenerEjecutor(conexion).query(
            'SELECT codigo_carrera FROM carreras'
        );
        return filas.map((fila) => String(fila.codigo_carrera).trim().toUpperCase());
    },

    /**
     * Verifica si un MAT CUR ya existe para una carrera determinada.
     * Se une cursos con semestres para conocer el id_carrera real del curso.
     */
    async obtenerCursoPorCarreraYMatricula(idCarrera, matCur, conexion) {
        const [filas] = await obtenerEjecutor(conexion).query(
            `SELECT c.id_curso
               FROM cursos c
               INNER JOIN semestres s ON s.id_semestre = c.id_semestre
              WHERE s.id_carrera = ? AND c.mat_cur = ?
              LIMIT 1`,
            [idCarrera, matCur]
        );
        return filas[0] || null;
    },

    /**
     * Busca un semestre (ciclo) de una carrera.
     */
    async obtenerSemestre(idCarrera, semestre, conexion) {
        const [filas] = await obtenerEjecutor(conexion).query(
            'SELECT id_semestre FROM semestres WHERE id_carrera = ? AND semestre = ?',
            [idCarrera, semestre]
        );
        return filas[0] || null;
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
    },

    /**
     * Registra un curso y devuelve su id.
     */
    async crearCurso(curso, conexion) {
        const {
            idSemestre,
            matCur,
            horarioSinfo,
            nombreCurso,
            semanas,
            horasTeoria,
            horasTaller,
            horasVirtual,
            horasEvaluacion,
            totalHoras,
            estado = 'A',
            catalogo = null,
            isCarrera = 0
        } = curso;

        const [resultado] = await obtenerEjecutor(conexion).query(
            `INSERT INTO cursos
                (id_semestre, mat_cur, horario_sinfo, nombre_curso, semanas, horas_teoria, horas_taller, horas_virtual, horas_evaluacion, total_horas, estado, catalogo, is_carrera)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [idSemestre, matCur, horarioSinfo, nombreCurso, semanas, horasTeoria, horasTaller, horasVirtual, horasEvaluacion, totalHoras, estado, catalogo, isCarrera]
        );
        return resultado.insertId;
    },

    /**
     * Actualiza CATALOGO e IS_CARRERA de un curso ya registrado.
     * Sirve para que al reimportar el Excel se completen/refresquen estos datos
     * sin duplicar el curso ni alterar su semestre.
     */
    async actualizarDatosClasificacionCurso(idCurso, { catalogo, isCarrera }, conexion) {
        const [resultado] = await obtenerEjecutor(conexion).query(
            'UPDATE cursos SET catalogo = ?, is_carrera = ? WHERE id_curso = ?',
            [catalogo, isCarrera, idCurso]
        );
        return resultado.affectedRows;
    },

    /**
     * Conteos usados por el resumen de la pantalla de mallas.
     */
    async contarCarreras(conexion) {
        const [filas] = await obtenerEjecutor(conexion).query('SELECT COUNT(*) as count FROM carreras');
        return filas[0].count;
    },

    async contarSemestres(conexion) {
        const [filas] = await obtenerEjecutor(conexion).query('SELECT COUNT(*) as count FROM semestres');
        return filas[0].count;
    },

    async contarCursos(conexion) {
        const [filas] = await obtenerEjecutor(conexion).query('SELECT COUNT(*) as count FROM cursos');
        return filas[0].count;
    }
};

module.exports = Malla;
