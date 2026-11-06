const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const modelPath = require.resolve(path.join(__dirname, '..', 'src', 'models', 'configuracion.model.js'));
const guardados = [];
require.cache[modelPath] = {
    id: modelPath,
    filename: modelPath,
    loaded: true,
    exports: {
        obtenerPeriodos: async () => [{ id_periodo: 1, codigo_periodo: '202620' }],
        guardarConfiguracionPeriodo: async (configuracion) => guardados.push(configuracion),
    },
};

const { actualizarFranjaHoraria } = require('../src/controllers/configuracion.controller');

function respuesta() {
    return {
        statusCode: 200,
        status(codigo) {
            this.statusCode = codigo;
            return this;
        },
        json(datos) {
            this.datos = datos;
            return this;
        },
    };
}

function solicitud(overrides = {}) {
    return {
        body: {
            id_periodo: '202620',
            hora_inicio_mañana: '07:45',
            hora_cierre_noche: '23:00',
            incluir_domingo: true,
            fecha_inicio: '2026-03-02',
            fecha_fin: '2026-03-15',
            ...overrides,
        },
    };
}

test('guarda fechas del período y calcula semanas incluyendo ambos extremos', async () => {
    const res = respuesta();

    await actualizarFranjaHoraria(solicitud(), res);

    assert.equal(res.datos.success, true);
    assert.equal(res.datos.cantidad_semanas, 2);
    const guardado = guardados[guardados.length - 1];
    assert.equal(guardado.cantidad_semanas, 2);
    assert.equal(guardado.incluir_domingo, 1);
});

test('rechaza fecha final anterior al inicio', async () => {
    const res = respuesta();
    const cantidadGuardados = guardados.length;

    await actualizarFranjaHoraria(solicitud({ fecha_fin: '2026-03-01' }), res);

    assert.equal(res.statusCode, 400);
    assert.equal(guardados.length, cantidadGuardados);
});
