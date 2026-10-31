const DIAS = [
    'LUNES',
    'MARTES',
    'MIERCOLES',
    'JUEVES',
    'VIERNES',
    'SABADO',
    'DOMINGO'
];

const HORAS_CONTRATO = {
    TIEMPO_COMPLETO: [36],
    TIEMPO_PARCIAL: [19, 23]
};

// Detiene la operación cuando un dato no es válido.
function exigir(condicion, mensaje, status = 400) {
    if (!condicion) {
        const error = new Error(mensaje);
        error.status = status;
        throw error;
    }
}

// Valida identificadores de docentes y cursos.
function id(valor) {
    const numero = Number(valor);

    exigir(
        /^\d+$/.test(String(valor)) &&
        Number.isSafeInteger(numero) &&
        numero > 0,
        'Identificador inválido.'
    );

    return numero;
}

// Valida el tipo de contrato y su meta semanal.
function contrato(datos) {
    const datosContrato = datos && typeof datos === 'object' && !Array.isArray(datos) ? datos : {};
    const tipoContrato = String(datosContrato.tipo_contrato || 'TIEMPO_COMPLETO').trim().toUpperCase();

    exigir(
        Object.prototype.hasOwnProperty.call(HORAS_CONTRATO, tipoContrato),
        'Selecciona un tipo de contrato válido.'
    );

    const horasPorDefecto = tipoContrato === 'TIEMPO_COMPLETO' ? 36 : 19;
    const horasMeta = datosContrato.horas_semanales_meta == null || datosContrato.horas_semanales_meta === ''
        ? horasPorDefecto
        : Number(datosContrato.horas_semanales_meta);

    exigir(
        Number.isInteger(horasMeta) && HORAS_CONTRATO[tipoContrato].includes(horasMeta),
        'Las horas semanales deben ser 36 para tiempo completo, o 19 o 23 para tiempo parcial.'
    );

    return { tipo_contrato: tipoContrato, horas_semanales_meta: horasMeta };
}

// Normaliza la bandera que decide si el solver respeta la cuadrícula.
function restriccion(valor) {
    if (valor === undefined || valor === null || valor === '') return null;
    if (valor === true || valor === 1) return 1;
    if (valor === false || valor === 0) return 0;

    const texto = String(valor).trim().toLowerCase();
    if (texto === '1' || texto === 'true') return 1;
    if (texto === '0' || texto === 'false') return 0;

    exigir(false, 'La restricción horaria debe estar activa o inactiva.');
}

// Valida los datos del docente.
function docente(datos) {
    exigir(
        datos &&
        typeof datos === 'object' &&
        !Array.isArray(datos),
        'Datos inválidos.'
    );

    const resultado = {};

    for (const campo of ['nombres', 'apellidos', 'especialidad']) {
        exigir(
            datos[campo] == null || typeof datos[campo] === 'string',
            'El campo ' + campo + ' debe ser texto.'
        );

        resultado[campo] = (datos[campo] || '').trim();

        exigir(
            resultado[campo].length <= 100,
            'Máximo 100 caracteres en ' + campo + '.'
        );
    }

    exigir(
        resultado.nombres && resultado.apellidos,
        'Completa nombres y apellidos.'
    );

    resultado.estado = datos.estado || 'A';

    exigir(
        ['A', 'I'].includes(resultado.estado),
        'Estado inválido.'
    );

    Object.assign(resultado, contrato(datos));

    return resultado;
}

// Convierte una hora válida en minutos.
function minutos(texto, esFin = false) {
    exigir(
        typeof texto === 'string' &&
        /^\d{2}:\d{2}(:00)?$/.test(texto),
        'Hora inválida.'
    );

    const [h, m] = texto.split(':').map(Number);

    exigir(
        h <= 24 &&
        m < 60 &&
        m % 15 === 0 &&
        (h < 24 || (esFin && m === 0)),
        'Usa intervalos de 15 minutos.'
    );

    return h * 60 + m;
}

// Convierte minutos al formato HH:MM:SS.
function hora(n) {
    return (
        String(Math.floor(n / 60)).padStart(2, '0') +
        ':' +
        String(n % 60).padStart(2, '0') +
        ':00'
    );
}

// Une superposiciones y separaciones de hasta 45 minutos.
function consolidar(franjas, horario) {
    exigir(
        Array.isArray(franjas) && franjas.length <= 1000,
        'Disponibilidad inválida.'
    );

    exigir(horario && typeof horario === 'object', 'No hay una franja horaria configurada para este periodo.', 409);
    const limiteInicio = minutos(horario.hora_inicio);
    const limiteFin = minutos(horario.hora_fin, true);
    exigir(limiteFin > limiteInicio, 'La franja horaria configurada no es válida.', 409);

    const filas = franjas.map((f) => {
        exigir(
            f && typeof f === 'object',
            'Franja inválida.'
        );

        const dia = String(f.dia_semana)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase()
            .trim();

        exigir(DIAS.includes(dia), 'Día inválido.');

        const inicio = minutos(f.hora_inicio);
        const fin = minutos(f.hora_fin, true);

        exigir(
            fin > inicio && inicio >= limiteInicio && fin <= limiteFin,
            'La disponibilidad debe estar dentro de la franja horaria configurada.'
        );

        return { dia, inicio, fin };
    });

    filas.sort((a, b) => {
        return (
            DIAS.indexOf(a.dia) - DIAS.indexOf(b.dia) ||
            a.inicio - b.inicio
        );
    });

    const unidas = [];

    for (const fila of filas) {
        const ultima = unidas[unidas.length - 1];

        if (
            ultima &&
            ultima.dia === fila.dia &&
            fila.inicio - ultima.fin <= 45
        ) {
            ultima.fin = Math.max(ultima.fin, fila.fin);
        } else {
            unidas.push({ ...fila });
        }
    }

    return unidas.map((f) => ({
        dia_semana: f.dia,
        hora_inicio: hora(f.inicio),
        hora_fin: hora(f.fin)
    }));
}

// Cuenta minutos sin duplicar horarios superpuestos.
// Aquí no se rellenan los espacios entre tramos.
function totalMinutos(franjas) {
    let total = 0;

    for (const dia of DIAS) {
        let finAnterior = -1;

        const convertir = (texto) => {
            const [h, m] = texto.split(':').map(Number);
            return h * 60 + m;
        };

        const filas = franjas
            .filter((f) => {
                const nombreDia = String(f.dia_semana)
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .toUpperCase()
                    .trim();

                return nombreDia === dia;
            })
            .map((f) => [
                convertir(f.hora_inicio),
                convertir(f.hora_fin)
            ])
            .sort((a, b) => a[0] - b[0]);

        for (const [inicio, fin] of filas) {
            total += Math.max(
                0,
                fin - Math.max(inicio, finAnterior)
            );

            finAnterior = Math.max(finAnterior, fin);
        }
    }

    return total;
}

module.exports = {
    DIAS,
    exigir,
    id,
    contrato,
    docente,
    restriccion,
    minutos,
    hora,
    consolidar,
    totalMinutos
};