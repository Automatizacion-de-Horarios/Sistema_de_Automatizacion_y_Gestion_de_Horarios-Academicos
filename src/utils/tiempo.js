// src/utils/tiempo.js

function aMinutos(horaStr) {
    const [h, m] = horaStr.split(':').map(Number);
    return h * 60 + m;
}

function aHora(minutos) {
    const h = Math.floor(minutos / 60).toString().padStart(2, '0');
    const m = (minutos % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
}

function validarFranjas(lista) {
    if (!Array.isArray(lista)) {
        return { valido: false, mensaje: 'El formato de franjas debe ser una lista' };
    }
    const regexHora = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    const minPermitido = aMinutos('07:00');
    const maxPermitido = aMinutos('21:00');

    for (let i = 0; i < lista.length; i++) {
        const f = lista[i];
        if (!f.dia_semana || typeof f.dia_semana !== 'number' || f.dia_semana < 1 || f.dia_semana > 6) {
            return { valido: false, mensaje: `Franja ${i + 1}: día de semana inválido (debe ser un número entero entre 1 y 6)` };
        }
        if (!regexHora.test(f.hora_inicio) || !regexHora.test(f.hora_fin)) {
            return { valido: false, mensaje: `Franja ${i + 1}: formato de hora inválido (use HH:MM)` };
        }
        const inicioMin = aMinutos(f.hora_inicio);
        const finMin = aMinutos(f.hora_fin);

        if (inicioMin < minPermitido || finMin > maxPermitido) {
            return { valido: false, mensaje: `Franja ${i + 1}: las horas deben estar estrictamente entre 07:00 y 21:00` };
        }
        if (finMin <= inicioMin) {
            return { valido: false, mensaje: `Franja ${i + 1}: la hora de fin debe ser mayor que la hora de inicio` };
        }
    }
    return { valido: true };
}

function fusionarFranjas(lista) {
    if (!lista || lista.length === 0) return [];

    const porDia = {};
    lista.forEach(f => {
        if (!porDia[f.dia_semana]) porDia[f.dia_semana] = [];
        porDia[f.dia_semana].push({
            inicio: aMinutos(f.hora_inicio),
            fin: aMinutos(f.hora_fin)
        });
    });

    const resultado = [];
    for (const diaStr in porDia) {
        const dia = Number(diaStr);
        const franjasDia = porDia[dia];
        franjasDia.sort((a, b) => a.inicio - b.inicio);

        const fusionadas = [];
        let actual = franjasDia[0];

        for (let i = 1; i < franjasDia.length; i++) {
            const siguiente = franjasDia[i];
            if (siguiente.inicio <= actual.fin) {
                actual.fin = Math.max(actual.fin, siguiente.fin);
            } else {
                fusionadas.push(actual);
                actual = siguiente;
            }
        }
        fusionadas.push(actual);

        fusionadas.forEach(f => {
            resultado.push({
                dia_semana: dia,
                hora_inicio: aHora(f.inicio),
                hora_fin: aHora(f.fin)
            });
        });
    }
    return resultado;
}

module.exports = {
    aMinutos,
    aHora,
    validarFranjas,
    fusionarFranjas
};