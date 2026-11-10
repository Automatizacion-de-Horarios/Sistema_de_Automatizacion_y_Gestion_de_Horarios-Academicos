const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const HorarioBorrador = require('../models/horarioBorrador.model');
const { prepararDirectorioSalida } = require('../utils/salidaHorarios.util');

const RAIZ_PROYECTO = path.resolve(__dirname, '..', '..');
const RUTA_SOLVER = path.join(RAIZ_PROYECTO, 'solver_horarios_db.py');
const PATRON_PERIODO = /^\d{6}$/;
const MAX_LINEAS = 250;
const MAX_TRABAJOS = 20;
const TIEMPO_LIMITE_PYTHON = Number(process.env.SOLVER_TIEMPO_LIMITE) > 0
    ? Number(process.env.SOLVER_TIEMPO_LIMITE)
    : 300;
const TIEMPO_ESPERA_MS = Number(process.env.SOLVER_TIMEOUT_MS) > 0
    ? Number(process.env.SOLVER_TIMEOUT_MS)
    : Math.max(15 * 60 * 1000, (TIEMPO_LIMITE_PYTHON + 120) * 1000);

const trabajos = new Map();
let trabajoActivo = null;

const atender = (operacion) => async (req, res) => {
    try {
        await operacion(req, res);
    } catch (error) {
        const estado = Number(error.status) || 500;
        console.error('Error al ejecutar el solver:', error.code || error.message);
        res.status(estado).json({
            success: false,
            message: estado < 500
                ? error.message
                : 'No se pudo ejecutar el solver de horarios.',
        });
    }
};

function validarPeriodo(valor) {
    const periodo = String(valor ?? '').trim();
    if (!PATRON_PERIODO.test(periodo)) {
        const error = new Error('El periodo debe tener exactamente 6 dígitos.');
        error.status = 400;
        throw error;
    }
    return periodo;
}

function normalizarBooleano(valor, predeterminado = false) {
    if (valor === undefined || valor === null || valor === '') return predeterminado;
    if (typeof valor === 'boolean') return valor;

    const texto = String(valor).trim().toLowerCase();
    if (['1', 'true', 'si', 'sí', 'yes', 'on'].includes(texto)) return true;
    if (['0', 'false', 'no', 'off'].includes(texto)) return false;

    const error = new Error('El valor booleano enviado no es válido.');
    error.status = 400;
    throw error;
}

function resolverPythonBin() {
    if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;

    const candidatos = process.platform === 'win32'
        ? [
            path.join(RAIZ_PROYECTO, '.venv', 'Scripts', 'python.exe'),
            path.join(RAIZ_PROYECTO, 'venv', 'Scripts', 'python.exe'),
        ]
        : [
            path.join(RAIZ_PROYECTO, '.venv', 'bin', 'python'),
            path.join(RAIZ_PROYECTO, 'venv', 'bin', 'python'),
        ];

    for (const candidato of candidatos) {
        if (fs.existsSync(candidato)) return candidato;
    }

    return process.platform === 'win32' ? 'python' : 'python3';
}

function construirArgumentos({
    periodo,
    reemplazarBorradores = false,
    dryRun = false,
    idBorrador = null,
}) {
    const argumentos = [RUTA_SOLVER, '--periodo', periodo];

    if (dryRun) {
        argumentos.push('--dry-run');
    } else {
        if (idBorrador != null) {
            argumentos.push('--id-borrador', String(idBorrador));
        }
        if (reemplazarBorradores) {
            argumentos.push('--reemplazar-borradores');
        }
    }

    if (Number(process.env.SOLVER_TIEMPO_LIMITE) > 0) {
        argumentos.push(
            '--tiempo-limite',
            String(Math.max(300, Number(process.env.SOLVER_TIEMPO_LIMITE)))
        );
    }

    if (Number(process.env.SOLVER_TRABAJADORES) > 0) {
        argumentos.push(
            '--trabajadores',
            String(Math.max(1, Math.trunc(Number(process.env.SOLVER_TRABAJADORES))))
        );
    }

    if (periodo === '202620') {
        argumentos.push('--excepcion-tope-docente', '31=24');
    }

    if (process.env.SOLVER_VERBOSE !== 'false') {
        argumentos.push('--verbose');
    }

    if (process.env.SOLVER_SIN_OBJETIVO !== 'false') {
        argumentos.push('--sin-objetivo');
    }

    return argumentos;
}

