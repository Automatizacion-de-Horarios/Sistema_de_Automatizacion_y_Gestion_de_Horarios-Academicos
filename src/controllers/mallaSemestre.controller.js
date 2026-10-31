const MallaSemestre = require('../models/mallaSemestre.model');
const Carrera = require('../models/carrerasImpExp.model');

/**
 * Controlador de Malla Curricular, Semestres y Cursos (Equipo 4 / Malla Semestre)
 * Gestiona:
 * - Consulta de la estructura curricular y cursos por semestre de una carrera
 * - Registro y actualización de asignaciones en programacion_academica
 * - Mantenimiento CRUD de cursos (creación, edición, eliminación, tipo de curso, estado)
 * - Mantenimiento de estado de semestres (habilitar/inhabilitar)
 */

const mallaSemestreController = {

    /**
     * Obtener la malla curricular completa y cursos registrados para una carrera (Semestres II al VI)
     */
    obtenerMallaCarrera: async (req, res) => {
        try {
            const { id } = req.params;

            if (!id) {
                return res.status(400).json({
                    status: 'error',
                    mensaje: 'Debe especificar el identificador o código de la carrera.'
                });
            }

            const filas = await MallaSemestre.obtenerMallaPorCarrera(id);

            if (!filas || filas.length === 0) {
                // Verificar si al menos existe la carrera pero sin semestres aún
                const carrera = isNaN(Number(id))
                    ? await Carrera.obtenerPorCodigo(String(id).toUpperCase())
                    : await Carrera.obtenerPorId(id);

                if (!carrera) {
                    return res.status(404).json({
                        status: 'error',
                        mensaje: `No se encontró la carrera especificada (${id}).`
                    });
                }

                return res.json({
                    status: 'ok',
                    carrera,
                    estadisticas: {
                        total_cursos: 0,
                        total_horas: 0,
                        total_semestres: 0
                    },
                    semestres: []
                });
            }

            // Datos base de la carrera (de la primera fila)
            const infoCarrera = {
                id_carrera: filas[0].id_carrera,
                codigo_carrera: filas[0].codigo_carrera,
                nombre_carrera: filas[0].nombre_carrera,
                estado: filas[0].estado_carrera
            };

            // Agrupar filas por semestre
            const mapaSemestres = new Map();

            let totalCursos = 0;
            let totalHorasCarrera = 0;

            for (const f of filas) {
                if (!mapaSemestres.has(f.id_semestre)) {
                    mapaSemestres.set(f.id_semestre, {
                        id_semestre: f.id_semestre,
                        semestre: f.semestre,
                        horas_meta: f.horas_semestre_meta || 510,
                        estado: f.estado_semestre || 'A',
                        total_horas: 0,
                        cursos: []
                    });
                }

                const semestreObj = mapaSemestres.get(f.id_semestre);

                // Si la fila tiene un curso registrado (LEFT JOIN no nulo)
                if (f.id_curso) {
                    const horasCurso = Number(f.total_horas) || 0;
                    semestreObj.total_horas += horasCurso;
                    totalHorasCarrera += horasCurso;
                    totalCursos++;

                    semestreObj.cursos.push({
                        id_curso: f.id_curso,
                        mat_cur: f.mat_cur,
                        horario_sinfo: f.horario_sinfo,
                        nombre_curso: f.nombre_curso,
                        semanas: f.semanas,
                        horas_teoria: Number(f.horas_teoria) || 0,
                        horas_taller: Number(f.horas_taller) || 0,
                        horas_virtual: Number(f.horas_virtual) || 0,
                        horas_evaluacion: Number(f.horas_evaluacion) || 0,
                        total_horas: horasCurso,
                        is_carrera: f.is_carrera !== undefined ? Number(f.is_carrera) : 1,
                        catalogo: f.catalogo || '',
                        estado: f.estado_curso
                    });
                }
            }

            const semestres = Array.from(mapaSemestres.values());

            // Obtener docentes y su disponibilidad agrupados por turno
            const filasDocentes = await MallaSemestre.obtenerDocentesPorTurno();
            
            const mapaTurnos = {
                MANANA: new Map(),
                TARDE: new Map(),
                NOCHE: new Map()
            };

            for (const doc of filasDocentes) {
                const turno = doc.turno || 'MANANA';
                if (!mapaTurnos[turno]) continue;

                if (!mapaTurnos[turno].has(doc.id_docente)) {
                    mapaTurnos[turno].set(doc.id_docente, {
                        id_docente: doc.id_docente,
                        nombre_completo: `${doc.nombres} ${doc.apellidos}`.trim(),
                        especialidad: doc.especialidad,
                        horarios: []
                    });
                }

                mapaTurnos[turno].get(doc.id_docente).horarios.push({
                    dia: doc.dia_semana,
                    inicio: doc.hora_inicio,
                    fin: doc.hora_fin
                });
            }

            // Obtener lista completa de docentes activos (nombre y especialidad)
            const filasListaDocentes = await MallaSemestre.obtenerListaDocentes();
            const docentesSimplificados = filasListaDocentes.map((d) => ({
                id_docente: d.id_docente,
                nombre_completo: `${d.nombres} ${d.apellidos}`.trim(),
                especialidad: d.especialidad
            }));

            // Obtener turnos oficiales registrados en la base de datos
            const turnosBD = await MallaSemestre.obtenerTurnos();

            // Obtener programación académica ya guardada en programacion_academica
            const programacionExistente = await MallaSemestre.obtenerProgramacion(infoCarrera.id_carrera);

            // Escalabilidad: todas las carreras tienen disponibles los turnos registrados en la BD (Turno 1, Turno 2, Turno 3)
            const maxTurnos = turnosBD.length > 0 ? turnosBD.length : 3;

            return res.json({
                status: 'ok',
                carrera: infoCarrera,
                estadisticas: {
                    total_cursos: totalCursos,
                    total_horas: totalHorasCarrera,
                    total_semestres: semestres.length
                },
                semestres,
                docentes: docentesSimplificados,
                turnos: turnosBD,
                programacion: programacionExistente,
                max_turnos: maxTurnos
            });

        } catch (error) {
            console.error('Error al obtener la malla de la carrera:', error);
            return res.status(500).json({
                status: 'error',
                mensaje: 'Error interno al consultar la malla y cursos de la carrera.',
                detalle: error.message
            });
        }
    },

    /**
     * Guardar la configuración de asignaciones en la tabla programacion_academica
     */
    guardarProgramacion: async (req, res) => {
        try {
            const { asignaciones } = req.body;

            if (!asignaciones || !Array.isArray(asignaciones)) {
                return res.status(400).json({
                    status: 'error',
                    mensaje: 'Debe enviar una lista válida de asignaciones para guardar en la programación académica.'
                });
            }

            const totalGuardados = await MallaSemestre.guardarProgramacion(asignaciones);

            return res.json({
                status: 'ok',
                mensaje: 'Configuración guardada exitosamente en la programación académica.',
                total_guardados: totalGuardados
            });
        } catch (error) {
            console.error('Error al guardar en programacion_academica:', error);
            return res.status(500).json({
                status: 'error',
                mensaje: 'Error al registrar la configuración en programacion_academica.',
                detalle: error.message
            });
        }
    },

    /**
     * Actualizar si un curso es de carrera (1) o complementario (0)
     */
    actualizarTipoCurso: async (req, res) => {
        try {
            const { id } = req.params;
            const { is_carrera } = req.body;

            if (!id || is_carrera === undefined) {
                return res.status(400).json({
                    status: 'error',
                    mensaje: 'Debe proporcionar el id del curso y el valor is_carrera (1 o 0).'
                });
            }

            const exito = await MallaSemestre.actualizarTipoCurso(id, is_carrera);

            if (!exito) {
                return res.status(404).json({
                    status: 'error',
                    mensaje: 'No se encontró el curso especificado para actualizar.'
                });
            }

            return res.json({
                status: 'ok',
                mensaje: 'Tipo de curso actualizado correctamente.',
                is_carrera: is_carrera ? 1 : 0
            });
        } catch (error) {
            console.error('Error al actualizar tipo de curso:', error);
            return res.status(500).json({
                status: 'error',
                mensaje: 'Error interno al actualizar el tipo de curso.',
                detalle: error.message
            });
        }
    },

    /**
     * Crear un nuevo curso en un semestre de la carrera
     */
    crearCurso: async (req, res) => {
        try {
            const { id_semestre, mat_cur, nombre_curso, total_horas } = req.body;

            if (!id_semestre || !mat_cur || !nombre_curso || !total_horas) {
                return res.status(400).json({
                    status: 'error',
                    mensaje: 'Los campos id_semestre, mat_cur, nombre_curso y total_horas son obligatorios.'
                });
            }

            const idCurso = await MallaSemestre.crearCurso(req.body);

            return res.status(201).json({
                status: 'ok',
                mensaje: 'Curso creado exitosamente.',
                id_curso: idCurso
            });
        } catch (error) {
            console.error('Error al crear curso:', error);
            if (error.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({
                    status: 'error',
                    mensaje: `Ya existe un curso registrado con el código MAT CUR "${req.body.mat_cur}" en este semestre.`
                });
            }
            return res.status(500).json({
                status: 'error',
                mensaje: 'Error interno al registrar el nuevo curso.',
                detalle: error.message
            });
        }
    },

    /**
     * Actualizar los datos de un curso existente
     */
    actualizarCurso: async (req, res) => {
        try {
            const { id } = req.params;
            const { mat_cur, nombre_curso, total_horas } = req.body;

            if (!id || !mat_cur || !nombre_curso || !total_horas) {
                return res.status(400).json({
                    status: 'error',
                    mensaje: 'Los campos mat_cur, nombre_curso y total_horas son obligatorios para actualizar.'
                });
            }

            const exito = await MallaSemestre.actualizarCurso(id, req.body);

            if (!exito) {
                return res.status(404).json({
                    status: 'error',
                    mensaje: 'No se encontró el curso solicitado para actualizar.'
                });
            }

            return res.json({
                status: 'ok',
                mensaje: 'Curso actualizado exitosamente.'
            });
        } catch (error) {
            console.error('Error al actualizar curso:', error);
            if (error.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({
                    status: 'error',
                    mensaje: `Ya existe otro curso con el código MAT CUR "${req.body.mat_cur}" en este semestre.`
                });
            }
            return res.status(500).json({
                status: 'error',
                mensaje: 'Error interno al actualizar el curso.',
                detalle: error.message
            });
        }
    },

    /**
     * Eliminar un curso de la malla
     */
    eliminarCurso: async (req, res) => {
        try {
            const { id } = req.params;
            if (!id) {
                return res.status(400).json({
                    status: 'error',
                    mensaje: 'Se requiere el id del curso a eliminar.'
                });
            }

            const exito = await MallaSemestre.eliminarCurso(id);
            if (!exito) {
                return res.status(404).json({
                    status: 'error',
                    mensaje: 'No se encontró el curso para eliminar.'
                });
            }

            return res.json({
                status: 'ok',
                mensaje: 'Curso eliminado exitosamente.'
            });
        } catch (error) {
            console.error('Error al eliminar curso:', error);
            return res.status(500).json({
                status: 'error',
                mensaje: 'Error interno al eliminar el curso.',
                detalle: error.message
            });
        }
    },

    /**
     * Habilitar o inhabilitar un curso específico (estado 'A' o 'I')
     */
    actualizarEstadoCurso: async (req, res) => {
        try {
            const { id } = req.params;
            const { estado } = req.body;

            if (!id) {
                return res.status(400).json({
                    status: 'error',
                    mensaje: 'Debe especificar el id del curso.'
                });
            }

            const estadoLimpio = String(estado).toUpperCase() === 'I' ? 'I' : 'A';
            const exito = await MallaSemestre.actualizarEstadoCurso(id, estadoLimpio);

            if (!exito) {
                return res.status(404).json({
                    status: 'error',
                    mensaje: 'No se encontró el curso para actualizar.'
                });
            }

            return res.json({
                status: 'ok',
                mensaje: `Curso ${estadoLimpio === 'A' ? 'activado' : 'inactivado'} exitosamente.`,
                estado: estadoLimpio
            });
        } catch (error) {
            console.error('Error al actualizar estado del curso:', error);
            return res.status(500).json({
                status: 'error',
                mensaje: 'Error al actualizar el estado del curso en la base de datos.',
                detalle: error.message
            });
        }
    },

    /**
     * Habilitar o inhabilitar un semestre específico de una carrera (estado 'A' o 'I')
     */
    actualizarEstadoSemestre: async (req, res) => {
        try {
            const { id } = req.params;
            const { estado } = req.body;

            if (!id) {
                return res.status(400).json({
                    status: 'error',
                    mensaje: 'Debe especificar el id del semestre.'
                });
            }

            const estadoLimpio = String(estado).toUpperCase() === 'I' ? 'I' : 'A';
            const exito = await MallaSemestre.actualizarEstadoSemestre(id, estadoLimpio);

            if (!exito) {
                return res.status(404).json({
                    status: 'error',
                    mensaje: 'No se encontró el semestre para actualizar.'
                });
            }

            return res.json({
                status: 'ok',
                mensaje: `Semestre ${estadoLimpio === 'A' ? 'habilitado' : 'inhabilitado'} exitosamente.`,
                estado: estadoLimpio
            });
        } catch (error) {
            console.error('Error al actualizar estado del semestre:', error);
            return res.status(500).json({
                status: 'error',
                mensaje: 'Error al actualizar el estado del semestre en la base de datos.',
                detalle: error.message
            });
        }
    }
};

module.exports = mallaSemestreController;

