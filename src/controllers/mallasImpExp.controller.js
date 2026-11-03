const xlsx = require('xlsx');
const crypto = require('crypto');
const Malla = require('../models/mallasImpExp.model');

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
            cursosActualizados: 0,
            cursosSinCambios: 0,
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

// La columna CATALOGO puede venir como número (ej. 202610); se guarda como texto.
const normalizarCatalogo = (valor) => {
    if (valor === null || valor === undefined) return null;
    const texto = String(valor).trim();
    return texto ? texto.slice(0, 20) : null;
};

// Comparaciones usadas para detectar qué campos cambiaron respecto de la BD.
const mismoValorTexto = (valorBD, valorExcel) => {
    const textoBD = valorBD === null || valorBD === undefined ? '' : String(valorBD).trim();
    const textoExcel = valorExcel === null || valorExcel === undefined ? '' : String(valorExcel).trim();
    return textoBD === textoExcel;
};

const mismoValorNumerico = (valorBD, valorExcel) => Number(valorBD ?? 0) === Number(valorExcel ?? 0);

// Obtiene el prefijo del MAT CUR (ej. "PIAD-525" -> "PIAD").
const obtenerPrefijoMatCur = (matCur) => {
    const texto = String(matCur || '').trim().toUpperCase();
    return texto.split('-')[0].trim();
};

const PREFIJOS_CONSIDERADOS_CARRERA = new Set(['NCCU']);

const calcularIsCarrera = (matCur, codigosCarreras) => {
    const prefijo = obtenerPrefijoMatCur(matCur);
    if (codigosCarreras.has(prefijo)) return 1;
    return PREFIJOS_CONSIDERADOS_CARRERA.has(prefijo) ? 1 : 0;
};


