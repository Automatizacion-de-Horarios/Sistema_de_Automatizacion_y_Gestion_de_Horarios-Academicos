const test = require('node:test');
const assert = require('node:assert/strict');

const {
    bloquesQueSolapanRangos,
    claveClase,
    hora,
    mismaClase,
    rangosDeBloques,
    semanasDeBloques,
} = require('../src/utils/horarioMovimiento');

const clase = {
    id_programacion: 10,
    tipo_modalidad: 'TEC',
    id_docente: 7,
    id_ambiente: 3,
    dia_semana: 'MIÉRCOLES',
    hora_inicio: '08:00:00',
    hora_fin: '09:30:00',
    semana_inicio: 1,
    semana_fin: 4,
};

test('la misma clase se reconoce aunque cambie el rango de semanas', () => {
    const otroRango = { ...clase, semana_inicio: 5, semana_fin: 9 };

    assert.equal(claveClase(clase), claveClase(otroRango));
    assert.equal(mismaClase(clase, otroRango), true);
});

test('clases de distinto día, modalidad o docente no se confunden', () => {
    assert.equal(mismaClase(clase, { ...clase, dia_semana: 'JUEVES' }), false);
    assert.equal(mismaClase(clase, { ...clase, tipo_modalidad: 'TAL' }), false);
    assert.equal(mismaClase(clase, { ...clase, id_docente: 8 }), false);
    assert.equal(mismaClase(clase, { ...clase, hora_inicio: '10:00:00' }), false);
});

test('los días con y sin tilde se comparan igual', () => {
    assert.equal(
        claveClase({ ...clase, dia_semana: 'MIERCOLES' }),
        claveClase({ ...clase, dia_semana: 'MIÉRCOLES' })
    );
});

test('solo se consideran ocupaciones que comparten alguna semana real', () => {
    const rangos = rangosDeBloques([clase, { ...clase, semana_inicio: 8, semana_fin: 10 }]);
    const ocupaciones = [
        { ...clase, id_horario: 1, semana_inicio: 3, semana_fin: 5 },
        { ...clase, id_horario: 2, semana_inicio: 5, semana_fin: 7 },
        { ...clase, id_horario: 3, semana_inicio: 11, semana_fin: 12 },
    ];

    assert.deepEqual(
        bloquesQueSolapanRangos(ocupaciones, rangos).map((bloque) => bloque.id_horario),
        [1]
    );
});

test('las semanas cubiertas no se duplican entre rangos solapados', () => {
    const semanas = semanasDeBloques([
        { ...clase, semana_inicio: 1, semana_fin: 3 },
        { ...clase, semana_inicio: 3, semana_fin: 5 },
    ]);

    assert.deepEqual(semanas, [1, 2, 3, 4, 5]);
});

test('hora formatea minutos como TIME de MySQL', () => {
    assert.equal(hora(465), '07:45:00');
    assert.equal(hora(1260), '21:00:00');
});
