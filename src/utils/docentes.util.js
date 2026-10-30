const DIAS = [
    'LUNES',
    'MARTES',
    'MIERCOLES',
    'JUEVES',
    'VIERNES',
    'SABADO',
    'DOMINGO'
];

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

    exigir(
        datos.dni == null || typeof datos.dni === 'string',
        'El DNI debe ingresarse como texto.'
    );

    resultado.dni = (datos.dni || '').trim() || null;

    exigir(
        !resultado.dni || /^\d{8}$/.test(resultado.dni),
        'El DNI debe tener 8 dígitos.'
    );

    resultado.estado = datos.estado || 'A';

    exigir(
        ['A', 'I', 'V'].includes(resultado.estado),
        'Estado inválido.'
    );

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
function consolidar(franjas) {
    exigir(
        Array.isArray(franjas) && franjas.length <= 1000,
        'Disponibilidad inválida.'
    );

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
            fin > inicio,
            'La hora final debe ser posterior al inicio.'
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
    docente,
    minutos,
    hora,
    consolidar,
    totalMinutos
};