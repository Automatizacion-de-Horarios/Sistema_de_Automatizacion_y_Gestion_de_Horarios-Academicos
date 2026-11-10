const baseDatos = require('../config/db');
const Horario = require('../models/horario.model');
const HorarioBorrador = require('../models/horarioBorrador.model');
const Ambiente = require('../models/ambiente.model');
const controladorSolver = require('./horarioSolver.controller');

const atender = (operacion) => async (req, res) => {
    try {
        await operacion(req, res);
    } catch (error) {
        const estado = Number(error.status) || 500;
        console.error('Error al procesar horario borrador:', error.code || error.message);
        const contenido = {
            success: false,
            message: estado < 500
                ? error.message
                : 'No se pudo procesar el horario borrador.',
        };
        if (Array.isArray(error.conflictos) && error.conflictos.length) {
            contenido.conflictos = error.conflictos;
        }
        res.status(estado).json(contenido);
    }
};

const DIAS = new Set([
    'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO',
]);

const normalizarTexto = (valor) => String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

function exigirSinSolverActivo() {
    if (controladorSolver.hayTrabajoActivo()) {
        const error = new Error(
            'Hay una generación de horario en curso. Espera a que termine o cancélala antes de modificar datos.'
        );
        error.status = 409;
        throw error;
    }
}

function leerIdBorrador(valor, obligatorio = false) {
    if (valor === undefined || valor === null || valor === '') {
        if (obligatorio) {
            const error = new Error('Debes indicar el borrador.');
            error.status = 400;
            throw error;
        }
        return null;
    }

    const numero = Number(valor);
    if (!Number.isSafeInteger(numero) || numero <= 0) {
        const error = new Error('El identificador del borrador no es válido.');
        error.status = 400;
        throw error;
    }
    return numero;
}

