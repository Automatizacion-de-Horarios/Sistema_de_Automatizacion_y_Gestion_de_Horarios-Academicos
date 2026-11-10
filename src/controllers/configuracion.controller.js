const ConfiguracionModel = require('../models/configuracion.model');
const controladorSolver = require('./horarioSolver.controller');

const validarFechaISO = (fecha) =>
    typeof fecha === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(fecha) &&
    !Number.isNaN(Date.parse(`${fecha}T00:00:00Z`)) &&
    new Date(`${fecha}T00:00:00Z`).toISOString().slice(0, 10) === fecha;

const calcularCantidadSemanas = (fecha_inicio, fecha_fin) => {
    const inicio = Date.parse(`${fecha_inicio}T00:00:00Z`);
    const fin = Date.parse(`${fecha_fin}T00:00:00Z`);
    const dias = Math.floor((fin - inicio) / 86_400_000) + 1;
    return Math.ceil(dias / 7);
};

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

const crearPeriodo = async (req, res) => {
    try {
        const codigo = String(req.body?.codigo_periodo || '').trim();
        const descripcion = String(req.body?.descripcion || '').trim();
        const fecha_inicio = req.body?.fecha_inicio;
        const fecha_fin = req.body?.fecha_fin;
        const estado = req.body?.estado === 'C' ? 'C' : 'A';

        if (!/^[A-Za-z0-9_-]{1,10}$/.test(codigo)) {
            return res.status(400).json({
                success: false,
                message: 'El código del período debe tener entre 1 y 10 caracteres alfanuméricos.'
            });
        }
        if (!descripcion || descripcion.length > 100) {
            return res.status(400).json({
                success: false,
                message: 'La descripción es obligatoria y no puede superar los 100 caracteres.'
            });
        }
        if (!validarFechaISO(fecha_inicio) || !validarFechaISO(fecha_fin)) {
            return res.status(400).json({
                success: false,
                message: 'Ingresa fechas válidas de inicio y fin del período.'
            });
        }
        if (Date.parse(`${fecha_fin}T00:00:00Z`) < Date.parse(`${fecha_inicio}T00:00:00Z`)) {
            return res.status(400).json({
                success: false,
                message: 'La fecha de fin debe ser igual o posterior a la fecha de inicio.'
            });
        }

        const periodos = await ConfiguracionModel.obtenerPeriodos();
        if (periodos.some((periodo) => String(periodo.codigo_periodo) === codigo)) {
            return res.status(409).json({
                success: false,
                message: `El período ${codigo} ya existe.`
            });
        }

        const periodo = await ConfiguracionModel.crearPeriodo({
            codigo_periodo: codigo,
            descripcion,
            estado,
            fecha_inicio,
            fecha_fin,
            cantidad_semanas: calcularCantidadSemanas(fecha_inicio, fecha_fin)
        });

        res.status(201).json({ success: true, data: { periodo } });
    } catch (error) {
        console.error('Error al crear período:', error);
        if (error?.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                success: false,
                message: 'Ya existe un período con ese código.'
            });
        }
        res.status(500).json({
            success: false,
            message: 'No se pudo crear el período.',
            error: error.message
        });
    }
};

const duplicarPeriodo = async (req, res) => {
    try {
        if (controladorSolver.hayTrabajoActivo()) {
            return res.status(409).json({
                success: false,
                message: 'Hay una generación de horario en curso. Espera a que termine o cancélala antes de duplicar datos.'
            });
        }

        const periodoOrigen = String(req.body?.periodoOrigen || '').trim();
        const periodoDestino = String(req.body?.periodoDestino || '').trim();
        const reemplazar = req.body?.reemplazar === true;

        if (!periodoOrigen || !periodoDestino) {
            return res.status(400).json({
                success: false,
                message: 'Debes indicar el período de origen y el período de destino.'
            });
        }

        const periodos = await ConfiguracionModel.obtenerPeriodos();
        const buscarPeriodo = (valor) => periodos.find(
            (periodo) =>
                String(periodo.id_periodo) === String(valor) ||
                String(periodo.codigo_periodo) === String(valor)
        );
        const origen = buscarPeriodo(periodoOrigen);
        const destino = buscarPeriodo(periodoDestino);

        if (!origen || !destino) {
            return res.status(400).json({
                success: false,
                message: 'El período de origen o destino no existe.'
            });
        }
        if (Number(origen.id_periodo) === Number(destino.id_periodo)) {
            return res.status(400).json({
                success: false,
                message: 'El período de origen y destino deben ser diferentes.'
            });
        }

        const resultado = await ConfiguracionModel.duplicarConfiguracionPeriodo({
            idPeriodoOrigen: origen.id_periodo,
            idPeriodoDestino: destino.id_periodo,
            reemplazar
        });

        res.json({
            success: true,
            message: `Datos duplicados de ${resultado.origen} a ${resultado.destino}.`,
            data: resultado
        });
    } catch (error) {
        console.error('Error al duplicar período:', error);
        const status = Number(error?.status) || 500;
        res.status(status).json({
            success: false,
            message: error.message || 'No se pudieron duplicar los datos del período.',
            code: error.code,
            data: error.data
        });
    }
};

module.exports = {
    obtenerConfiguracionGlobal,
    registrarSede,
    actualizarFranjaHoraria,
    crearPeriodo,
    duplicarPeriodo
};