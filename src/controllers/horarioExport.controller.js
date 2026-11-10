const XLSX = require('xlsx-js-style');
const fs = require('fs/promises');
const path = require('path');

const HorarioExport = require('../models/horarioExport.model');
const HorarioBorrador = require('../models/horarioBorrador.model');
const controladorSolver = require('./horarioSolver.controller');
const { crearZip } = require('../utils/zip.util');
const {
    prepararDirectorioSalida,
    resolverRutaSalida,
} = require('../utils/salidaHorarios.util');

const COLUMNAS = [
    'PERIODO',
    'PARTE_PERIODO',
    'SECCION',
    'CAMP',
    'MAT_CUR',
    'ACTIVIDAD',
    'TIPO_REUNION',
    'EDIFICIO',
    'SALON',
    'HORA_INI',
    'HORA_FIN',
    'DOMINGO',
    'LUNES',
    'MARTES',
    'MIERCOLES',
    'JUEVES',
    'VIERNES',
    'SABADO',
    'D_INICIO',
    'D_FIN',
    'INSTRUCTOR',
    'BLOQUE',
    'NRO_ALUMNOS_INSCRITOS',
    'IND_SESION',
];

const DIAS_COLUMNA = [
    'DOMINGO',
    'LUNES',
    'MARTES',
    'MIERCOLES',
    'JUEVES',
    'VIERNES',
    'SABADO',
];

const DIAS_DB = {
    DOMINGO: 'DOMINGO',
    LUNES: 'LUNES',
    MARTES: 'MARTES',
    MIERCOLES: 'MIERCOLES',
    'MIÉRCOLES': 'MIERCOLES',
    JUEVES: 'JUEVES',
    VIERNES: 'VIERNES',
    SABADO: 'SABADO',
    'SÁBADO': 'SABADO',
};

const SEMESTRE_NUMERO = {
    I: '1',
    II: '2',
    III: '3',
    IV: '4',
    V: '5',
    VI: '6',
    VII: '7',
    VIII: '8',
    IX: '9',
    X: '10',
};

function texto(valor) {
    return String(valor ?? '').replace(/\s+/g, ' ').trim();
}