function redactarLinea(linea) {
    return String(linea)
        .replace(
            /(MYSQL_PASSWORD|DB_PASSWORD|PASSWORD|CONTRASEÑA|CONTRASENA|CLAVE)\s*[:=]\s*[^\s,;]+/gi,
            '$1=***'
        )
        .replace(/(mysql:\/\/[^:\s]+:)([^@\s]+)(@)/gi, '$1***$3');
}

function registrarLinea(trabajo, linea) {
    const limpia = redactarLinea(linea).trimEnd();
    if (!limpia) return;

    trabajo.lineas.push(limpia);
    if (trabajo.lineas.length > MAX_LINEAS) {
        trabajo.lineas.splice(0, trabajo.lineas.length - MAX_LINEAS);
    }

    if (trabajo.flujoLog) {
        trabajo.flujoLog.write(`${new Date().toISOString()} ${limpia}\n`);
    }
}

function limpiarTrabajosFinalizados() {
    const finalizados = [...trabajos.values()]
        .filter((trabajo) => trabajo.finalizado)
        .sort((a, b) => (a.fin?.getTime() ?? 0) - (b.fin?.getTime() ?? 0));

    while (trabajos.size > MAX_TRABAJOS && finalizados.length) {
        const trabajo = finalizados.shift();
        trabajos.delete(trabajo.id);
    }
}

function finalizarTrabajo(trabajo, estado, datos = {}) {
    if (trabajo.finalizado) return;
    trabajo.finalizado = true;
    trabajo.estado = estado;
    trabajo.fin = new Date();
    Object.assign(trabajo, datos);

    if (trabajo.flujoLog) {
        try {
            trabajo.flujoLog.end();
        } catch {
            // El log es auxiliar; no debe afectar el resultado del solver.
        }
        trabajo.flujoLog = null;
    }

    if (trabajoActivo === trabajo.id) trabajoActivo = null;
    limpiarTrabajosFinalizados();

    const duracion = ((trabajo.fin.getTime() - trabajo.inicio.getTime()) / 1000).toFixed(1);
    console.log(
        `Solver ${trabajo.id} (${trabajo.periodo}) terminó con estado ${estado} en ${duracion} s.`
    );
}

function obtenerHito(lineas = []) {
    const texto = lineas.join('\\n').toLowerCase();
    if (texto.includes('filas insertadas') || texto.includes('horario guardado')) {
        return 'GUARDANDO';
    }
    if (texto.includes('bloques programados') || texto.includes('cp-sat')) {
        return 'RESOLVIENDO';
    }
    if (texto.includes('actividades semanales') || texto.includes('ventanas asignadas')) {
        return 'VALIDANDO';
    }
    if (texto.includes('conectando a mysql')) {
        return 'INICIANDO';
    }
    return 'EJECUTANDO';
}

function trabajoPublico(trabajo) {
    const fin = trabajo.fin ? trabajo.fin.getTime() : Date.now();
    const tiempoLimite = Number(process.env.SOLVER_TIEMPO_LIMITE) > 0
        ? Number(process.env.SOLVER_TIEMPO_LIMITE)
        : 300;
    const transcurrido = (fin - trabajo.inicio.getTime()) / 1000;
    const tiempoRestante = Math.max(0, tiempoLimite - transcurrido);
    let progreso = 0;
    if (trabajo.finalizado) {
        progreso = trabajo.estado === 'CANCELADO' ? 0 : 100;
    } else {
        progreso = Math.min(95, Math.max(5, Math.round((transcurrido / tiempoLimite) * 100)));
    }

    return {
        id: trabajo.id,
        estado: trabajo.estado,
        periodo: trabajo.periodo,
        id_borrador: trabajo.idBorrador,
        borrador: trabajo.nombreBorrador,
        reemplazar_borradores: trabajo.reemplazarBorradores,
        dry_run: trabajo.dryRun,
        inicio: trabajo.inicio.toISOString(),
        fin: trabajo.fin ? trabajo.fin.toISOString() : null,
        duracion_seg: Number(((fin - trabajo.inicio.getTime()) / 1000).toFixed(1)),
        tiempo_limite_seg: tiempoLimite,
        tiempo_restante_seg: Number(tiempoRestante.toFixed(1)),
        codigo_salida: trabajo.codigoSalida,
        senal: trabajo.senal,
        error: trabajo.error ? redactarLinea(trabajo.error) : null,
        lineas: trabajo.lineas.slice(-60),
        progreso,
        hito: obtenerHito(trabajo.lineas),
    };
}

