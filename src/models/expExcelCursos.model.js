const db = require('../config/db');

/**
 * Modelo de Exportación de Estructura Curricular (Cursos y Mallas)
 * Devuelve los cursos registrados junto con su carrera y semestre para poder
 * reconstruir el Excel de estructura curricular en el mismo formato que se
 * usa para importar (CATALOGO, MAT CUR, HORARIO SINFO, SEMANAS, HORAS, etc.).
 *
 * Solo tiene consultas de lectura: la exportación nunca modifica la base de datos.
 */
const EstructuraCurricular = {
    /**
     * Obtiene todos los cursos con los datos de su semestre y su carrera.
     * El orden base es por código de carrera (para agrupar) y por id_curso
     * (que conserva el orden en que se importó cada curso dentro del semestre).
     */
    async obtenerCursosParaExportar() {
        const [filas] = await db.query(
            `SELECT ca.codigo_carrera,
                    s.semestre,
                    s.horas_semestre_meta,
                    c.id_curso,
                    c.mat_cur,
                    c.catalogo,
                    c.horario_sinfo,
                    c.nombre_curso,
                    c.semanas,
                    c.horas_teoria,
                    c.horas_taller,
                    c.horas_virtual,
                    c.horas_evaluacion,
                    c.total_horas
               FROM cursos c
               INNER JOIN semestres s ON s.id_semestre = c.id_semestre
               INNER JOIN carreras ca ON ca.id_carrera = s.id_carrera
              ORDER BY ca.codigo_carrera ASC, c.id_curso ASC`
        );
        return filas;
    }
};

module.exports = EstructuraCurricular;