function sinAcentos(valor) {
    return texto(valor)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function normalizarNombreArchivo(valor) {
    return sinAcentos(valor)
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function normalizarPeriodo(valor) {
    const limpio = texto(valor);
    return /^\d+$/.test(limpio) ? Number(limpio) : limpio;
}

function minutosDeHora(hora) {
    const coincidencia = texto(hora).match(/^(\d{1,2}):(\d{2})/);
    if (!coincidencia) return null;
    const horas = Number(coincidencia[1]);
    const minutos = Number(coincidencia[2]);
    if (horas > 23 || minutos > 59) return null;
    return horas * 60 + minutos;
}

function fraccionHora(hora) {
    const minutos = minutosDeHora(hora);
    return minutos === null ? null : minutos / (24 * 60);
}

function partesFecha(fecha) {
    if (!fecha) return null;
    if (typeof fecha === 'string') {
        const coincidencia = fecha.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (coincidencia) {
            return {
                anio: Number(coincidencia[1]),
                mes: Number(coincidencia[2]) - 1,
                dia: Number(coincidencia[3]),
            };
        }
    }
    const valor = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(valor.getTime())) return null;
    return {
        anio: valor.getFullYear(),
        mes: valor.getMonth(),
        dia: valor.getDate(),
    };
}

function serialExcel(fecha, diasDesplazamiento = 0) {
    const partes = partesFecha(fecha);
    if (!partes) return null;
    const utc = Date.UTC(
        partes.anio,
        partes.mes,
        partes.dia + Number(diasDesplazamiento || 0)
    );
    const epoch = Date.UTC(1899, 11, 30);
    return Math.floor((utc - epoch) / (24 * 60 * 60 * 1000));
}

function desplazamientoDia(dia, fechaInicio) {
    const indice = DIAS_COLUMNA.indexOf(dia);
    if (indice < 0) return 0;

    // Las columnas empiezan en domingo; la semana académica, en lunes.
    const objetivo = (indice + 6) % 7;
    const partes = partesFecha(fechaInicio);
    if (!partes) return objetivo;

    const base = new Date(Date.UTC(partes.anio, partes.mes, partes.dia));
    const diaBase = (base.getUTCDay() + 6) % 7;
    return (objetivo - diaBase + 7) % 7;
}

function campusDesdeAmbiente(codigoAmbiente) {
    const codigo = texto(codigoAmbiente);
    if (!codigo) return null;
    const partes = codigo.split('-');
    return texto(partes[0]) || null;
}

function codigoCampus(fila) {
    return campusDesdeAmbiente(fila?.codigo_ambiente)
        || `${texto(fila?.codigo_camp)}${texto(fila?.codigo_sede).slice(-1)}`
        || texto(fila?.codigo_camp)
        || texto(fila?.codigo_sede);
}

function modalidad(fila) {
    return texto(fila?.tipo_modalidad).toUpperCase();
}

function tipoReunion(fila) {
    const tipo = modalidad(fila);
    if (tipo === 'VIR') return 'VAEE';
    if (tipo === 'EMP') return null;
    return 'CLAS';
}

function edificio(fila) {
    const tipo = modalidad(fila);
    if (tipo === 'EMP') return '00-EX';
    if (tipo === 'VIR') return 'SV-EV';

    const pabellon = texto(fila?.pabellon);
    if (pabellon) {
        return pabellon.includes('-')
            ? pabellon
            : `${codigoCampus(fila)}-${pabellon}`;
    }

    const partes = texto(fila?.codigo_ambiente).split('-').filter(Boolean);
    if (partes.length >= 2) {
        return `${partes[0]}-${partes[1]}`;
    }
    return null;
}

function salon(fila) {
    const tipo = modalidad(fila);
    if (tipo === 'EMP' || tipo === 'VIR') return null;
    const partes = texto(fila?.codigo_ambiente).split('-').filter(Boolean);
    return partes.length ? partes[partes.length - 1] : null;
}

function nombreDocente(fila) {
    return texto(
        `${texto(fila?.docente_nombres)} ${texto(fila?.docente_apellidos)}`
    ) || null;
}

function docenteAsignado(fila) {
    const tipo = modalidad(fila);
    if (tipo === 'EMP' || tipo === 'VIR') return null;
    return fila?.id_docente && nombreDocente(fila) ? nombreDocente(fila) : null;
}

function bloque(fila) {
    const camp = texto(fila?.codigo_camp) || '56';
    const carrera = texto(fila?.codigo_carrera);
    const sector = texto(fila?.sector) || 'S';
    const semestre = SEMESTRE_NUMERO[sinAcentos(fila?.semestre).toUpperCase()]
        || sinAcentos(fila?.semestre)
        || '';
    const turno = String(fila?.id_turno ?? '').padStart(2, '0');
    return `${camp}${carrera}${sector}${semestre}${turno}`;
}

function actividadSeccion(fila) {
    // Las sesiones virtuales pertenecen a la sección TEC del curso.
    return modalidad(fila) === 'VIR' ? 'TEC' : modalidad(fila);
}

function claveSeccion(fila) {
    return [
        texto(fila?.mat_cur),
        bloque(fila),
        texto(fila?.grupo),
        actividadSeccion(fila),
    ].join('|');
}

function construirFilasExcel(filas, periodo) {
    const secciones = new Map();
    let secuencia = 0;

    return filas.map((fila) => {
        const clave = claveSeccion(fila);
        if (!secciones.has(clave)) {
            secuencia += 1;
            secciones.set(clave, secuencia);
        }

        const dia = DIAS_DB[sinAcentos(fila?.dia_semana).toUpperCase()] ?? null;
        const docente = docenteAsignado(fila);
        const semanaInicio = Math.max(1, Number(fila?.semana_inicio) || 1);
        const semanaFin = Math.max(semanaInicio, Number(fila?.semana_fin) || semanaInicio);

        const registro = new Array(COLUMNAS.length).fill(null);
        registro[0] = normalizarPeriodo(fila?.codigo_periodo ?? periodo);
        registro[1] = null;
        registro[2] = secciones.get(clave);
        registro[3] = codigoCampus(fila);
        registro[4] = texto(fila?.mat_cur) || null;
        registro[5] = actividadSeccion(fila) || null;
        registro[6] = tipoReunion(fila);
        registro[7] = edificio(fila);
        registro[8] = salon(fila);
        registro[9] = fraccionHora(fila?.hora_inicio);
        registro[10] = fraccionHora(fila?.hora_fin);
        for (let indice = 0; indice < DIAS_COLUMNA.length; indice += 1) {
            registro[11 + indice] = DIAS_COLUMNA[indice] === dia ? 'x' : null;
        }
        const desplazamiento = desplazamientoDia(dia, fila?.fecha_inicio);
        registro[18] = serialExcel(
            fila?.fecha_inicio,
            (semanaInicio - 1) * 7 + desplazamiento
        );
        registro[19] = serialExcel(
            fila?.fecha_inicio,
            (semanaFin - 1) * 7 + desplazamiento
        );
        registro[20] = docente;
        registro[21] = bloque(fila) || null;
        registro[22] = null;
        registro[23] = docente ? 1 : 2;
        return registro;
    });
}

function aplicarFormatos(hoja, cantidadFilas) {
    const anchoColumnas = {
        0: 12, 1: 16, 2: 10, 3: 8, 4: 14, 5: 12, 6: 16, 7: 12,
        8: 10, 9: 10, 10: 10, 11: 10, 12: 10, 13: 10, 14: 12,
        15: 10, 16: 10, 17: 10, 18: 12, 19: 12, 20: 38, 21: 18,
        22: 22, 23: 12,
    };
    hoja['!cols'] = Object.entries(anchoColumnas).map(([, ancho]) => ({ wch: ancho }));

    const columnasHora = [9, 10];
    const columnasFecha = [18, 19];
    for (let fila = 1; fila <= cantidadFilas; fila += 1) {
        for (const columna of columnasHora) {
            const celda = XLSX.utils.encode_cell({ r: fila, c: columna });
            if (hoja[celda] && hoja[celda].v != null) hoja[celda].z = 'h:mm';
        }
        for (const columna of columnasFecha) {
            const celda = XLSX.utils.encode_cell({ r: fila, c: columna });
            if (hoja[celda] && hoja[celda].v != null) hoja[celda].z = 'dd/mm/yyyy';
        }
    }
}

function generarExcelCarrera(filas, periodo) {
    const datos = construirFilasExcel(filas, periodo);
    const hoja = XLSX.utils.aoa_to_sheet([COLUMNAS, ...datos]);
    aplicarFormatos(hoja, datos.length);

    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, '2a');
    return XLSX.write(libro, {
        type: 'buffer',
        bookType: 'xlsx',
        cellStyles: true,
    });
}