async function crearLog(trabajo) {
    try {
        const directorio = await prepararDirectorioSalida('solver');
        const ruta = path.join(
            directorio,
            `solver_${trabajo.periodo}_${trabajo.id}.log`
        );
        const flujo = fs.createWriteStream(ruta, { flags: 'a' });
        flujo.on('error', () => {
            trabajo.flujoLog = null;
        });
        trabajo.flujoLog = flujo;
        flujo.write(
            `# Solver ${trabajo.id} periodo=${trabajo.periodo} ` +
            `borrador=${trabajo.idBorrador ?? '-'} ` +
            `reemplazar=${trabajo.reemplazarBorradores} dry_run=${trabajo.dryRun}\n`
        );
    } catch (error) {
        console.warn('No se pudo crear el log del solver:', error.message);
    }
}

async function limpiarBorradorFallido(trabajo) {
    if (!trabajo?.idBorrador) return;
    try {
        const eliminado = await HorarioBorrador.eliminarSiVacio(
            trabajo.idBorrador
        );
        if (eliminado) {
            registrarLinea(
                trabajo,
                `Borrador ${trabajo.idBorrador} eliminado porque quedó vacío.`
            );
        }
    } catch (error) {
        console.warn(
            `No se pudo limpiar el borrador ${trabajo.idBorrador}:`,
            error.message
        );
    }
}

