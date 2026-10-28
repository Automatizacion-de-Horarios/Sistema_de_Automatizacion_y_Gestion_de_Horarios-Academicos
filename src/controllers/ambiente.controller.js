const Ambiente = require('../models/ambiente.model');

// Valida los datos recibidos. Devuelve un mensaje de error o null si todo está bien.
const validarAmbiente = ({ codigo_ambiente, id_tipo_ambiente, aforo_maximo, piso_ubicacion, pabellón, estado }) => {
    if (typeof codigo_ambiente !== 'string' || codigo_ambiente.trim() === '') {
        return 'El código del ambiente es obligatorio';
    }
    if (id_tipo_ambiente === undefined || !Number.isInteger(Number(id_tipo_ambiente)) || Number(id_tipo_ambiente) <= 0) {
        return 'El id del tipo de ambiente debe ser un número entero válido';
    }
    if (aforo_maximo === undefined || !Number.isInteger(Number(aforo_maximo)) || Number(aforo_maximo) <= 0) {
        return 'El aforo máximo debe ser un número entero mayor a 0';
    }
    if (piso_ubicacion === undefined || !Number.isInteger(Number(piso_ubicacion))) {
        return 'El piso de ubicación debe ser un número entero';
    }
    if (typeof pabellón !== 'string' || pabellón.trim() === '') {
        return 'El pabellón es obligatorio';
    }
    if (estado !== undefined && typeof estado !== 'string') {
        return 'El estado debe ser una cadena de texto válida';
    }
    return null;
};

// GET /api/ambientes
const listar = async (req, res) => {
    try {
        const ambientes = await Ambiente.obtenerTodos();
        res.status(200).json(ambientes);
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: 'Error al obtener los ambientes' });
    }
};

// GET /api/ambientes/:id
const obtener = async (req, res) => {
    try {
        const ambiente = await Ambiente.obtenerPorId(req.params.id);
        if (!ambiente) {
            return res.status(404).json({ mensaje: 'Ambiente no encontrado' });
        }
        res.status(200).json(ambiente);
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: 'Error al obtener el ambiente' });
    }
};

// POST /api/ambientes
const crear = async (req, res) => {
    try {
        const datos = req.body ?? {};
        const errorValidacion = validarAmbiente(datos);
        if (errorValidacion) {
            return res.status(400).json({ mensaje: errorValidacion });
        }
        const nuevo = await Ambiente.crear(datos);
        res.status(201).json(nuevo);
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: 'Error al crear el ambiente' });
    }
};

// PUT /api/ambientes/:id
const actualizar = async (req, res) => {
    try {
        const { id } = req.params;
        const datos = req.body ?? {};
        const errorValidacion = validarAmbiente(datos);
        if (errorValidacion) {
            return res.status(400).json({ mensaje: errorValidacion });
        }
        const filasAfectadas = await Ambiente.actualizar(id, datos);
        if (filasAfectadas === 0) {
            return res.status(404).json({ mensaje: 'Ambiente no encontrado' });
        }
        const actualizado = await Ambiente.obtenerPorId(id);
        res.status(200).json(actualizado);
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: 'Error al actualizar el ambiente' });
    }
};

// DELETE /api/ambientes/:id
const eliminar = async (req, res) => {
    try {
        const filasAfectadas = await Ambiente.eliminar(req.params.id);
        if (filasAfectadas === 0) {
            return res.status(404).json({ mensaje: 'Ambiente no encontrado' });
        }
        res.status(200).json({ mensaje: 'Ambiente eliminado correctamente' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: 'Error al eliminar el ambiente' });
    }
};

module.exports = { listar, obtener, crear, actualizar, eliminar };
