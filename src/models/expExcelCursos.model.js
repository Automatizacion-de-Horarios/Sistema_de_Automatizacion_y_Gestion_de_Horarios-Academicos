const db = require('../config/db');

const EstructuraCurricular = {

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
