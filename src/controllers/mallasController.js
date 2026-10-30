const xlsx = require('xlsx');
const crypto = require('crypto');
const db = require('../config/db');

/**
 * Controlador de Mallas y Cursos (Equipo 3)
 * Recibe el archivo Excel directamente del usuario,
 * ignora las columnas CATALOGO y CLASIFICACION BLACKBOARD,
 * valida que todas las carreras existan con SELECT previo (si falta alguna, anula el proceso),
 * y verifica que la pareja (id_carrera, mat_cur) no se repita.
 *
 * REGLA DE DUPLICADOS:
 * - Si un MAT CUR ya fue registrado para la MISMA carrera, se ignora toda la fila.
 * - Si el MAT CUR se repite pero pertenece a OTRA carrera, sí se registra.
 *   Ejemplo: SCIU-185 se comparte entre PIAD, NAED, PCBD, etc., y debe existir en cada una.
 */

// Trabajos de importación en memoria para reportar el avance real al frontend.
const trabajosImportacion = new Map();
const TIEMPO_VIDA_TRABAJO_MS = 15 * 60 * 1000; // 15 minutos

class ErrorImportacion extends Error {
    constructor(mensaje, opciones = {}) {
        super(mensaje);
        this.name = 'ErrorImportacion';
        this.statusCode = opciones.statusCode || 400;
        this.tipo = opciones.tipo || null;
        this.carrerasFaltantes = opciones.carrerasFaltantes || [];
        this.detalle = opciones.detalle || null;
    }
}

// Limpia trabajos antiguos para no acumular memoria en el servidor.
const limpiarTrabajosAntiguos = () => {
    const ahora = Date.now();
    for (const [id, trabajo] of trabajosImportacion.entries()) {
        if (ahora - trabajo.creadoEn > TIEMPO_VIDA_TRABAJO_MS) {
            trabajosImportacion.delete(id);
        }
    }
};

const crearTrabajo = (nombreArchivo) => {
    limpiarTrabajosAntiguos();

    const trabajo = {
        id: crypto.randomUUID(),
        nombreArchivo,
        estado: 'en_cola', // en_cola | procesando | completado | error
        porcentaje: 0,
        paso: 'En cola',
        mensaje: 'Preparando el archivo para su análisis...',
        datos: {
            totalFilas: 0,
            filasProcesadas: 0,
            cursosInsertados: 0,
            filasIgnoradas: 0,
            semestresCreados: 0
        },
        resultado: null,
        error: null,
        creadoEn: Date.now(),
        actualizadoEn: Date.now()
    };

    trabajosImportacion.set(trabajo.id, trabajo);
    return trabajo;
};

const actualizarTrabajo = (trabajo, cambios) => {
    Object.assign(trabajo, cambios, { actualizadoEn: Date.now() });
};

// Convierte un valor de Excel a entero seguro (evita NaN / NULL inesperados).
const aEntero = (valor, valorPorDefecto = 0) => {
    const numero = parseInt(valor, 10);
    return Number.isFinite(numero) ? numero : valorPorDefecto;
};

const normalizarHorario = (valor) => {
    const horario = valor ? String(valor).trim().toUpperCase() : '';
    return ['TEC', 'TAL', 'TEC-TAL', 'EMP'].includes(horario) ? horario : 'TEC';
};

/**
 * Procesa el buffer del Excel y realiza toda la importación en una transacción.
 * Devuelve el mismo reporte que consume el frontend.
 * El callback `alProgresar` permite reportar el avance (fila, porcentaje y paso actual).
 */