const procesarArchivoExcel = async (buffer, opciones = {}) => {
    const { nombreArchivo = '', alProgresar = () => {} } = opciones;
    

    // LECTURA DEL ARCHIVO EN MEMORIA
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


    // si una fila falla, se revierte todo lo insertado.
    const reporte = await Malla.enTransaccion(async (conexion) => {

        // VALIDACIÓN PREVIA DE CÓDIGOS DE CARRERA
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
            const carrera = await Malla.obtenerCarreraPorCodigo(codigo, conexion);

            if (carrera) {
                mapaCarrerasValidas.set(codigo, carrera.id_carrera);
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

        const codigosCarrerasBD = new Set(await Malla.obtenerCodigosCarreras(conexion));


        // FASE 2: PROCESAMIENTO E INSERCIÓN LIMPIA
        const clavesProcesadasEnArchivo = new Set(); // `${idCarrera}|${matCur}`

        let totalFilasLeidas = 0;
        let semestresCreados = 0;
        let cursosInsertados = 0;
        let cursosActualizados = 0;
        let cursosSinCambios = 0;
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

            const catalogo = normalizarCatalogo(fila[1]);
            const isCarrera = calcularIsCarrera(matCur, codigosCarrerasBD);

            const idCarrera = mapaCarrerasValidas.get(codigoCarrera);

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
                        cursosActualizados,
                        cursosSinCambios,
                        filasIgnoradas: filasIgnoradasPorRepetido,
                        semestresCreados
                    }
                });
                continue;
            }

            // Extraer los datos del curso ANTES de decidir si se inserta o se actualiza. Así ambas rutas usan exactamente los mismos valores.

            const horarioExcel = fila[3] ? String(fila[3]).trim().toUpperCase() : '';
            const horarioSinfo = normalizarHorario(fila[3]);
            const nombreCursoExcel = fila[6] ? String(fila[6]).trim().slice(0, 180) : '';
            const nombreCurso = nombreCursoExcel || matCur;
            const semanas = aEntero(fila[7], 16);
            const horasTeoria = aEntero(fila[8], 0);
            const horasTaller = aEntero(fila[9], 0);
            const horasVirtual = aEntero(fila[10], 0);
            const horasEvaluacion = aEntero(fila[11], 0);

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
                        cursosActualizados,
                        cursosSinCambios,
                        filasIgnoradas: filasIgnoradasPorRepetido,
                        semestresCreados
                    }
                });
                continue;
            }

            const cursoExistente = await Malla.obtenerCursoPorCarreraYMatricula(idCarrera, matCur, conexion);

            if (cursoExistente) {
                // El curso no se duplica. Se comparan TODOS sus campos contra el Excel y solo se actualizan los que realmente cambiaron.
                const semestreRomanoExcel = fila[5] ? String(fila[5]).trim().toUpperCase() : null;

                let idSemestreDestino = cursoExistente.id_semestre;

                if (semestreRomanoExcel && !mismoValorTexto(cursoExistente.semestre_actual, semestreRomanoExcel)) {
                    const semestreDestino = await Malla.obtenerSemestre(idCarrera, semestreRomanoExcel, conexion);

                    if (semestreDestino) {
                        const conflicto = await Malla.obtenerCursoPorSemestreYMatricula(
                            semestreDestino.id_semestre,
                            matCur,
                            conexion
                        );

                        if (!conflicto || conflicto.id_curso === cursoExistente.id_curso) {
                            idSemestreDestino = semestreDestino.id_semestre;
                        }
                    } else {
                        idSemestreDestino = await Malla.crearSemestre(
                            { idCarrera, semestre: semestreRomanoExcel, horasMeta: 510, estado: 'A' },
                            conexion
                        );
                        semestresCreados++;
                    }
                }

                const cambios = {};

                if (!mismoValorNumerico(cursoExistente.id_semestre, idSemestreDestino)) {
                    cambios.id_semestre = idSemestreDestino;
                }
                if (horarioExcel && !mismoValorTexto(cursoExistente.horario_sinfo, horarioSinfo)) {
                    cambios.horario_sinfo = horarioSinfo;
                }
                if (nombreCursoExcel && !mismoValorTexto(cursoExistente.nombre_curso, nombreCurso)) {
                    cambios.nombre_curso = nombreCurso;
                }
                if (fila[7] !== undefined && fila[7] !== null && String(fila[7]).trim() !== '' &&
                    !mismoValorNumerico(cursoExistente.semanas, semanas)) {
                    cambios.semanas = semanas;
                }
                if (!mismoValorNumerico(cursoExistente.horas_teoria, horasTeoria)) {
                    cambios.horas_teoria = horasTeoria;
                }
                if (!mismoValorNumerico(cursoExistente.horas_taller, horasTaller)) {
                    cambios.horas_taller = horasTaller;
                }
                if (!mismoValorNumerico(cursoExistente.horas_virtual, horasVirtual)) {
                    cambios.horas_virtual = horasVirtual;
                }
                if (!mismoValorNumerico(cursoExistente.horas_evaluacion, horasEvaluacion)) {
                    cambios.horas_evaluacion = horasEvaluacion;
                }
                if (!mismoValorNumerico(cursoExistente.total_horas, totalHoras)) {
                    cambios.total_horas = totalHoras;
                }
                if (!mismoValorTexto(cursoExistente.catalogo, catalogo)) {
                    cambios.catalogo = catalogo;
                }
                if (!mismoValorNumerico(cursoExistente.is_carrera, isCarrera)) {
                    cambios.is_carrera = isCarrera;
                }

                const camposActualizados = Object.keys(cambios);

                if (camposActualizados.length > 0) {
                    await Malla.actualizarCurso(cursoExistente.id_curso, cambios, conexion);
                    cursosActualizados++;
                } else {
                    cursosSinCambios++;
                }

                clavesProcesadasEnArchivo.add(claveCurso);
                alProgresar({
                    porcentaje: Math.min(99, Math.round(20 + (i / totalFilasArchivo) * 75)),
                    paso: 'Procesando cursos',
                    mensaje: camposActualizados.length > 0
                        ? `Fila ${numeroFilaExcel}: ${matCur} actualizado (${camposActualizados.join(', ')}).`
                        : `Fila ${numeroFilaExcel}: ${matCur} sin cambios, se mantiene igual.`,
                    datos: {
                        totalFilas: totalFilasArchivo,
                        filasProcesadas: i - 1,
                        cursosInsertados,
                        cursosActualizados,
                        cursosSinCambios,
                        filasIgnoradas: filasIgnoradasPorRepetido,
                        semestresCreados
                    }
                });
                continue;
            }

            // busca el semestre de la carrera, si no existe la crea
            const semestreRomano = fila[5] ? String(fila[5]).trim().toUpperCase() : 'I';

            let idSemestre;

            const semestreBD = await Malla.obtenerSemestre(idCarrera, semestreRomano, conexion);

            if (semestreBD) {
                idSemestre = semestreBD.id_semestre;
            } else {
                idSemestre = await Malla.crearSemestre(
                    { idCarrera, semestre: semestreRomano, horasMeta: 510, estado: 'A' },
                    conexion
                );
                semestresCreados++;
            }

            // Insert lipio en cursos
            await Malla.crearCurso(
                {
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
                    estado: 'A',
                    catalogo,
                    isCarrera
                },
                conexion
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
                    cursosActualizados,
                    cursosSinCambios,
                    filasIgnoradas: filasIgnoradasPorRepetido,
                    semestresCreados
                }
            });
        }

        return {
            totalFilasLeidas,
            carrerasVerificadas: codigosEnExcel.size,
            semestresCreados,
            cursosInsertados,
            cursosActualizados,
            cursosSinCambios,
            filasIgnoradasPorRepetido
        };
    });

    return {
        status: 'ok',
        mensaje: 'Archivo analizado y cursos importados exitosamente sin duplicados por carrera.',
        nombreArchivo,
        columnasIgnoradas: ['CLASIFICACION BLACKBOARD'],
        reglaDuplicados: 'Se omite una fila solo cuando el MAT CUR ya existe para la misma carrera. El mismo curso sí puede registrarse en carreras diferentes. Al reimportar se actualizan únicamente los datos que cambiaron (nombre, semanas, horas, horario, semestre, catálogo e IS_CARRERA) sin duplicar el curso.',
        reporte
    };
};

const mallasImpExpController = {



    importarExcel: async (req, res) => {
        try {
            // Valida que el usuario haya enviado un archivo
            if (!req.file || !req.file.buffer) {
                return res.status(400).json({
                    status: 'error',
                    mensaje: 'No se recibió ningún archivo. Por favor arrastre o seleccione un archivo Excel (.xlsx o .csv).'
                });
            }

            // 2. Modo con progreso real
            if (req.query.progreso === '1') {
                const trabajo = crearTrabajo(req.file.originalname);

                // Responder de inmediato para que el frontend pueda consultar el avance.
                res.status(202).json({
                    status: 'ok',
                    jobId: trabajo.id,
                    mensaje: 'El archivo se está procesando. Consultando el avance...'
                });

                // Procesa en segundo plano sin bloquear la petición.
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


    // Devuelve el avance de un trabajo de importación.

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

    
    // Retorna el conteo actual de registros en la base de datos
   
    obtenerResumen: async (req, res) => {
        try {
            const [totalCarreras, totalSemestres, totalCursos] = await Promise.all([
                Malla.contarCarreras(),
                Malla.contarSemestres(),
                Malla.contarCursos()
            ]);

            return res.json({
                status: 'ok',
                resumen: {
                    totalCarreras,
                    totalSemestres,
                    totalCursos
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

module.exports = mallasImpExpController;