function agruparPorCarrera(filas) {
    const grupos = new Map();
    for (const fila of filas) {
        const zonal = texto(fila.ciudad) || texto(fila.nombre_zonal) || 'ZONAL';
        const carrera = texto(fila.nombre_carrera)
            || texto(fila.codigo_carrera)
            || 'CARRERA';
        const clave = `${normalizarNombreArchivo(zonal)}|${normalizarNombreArchivo(carrera)}`;
        if (!grupos.has(clave)) {
            grupos.set(clave, { zonal, carrera, filas: [] });
        }
        grupos.get(clave).filas.push(fila);
    }
    return [...grupos.values()];
}

function construirArchivosPorCarrera(filas, periodo) {
    return agruparPorCarrera(filas).map((grupo) => {
        const nombre = `${normalizarNombreArchivo(grupo.zonal)}_${normalizarNombreArchivo(grupo.carrera)}.xlsx`;
        return {
            nombre,
            zonal: grupo.zonal,
            carrera: grupo.carrera,
            filas: grupo.filas.length,
            contenido: generarExcelCarrera(grupo.filas, periodo),
        };
    });
}

async function guardarArtefactos(periodo, idBorrador, archivos, nombreZip, zip) {
    const carpeta = await prepararDirectorioSalida(
        String(periodo),
        `borrador_${idBorrador}`
    );
    for (const archivo of archivos) {
        await fs.writeFile(path.join(carpeta, archivo.nombre), archivo.contenido);
    }
    await fs.writeFile(
        resolverRutaSalida(String(periodo), `borrador_${idBorrador}`, nombreZip),
        zip
    );
    return carpeta;
}

