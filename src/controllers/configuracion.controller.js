const ConfiguracionModel = require('../models/configuracion.model');

// Cargar toda la información necesaria para pintar la pantalla
const obtenerConfiguracionGlobal = async (req, res) => {
    try {
        const zonales = await ConfiguracionModel.obtenerZonales();
        const sedes = await ConfiguracionModel.obtenerSedes();
        const periodos = await ConfiguracionModel.obtenerPeriodos();
        
        // Tomamos la franja horaria del primer período activo por defecto
        const periodoActivo = periodos[0] ? periodos[0].id_periodo : 1;
        const franja = await ConfiguracionModel.obtenerFranja(periodoActivo);

        res.json({
            success: true,
            data: {
                zonales,
                sedes,
                periodos,
                franja
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

// Guardar los cambios de inicio/cierre de turno
const actualizarFranjaHoraria = async (req, res) => {
    try {
        const { id_periodo, hora_inicio_mañana, hora_cierre_noche } = req.body;

        if (!id_periodo || !hora_inicio_mañana || !hora_cierre_noche) {
            return res.status(400).json({ success: false, message: 'Faltan parámetros de hora o período' });
        }

        await ConfiguracionModel.guardarFranja(id_periodo, hora_inicio_mañana, hora_cierre_noche);

        res.json({ success: true, message: 'Franja horaria actualizada correctamente' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al guardar la franja horaria', error: error.message });
    }
};

module.exports = {
    obtenerConfiguracionGlobal,
    registrarSede,
    actualizarFranjaHoraria
};