const procesarArchivoExcel = async (buffer, opciones = {}) => {
    const { nombreArchivo = '', alProgresar = () => {} } = opciones;

    let connection;

    try {
        // ==============================================================
        // LECTURA DEL ARCHIVO EN MEMORIA
        // ==============================================================
        alProgresar({
            estado: 'procesando',
            porcentaje: 2,
            paso: 'Leyendo archivo',
            mensaje: 'Leyendo la hoja de cálculo del Excel...'
        });

        const workbook = xlsx.read(buffer, { type: 'buffer' });
        const primeraHoja = workbook.SheetNames[0];

        if (!primeraHoja) {
            throw new ErrorImportacion('El archivo Excel no contiene hojas para procesar.');
        }

        const sheet = workbook.Sheets[primeraHoja];
        const filas = xlsx.utils.sheet_to_json(sheet, { header: 1 });

        if (!filas || filas.length < 3) {
            throw new ErrorImportacion('El archivo Excel no contiene filas de datos suficientes.');
        }

        // Iniciar conexión y transacción SQL
        connection = await db.getConnection();
        await connection.beginTransaction();

        // ==============================================================
        // FASE 1: VALIDACIÓN PREVIA DE CÓDIGOS DE CARRERA
        // Escanea todos los códigos de carrera que vienen en el archivo.
        // Si detecta un código que NO existe en la tabla carreras, anula
        // el proceso inmediatamente para que el usuario registre su nombre oficial.
        // ==============================================================
        alProgresar({
            estado: 'procesando',
            porcentaje: 5,
            paso: 'Validando carreras',
            mensaje: 'Buscando los códigos de carrera del archivo en la base de datos...',
            datos: { totalFilas: Math.max(filas.length - 2, 0) }
        });

        const codigosEnExcel = new Set();
        for (let i = 2; i < filas.length; i++) {
            const fila = filas[i];
            if (fila && fila[0]) {
                codigosEnExcel.add(String(fila[0]).trim().toUpperCase());
            }
        }

        const carrerasFaltantes = [];
        const mapaCarrerasValidas = new Map(); // codigo_carrera -> id_carrera
        const totalCarreras = Math.max(codigosEnExcel.size, 1);
        let carrerasVerificadas = 0;

        for (const codigo of codigosEnExcel) {
            const [existe] = await connection.query(
                'SELECT id_carrera, nombre_carrera FROM carreras WHERE codigo_carrera = ?',
                [codigo]
            );

            if (existe && existe.length > 0) {
                mapaCarrerasValidas.set(codigo, existe[0].id_carrera);
            } else {
                carrerasFaltantes.push(codigo);
            }

            carrerasVerificadas++;
            alProgresar({
                porcentaje: Math.max(5, Math.round(5 + (carrerasVerificadas / totalCarreras) * 10)),
                paso: 'Validando carreras',
                mensaje: `Verificando carreras: ${carrerasVerificadas} de ${codigosEnExcel.size}...`
            });
        }

        // SI HAY CARRERAS QUE NO EXISTEN EN LA BD -> ANULAR EL PROCESO
        if (carrerasFaltantes.length > 0) {
            throw new ErrorImportacion(
                `No detectamos el código de carrera en la base de datos: ${carrerasFaltantes.join(', ')}.`,
                {
                    tipo: 'CARRERAS_NO_REGISTRADAS',
                    carrerasFaltantes,
                    detalle: `El archivo contiene carreras no registradas (${carrerasFaltantes.join(', ')}). Por favor use la opción 'Agregar Nueva Carrera' para registrar su código y nombre institucional antes de volver a importar.`
                }
            );
        }

        // ==============================================================
        // FASE 2: PROCESAMIENTO E INSERCIÓN LIMPIA
        // La clave de control es (id_carrera + mat_cur), NO solo mat_cur.
        // ==============================================================
        const clavesProcesadasEnArchivo = new Set(); // `${idCarrera}|${matCur}`

        let totalFilasLeidas = 0;
        let semestresCreados = 0;
        let cursosInsertados = 0;
        let filasIgnoradasPorRepetido = 0;

        const totalFilasArchivo = Math.max(filas.length - 2, 1);

        for (let i = 2; i < filas.length; i++) {
            const fila = filas[i];
            const numeroFilaExcel = i + 1;

            if (!fila || fila.length === 0) continue;

            const codigoCarrera = fila[0] ? String(fila[0]).trim().toUpperCase() : null;
            const matCur = fila[2] ? String(fila[2]).trim().toUpperCase() : null;

            if (!codigoCarrera || !matCur) continue;

            totalFilasLeidas++;

            // 2.1. Obtener el id_carrera ya validado
            const idCarrera = mapaCarrerasValidas.get(codigoCarrera);

            // 2.2. REGLA: no repetir el mismo MAT CUR dentro de la MISMA carrera.
            // Un mismo MAT CUR sí puede registrarse en carreras diferentes.
            const claveCurso = `${idCarrera}|${matCur}`;

            if (clavesProcesadasEnArchivo.has(claveCurso)) {
                filasIgnoradasPorRepetido++;
                alProgresar({
                    porcentaje: Math.min(99, Math.round(20 + (i / totalFilasArchivo) * 75)),
                    paso: 'Procesando cursos',
                    mensaje: `Fila ${numeroFilaExcel}: ${matCur} ya está registrado para ${codigoCarrera}, se omite.`,
                    datos: {
                        totalFilas: totalFilasArchivo,
                        filasProcesadas: i - 1,
                        cursosInsertados,
                        filasIgnoradas: filasIgnoradasPorRepetido,
                        semestresCreados
                    }
                });
                continue;
            }

            // 2.3. Verificar con SELECT si ya existe en la BD para ESA MISMA carrera.
            // Se une cursos con semestres para conocer el id_carrera real del curso.
            const [cursoExistente] = await connection.query(
                `SELECT c.id_curso
                   FROM cursos c
                   INNER JOIN semestres s ON s.id_semestre = c.id_semestre
                  WHERE s.id_carrera = ? AND c.mat_cur = ?
                  LIMIT 1`,
                [idCarrera, matCur]
            );

            if (cursoExistente && cursoExistente.length > 0) {
                clavesProcesadasEnArchivo.add(claveCurso);
                filasIgnoradasPorRepetido++;
                alProgresar({
                    porcentaje: Math.min(99, Math.round(20 + (i / totalFilasArchivo) * 75)),
                    paso: 'Procesando cursos',
                    mensaje: `Fila ${numeroFilaExcel}: ${matCur} ya existe en la base de datos para ${codigoCarrera}, se omite.`,
                    datos: {
                        totalFilas: totalFilasArchivo,
                        filasProcesadas: i - 1,
                        cursosInsertados,
                        filasIgnoradas: filasIgnoradasPorRepetido,
                        semestresCreados
                    }
                });
                continue;
            }

            // 2.4. SELECT a la tabla semestres para esa carrera y ciclo
            const semestreRomano = fila[5] ? String(fila[5]).trim().toUpperCase() : 'I';

            let idSemestre;

            const [semestreBD] = await connection.query(
                'SELECT id_semestre FROM semestres WHERE id_carrera = ? AND semestre = ?',
                [idCarrera, semestreRomano]
            );

            if (semestreBD && semestreBD.length > 0) {
                idSemestre = semestreBD[0].id_semestre;
            } else {
                const [nuevoSemestre] = await connection.query(
                    'INSERT INTO semestres (id_carrera, semestre, horas_semestre_meta, estado) VALUES (?, ?, ?, ?)',
                    [idCarrera, semestreRomano, 510, 'A']
                );
                idSemestre = nuevoSemestre.insertId;
                semestresCreados++;
            }

            // 2.5. EXTRAER DATOS DEL CURSO IGNORANDO:
            // fila[1] -> CATALOGO (IGNORADA)
            // fila[4] -> CLASIFICACION BLACKBOARD (IGNORADA)
            const horarioSinfo = normalizarHorario(fila[3]);
            const nombreCurso = fila[6] ? String(fila[6]).trim().slice(0, 180) : matCur;
            const semanas = aEntero(fila[7], 16);
            const horasTeoria = aEntero(fila[8], 0);
            const horasTaller = aEntero(fila[9], 0);
            const horasVirtual = aEntero(fila[10], 0);
            const horasEvaluacion = aEntero(fila[11], 0);

            // Asegurar cuadre de total_horas (CHECK CONSTRAINT de la tabla cursos)
            const sumaCalculada = horasTeoria + horasTaller + horasVirtual + horasEvaluacion;
            const totalHorasExcel = aEntero(fila[12], 0);
            const totalHoras = totalHorasExcel > 0 && totalHorasExcel === sumaCalculada
                ? totalHorasExcel
                : sumaCalculada;

            if (totalHoras <= 0) {
                filasIgnoradasPorRepetido++;
                clavesProcesadasEnArchivo.add(claveCurso);
                alProgresar({
                    porcentaje: Math.min(99, Math.round(20 + (i / totalFilasArchivo) * 75)),
                    paso: 'Procesando cursos',
                    mensaje: `Fila ${numeroFilaExcel}: ${matCur} no tiene horas válidas, se omite.`,
                    datos: {
                        totalFilas: totalFilasArchivo,
                        filasProcesadas: i - 1,
                        cursosInsertados,
                        filasIgnoradas: filasIgnoradasPorRepetido,
                        semestresCreados
                    }
                });
                continue;
            }

            // 2.6. Inserción limpia del curso
            await connection.query(
                `INSERT INTO cursos 
                (id_semestre, mat_cur, horario_sinfo, nombre_curso, semanas, horas_teoria, horas_taller, horas_virtual, horas_evaluacion, total_horas, estado)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'A')`,
                [idSemestre, matCur, horarioSinfo, nombreCurso, semanas, horasTeoria, horasTaller, horasVirtual, horasEvaluacion, totalHoras]
            );

            clavesProcesadasEnArchivo.add(claveCurso);
            cursosInsertados++;

            alProgresar({
                porcentaje: Math.min(99, Math.round(20 + (i / totalFilasArchivo) * 75)),
                paso: 'Procesando cursos',
                mensaje: `Fila ${numeroFilaExcel} de ${filas.length}: ${matCur} (${codigoCarrera}) registrado correctamente.`,
                datos: {
                    totalFilas: totalFilasArchivo,
                    filasProcesadas: i - 1,
                    cursosInsertados,
                    filasIgnoradas: filasIgnoradasPorRepetido,
                    semestresCreados
                }
            });
        }

        // Confirmar transacción
        await connection.commit();

        return {
            status: 'ok',
            mensaje: 'Archivo analizado y cursos importados exitosamente sin duplicados por carrera.',
            nombreArchivo,
            columnasIgnoradas: ['CATALOGO', 'CLASIFICACION BLACKBOARD'],
            reglaDuplicados: 'Se omite una fila solo cuando el MAT CUR ya existe para la misma carrera. El mismo curso sí puede registrarse en carreras diferentes.',
            reporte: {
                totalFilasLeidas,
                carrerasVerificadas: codigosEnExcel.size,
                semestresCreados,
                cursosInsertados,
                filasIgnoradasPorRepetido
            }
        };

    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (errorRollback) {
                console.error('Error al hacer rollback de la importación:', errorRollback);
            }
        }
        throw error;
    } finally {
        if (connection) connection.release();
    }
};

