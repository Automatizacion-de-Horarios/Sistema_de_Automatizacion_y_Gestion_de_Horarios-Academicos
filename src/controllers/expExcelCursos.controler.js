const XLSX = require('xlsx-js-style');
const EstructuraCurricular = require('../models/expExcelCursos.model');

/**
 * Controlador de Exportación de Estructura Curricular (Cursos y Mallas)
 *
 * Genera un Excel con TODOS los cursos registrados, en el mismo formato del
 * archivo de importación ("Estructura curricular Consolidado"):
 *
 *   Fila 1: títulos de cabecera (PRODUCCIÓN / ESTRUCTURA)
 *   Fila 2: encabezados de columnas
 *   Fila 3 en adelante: un curso por fila
 *
 * El orden de salida es: carrera (por código) -> semestre (I a VI) -> curso
 * (en el orden en que fue importado), para que el archivo quede ordenado
 * aunque los Excel originales estuvieran mezclados.
 */

const xlsx = XLSX;

// Encabezados exactamente como aparecen en el archivo de referencia.
const ENCABEZADOS = [
    'CODIGO',
    'CATALOGO',
    'MAT CUR',
    'HORARIO SINFO\n(COD-PATRON)',
    'CLASIFICACIÓN\nBLACKBOARD\nPRODUCCIÓN - VIRTUALIZACIÓN',
    'SEMESTRE CATÁLOGO',
    'DESCRIPCION DE CURSO',
    'SEMANAS',
    'TEORÍA / TECNOLOGÍA',
    'TALLER / EMPRESA',
    'VIRTUAL',
    'EVALUACIÓN SEMESTRAL',
    'TOTAL HORAS',
    'HORAS SEMESTRE'
];

// Anchos de columna para que el archivo se abra legible (no afectan la importación).
const ANCHOS_COLUMNAS = [
    { wch: 10 }, // CODIGO
    { wch: 12 }, // CATALOGO
    { wch: 14 }, // MAT CUR
    { wch: 16 }, // HORARIO SINFO
    { wch: 18 }, // CLASIFICACIÓN BLACKBOARD
    { wch: 17 }, // SEMESTRE CATÁLOGO
    { wch: 58 }, // DESCRIPCION DE CURSO
    { wch: 10 }, // SEMANAS
    { wch: 20 }, // TEORÍA / TECNOLOGÍA
    { wch: 18 }, // TALLER / EMPRESA
    { wch: 10 }, // VIRTUAL
    { wch: 21 }, // EVALUACIÓN SEMESTRAL
    { wch: 13 }, // TOTAL HORAS
    { wch: 15 }  // HORAS SEMESTRE
];

// Orden oficial de los semestres (I a VI y siguientes, por si se amplía la malla).
const ORDEN_SEMESTRES = {
    I: 1,
    II: 2,
    III: 3,
    IV: 4,
    V: 5,
    VI: 6,
    VII: 7,
    VIII: 8,
    IX: 9,
    X: 10
};

// Colores de fondo por semestre (formato ARGB). Se usa el mismo color para el
// mismo semestre en todas las carreras: I azul, II verde, III amarillo,
// IV durazno, V lila y VI rosa. Si apareciera un semestre mayor a VI se usa gris.
// Colores de fondo por semestre (formato ARGB sin el "#"). 
// Ahora todos serán blancos para no interferir visualmente.
const COLORES_SEMESTRE = {
    1: 'FFFFFFFF',
    2: 'FFFFFFFF',
    3: 'FFFFFFFF',
    4: 'FFFFFFFF',
    5: 'FFFFFFFF',
    6: 'FFFFFFFF'
};
// Si llega a existir un semestre 7 o mayor, también será blanco.
const COLOR_SEMESTRE_DEFECTO = 'FFFFFFFF'; 

// Paleta de las cabeceras intacta (se mantienen rojas con letras blancas)
const COLOR_TITULOS = 'FF8B0000';
const COLOR_ENCABEZADOS = 'FFC00000';

// Estilos de borde reutilizables.
const BORDE_FINO = { style: 'thin', color: { rgb: 'FF000000' } };
const BORDE_MEDIO = { style: 'medium', color: { rgb: 'FF000000' } };
const BORDE_GRUESO = { style: 'thick', color: { rgb: 'FF000000' } };

const ordenSemestre = (valor) => {
    const texto = String(valor || '').trim().toUpperCase();
    if (ORDEN_SEMESTRES[texto]) return ORDEN_SEMESTRES[texto];

    const numero = parseInt(texto, 10);
    return Number.isFinite(numero) ? numero : 99;
};

// El CATALOGO se guarda como texto en la BD, pero en el Excel original es numérico.
const normalizarCatalogo = (valor) => {
    if (valor === null || valor === undefined) return null;

    const texto = String(valor).trim();
    if (!texto) return null;

    if (/^\d+$/.test(texto) && texto.length <= 15) {
        return Number(texto);
    }

    return texto;
};

