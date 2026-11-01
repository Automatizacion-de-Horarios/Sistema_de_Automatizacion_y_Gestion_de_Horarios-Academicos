const db = require('../config/db');

/**
 * Modelo de Malla Curricular, Semestres y Cursos (Equipo 4 / Malla Semestre)
 * Centraliza las consultas e inserciones a la base de datos para:
 * - Consulta de la estructura curricular de una carrera (semestres II al VI y cursos)
 * - Turnos oficiales y asignaciones en programacion_academica
 * - Mantenimiento de cursos (crear, actualizar, eliminar, activar/inactivar)
 * - Mantenimiento de estado de semestres (habilitar/inhabilitar)
 * - Consulta de docentes y disponibilidad
 */

const obtenerEjecutor = (conexion) => conexion || db;

const MallaSemestre = {
    /**
     * Obtiene la estructura completa de mallas y cursos para una carrera,
     * agrupando los semestres (II al VI) y sus materias registradas.
     * Excluye el Semestre 1 (ciclo general que no se gestiona aquí).
     */
    async obtenerMallaPorCarrera(identificador, conexion) {
        const esNumero = !isNaN(Number(identificador));
        const condicion = esNumero ? 'c.id_carrera = ?' : 'c.codigo_carrera = ?';

        const [filas] = await obtenerEjecutor(conexion).query(
            `SELECT 
                c.id_carrera,
                c.codigo_carrera,
                c.nombre_carrera,
                c.estado AS estado_carrera,
                s.id_semestre,
                s.semestre,
                s.horas_semestre_meta,
                s.estado AS estado_semestre,
                cur.id_curso,
                cur.mat_cur,
                cur.horario_sinfo,
                cur.nombre_curso,
                cur.semanas,
                cur.horas_teoria,
                cur.horas_taller,
                cur.horas_virtual,
                cur.horas_evaluacion,
                cur.total_horas,
                cur.is_carrera,
                cur.catalogo,
                cur.estado AS estado_curso
            FROM carreras c
            INNER JOIN semestres s ON s.id_carrera = c.id_carrera
            LEFT JOIN cursos cur ON cur.id_semestre = s.id_semestre
            WHERE ${condicion} AND UPPER(TRIM(s.semestre)) NOT IN ('I', '1')
            ORDER BY 
                FIELD(s.semestre, 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'),
                cur.nombre_curso ASC`,
            [identificador]
        );
        return filas;
    },

    /**
     * Obtiene los turnos registrados y activos en la base de datos
     */
    async obtenerTurnos(conexion) {
        try {
            const [filas] = await obtenerEjecutor(conexion).query(
                `SELECT id_turno, codigo_turno, estado 
                 FROM turnos 
                 WHERE estado = 'A' 
                 ORDER BY id_turno ASC`
            );
            return filas;
        } catch (error) {
            console.error('Error al consultar turnos en la base de datos:', error.message);
            return [];
        }
    },

    /**
     * Obtiene la programación académica registrada para los cursos de una carrera
     */
    async obtenerProgramacion(idCarrera, conexion) {
        try {
            const [filas] = await obtenerEjecutor(conexion).query(
                `SELECT 
                    pa.id_programacion,
                    pa.id_periodo,
                    pa.id_sede,
                    pa.id_curso,
                    pa.id_turno,
                    pa.grupo,
                    pa.id_docente_tec,
                    pa.id_docente_tal,
                    c.id_semestre,
                    s.semestre
                 FROM programacion_academica pa
                 INNER JOIN cursos c ON c.id_curso = pa.id_curso
                 INNER JOIN semestres s ON s.id_semestre = c.id_semestre
                 WHERE s.id_carrera = ? AND pa.estado = 'A'`,
                [idCarrera]
            );
            return filas;
        } catch (error) {
            console.error('Error al consultar programacion_academica:', error.message);
            return [];
        }
    },

    /**
     * Guarda la configuración de docentes por curso y turno en programacion_academica.
     * Solo hay 1 sede (UCP - id_sede 1) y 1 periodo (202620 - id_periodo 1).
     * OPTIMIZACIÓN: Realiza una única consulta masiva (Bulk Insert / Batch) y limpieza agrupada
     * para reducir el tiempo de guardado de ~5 segundos a menos de 300 ms.
     */
    async guardarProgramacion(asignaciones, idCarrera, conexion) {
        if (!asignaciones || asignaciones.length === 0) return 0;
        const ejecutor = obtenerEjecutor(conexion);

        const idPeriodo = 1;
        const idSede = 1;

        // 1. Limpieza agrupada de turnos descartados
        const turnosValidosPorCurso = new Map();
        for (const item of asignaciones) {
            if (!item.id_curso || !item.id_turno) continue;
            const idC = Number(item.id_curso);
            const idT = Number(item.id_turno);
            if (!turnosValidosPorCurso.has(idC)) {
                turnosValidosPorCurso.set(idC, new Set());
            }
            turnosValidosPorCurso.get(idC).add(idT);
        }

        // Agrupamos cursos que tienen el mismo patrón de turnos para no ejecutar 40 DELETE individuales
        const cursosPorPatronTurnos = new Map();
        for (const [idCurso, turnosSet] of turnosValidosPorCurso.entries()) {
            const patternKey = Array.from(turnosSet).sort((a, b) => a - b).join(',');
            if (!cursosPorPatronTurnos.has(patternKey)) {
                cursosPorPatronTurnos.set(patternKey, []);
            }
            cursosPorPatronTurnos.get(patternKey).push(idCurso);
        }

        for (const [turnosStr, listaCursos] of cursosPorPatronTurnos.entries()) {
            if (turnosStr && listaCursos.length > 0) {
                const cursosIdsSql = listaCursos.map(Number).join(', ');
                await ejecutor.query(
                    `DELETE FROM programacion_academica 
                     WHERE id_periodo = ? AND id_sede = ? AND id_curso IN (${cursosIdsSql}) AND id_turno NOT IN (${turnosStr})`,
                    [idPeriodo, idSede]
                );
            }
        }

        // 2. Preparar todas las filas en memoria para un único Bulk Insert
        const filasParaInsertar = [];
        for (const item of asignaciones) {
            if (!item.id_curso || !item.id_turno) continue;

            const grupo = item.grupo || '01';
            const idDocenteTec = item.id_docente_tec ? Number(item.id_docente_tec) : null;
            const idDocenteTal = item.id_docente_tal ? Number(item.id_docente_tal) : null;

            filasParaInsertar.push([
                idPeriodo,
                idSede,
                Number(item.id_curso),
                Number(item.id_turno),
                grupo,
                idDocenteTec,
                idDocenteTal,
                'A'
            ]);
        }

        // 3. Ejecutar Bulk Insert masivo (1 solo viaje a la base de datos)
        if (filasParaInsertar.length > 0) {
            await ejecutor.query(
                `INSERT INTO programacion_academica 
                 (id_periodo, id_sede, id_curso, id_turno, grupo, id_docente_tec, id_docente_tal, estado)
                 VALUES ?
                 ON DUPLICATE KEY UPDATE
                 id_docente_tec = VALUES(id_docente_tec),
                 id_docente_tal = VALUES(id_docente_tal),
                 estado = 'A'`,
                [filasParaInsertar]
            );
        }

        return filasParaInsertar.length;
    },

    /**
     * Actualiza si un curso es de carrera (1) o complementario (0)
     */
    async actualizarTipoCurso(idCurso, isCarrera, conexion) {
        const [resultado] = await obtenerEjecutor(conexion).query(
            'UPDATE cursos SET is_carrera = ? WHERE id_curso = ?',
            [isCarrera ? 1 : 0, idCurso]
        );
        return resultado.affectedRows > 0;
    },

    /**
     * Calcula la distribución de horas según horario_sinfo para cumplir el check constraint:
     * chk_horas_cuadran_exacto: (horas_teoria + horas_taller + horas_virtual + horas_evaluacion) = total_horas
     */
    calcularDistribucionHoras(datos) {
        const esSeminario = /seminario/i.test(datos.nombre_curso || '');
        const total = Number(datos.total_horas) || 0;
        let teoria = Number(datos.horas_teoria) || 0;
        let taller = Number(datos.horas_taller) || 0;
        let virtualH = Number(datos.horas_virtual) || 0;
        let evaluacion = Number(datos.horas_evaluacion) || 0;

        if (esSeminario) {
            teoria = 0;
            taller = total;
            virtualH = 0;
            evaluacion = 0;
        } else if ((teoria + taller + virtualH + evaluacion) !== total) {
            const horario = String(datos.horario_sinfo || '').toUpperCase();
            if (horario === 'TEC') {
                teoria = total;
                taller = 0;
            } else if (horario === 'TAL' || horario === 'EMP') {
                taller = total;
                teoria = 0;
            } else if (horario === 'TEC-TAL') {
                teoria = Math.floor(total * 0.4);
                taller = total - teoria;
            } else {
                teoria = total;
                taller = 0;
            }
            virtualH = 0;
            evaluacion = 0;
        }

        return { teoria, taller, virtualH, evaluacion, total };
    },

    /**
     * Inserta un nuevo curso en la tabla cursos.
     */
    async crearCurso(datos, conexion) {
        const esSeminario = /seminario/i.test(datos.nombre_curso || '');
        const horarioSinfo = esSeminario ? 'TAL' : (datos.horario_sinfo || 'TEC');
        const { teoria, taller, virtualH, evaluacion, total } = this.calcularDistribucionHoras(datos);
        const [resultado] = await obtenerEjecutor(conexion).query(
            `INSERT INTO cursos 
             (id_semestre, mat_cur, horario_sinfo, nombre_curso, semanas, horas_teoria, horas_taller, horas_virtual, horas_evaluacion, total_horas, estado, is_carrera, catalogo)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'A', ?, ?)`,
            [
                datos.id_semestre,
                String(datos.mat_cur || '').trim().toUpperCase(),
                horarioSinfo,
                String(datos.nombre_curso || '').trim().toUpperCase(),
                Number(datos.semanas) || 16,
                teoria,
                taller,
                virtualH,
                evaluacion,
                total,
                datos.is_carrera ? 1 : 0,
                datos.catalogo ? String(datos.catalogo).trim() : null
            ]
        );
        return resultado.insertId;
    },

    /**
     * Actualiza los datos de un curso existente en la tabla cursos.
     */
    async actualizarCurso(idCurso, datos, conexion) {
        const esSeminario = /seminario/i.test(datos.nombre_curso || '');
        const horarioSinfo = esSeminario ? 'TAL' : (datos.horario_sinfo || 'TEC');
        const { teoria, taller, virtualH, evaluacion, total } = this.calcularDistribucionHoras(datos);
        const [resultado] = await obtenerEjecutor(conexion).query(
            `UPDATE cursos SET
                mat_cur = ?,
                horario_sinfo = ?,
                nombre_curso = ?,
                semanas = ?,
                horas_teoria = ?,
                horas_taller = ?,
                horas_virtual = ?,
                horas_evaluacion = ?,
                total_horas = ?,
                is_carrera = ?,
                catalogo = ?
             WHERE id_curso = ?`,
            [
                String(datos.mat_cur || '').trim().toUpperCase(),
                horarioSinfo,
                String(datos.nombre_curso || '').trim().toUpperCase(),
                Number(datos.semanas) || 16,
                teoria,
                taller,
                virtualH,
                evaluacion,
                total,
                datos.is_carrera ? 1 : 0,
                datos.catalogo ? String(datos.catalogo).trim() : null,
                idCurso
            ]
        );
        return resultado.affectedRows > 0;
    },

    /**
     * Elimina un curso de la tabla cursos.
     */
    async eliminarCurso(idCurso, conexion) {
        const [resultado] = await obtenerEjecutor(conexion).query(
            'DELETE FROM cursos WHERE id_curso = ?',
            [idCurso]
        );
        return resultado.affectedRows > 0;
    },

    /**
     * Obtiene los docentes activos y su disponibilidad horaria registrada,
     * clasificada por turnos (Mañana, Tarde, Noche).
     */
    async obtenerDocentesPorTurno(conexion) {
        try {
            const [filas] = await obtenerEjecutor(conexion).query(
                `SELECT 
                    d.id_docente,
                    TRIM(d.nombres) AS nombres,
                    TRIM(d.apellidos) AS apellidos,
                    TRIM(d.especialidad) AS especialidad,
                    disp.dia_semana,
                    disp.hora_inicio,
                    disp.hora_fin,
                    CASE 
                        WHEN disp.hora_inicio < '13:00:00' THEN 'MANANA'
                        WHEN disp.hora_inicio < '18:00:00' THEN 'TARDE'
                        ELSE 'NOCHE'
                    END AS turno
                FROM docentes d
                INNER JOIN disponibilidad_docentes disp ON disp.id_docente = d.id_docente
                WHERE d.estado = 'A' AND disp.estado = 'A'
                ORDER BY d.apellidos ASC, d.nombres ASC`
            );
            return filas;
        } catch (error) {
            console.error('Error al consultar docentes y disponibilidad:', error.message);
            return [];
        }
    },

    /**
     * Obtiene la lista completa de docentes activos con su nombre y especialidad
     */
    async obtenerListaDocentes(conexion) {
        try {
            const [filas] = await obtenerEjecutor(conexion).query(
                `SELECT 
                    id_docente,
                    TRIM(nombres) AS nombres,
                    TRIM(apellidos) AS apellidos,
                    TRIM(especialidad) AS especialidad
                FROM docentes
                WHERE estado = 'A'
                ORDER BY apellidos ASC, nombres ASC`
            );
            return filas;
        } catch (error) {
            console.error('Error al consultar lista de docentes:', error.message);
            return [];
        }
    },

    /**
     * Actualiza el estado (A=Activo, I=Inactivo) de un curso
     */
    async actualizarEstadoCurso(idCurso, nuevoEstado, conexion) {
        const [resultado] = await obtenerEjecutor(conexion).query(
            'UPDATE cursos SET estado = ?, fecha_modificacion = CURRENT_TIMESTAMP WHERE id_curso = ?',
            [nuevoEstado, idCurso]
        );
        return resultado.affectedRows > 0;
    },

    /**
     * Actualiza el estado (A=Activo, I=Inactivo) de un semestre de la carrera
     */
    async actualizarEstadoSemestre(idSemestre, nuevoEstado, conexion) {
        const [resultado] = await obtenerEjecutor(conexion).query(
            'UPDATE semestres SET estado = ? WHERE id_semestre = ?',
            [nuevoEstado, idSemestre]
        );
        return resultado.affectedRows > 0;
    }
};

module.exports = MallaSemestre;

