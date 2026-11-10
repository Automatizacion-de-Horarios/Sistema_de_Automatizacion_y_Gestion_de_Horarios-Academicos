/**
 * Escritor ZIP mínimo sin dependencias externas.
 *
 * El proyecto sólo necesita empaquetar unos pocos archivos XLSX en memoria.
 * Usamos `zlib.deflateRawSync` (método 8 de ZIP) y CRC-32 para generar un
 * archivo compatible con `Expand-Archive`, 7-Zip y cualquier lector ZIP.
 */

const zlib = require('zlib');

const FIRMA_ARCHIVO_LOCAL = 0x04034b50;
const FIRMA_DIRECTORIO_CENTRAL = 0x02014b50;
const FIRMA_FIN_DIRECTORIO = 0x06054b50;

const TABLA_CRC32 = (() => {
    const tabla = new Uint32Array(256);
    for (let indice = 0; indice < 256; indice += 1) {
        let valor = indice;
        for (let bit = 0; bit < 8; bit += 1) {
            valor = (valor & 1) ? (0xedb88320 ^ (valor >>> 1)) : (valor >>> 1);
        }
        tabla[indice] = valor >>> 0;
    }
    return tabla;
})();

function calcularCrc32(contenido) {
    let crc = 0xffffffff;
    for (let indice = 0; indice < contenido.length; indice += 1) {
        crc = TABLA_CRC32[(crc ^ contenido[indice]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function fechaHoraDos(fecha = new Date()) {
    const anio = Math.max(1980, fecha.getFullYear());
    const hora = ((fecha.getHours() & 0x1f) << 11)
        | ((fecha.getMinutes() & 0x3f) << 5)
        | (Math.floor(fecha.getSeconds() / 2) & 0x1f);
    const dia = (((anio - 1980) & 0x7f) << 9)
        | (((fecha.getMonth() + 1) & 0x0f) << 5)
        | (fecha.getDate() & 0x1f);
    return { hora, dia };
}

/**
 * Crea un Buffer ZIP a partir de una lista de archivos.
 * @param {Array<{nombre: string, contenido: Buffer|string}>} archivos
 * @returns {Buffer}
 */
function crearZip(archivos) {
    if (!Array.isArray(archivos) || archivos.length === 0) {
        throw new Error('El ZIP debe contener al menos un archivo.');
    }

    const { hora, dia } = fechaHoraDos();
    const partesLocales = [];
    const partesCentrales = [];
    let desplazamiento = 0;

    for (const archivo of archivos) {
        if (!archivo || typeof archivo.nombre !== 'string' || !archivo.nombre) {
            throw new Error('Cada archivo del ZIP necesita un nombre válido.');
        }

        const nombre = Buffer.from(archivo.nombre, 'utf8');
        const datos = Buffer.isBuffer(archivo.contenido)
            ? archivo.contenido
            : Buffer.from(archivo.contenido ?? '');
        const comprimido = zlib.deflateRawSync(datos);
        const crc = calcularCrc32(datos);

        const cabeceraLocal = Buffer.alloc(30);
        cabeceraLocal.writeUInt32LE(FIRMA_ARCHIVO_LOCAL, 0);
        cabeceraLocal.writeUInt16LE(20, 4);       // versión necesaria
        cabeceraLocal.writeUInt16LE(0x0800, 6);   // nombres UTF-8
        cabeceraLocal.writeUInt16LE(8, 8);        // deflate
        cabeceraLocal.writeUInt16LE(hora, 10);
        cabeceraLocal.writeUInt16LE(dia, 12);
        cabeceraLocal.writeUInt32LE(crc, 14);
        cabeceraLocal.writeUInt32LE(comprimido.length, 18);
        cabeceraLocal.writeUInt32LE(datos.length, 22);
        cabeceraLocal.writeUInt16LE(nombre.length, 26);
        cabeceraLocal.writeUInt16LE(0, 28);       // sin campo extra

        const local = Buffer.concat([cabeceraLocal, nombre, comprimido]);
        partesLocales.push(local);

        const cabeceraCentral = Buffer.alloc(46);
        cabeceraCentral.writeUInt32LE(FIRMA_DIRECTORIO_CENTRAL, 0);
        cabeceraCentral.writeUInt16LE(20, 4);     // versión creadora
        cabeceraCentral.writeUInt16LE(20, 6);     // versión necesaria
        cabeceraCentral.writeUInt16LE(0x0800, 8);
        cabeceraCentral.writeUInt16LE(8, 10);
        cabeceraCentral.writeUInt16LE(hora, 12);
        cabeceraCentral.writeUInt16LE(dia, 14);
        cabeceraCentral.writeUInt32LE(crc, 16);
        cabeceraCentral.writeUInt32LE(comprimido.length, 20);
        cabeceraCentral.writeUInt32LE(datos.length, 24);
        cabeceraCentral.writeUInt16LE(nombre.length, 28);
        cabeceraCentral.writeUInt16LE(0, 30);     // extra
        cabeceraCentral.writeUInt16LE(0, 32);     // comentario
        cabeceraCentral.writeUInt16LE(0, 34);     // disco
        cabeceraCentral.writeUInt16LE(0, 36);     // atributos internos
        cabeceraCentral.writeUInt32LE(0, 38);     // atributos externos
        cabeceraCentral.writeUInt32LE(desplazamiento, 42);

        partesCentrales.push(Buffer.concat([cabeceraCentral, nombre]));
        desplazamiento += local.length;
    }

    const directorioCentral = Buffer.concat(partesCentrales);
    const finDirectorio = Buffer.alloc(22);
    finDirectorio.writeUInt32LE(FIRMA_FIN_DIRECTORIO, 0);
    finDirectorio.writeUInt16LE(0, 4);            // número de disco
    finDirectorio.writeUInt16LE(0, 6);            // disco del directorio
    finDirectorio.writeUInt16LE(archivos.length, 8);
    finDirectorio.writeUInt16LE(archivos.length, 10);
    finDirectorio.writeUInt32LE(directorioCentral.length, 12);
    finDirectorio.writeUInt32LE(desplazamiento, 16);
    finDirectorio.writeUInt16LE(0, 20);           // sin comentario

    return Buffer.concat([
        ...partesLocales,
        directorioCentral,
        finDirectorio,
    ]);
}

module.exports = {
    calcularCrc32,
    crearZip,
};
