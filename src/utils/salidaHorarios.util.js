/**
 * Rutas de salida aisladas para los artefactos generados.
 *
 * Nunca escribimos junto a los archivos base: todo Excel, ZIP o reporte
 * derivado vive dentro de `horarios_generados/`.
 */

const path = require('path');
const fs = require('fs/promises');

const DIRECTORIO_SALIDA = path.resolve(__dirname, '..', '..', 'horarios_generados');

function resolverRutaSalida(...partes) {
    const destino = path.resolve(DIRECTORIO_SALIDA, ...partes.map(String));
    const raiz = `${DIRECTORIO_SALIDA}${path.sep}`;
    if (destino !== DIRECTORIO_SALIDA && !destino.startsWith(raiz)) {
        throw new Error(
            `La ruta ${destino} quedaría fuera de la carpeta de salida.`
        );
    }
    return destino;
}

async function prepararDirectorioSalida(...partes) {
    const destino = resolverRutaSalida(...partes);
    await fs.mkdir(destino, { recursive: true });
    return destino;
}

module.exports = {
    DIRECTORIO_SALIDA,
    prepararDirectorioSalida,
    resolverRutaSalida,
};