const ejecutar = atender(async (req, res) => {
    const cuerpo = req.body || {};
    const periodo = validarPeriodo(cuerpo.periodo);
    const reemplazarBorradores = normalizarBooleano(
        cuerpo.reemplazar_borradores,
        false
    );
    const dryRun = normalizarBooleano(cuerpo.dry_run, false);

    if (reemplazarBorradores) {
        return res.status(400).json({
            success: false,
            message: (
                'La generación ya no reemplaza borradores. ' +
                'Cada ejecución crea un borrador nuevo del periodo.'
            ),
        });
    }

    if (trabajoActivo) {
        const activo = trabajos.get(trabajoActivo);
        if (activo && !activo.finalizado) {
            return res.status(409).json({
                success: false,
                message: 'Ya hay una ejecución del solver en curso.',
                data: trabajoPublico(activo),
            });
        }
        trabajoActivo = null;
    }

    if (!fs.existsSync(RUTA_SOLVER)) {
        const error = new Error('No se encontró solver_horarios_db.py en el proyecto.');
        error.status = 500;
        throw error;
    }

    const borrador = dryRun ? null : await HorarioBorrador.crear(periodo);

    const trabajo = {
        id: crypto.randomUUID(),
        estado: 'EJECUTANDO',
        periodo,
        idBorrador: borrador?.id_borrador ?? null,
        nombreBorrador: borrador?.nombre ?? null,
        cancelado: false,
        reemplazarBorradores: false,
        dryRun,
        inicio: new Date(),
        fin: null,
        finalizado: false,
        codigoSalida: null,
        senal: null,
        error: null,
        lineas: [],
        flujoLog: null,
        proceso: null,
    };

    trabajos.set(trabajo.id, trabajo);
    trabajoActivo = trabajo.id;
    await crearLog(trabajo);

    const python = resolverPythonBin();
    const argumentos = construirArgumentos({
        periodo,
        reemplazarBorradores: false,
        dryRun,
        idBorrador: trabajo.idBorrador,
    });

    console.log(
        `Iniciando solver ${trabajo.id} para el periodo ${periodo} ` +
        `y borrador ${trabajo.idBorrador ?? '(dry-run)'} con ${python}.`
    );

    let proceso;
    try {
        proceso = spawn(python, argumentos, {
            cwd: RAIZ_PROYECTO,
            env: {
                ...process.env,
                PYTHONUNBUFFERED: '1',
            },
            shell: false,
            windowsHide: true,
        });
    } catch (error) {
        finalizarTrabajo(trabajo, 'ERROR', {
            error: `No se pudo iniciar Python (${python}): ${error.message}`,
        });
        await limpiarBorradorFallido(trabajo);
        throw error;
    }

    trabajo.proceso = proceso;

    const salida = readline.createInterface({
        input: proceso.stdout,
        crlfDelay: Infinity,
    });
    const errores = readline.createInterface({
        input: proceso.stderr,
        crlfDelay: Infinity,
    });

    salida.on('line', (linea) => registrarLinea(trabajo, linea));
    errores.on('line', (linea) => registrarLinea(trabajo, linea));

    const temporizador = setTimeout(() => {
        if (trabajo.finalizado) return;
        trabajo.error = `El solver excedió el tiempo máximo de espera (${Math.round(TIEMPO_ESPERA_MS / 1000)} s).`;
        try {
            proceso.kill('SIGKILL');
        } catch {
            // Si el proceso ya terminó, el evento close hará la limpieza.
        }
    }, TIEMPO_ESPERA_MS);

    proceso.on('error', (error) => {
        clearTimeout(temporizador);
        salida.close();
        errores.close();
        finalizarTrabajo(trabajo, 'ERROR', {
            error: `No se pudo iniciar Python (${python}): ${error.message}`,
        });
        void limpiarBorradorFallido(trabajo);
    });

    proceso.on('close', (codigo, senal) => {
        clearTimeout(temporizador);
        salida.close();
        errores.close();

        const estado = trabajo.cancelado
            ? 'CANCELADO'
            : (trabajo.error || codigo !== 0 ? 'ERROR' : 'COMPLETADO');
        finalizarTrabajo(trabajo, estado, {
            codigoSalida: codigo,
            senal,
            error: trabajo.cancelado
                ? 'La generación fue cancelada por el usuario.'
                : (trabajo.error || (
                    codigo === 0
                        ? null
                        : `El solver terminó con código ${codigo}.`
                )),
        });
        if (estado === 'ERROR' || estado === 'CANCELADO') {
            void limpiarBorradorFallido(trabajo);
        }
    });

    return res.status(202).json({
        success: true,
        message: 'Ejecución del solver iniciada.',
        jobId: trabajo.id,
        data: trabajoPublico(trabajo),
    });
});

const estado = atender(async (req, res) => {
    const trabajo = trabajos.get(String(req.params.jobId));
    if (!trabajo) {
        return res.status(404).json({
            success: false,
            message: 'No se encontró la ejecución del solver solicitada.',
        });
    }

    return res.json({
        success: true,
        data: trabajoPublico(trabajo),
    });
});

const actual = atender(async (req, res) => {
    if (!trabajoActivo) {
        return res.json({ success: true, data: null });
    }

    const trabajo = trabajos.get(trabajoActivo);
    return res.json({
        success: true,
        data: trabajo ? trabajoPublico(trabajo) : null,
    });
});

const cancelar = atender(async (req, res) => {
    if (!trabajoActivo) {
        return res.json({ success: true, data: null });
    }

    const trabajo = trabajos.get(trabajoActivo);
    if (!trabajo || trabajo.finalizado) {
        trabajoActivo = null;
        return res.json({ success: true, data: null });
    }

    trabajo.cancelado = true;
    trabajo.error = 'La generación fue cancelada por el usuario.';
    try {
        trabajo.proceso.kill('SIGKILL');
    } catch (error) {
        // El proceso puede haber terminado entre la consulta y la señal.
    }

    return res.json({
        success: true,
        message: 'Cancelación solicitada.',
        data: trabajoPublico(trabajo),
    });
});

function hayTrabajoActivo() {
    if (!trabajoActivo) return false;
    const trabajo = trabajos.get(trabajoActivo);
    return Boolean(trabajo && !trabajo.finalizado);
}

module.exports = {
    actual,
    cancelar,
    construirArgumentos,
    estado,
    ejecutar,
    hayTrabajoActivo,
    normalizarBooleano,
    redactarLinea,
    resolverPythonBin,
    validarPeriodo,
};