const aNumeroONulo = (valor) => {
    if (valor === null || valor === undefined || valor === '') return null;

    const numero = Number(valor);
    return Number.isFinite(numero) ? numero : null;
};

/**
 * Igual que aNumeroONulo, pero devuelve null cuando el valor es 0.
 * Se usa en las columnas de horas para que un 0 se exporte como celda vacía.
 */
const aNumeroPositivoONulo = (valor) => {
    const numero = aNumeroONulo(valor);
    return numero === null || numero === 0 ? null : numero;
};

/**
 * Convierte los cursos de la BD en la matriz de filas del Excel.
 * La columna HORAS SEMESTRE solo se completa en la primera fila de cada
 * carrera/semestre (igual que en el archivo de referencia).
 */
const construirFilas = (cursos) => {
    const ordenados = [...cursos].sort((a, b) => {
        const carreraA = String(a.codigo_carrera || '').trim().toUpperCase();
        const carreraB = String(b.codigo_carrera || '').trim().toUpperCase();

        if (carreraA !== carreraB) return carreraA.localeCompare(carreraB);

        const diferenciaSemestre = ordenSemestre(a.semestre) - ordenSemestre(b.semestre);
        if (diferenciaSemestre !== 0) return diferenciaSemestre;

        return Number(a.id_curso || 0) - Number(b.id_curso || 0);
    });

    const filas = [
        [null, 'PRODUCCIÓN', null, null, null, 'ESTRUCTURA'],
        ENCABEZADOS
    ];

    const gruposConHorasSemestre = new Set();

    for (const curso of ordenados) {
        const codigoCarrera = String(curso.codigo_carrera || '').trim().toUpperCase();
        const semestre = String(curso.semestre || '').trim().toUpperCase();
        const claveGrupo = `${codigoCarrera}|${semestre}`;

        let horasSemestre = null;
        if (!gruposConHorasSemestre.has(claveGrupo)) {
            horasSemestre = aNumeroPositivoONulo(curso.horas_semestre_meta);
            gruposConHorasSemestre.add(claveGrupo);
        }

        filas.push([
            codigoCarrera,
            normalizarCatalogo(curso.catalogo),
            curso.mat_cur ? String(curso.mat_cur).trim().toUpperCase() : null,
            curso.horario_sinfo ? String(curso.horario_sinfo).trim().toUpperCase() : null,
            null, // CLASIFICACIÓN BLACKBOARD: siempre vacía
            semestre || null,
            curso.nombre_curso ? String(curso.nombre_curso).trim() : null,
            aNumeroPositivoONulo(curso.semanas),
            aNumeroPositivoONulo(curso.horas_teoria),
            aNumeroPositivoONulo(curso.horas_taller),
            aNumeroPositivoONulo(curso.horas_virtual),
            aNumeroPositivoONulo(curso.horas_evaluacion),
            aNumeroPositivoONulo(curso.total_horas),
            horasSemestre
        ]);
    }

    return filas;
};

