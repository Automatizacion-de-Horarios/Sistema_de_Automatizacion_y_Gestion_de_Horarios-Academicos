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

// Guardar los cambios de inicio/cierre de turno y estado del domingo
const actualizarFranjaHoraria = async (req, res) => {
    try {
        const { id_periodo, hora_inicio_mañana, hora_cierre_noche, incluir_domingo } = req.body;

        if (!hora_inicio_mañana || !hora_cierre_noche) {
            return res.status(400).json({ success: false, message: 'Faltan parámetros de hora' });
        }

        // 1. Consultar la lista de períodos reales en MySQL para no romper la llave foránea
        const periodos = await ConfiguracionModel.obtenerPeriodos();
        
        let periodoIdValido = null;

        if (periodos && periodos.length > 0) {
            // Buscar si coincide por id_periodo o por el código del período (ej. "202620")
            const periodoEncontrado = periodos.find(p => p.id_periodo == id_periodo || p.codigo_periodo == id_periodo);
            
            // Si lo encuentra usa ese ID; de lo contrario toma el ID del primer período registrado
            periodoIdValido = periodoEncontrado ? periodoEncontrado.id_periodo : periodos[0].id_periodo;
        } else {
            return res.status(400).json({ success: false, message: 'No existen períodos lectivos en la base de datos.' });
        }

        // Convertir booleano a 1 o 0 para MySQL
        const valorDomingo = incluir_domingo ? 1 : 0;

        // 2. Guardar franja horaria usando la clave primaria válida
        await ConfiguracionModel.guardarFranja(periodoIdValido, hora_inicio_mañana, hora_cierre_noche, valorDomingo);

        res.json({ success: true, message: 'Franja horaria y configuración actualizadas correctamente' });
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