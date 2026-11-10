const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

const {
    COLUMNAS,
    construirArchivosPorCarrera,
    construirFilasExcel,
    normalizarNombreArchivo,
} = require('../src/controllers/horarioExport.controller');
const { crearZip } = require('../src/utils/zip.util');

const filaBase = (extra = {}) => ({
    codigo_periodo: '202620',
    tipo_modalidad: 'TEC',
    dia_semana: 'MIÉRCOLES',
    hora_inicio: '09:30:00',
    hora_fin: '11:00:00',
    semana_inicio: 1,
    semana_fin: 16,
    id_docente: 42,
    id_ambiente: 7,
    fecha_inicio: new Date(2026, 7, 17),
    id_turno: 1,
    grupo: '01',
    mat_cur: 'CGEU-271',
    semestre: 'II',
    codigo_carrera: 'NAED',
    nombre_carrera: 'Administración de Empresas',
    sector: 'E',
    codigo_sede: 'UCP',
    codigo_camp: '56',
    ciudad: 'Tacna',
    docente_nombres: ' YENIFFER WENDY ',
    docente_apellidos: 'ZAPANA AGUILAR',
    codigo_ambiente: '56P-1-202',
    pabellon: '1',
    ...extra,
});

test('la primera fila respeta las 24 columnas institucionales', () => {
    assert.equal(COLUMNAS.length, 24);
    const [fila] = construirFilasExcel([filaBase()], '202620');

    assert.equal(fila.length, 24);
    assert.equal(fila[0], 202620);
    assert.equal(fila[1], null); // PARTE_PERIODO vacío
    assert.equal(fila[2], 1);
    assert.equal(fila[3], '56P');
    assert.equal(fila[4], 'CGEU-271');
    assert.equal(fila[5], 'TEC');
    assert.equal(fila[6], 'CLAS');
    assert.equal(fila[7], '56P-1');
    assert.equal(fila[8], '202');
    assert.equal(fila[9], 570 / 1440);
    assert.equal(fila[10], 660 / 1440);
    assert.equal(fila[14], 'x'); // MIERCOLES
    assert.equal(fila[18], 46253); // miércoles de la semana 1
    assert.equal(fila[19], 46358); // miércoles de la semana 16
    assert.equal(fila[20], 'YENIFFER WENDY ZAPANA AGUILAR');
    assert.equal(fila[21], '56NAEDE201');
    assert.equal(fila[22], null); // NRO_ALUMNOS_INSCRITOS vacío
    assert.equal(fila[23], 1);
});

test('las fechas se desplazan al día real de la sesión', () => {
    const [fila] = construirFilasExcel([
        filaBase({
            dia_semana: 'MARTES',
            semana_inicio: 1,
            semana_fin: 1,
        }),
    ], '202620');

    assert.equal(fila[18], 46252); // martes de la semana 1
    assert.equal(fila[19], 46252);
});

test('EMP queda fuera de aula, sin docente y con IND_SESION 2', () => {
    const [fila] = construirFilasExcel([
        filaBase({
            tipo_modalidad: 'EMP',
            id_docente: null,
            id_ambiente: null,
            pabellon: null,
            codigo_ambiente: null,
            dia_semana: 'LUNES',
        }),
    ], '202620');

    assert.equal(fila[6], null);
    assert.equal(fila[7], '00-EX');
    assert.equal(fila[8], null);
    assert.equal(fila[20], null);
    assert.equal(fila[23], 2);
    assert.equal(fila[12], 'x');
});

test('VIR usa VAEE y edificio virtual', () => {
    const [fila] = construirFilasExcel([
        filaBase({
            tipo_modalidad: 'VIR',
            id_docente: null,
            codigo_ambiente: null,
            pabellon: null,
        }),
    ], '202620');

    assert.equal(fila[5], 'TEC'); // la sesión virtual pertenece a TEC
    assert.equal(fila[6], 'VAEE');
    assert.equal(fila[7], 'SV-EV');
    assert.equal(fila[8], null);
    assert.equal(fila[20], null);
    assert.equal(fila[23], 2);
});

test('SECCION es único y secuencial por curso/bloque/grupo', () => {
    const filas = construirFilasExcel([
        filaBase(),
        filaBase({ mat_cur: 'NCCU-276' }),
        filaBase({ mat_cur: 'NCCU-276', tipo_modalidad: 'VIR', id_docente: null }),
        filaBase({ mat_cur: 'CGEU-271', grupo: '02' }),
    ], '202620');

    assert.deepEqual(filas.map((fila) => fila[2]), [1, 2, 2, 3]);
});

test('TEC y TAL del mismo curso usan secciones distintas', () => {
    const filas = construirFilasExcel([
        filaBase(),
        filaBase({ tipo_modalidad: 'TAL' }),
        filaBase({ tipo_modalidad: 'EMP', id_docente: null }),
    ], '202620');

    assert.deepEqual(filas.map((fila) => fila[2]), [1, 2, 3]);
});

test('genera un Excel independiente por zonal/carrera', () => {
    const filas = [
        filaBase({
            codigo_carrera: 'PIAD',
            nombre_carrera: 'Ingeniería de Software con IA',
        }),
        filaBase({
            codigo_carrera: 'PIAD',
            nombre_carrera: 'Ingeniería de Software con IA',
            mat_cur: 'PIAD-222',
        }),
        filaBase({
            codigo_carrera: 'PCBD',
            nombre_carrera: 'Contabilidad',
            mat_cur: 'PCBD-221',
        }),
    ];

    const archivos = construirArchivosPorCarrera(filas, '202620');
    const nombres = archivos.map((archivo) => archivo.nombre).sort();

    assert.deepEqual(nombres, [
        'TACNA_CONTABILIDAD.xlsx',
        'TACNA_INGENIERIA_DE_SOFTWARE_CON_IA.xlsx',
    ]);
    assert.deepEqual(
        archivos.map((archivo) => archivo.filas).sort((a, b) => a - b),
        [1, 2]
    );
    assert.ok(archivos.every((archivo) => Buffer.isBuffer(archivo.contenido)));
});

test('el nombre de archivo normaliza zonal y carrera', () => {
    assert.equal(
        normalizarNombreArchivo('Ingeniería de Software con IA'),
        'INGENIERIA_DE_SOFTWARE_CON_IA'
    );
    assert.equal(normalizarNombreArchivo('Tacna'), 'TACNA');
});

test('crearZip produce un ZIP deflate válido', () => {
    const contenido = Buffer.from('Contenido de prueba');
    const zip = crearZip([{ nombre: 'datos.txt', contenido }]);

    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    const metodo = zip.readUInt16LE(8);
    const nombreLargo = zip.readUInt16LE(26);
    const extraLargo = zip.readUInt16LE(28);
    const comprimidoLargo = zip.readUInt32LE(18);
    const inicioDatos = 30 + nombreLargo + extraLargo;
    const nombre = zip.subarray(30, 30 + nombreLargo).toString('utf8');
    const comprimido = zip.subarray(inicioDatos, inicioDatos + comprimidoLargo);
    const recuperado = zlib.inflateRawSync(comprimido);

    assert.equal(metodo, 8);
    assert.equal(nombre, 'datos.txt');
    assert.deepEqual(recuperado, contenido);
    assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
    assert.equal(zip.readUInt16LE(zip.length - 22 + 10), 1);
});