module.exports = {
    listarVersiones: atender(async (req, res) => {
        const codigoPeriodo = req.query?.periodo ?? '202620';
        if (
            typeof codigoPeriodo !== 'string' ||
            !/^[A-Za-z0-9_-]{1,10}$/.test(codigoPeriodo)
        ) {
            return res.status(400).json({
                success: false,
                message: 'El código de periodo no es válido.',
            });
        }

        const borradores = await HorarioBorrador.listar(codigoPeriodo);
        res.json({
            success: true,
            data: {
                periodo: codigoPeriodo,
                borradores,
            },
        });
    }),

    listarAmbientes: atender(async (req, res) => {
        const sedeId = Number(req.query?.sede);
        if (!Number.isSafeInteger(sedeId) || sedeId <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Debes indicar la sede del bloque.',
            });
        }

        const aulas = await Ambiente.listarAulasPorSede(sedeId);
        res.json({ success: true, data: { aulas } });
    }),

    cambiarAula: atender(async (req, res) => {
        try {
            exigirSinSolverActivo();
            const codigoPeriodo = req.params.periodo;
            if (
                typeof codigoPeriodo !== 'string' ||
                !/^[A-Za-z0-9_-]{1,10}$/.test(codigoPeriodo)
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'El código de periodo no es válido.',
                });
            }

            const identificadores = req.body?.ids;
            const idAmbiente = Number(req.body?.id_ambiente);
            const idBorrador = Number(req.body?.id_borrador);
            if (
                !Array.isArray(identificadores) ||
                !identificadores.length ||
                identificadores.some((id) => !Number.isSafeInteger(Number(id)) || Number(id) <= 0) ||
                !Number.isSafeInteger(idAmbiente) || idAmbiente <= 0 ||
                !Number.isSafeInteger(idBorrador) || idBorrador <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'Los datos del cambio de aula no son válidos.',
                });
            }

            const ambiente = await Ambiente.obtener(idAmbiente);
            if (!ambiente || Number(ambiente.id_tipo_ambiente) !== 5) {
                return res.status(400).json({
                    success: false,
                    message: 'Solo se pueden asignar aulas, no laboratorios.',
                });
            }

            const conexion = await baseDatos.getConnection();
            try {
                await conexion.beginTransaction();

                const ids = [...new Set(identificadores.map(Number))];
                const marcadores = ids.map(() => '?').join(', ');
                const [bloques] = await conexion.query(
                    `SELECT id_horario, id_periodo, id_borrador, dia_semana,
                            hora_inicio, hora_fin, semana_inicio, semana_fin
                       FROM horarios_generados
                      WHERE id_periodo = (SELECT id_periodo FROM periodos WHERE codigo_periodo = ?)
                        AND id_borrador = ?
                        AND estado = 'BORRADOR'
                        AND id_horario IN (${marcadores})
                      FOR UPDATE`,
                    [codigoPeriodo, idBorrador, ...ids]
                );
                if (bloques.length !== ids.length) {
                    throw Object.assign(new Error('Una o más clases ya no están disponibles.'), { status: 409 });
                }

                const base = bloques[0];
                const [conflictos] = await conexion.query(
                    `SELECT COUNT(*) AS total
                       FROM horarios_generados hg
                      WHERE hg.id_periodo = ?
                        AND hg.id_borrador = ?
                        AND hg.id_ambiente = ?
                        AND hg.estado IN ('BORRADOR', 'CONFIRMADO')
                        AND hg.dia_semana = ?
                        AND hg.hora_inicio < ?
                        AND hg.hora_fin > ?
                        AND hg.semana_inicio <= ?
                        AND hg.semana_fin >= ?
                        AND hg.id_horario NOT IN (${marcadores})`,
                    [
                        base.id_periodo,
                        idBorrador,
                        idAmbiente,
                        base.dia_semana,
                        base.hora_fin,
                        base.hora_inicio,
                        base.semana_fin,
                        base.semana_inicio,
                        ...ids,
                    ]
                );
                if (Number(conflictos[0]?.total) > 0) {
                    throw Object.assign(new Error('El aula está ocupada en ese horario.'), { status: 409 });
                }

                await conexion.query(
                    `UPDATE horarios_generados
                        SET id_ambiente = ?
                      WHERE id_periodo = ?
                        AND id_borrador = ?
                        AND estado = 'BORRADOR'
                        AND id_horario IN (${marcadores})`,
                    [idAmbiente, base.id_periodo, idBorrador, ...ids]
                );

                await conexion.commit();
                res.json({ success: true, data: { ids, id_ambiente: idAmbiente } });
            } catch (error) {
                await conexion.rollback();
                console.error('Error al cambiar aula:', error);
                const status = Number(error.status) || 400;
                res.status(status).json({
                    success: false,
                    message: error.message || 'No se pudo cambiar el aula.',
                });
                return;
            } finally {
                conexion.release();
            }
        } catch (error) {
            console.error('Error general al cambiar aula:', error);
            res.status(400).json({
                success: false,
                message: error.message || 'No se pudo cambiar el aula.',
            });
        }
    }),

    eliminarBorrador: atender(async (req, res) => {
        exigirSinSolverActivo();
        const codigoPeriodo = req.params.periodo;
        if (
            typeof codigoPeriodo !== 'string' ||
            !/^[A-Za-z0-9_-]{1,10}$/.test(codigoPeriodo)
        ) {
            return res.status(400).json({
                success: false,
                message: 'El código de periodo no es válido.',
            });
        }

        const idBorrador = leerIdBorrador(req.params.idBorrador, true);
        await HorarioBorrador.eliminar(codigoPeriodo, idBorrador);
        const borradores = await HorarioBorrador.listar(codigoPeriodo);
        res.json({
            success: true,
            data: {
                id_borrador: idBorrador,
                borradores,
            },
        });
    }),

    listarBorradores: atender(async (req, res) => {
        const codigoPeriodo = req.query.periodo ?? '202620';
        if (
            typeof codigoPeriodo !== 'string' ||
            !/^[A-Za-z0-9_-]{1,10}$/.test(codigoPeriodo)
        ) {
            return res.status(400).json({
                success: false,
                message: 'El código de periodo no es válido.',
            });
        }

        const idBorrador = leerIdBorrador(req.query?.id_borrador);
        const resultado = await Horario.listarBorradores(
            codigoPeriodo,
            idBorrador
        );
        if (!resultado) {
            return res.status(404).json({
                success: false,
                message: `No existe el periodo ${codigoPeriodo}.`,
            });
        }

        res.json({
            success: true,
            data: {
                ...resultado.periodo,
                estado: resultado.estado,
                borrador: resultado.borrador,
                borradores: resultado.borradores,
                total: resultado.bloques.length,
                bloques: resultado.bloques,
                restricciones: resultado.restricciones,
            },
        });
    }),

    moverBorradores: atender(async (req, res) => {
        exigirSinSolverActivo();
        const codigoPeriodo = req.params.periodo;
        if (
            typeof codigoPeriodo !== 'string' ||
            !/^[A-Za-z0-9_-]{1,10}$/.test(codigoPeriodo)
        ) {
            return res.status(400).json({
                success: false,
                message: 'El código de periodo no es válido.',
            });
        }

        const identificadores = req.body?.ids;
        const dia = normalizarTexto(req.body?.dia);
        const horaInicio = req.body?.hora_inicio;
        if (
            !Array.isArray(identificadores) ||
            identificadores.length < 1 ||
            identificadores.length > 100 ||
            identificadores.some((identificador) => !Number.isSafeInteger(Number(identificador)) || Number(identificador) <= 0) ||
            !DIAS.has(dia)
        ) {
            return res.status(400).json({
                success: false,
                message: 'La clase o el día destino no son válidos.',
            });
        }
        if (
            typeof horaInicio !== 'string' ||
            !/^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/.test(horaInicio)
        ) {
            return res.status(400).json({
                success: false,
                message: 'La hora debe estar en la grilla de 15 minutos.',
            });
        }

        const idBorrador = leerIdBorrador(req.body?.id_borrador);
        const movimiento = await Horario.moverBorradores(
            codigoPeriodo,
            [...new Set(identificadores.map(Number))],
            { dia, hora_inicio: `${horaInicio}:00` },
            idBorrador
        );
        res.json({ success: true, data: movimiento });
    }),

    cambiarEstado: atender(async (req, res) => {
        exigirSinSolverActivo();
        const codigoPeriodo = req.params.periodo;
        const estado = normalizarTexto(req.body?.estado);
        if (
            typeof codigoPeriodo !== 'string' ||
            !/^[A-Za-z0-9_-]{1,10}$/.test(codigoPeriodo) ||
            !['BORRADOR', 'CONFIRMADO'].includes(estado)
        ) {
            return res.status(400).json({
                success: false,
                message: 'El periodo o el estado no son válidos.',
            });
        }

        const idBorrador = leerIdBorrador(req.body?.id_borrador, true);
        const resultado = await Horario.cambiarEstado(
            codigoPeriodo,
            estado,
            idBorrador
        );
        res.json({ success: true, data: resultado });
    }),
};
