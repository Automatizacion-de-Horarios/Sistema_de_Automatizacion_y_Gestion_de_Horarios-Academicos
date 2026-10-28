const TipoAmbiente = require('../models/tipoAmbiente.model'); 
 
const validarTipoAmbiente = ({ nombre_tipo_ambiente }) => { 
  if (typeof nombre_tipo_ambiente !== 'string' || nombre_tipo_ambiente.trim() === '') { 
    return 'El nombre del tipo de ambiente es obligatorio'; 
  } 
  return null; 
}; 
 
const listar = async (req, res) => { 
  try { 
    const tipos = await TipoAmbiente.obtenerTodos(); 
    res.status(200).json(tipos); 
  } catch (error) { 
    console.error(error); 
    res.status(500).json({ mensaje: 'Error al obtener los tipos de ambiente' }); 
  } 
}; 
 
const obtener = async (req, res) => { 
  try { 
    const tipo = await TipoAmbiente.obtenerPorId(req.params.id); 
    if (!tipo) { 
      return res.status(404).json({ mensaje: 'Tipo de ambiente no encontrado' }); 
    } 
    res.status(200).json(tipo); 
  } catch (error) { 
    console.error(error); 
    res.status(500).json({ mensaje: 'Error al obtener el tipo de ambiente' }); 
  } 
}; 
 
const crear = async (req, res) => { 
  try { 
    const datos = req.body ?? {}; 
    const errorValidacion = validarTipoAmbiente(datos); 
    if (errorValidacion) { 
      return res.status(400).json({ mensaje: errorValidacion }); 
    } 
    const nuevo = await TipoAmbiente.crear(datos); 
    res.status(201).json(nuevo); 
  } catch (error) { 
    console.error(error); 
    res.status(500).json({ mensaje: 'Error al crear el tipo de ambiente' }); 
  } 
}; 
 
const actualizar = async (req, res) => { 
  try { 
    const { id } = req.params; 
    const datos = req.body ?? {}; 
    const errorValidacion = validarTipoAmbiente(datos); 
    if (errorValidacion) { 
      return res.status(400).json({ mensaje: errorValidacion }); 
    } 
    const filasAfectadas = await TipoAmbiente.actualizar(id, datos); 
    if (filasAfectadas === 0) { 
      return res.status(404).json({ mensaje: 'Tipo de ambiente no encontrado' }); 
    } 
    const actualizado = await TipoAmbiente.obtenerPorId(id); 
    res.status(200).json(actualizado); 
  } catch (error) { 
    console.error(error); 
    res.status(500).json({ mensaje: 'Error al actualizar el tipo de ambiente' }); 
  } 
}; 
 
const eliminar = async (req, res) => { 
  try { 
    const filasAfectadas = await TipoAmbiente.eliminar(req.params.id); 
    if (filasAfectadas === 0) { 
      return res.status(404).json({ mensaje: 'Tipo de ambiente no encontrado' }); 
    } 
    res.status(200).json({ mensaje: 'Tipo de ambiente eliminado correctamente' }); 
  } catch (error) { 
    console.error(error); 
    res.status(500).json({ mensaje: 'Error al eliminar el tipo de ambiente' }); 
  } 
}; 
 
module.exports = { listar, obtener, crear, actualizar, eliminar };