const estiloCabecera = (colorFondo, tamanoFuente) => ({
    font: { bold: true, sz: tamanoFuente, color: { rgb: 'FFFFFFFF' } },
    fill: { patternType: 'solid', fgColor: { rgb: colorFondo } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: {
        top: BORDE_MEDIO,
        bottom: BORDE_MEDIO,
        left: BORDE_FINO,
        right: BORDE_FINO
    }
});

/**
 * Aplica colores y bordes sobre la hoja ya generada.
 * - Cabeceras en rojo con letra blanca.
 * - Fondo por semestre en toda la fila del curso.
 * - Borde fino entre celdas, medio entre semestres y grueso alrededor de
 *   cada carrera (incluyendo sus columnas laterales).
 */
const aplicarEstilos = (hoja, filasExcel) => {
    const ultimaColumna = ENCABEZADOS.length - 1;
    const ultimaFila = filasExcel.length - 1;

    // Fila 1: títulos (PRODUCCIÓN / ESTRUCTURA) sobre fondo rojo oscuro.
    for (let columna = 0; columna <= ultimaColumna; columna++) {
        const celda = obtenerCelda(hoja, 0, columna);
        if (!celda) continue;

        celda.s = estiloCabecera(COLOR_TITULOS, 12);
    }

    // Fila 2: nombres de columnas sobre fondo rojo.
    for (let columna = 0; columna <= ultimaColumna; columna++) {
        const celda = obtenerCelda(hoja, 1, columna);
        celda.s = estiloCabecera(COLOR_ENCABEZADOS, 10);
    }

    for (let fila = 2; fila <= ultimaFila; fila++) {
        const actual = filasExcel[fila];
        const anterior = filasExcel[fila - 1];
        const siguiente = filasExcel[fila + 1];

        const carrera = actual[0];
        const semestre = actual[5];

        const esPrimeraDeCarrera = !anterior || anterior[0] !== carrera;
        const esUltimaDeCarrera = !siguiente || siguiente[0] !== carrera;
        const esPrimeraDeSemestre = esPrimeraDeCarrera || anterior[5] !== semestre;

        const colorFondo = COLORES_SEMESTRE[ordenSemestre(semestre)] || COLOR_SEMESTRE_DEFECTO;

        for (let columna = 0; columna <= ultimaColumna; columna++) {
            const celda = obtenerCelda(hoja, fila, columna);

            const bordes = {
                top: esPrimeraDeCarrera ? BORDE_GRUESO : (esPrimeraDeSemestre ? BORDE_MEDIO : BORDE_FINO),
                bottom: esUltimaDeCarrera ? BORDE_GRUESO : BORDE_FINO,
                left: columna === 0 ? BORDE_GRUESO : BORDE_FINO,
                right: columna === ultimaColumna ? BORDE_GRUESO : BORDE_FINO
            };

            celda.s = {
                font: { sz: 10 },
                fill: { patternType: 'solid', fgColor: { rgb: colorFondo } },
                alignment: {
                    horizontal: columna === 6 ? 'left' : 'center',
                    vertical: 'center',
                    wrapText: columna === 6
                },
                border: bordes
            };
        }
    }

    // Alturas de las dos filas de cabecera.
    hoja['!rows'] = [{ hpt: 22 }, { hpt: 46 }];
};

/**
 * Devuelve la celda de la hoja; si aoa_to_sheet la omitió por estar vacía,
 * la crea para que igual reciba color de fondo y bordes.
 */
const obtenerCelda = (hoja, fila, columna) => {
    const direccion = XLSX.utils.encode_cell({ r: fila, c: columna });

    if (!hoja[direccion]) {
        hoja[direccion] = { t: 's', v: '' };
    }

    return hoja[direccion];
};

/**
 * Construye el libro de Excel completo (datos + estilos).
 * Se expone aparte del controlador para poder probarlo sin base de datos.
 */
const generarLibro = (cursos) => {
    const filasExcel = construirFilas(cursos);
    const hoja = xlsx.utils.aoa_to_sheet(filasExcel);

    hoja['!cols'] = ANCHOS_COLUMNAS;
    hoja['!autofilter'] = { ref: `A2:N${filasExcel.length}` };

    aplicarEstilos(hoja, filasExcel);

    const libro = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(libro, hoja, 'Hoja2');

    return libro;
};

const dosDigitos = (numero) => String(numero).padStart(2, '0');

const nombreArchivoConFecha = () => {
    const hoy = new Date();
    const fecha = `${hoy.getFullYear()}${dosDigitos(hoy.getMonth() + 1)}${dosDigitos(hoy.getDate())}`;
    // La hora evita confundir la descarga nueva con una versión anterior del
    // mismo día (el navegador agrega "(1)", "(2)" y es fácil abrir la vieja).
    const hora = `${dosDigitos(hoy.getHours())}${dosDigitos(hoy.getMinutes())}${dosDigitos(hoy.getSeconds())}`;
    return `Estructura_curricular_consolidado_${fecha}_${hora}.xlsx`;
};

const expExcelCursosController = {

    /**
     * GET /api/mallas/exportar-excel
     * Descarga la estructura curricular completa (todas las carreras, con sus
     * semestres de I a VI ordenados) en un archivo .xlsx.
     */
    exportarExcel: async (req, res) => {
        try {
            const cursos = await EstructuraCurricular.obtenerCursosParaExportar();

            if (!cursos || cursos.length === 0) {
                return res.status(404).json({
                    status: 'error',
                    mensaje: 'No hay cursos registrados para exportar. Importe primero un archivo de estructura curricular.'
                });
            }

            const libro = generarLibro(cursos);
            const buffer = xlsx.write(libro, { bookType: 'xlsx', type: 'buffer' });
            const nombreArchivo = nombreArchivoConFecha();

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader(
                'Content-Disposition',
                `attachment; filename="${nombreArchivo}"; filename*=UTF-8''${encodeURIComponent(nombreArchivo)}`
            );
            // Permite que el frontend lea el nombre del archivo desde el navegador.
            res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
            res.setHeader('Cache-Control', 'no-store');

            return res.send(buffer);

        } catch (error) {
            console.error('Error al exportar la estructura curricular:', error);
            return res.status(500).json({
                status: 'error',
                mensaje: 'Ocurrió un error al generar el archivo Excel.',
                detalle: error.message
            });
        }
    }
};

// Se adjuntan los generadores para poder verificarlos sin la base de datos.
expExcelCursosController.construirFilas = construirFilas;
expExcelCursosController.generarLibro = generarLibro;

module.exports = expExcelCursosController;
