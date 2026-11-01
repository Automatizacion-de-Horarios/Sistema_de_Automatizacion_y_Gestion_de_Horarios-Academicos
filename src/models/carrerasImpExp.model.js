const db = require('../config/db');
const MallaSemestre = require('./mallaSemestre.model');

/**
 * Modelo de Carreras (Equipo 4)
 * Centraliza las consultas e inserciones a la base de datos que usa
 * el registro y listado de carreras y sus semestres base.
 *
 * La gestión avanzada de Malla Curricular, Semestres y Cursos (II al VI)
 * se encuentra modularizada en mallaSemestre.model.js.
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
            `SELECT 
                c.id_carrera, 
                c.codigo_carrera, 
                c.nombre_carrera, 
                c.estado,
                s.id_semestre,
                s.semestre,
                s.estado AS estado_semestre
             FROM carreras c
             LEFT JOIN semestres s ON s.id_carrera = c.id_carrera
             WHERE c.estado = 'A'
             ORDER BY c.nombre_carrera ASC, FIELD(s.semestre, 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X')`
        );

        const mapa = new Map();
        for (const fila of filas) {
            if (!mapa.has(fila.id_carrera)) {
                mapa.set(fila.id_carrera, {
                    id_carrera: fila.id_carrera,
                    codigo_carrera: fila.codigo_carrera,
                    nombre_carrera: fila.nombre_carrera,
                    estado: fila.estado,
                    semestres: []
                });
            }
            if (fila.id_semestre) {
                mapa.get(fila.id_carrera).semestres.push({
                    id_semestre: fila.id_semestre,
                    semestre: fila.semestre,
                    estado: fila.estado_semestre || 'A'
                });
            }
        }
        return Array.from(mapa.values());
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
    },

    /**
     * Busca una carrera por su id numérico.
     */
    async obtenerPorId(idCarrera, conexion) {
        const [filas] = await obtenerEjecutor(conexion).query(
            'SELECT id_carrera, codigo_carrera, nombre_carrera, estado FROM carreras WHERE id_carrera = ?',
            [idCarrera]
        );
        return filas[0] || null;
    },

    // Delegaciones a MallaSemestre para retrocompatibilidad total:
    obtenerMallaPorCarrera: (...args) => MallaSemestre.obtenerMallaPorCarrera(...args),
    obtenerTurnos: (...args) => MallaSemestre.obtenerTurnos(...args),
    obtenerProgramacion: (...args) => MallaSemestre.obtenerProgramacion(...args),
    guardarProgramacion: (...args) => MallaSemestre.guardarProgramacion(...args),
    actualizarTipoCurso: (...args) => MallaSemestre.actualizarTipoCurso(...args),
    calcularDistribucionHoras: (...args) => MallaSemestre.calcularDistribucionHoras(...args),
    crearCurso: (...args) => MallaSemestre.crearCurso(...args),
    actualizarCurso: (...args) => MallaSemestre.actualizarCurso(...args),
    eliminarCurso: (...args) => MallaSemestre.eliminarCurso(...args),
    obtenerDocentesPorTurno: (...args) => MallaSemestre.obtenerDocentesPorTurno(...args),
    obtenerListaDocentes: (...args) => MallaSemestre.obtenerListaDocentes(...args),
    actualizarEstadoCurso: (...args) => MallaSemestre.actualizarEstadoCurso(...args),
    actualizarEstadoSemestre: (...args) => MallaSemestre.actualizarEstadoSemestre(...args)
};

module.exports = Carrera;
