const Horario = require('../models/horario.model');

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

module.exports = {
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

        const resultado = await Horario.listarBorradores(codigoPeriodo);
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
                total: resultado.bloques.length,
                bloques: resultado.bloques,
                restricciones: resultado.restricciones,
            },
        });
    }),

    moverBorradores: atender(async (req, res) => {
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

        const movimiento = await Horario.moverBorradores(
            codigoPeriodo,
            [...new Set(identificadores.map(Number))],
            { dia, hora_inicio: `${horaInicio}:00` }
        );
        res.json({ success: true, data: movimiento });
    }),

    cambiarEstado: atender(async (req, res) => {
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

        const resultado = await Horario.cambiarEstado(codigoPeriodo, estado);
        res.json({ success: true, data: resultado });
    }),
};