const mallasController = {

    /**
     * Procesa e importa el archivo Excel enviado por el usuario.
     *
     * Modo normal  (sin ?progreso=1): responde al finalizar (comportamiento original).
     * Modo progreso (con ?progreso=1): crea un trabajo en memoria, responde con jobId
     * y el frontend consulta el avance con GET /importar-excel/progreso/:jobId.
     */
    importarExcel: async (req, res) => {
        try {
            // 1. Validar que el usuario haya enviado un archivo
            if (!req.file || !req.file.buffer) {
                return res.status(400).json({
                    status: 'error',
                    mensaje: 'No se recibió ningún archivo. Por favor arrastre o seleccione un archivo Excel (.xlsx o .csv).'
                });
            }

            // 2. Modo con progreso real (polling)
            if (req.query.progreso === '1') {
                const trabajo = crearTrabajo(req.file.originalname);

                // Responder de inmediato para que el frontend pueda consultar el avance.
                res.status(202).json({
                    status: 'ok',
                    jobId: trabajo.id,
                    mensaje: 'El archivo se está procesando. Consultando el avance...'
                });

                // Procesar en segundo plano sin bloquear la petición.
                setImmediate(async () => {
                    try {
                        const resultado = await procesarArchivoExcel(req.file.buffer, {
                            nombreArchivo: req.file.originalname,
                            alProgresar: (progreso) => actualizarTrabajo(trabajo, progreso)
                        });

                        actualizarTrabajo(trabajo, {
                            estado: 'completado',
                            porcentaje: 100,
                            paso: 'Importación completada',
                            mensaje: resultado.mensaje,
                            resultado
                        });
                    } catch (error) {
                        const esErrorControlado = error instanceof ErrorImportacion;

                        if (!esErrorControlado) {
                            console.error('Error al importar Excel:', error);
                        }

                        actualizarTrabajo(trabajo, {
                            estado: 'error',
                            porcentaje: 100,
                            paso: 'Importación con errores',
                            mensaje: error.message || 'Ocurrió un error al procesar el archivo.',
                            error: {
                                mensaje: error.message || 'Ocurrió un error al procesar el archivo en la base de datos.',
                                detalle: error.detalle || (esErrorControlado ? null : error.message),
                                tipo: error.tipo || null,
                                carrerasFaltantes: error.carrerasFaltantes || []
                            }
                        });
                    }
                });

                return;
            }

            // 3. Modo normal (sincrónico, compatible con llamadas anteriores)
            const resultado = await procesarArchivoExcel(req.file.buffer, {
                nombreArchivo: req.file.originalname
            });

            return res.json(resultado);

        } catch (error) {
            if (error instanceof ErrorImportacion) {
                return res.status(error.statusCode).json({
                    status: 'error',
                    tipo: error.tipo,
                    mensaje: error.message,
                    detalle: error.detalle,
                    carrerasFaltantes: error.carrerasFaltantes
                });
            }

            console.error('Error al importar Excel:', error);
            return res.status(500).json({
                status: 'error',
                mensaje: 'Ocurrió un error al procesar el archivo en la base de datos.',
                detalle: error.message
            });
        }
    },

    /**
     * Devuelve el avance de un trabajo de importación.
     */
    obtenerProgreso: async (req, res) => {
        limpiarTrabajosAntiguos();

        const { jobId } = req.params;
        const trabajo = trabajosImportacion.get(jobId);

        if (!trabajo) {
            return res.status(404).json({
                status: 'error',
                mensaje: 'El trabajo de importación no existe o ya expiró. Vuelva a cargar el archivo.'
            });
        }

        return res.json({
            status: 'ok',
            trabajo: {
                id: trabajo.id,
                nombreArchivo: trabajo.nombreArchivo,
                estado: trabajo.estado,
                porcentaje: trabajo.porcentaje,
                paso: trabajo.paso,
                mensaje: trabajo.mensaje,
                datos: trabajo.datos,
                resultado: trabajo.resultado,
                error: trabajo.error
            }
        });
    },

    /**
     * Retorna el conteo actual de registros en la base de datos
     */
    obtenerResumen: async (req, res) => {
        try {
            const [carreras] = await db.query('SELECT COUNT(*) as count FROM carreras');
            const [semestres] = await db.query('SELECT COUNT(*) as count FROM semestres');
            const [cursos] = await db.query('SELECT COUNT(*) as count FROM cursos');

            return res.json({
                status: 'ok',
                resumen: {
                    totalCarreras: carreras[0].count,
                    totalSemestres: semestres[0].count,
                    totalCursos: cursos[0].count
                }
            });
        } catch (error) {
            console.error('Error al obtener resumen:', error);
            return res.status(500).json({
                status: 'error',
                mensaje: 'Error al consultar el resumen de la base de datos.'
            });
        }
    }
};

module.exports = mallasController;
