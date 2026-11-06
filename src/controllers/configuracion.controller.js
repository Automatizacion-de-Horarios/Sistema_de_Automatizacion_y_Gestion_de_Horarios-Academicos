const ConfiguracionModel = require('../models/configuracion.model');

// Cargar toda la información necesaria para pintar la pantalla
const obtenerConfiguracionGlobal = async (req, res) => {
    try {
        const zonales = await ConfiguracionModel.obtenerZonales();
        const sedes = await ConfiguracionModel.obtenerSedes();
        const periodos = await ConfiguracionModel.obtenerPeriodos();
        const periodoSolicitado = req.query.periodo;
        const periodoSeleccionado = periodoSolicitado
            ? periodos.find((periodo) =>
                String(periodo.id_periodo) === String(periodoSolicitado) ||
                String(periodo.codigo_periodo) === String(periodoSolicitado)
            )
            : periodos.find((periodo) => periodo.estado === 'A') || periodos[0];

        if (periodoSolicitado && !periodoSeleccionado) {
            return res.status(404).json({
                success: false,
                message: 'El período solicitado no existe en la base de datos.'
            });
        }

        const franja = periodoSeleccionado
            ? await ConfiguracionModel.obtenerFranja(periodoSeleccionado.id_periodo)
            : null;

        res.json({
            success: true,
            data: {
                zonales,
                sedes,
                periodos,
                franja,
                periodo: periodoSeleccionado || null
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al obtener la configuración global', error: error.message });
    }
};

// Guardar una nueva sede desde el modal
const registrarSede = async (req, res) => {
    try {
        const { codigo_sede, id_zonal, nombre_sede, direccion_sede } = req.body;

        if (!codigo_sede || !id_zonal || !nombre_sede) {
            return res.status(400).json({ success: false, message: 'Faltan campos obligatorios' });
        }

        const idInsertado = await ConfiguracionModel.crearSede({
            codigo_sede,
            id_zonal,
            nombre_sede,
            direccion_sede: direccion_sede || 'Sin Dirección'
        });

        res.json({ success: true, message: 'Sede registrada con éxito', id_sede: idInsertado });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al registrar la sede', error: error.message });
    }
};

// Guardar los cambios de inicio/cierre de turno y estado del domingo
const actualizarFranjaHoraria = async (req, res) => {
    try {
        const {
            id_periodo,
            hora_inicio_mañana,
            hora_cierre_noche,
            incluir_domingo,
            fecha_inicio,
            fecha_fin
        } = req.body;

        const horas = [hora_inicio_mañana, hora_cierre_noche];
        if (horas.some((valor) =>
            typeof valor !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(valor)
        )) {
            return res.status(400).json({
                success: false,
                message: 'Las horas de inicio y cierre deben tener formato HH:mm.'
            });
        }
        const minutosInicio = Number(hora_inicio_mañana.slice(0, 2)) * 60 +
            Number(hora_inicio_mañana.slice(3, 5));
        const minutosFin = Number(hora_cierre_noche.slice(0, 2)) * 60 +
            Number(hora_cierre_noche.slice(3, 5));
        if (minutosInicio >= minutosFin) {
            return res.status(400).json({
                success: false,
                message: 'El cierre debe ser posterior al inicio de la jornada.'
            });
        }

        const validarFecha = (fecha) =>
            typeof fecha === 'string' &&
            /^\d{4}-\d{2}-\d{2}$/.test(fecha) &&
            !Number.isNaN(Date.parse(`${fecha}T00:00:00Z`)) &&
            new Date(`${fecha}T00:00:00Z`).toISOString().slice(0, 10) === fecha;
        if (!validarFecha(fecha_inicio) || !validarFecha(fecha_fin)) {
            return res.status(400).json({
                success: false,
                message: 'Ingresa fechas válidas de inicio y fin del período.'
            });
        }
        const inicioPeriodo = Date.parse(`${fecha_inicio}T00:00:00Z`);
        const finPeriodo = Date.parse(`${fecha_fin}T00:00:00Z`);
        if (finPeriodo < inicioPeriodo) {
            return res.status(400).json({
                success: false,
                message: 'La fecha de fin debe ser igual o posterior a la fecha de inicio.'
            });
        }
        const diasPeriodo = Math.floor((finPeriodo - inicioPeriodo) / 86_400_000) + 1;
        const cantidadSemanas = Math.ceil(diasPeriodo / 7);

        const periodos = await ConfiguracionModel.obtenerPeriodos();
        if (!periodos.length) {
            return res.status(400).json({ success: false, message: 'No existen períodos lectivos en la base de datos.' });
        }
        const periodoEncontrado = periodos.find((periodo) =>
            String(periodo.id_periodo) === String(id_periodo) ||
            String(periodo.codigo_periodo) === String(id_periodo)
        );
        if (!periodoEncontrado) {
            return res.status(400).json({
                success: false,
                message: 'Selecciona un período lectivo válido.'
            });
        }

        const valorDomingo = incluir_domingo ? 1 : 0;
        await ConfiguracionModel.guardarConfiguracionPeriodo({
            id_periodo: periodoEncontrado.id_periodo,
            hora_inicio_mañana,
            hora_cierre_noche,
            incluir_domingo: valorDomingo,
            fecha_inicio,
            fecha_fin,
            cantidad_semanas: cantidadSemanas
        });

        res.json({
            success: true,
            message: 'Configuración del período actualizada correctamente',
            cantidad_semanas: cantidadSemanas
        });
    } catch (error) {
        console.error("Error exacto en MySQL:", error);
        res.status(500).json({ success: false, message: 'Error al guardar la franja horaria', error: error.message });
    }
};

module.exports = {
    obtenerConfiguracionGlobal,
    registrarSede,
    actualizarFranjaHoraria
};