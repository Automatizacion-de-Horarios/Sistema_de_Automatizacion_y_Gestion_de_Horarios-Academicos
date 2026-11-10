const test = require('node:test');
const assert = require('node:assert/strict');

const {
    construirArgumentos,
    normalizarBooleano,
    redactarLinea,
    resolverPythonBin,
    validarPeriodo,
} = require('../src/controllers/horarioSolver.controller');

test('valida el periodo como seis dígitos', () => {
    assert.equal(validarPeriodo('202620'), '202620');
    assert.equal(validarPeriodo(202620), '202620');
    assert.throws(() => validarPeriodo('2026'), /6 dígitos/);
    assert.throws(() => validarPeriodo('202620; rm -rf /'), /6 dígitos/);
});

test('normaliza booleanos de entrada', () => {
    assert.equal(normalizarBooleano(true), true);
    assert.equal(normalizarBooleano('true'), true);
    assert.equal(normalizarBooleano('1'), true);
    assert.equal(normalizarBooleano('si'), true);
    assert.equal(normalizarBooleano(false), false);
    assert.equal(normalizarBooleano('0'), false);
    assert.equal(normalizarBooleano(undefined, true), true);
    assert.throws(() => normalizarBooleano('quizá'), /booleano/);
});

test('construye los argumentos del solver sin shell', () => {
    const argumentos = construirArgumentos({
        periodo: '202620',
        reemplazarBorradores: true,
    });

    assert.ok(argumentos.some((valor) => valor.endsWith('solver_horarios_db.py')));
    assert.deepEqual(argumentos.slice(1, 3), ['--periodo', '202620']);
    assert.ok(argumentos.includes('--reemplazar-borradores'));
    assert.ok(!argumentos.includes('--dry-run'));
});

test('dry-run no reemplaza borradores', () => {
    const argumentos = construirArgumentos({
        periodo: '202620',
        reemplazarBorradores: true,
        dryRun: true,
    });

    assert.ok(argumentos.includes('--dry-run'));
    assert.ok(!argumentos.includes('--reemplazar-borradores'));
});

test('redacta credenciales en los logs', () => {
    const linea = redactarLinea('Conectando MYSQL_PASSWORD=secreto123 host=db');
    assert.ok(!linea.includes('secreto123'));
    assert.ok(linea.includes('MYSQL_PASSWORD=***'));
});

test('respeta PYTHON_BIN si está configurado', () => {
    const anterior = process.env.PYTHON_BIN;
    process.env.PYTHON_BIN = '/ruta/personalizada/python';
    try {
        assert.equal(resolverPythonBin(), '/ruta/personalizada/python');
    } finally {
        if (anterior === undefined) delete process.env.PYTHON_BIN;
        else process.env.PYTHON_BIN = anterior;
    }
});