async function exportarHorariosZip(req, res) {
    try {
        if (controladorSolver.hayTrabajoActivo()) {
            return res.status(409).json({
                success: false,
                message:
                    'Hay una generación de horario en curso. Espera a que termine antes de exportar.',
            });
        }
        const codigoPeriodo = texto(req.query?.periodo ?? '202620');
        if (!/^[A-Za-z0-9_-]{1,10}$/.test(codigoPeriodo)) {
            return res.status(400).json({
                success: false,
                message: 'El código de periodo no es válido.',
            });
        }

        const periodo = await HorarioExport.obtenerPeriodo(codigoPeriodo);
        if (!periodo) {
            return res.status(404).json({
                success: false,
                message: `No existe el periodo ${codigoPeriodo}.`,
            });
        }

        const borradores = await HorarioBorrador.listar(codigoPeriodo);
        if (!borradores.length) {
            return res.status(404).json({
                success: false,
                message: `No hay borradores generados para el periodo ${codigoPeriodo}.`,
            });
        }

        let borrador;
        const idBorradorTexto = texto(req.query?.id_borrador);
        if (idBorradorTexto) {
            const idBorrador = Number(idBorradorTexto);
            if (!Number.isSafeInteger(idBorrador) || idBorrador <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'El identificador del borrador no es válido.',
                });
            }
            borrador = borradores.find(
                (candidato) => candidato.id_borrador === idBorrador
            );
            if (!borrador) {
                return res.status(404).json({
                    success: false,
                    message: (
                        `No existe el borrador ${idBorrador} para el periodo ` +
                        `${codigoPeriodo}.`
                    ),
                });
            }
        } else if (borradores.length === 1) {
            borrador = borradores[0];
        } else {
            return res.status(400).json({
                success: false,
                message: (
                    'Hay varios borradores para el periodo. ' +
                    'Indica cuál quieres descargar con id_borrador.'
                ),
            });
        }

        const filas = await HorarioExport.listarFilasPeriodo(
            codigoPeriodo,
            borrador.id_borrador
        );
        if (!filas.length) {
            return res.status(404).json({
                success: false,
                message: (
                    `El borrador ${borrador.nombre} no tiene horarios para ` +
                    `el periodo ${codigoPeriodo}.`
                ),
            });
        }

        const archivos = construirArchivosPorCarrera(filas, periodo.codigo_periodo);
        if (!archivos.length) {
            return res.status(404).json({
                success: false,
                message: 'No se pudieron agrupar los horarios por carrera.',
            });
        }

        const sufijoBorrador = normalizarNombreArchivo(borrador.nombre)
            || `BORRADOR_${borrador.id_borrador}`;
        const nombreZip = `horarios_${codigoPeriodo}_${sufijoBorrador}.zip`;
        const zip = crearZip(archivos.map((archivo) => ({
            nombre: archivo.nombre,
            contenido: archivo.contenido,
        })));

        await guardarArtefactos(
            codigoPeriodo,
            borrador.id_borrador,
            archivos,
            nombreZip,
            zip
        );

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${nombreZip}"; filename*=UTF-8''${encodeURIComponent(nombreZip)}`
        );
        res.setHeader('Content-Length', zip.length);
        return res.send(zip);
    } catch (error) {
        console.error('Error al exportar horarios:', error.code || error.message);
        if (res.headersSent) return res.end();
        return res.status(500).json({
            success: false,
            message: 'No se pudo generar el ZIP de horarios por carrera.',
        });
    }
}

module.exports = {
    COLUMNAS,
    construirArchivosPorCarrera,
    construirFilasExcel,
    exportarHorariosZip,
    generarExcelCarrera,
    normalizarNombreArchivo,
};
