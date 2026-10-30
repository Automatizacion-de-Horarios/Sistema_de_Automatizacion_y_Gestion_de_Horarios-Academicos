const Carrera = require('../models/carrerasImpExp.model');

/**
 * Controlador de Carreras
 * Permite registrar nuevas carreras con su código y nombre institucional,
 * asegurando la creación de sus ciclos I al VI.
 *
 * Este controlador solo valida datos y aplica las reglas de negocio.
 * Todas las consultas e inserciones a la base de datos viven en
 * ../models/carrerasImpExp.model.js.
 */

class ErrorCarreraDuplicada extends Error {
    constructor(codigo) {
        super(`El código de carrera '${codigo}' ya se encuentra registrado en el sistema.`);
        this.name = 'ErrorCarreraDuplicada';
        this.statusCode = 400;
        this.codigo = codigo;
    }
}

const carrerasImpExpController = {

    /**
     * Obtener listado de todas las carreras activas
     */
    obtenerCarreras: async (req, res) => {
        try {
            const carreras = await Carrera.obtenerActivas();
            return res.json({
                status: 'ok',
                carreras
            });
        } catch (error) {
            console.error('Error al obtener carreras:', error);
            return res.status(500).json({
                status: 'error',
                mensaje: 'Error al consultar las carreras en la base de datos.'
            });
        }
    },

    /**
     * Registrar una nueva carrera con su código y nombre oficial
     */
    crearCarrera: async (req, res) => {
        try {
            const { codigo_carrera, nombre_carrera } = req.body;

            if (!codigo_carrera || !nombre_carrera) {
                return res.status(400).json({
                    status: 'error',
                    mensaje: 'Debe ingresar tanto el código (sigla) como el nombre oficial de la carrera.'
                });
            }

            const codigoLimpio = String(codigo_carrera).trim().toUpperCase();
            const nombreLimpio = String(nombre_carrera).trim();

            // La carrera y sus semestres se registran en una sola transacción:
            // o se guarda todo, o no se guarda nada.
            const nuevoIdCarrera = await Carrera.enTransaccion(async (conexion) => {
                // 1. Verificar si ya existe el código de carrera
                const carreraExistente = await Carrera.obtenerPorCodigo(codigoLimpio, conexion);

                if (carreraExistente) {
                    throw new ErrorCarreraDuplicada(codigoLimpio);
                }

                // 2. Insertar la nueva carrera
                const idCarrera = await Carrera.crear(
                    { codigo: codigoLimpio, nombre: nombreLimpio, estado: 'A' },
                    conexion
                );

                // 3. Crear automáticamente los 6 semestres (I al VI) con la meta oficial de 510 hrs.
                // Primero se consultan los semestres que ya existen para la carrera y solo se
                // insertan los que faltan, tal como se valida en la importación de mallas.
                const ciclos = ['I', 'II', 'III', 'IV', 'V', 'VI'];

                const semestresExistentes = await Carrera.obtenerSemestres(idCarrera, conexion);

                const semestresRegistrados = new Set(
                    semestresExistentes.map((fila) => String(fila.semestre).trim().toUpperCase())
                );

                for (const ciclo of ciclos) {
                    // Si el semestre ya existe para esta carrera, no se vuelve a insertar.
                    if (semestresRegistrados.has(ciclo)) continue;

                    await Carrera.crearSemestre(
                        { idCarrera, semestre: ciclo, horasMeta: 510, estado: 'A' },
                        conexion
                    );
                }

                return idCarrera;
            });

            return res.json({
                status: 'ok',
                mensaje: `Carrera '${nombreLimpio}' (${codigoLimpio}) registrada exitosamente con sus 6 semestres.`,
                carrera: {
                    id_carrera: nuevoIdCarrera,
                    codigo_carrera: codigoLimpio,
                    nombre_carrera: nombreLimpio
                }
            });

        } catch (error) {
            if (error instanceof ErrorCarreraDuplicada) {
                return res.status(error.statusCode).json({
                    status: 'error',
                    mensaje: error.message
                });
            }

            console.error('Error al registrar carrera:', error);
            return res.status(500).json({
                status: 'error',
                mensaje: 'Error interno al guardar la carrera en la base de datos.',
                detalle: error.message
            });
        }
    },

    /**
     * Obtener la malla curricular completa y cursos registrados para una carrera
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

            const filas = await Carrera.obtenerMallaPorCarrera(id);

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
            const filasDocentes = await Carrera.obtenerDocentesPorTurno();
            
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

            const turnosInfo = {
                manana: {
                    nombre: 'Turno Mañana',
                    horario: '07:45 – 13:00',
                    total_docentes: mapaTurnos.MANANA.size,
                    docentes: Array.from(mapaTurnos.MANANA.values())
                },
                tarde: {
                    nombre: 'Turno Tarde',
                    horario: '13:30 – 18:45',
                    total_docentes: mapaTurnos.TARDE.size,
                    docentes: Array.from(mapaTurnos.TARDE.values())
                },
                noche: {
                    nombre: 'Turno Noche',
                    horario: '18:45 – 22:30',
                    total_docentes: mapaTurnos.NOCHE.size,
                    docentes: Array.from(mapaTurnos.NOCHE.values())
                }
            };

            // Obtener lista completa de docentes activos (nombre y especialidad)
            const filasListaDocentes = await Carrera.obtenerListaDocentes();
            const docentesSimplificados = filasListaDocentes.map((d) => ({
                id_docente: d.id_docente,
                nombre_completo: `${d.nombres} ${d.apellidos}`.trim(),
                especialidad: d.especialidad
            }));

            // Obtener turnos oficiales registrados en la base de datos
            const turnosBD = await Carrera.obtenerTurnos();

            // Obtener programación académica ya guardada en programacion_academica
            const programacionExistente = await Carrera.obtenerProgramacion(infoCarrera.id_carrera);

            // Escalabilidad: todas las carreras tienen disponibles todos los turnos registrados en la BD (Turno 1, Turno 2, Turno 3)
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

            const totalGuardados = await Carrera.guardarProgramacion(asignaciones);

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

            const exito = await Carrera.actualizarTipoCurso(id, is_carrera);

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

            const idCurso = await Carrera.crearCurso(req.body);

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

            const exito = await Carrera.actualizarCurso(id, req.body);

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

            const exito = await Carrera.eliminarCurso(id);
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
    }
};

module.exports = carrerasImpExpController;

