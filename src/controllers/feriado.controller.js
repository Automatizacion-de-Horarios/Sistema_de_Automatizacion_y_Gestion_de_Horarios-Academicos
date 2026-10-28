<<<<<<< HEAD
const Feriado = require('../models/feriado.model'); 
 
const validarFeriado = ({ fecha, estado }) => { 
  if (!fecha || typeof fecha !== 'string' || fecha.trim() === '') { 
    return 'La fecha es obligatoria'; 
  } 
  if (typeof estado !== 'string' || estado.trim() === '') {
    return 'El estado es obligatorio';
  }
  return null; 
}; 
 
const listar = async (req, res) => { 
  try { 
    const feriados = await Feriado.obtenerTodos(); 
    res.status(200).json(feriados); 
  } catch (error) { 
    console.error(error); 
    res.status(500).json({ mensaje: 'Error al obtener los feriados' }); 
  } 
}; 
 
const obtener = async (req, res) => { 
  try { 
    const feriado = await Feriado.obtenerPorId(req.params.id); 
    if (!feriado) { 
      return res.status(404).json({ mensaje: 'Feriado no encontrado' }); 
    } 
    res.status(200).json(feriado); 
  } catch (error) { 
    console.error(error); 
    res.status(500).json({ mensaje: 'Error al obtener el feriado' }); 
  } 
}; 
 
const crear = async (req, res) => { 
  try { 
    const datos = req.body ?? {}; 
    const errorValidacion = validarFeriado(datos); 
    if (errorValidacion) { 
      return res.status(400).json({ mensaje: errorValidacion }); 
    } 
    const nuevo = await Feriado.crear(datos); 
    res.status(201).json(nuevo); 
  } catch (error) { 
    console.error(error); 
    res.status(500).json({ mensaje: 'Error al crear el feriado' }); 
  } 
}; 
 
const actualizar = async (req, res) => { 
  try { 
    const { id } = req.params; 
    const datos = req.body ?? {}; 
    const errorValidacion = validarFeriado(datos); 
    if (errorValidacion) { 
      return res.status(400).json({ mensaje: errorValidacion }); 
    } 
    const filasAfectadas = await Feriado.actualizar(id, datos); 
    if (filasAfectadas === 0) { 
      return res.status(404).json({ mensaje: 'Feriado no encontrado' }); 
    } 
    const actualizado = await Feriado.obtenerPorId(id); 
    res.status(200).json(actualizado); 
  } catch (error) { 
    console.error(error); 
    res.status(500).json({ mensaje: 'Error al actualizar el feriado' }); 
  } 
}; 
 
const eliminar = async (req, res) => { 
  try { 
    const filasAfectadas = await Feriado.eliminar(req.params.id); 
    if (filasAfectadas === 0) { 
      return res.status(404).json({ mensaje: 'Feriado no encontrado' }); 
    } 
    res.status(200).json({ mensaje: 'Feriado eliminado correctamente' }); 
  } catch (error) { 
    console.error(error); 
    res.status(500).json({ mensaje: 'Error al eliminar el feriado' }); 
  } 
}; 
 
=======
const Feriado = require('../models/feriado.model');

// Valida los datos recibidos. Devuelve un mensaje de error o null si todo está bien.
const validarFeriado = ({ fecha, descripcion, estado }) => {
    if (!fecha || typeof fecha !== 'string' || fecha.trim() === '') {
        return 'La fecha es obligatoria y debe ser una cadena válida';
    }
    if (!descripcion || typeof descripcion !== 'string' || descripcion.trim() === '') {
        return 'La descripción es obligatoria';
    }
    if (estado !== undefined && typeof estado !== 'string') {
        return 'El estado debe ser una cadena de texto válida';
    }
    return null;
};

// GET /api/feriados
const listar = async (req, res) => {
    try {
        const feriados = await Feriado.obtenerTodos();
        res.status(200).json(feriados);
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: 'Error al obtener los feriados' });
    }
};

// GET /api/feriados/:id
const obtener = async (req, res) => {
    try {
        const feriado = await Feriado.obtenerPorId(req.params.id);
        if (!feriado) {
            return res.status(404).json({ mensaje: 'Feriado no encontrado' });
        }
        res.status(200).json(feriado);
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: 'Error al obtener el feriado' });
    }
};

// POST /api/feriados
const crear = async (req, res) => {
    try {
        const datos = req.body ?? {};
        const errorValidacion = validarFeriado(datos);
        if (errorValidacion) {
            return res.status(400).json({ mensaje: errorValidacion });
        }
        const nuevo = await Feriado.crear(datos);
        res.status(201).json(nuevo);
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: 'Error al crear el feriado' });
    }
};

// PUT /api/feriados/:id
const actualizar = async (req, res) => {
    try {
        const { id } = req.params;
        const datos = req.body ?? {};
        const errorValidacion = validarFeriado(datos);
        if (errorValidacion) {
            return res.status(400).json({ mensaje: errorValidacion });
        }
        const filasAfectadas = await Feriado.actualizar(id, datos);
        if (filasAfectadas === 0) {
            return res.status(404).json({ mensaje: 'Feriado no encontrado' });
        }
        const actualizado = await Feriado.obtenerPorId(id);
        res.status(200).json(actualizado);
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: 'Error al actualizar el feriado' });
    }
};

// DELETE /api/feriados/:id
const eliminar = async (req, res) => {
    try {
        const filasAfectadas = await Feriado.eliminar(req.params.id);
        if (filasAfectadas === 0) {
            return res.status(404).json({ mensaje: 'Feriado no encontrado' });
        }
        res.status(200).json({ mensaje: 'Feriado eliminado correctamente' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensaje: 'Error al eliminar el feriado' });
    }
};

>>>>>>> main
module.exports = { listar, obtener, crear, actualizar, eliminar };