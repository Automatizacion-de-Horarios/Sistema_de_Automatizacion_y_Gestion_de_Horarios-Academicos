/**
 * Reglas puras para mover una clase en el horario borrador.
 *
 * Una "clase" es el conjunto de filas de `horarios_generados` que comparten
 * programación, modalidad, docente, ambiente, día y rango horario. El solver
 * puede partir una clase en varios registros por feriados o por rangos de
 * semanas; todos ellos deben moverse juntos para conservar el mismo horario
 * durante el semestre. Los demás cursos no se recolocan: si un curso termina,
 * sus espacios quedan vacíos.
 */

const normalizarDia = (valor) => String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();

const minutos = (valor) => {
    const [hora, minuto] = String(valor ?? '').split(':').map(Number);
    return Number.isFinite(hora) && Number.isFinite(minuto)
        ? hora * 60 + minuto
        : null;
};

const idNormalizado = (valor) => {
    if (valor === null || valor === undefined || valor === '') return null;
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero : String(valor);
};

// Identifica la clase recurrente completa, no una fila ni una semana concreta.
function claveClase(bloque) {
    return [
        idNormalizado(bloque && bloque.id_programacion),
        String((bloque && bloque.tipo_modalidad) ?? '').toUpperCase(),
        idNormalizado(bloque && bloque.id_docente),
        idNormalizado(bloque && bloque.id_ambiente),
        normalizarDia(bloque && bloque.dia_semana),
        minutos(bloque && bloque.hora_inicio),
        minutos(bloque && bloque.hora_fin),
    ].join('|');
}

function mismaClase(izquierda, derecha) {
    return claveClase(izquierda) === claveClase(derecha);
}

function rangoSemanas(bloque) {
    return {
        inicio: Number(bloque && bloque.semana_inicio),
        fin: Number(bloque && bloque.semana_fin),
    };
}

function rangosDeBloques(bloques = []) {
    return bloques.map(rangoSemanas);
}

function rangosSeSolapan(izquierdo, derecho) {
    return izquierdo.inicio <= derecho.fin && derecho.inicio <= izquierdo.fin;
}

// Devuelve solo las ocupaciones que comparten al menos una semana con la clase.
function bloquesQueSolapanRangos(bloques = [], rangos = []) {
    if (!rangos.length) return [];
    return bloques.filter((bloque) => {
        const rango = rangoSemanas(bloque);
        return rangos.some((objetivo) => rangosSeSolapan(rango, objetivo));
    });
}

// Semanas reales cubiertas por la clase, sin duplicar rangos solapados.
function semanasDeBloques(bloques = []) {
    const semanas = new Set();
    bloques.forEach((bloque) => {
        const { inicio, fin } = rangoSemanas(bloque);
        if (!Number.isFinite(inicio) || !Number.isFinite(fin)) return;
        for (let semana = inicio; semana <= fin; semana += 1) {
            semanas.add(semana);
        }
    });
    return [...semanas].sort((izquierda, derecha) => izquierda - derecha);
}

function hora(minutosTotales) {
    return (
        String(Math.floor(minutosTotales / 60)).padStart(2, '0') +
        ':' +
        String(minutosTotales % 60).padStart(2, '0') +
        ':00'
    );
}

module.exports = {
    bloquesQueSolapanRangos,
    claveClase,
    hora,
    mismaClase,
    minutos,
    normalizarDia,
    rangoSemanas,
    rangosDeBloques,
    rangosSeSolapan,
    semanasDeBloques,
};
