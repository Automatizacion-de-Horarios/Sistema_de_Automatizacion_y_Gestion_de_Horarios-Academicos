const Ambiente = require('../models/ambiente.model'); 
 
const validarAmbiente = ({ codigo_ambiente, id_tipo_ambiente, aforo_maximo, piso_ubicacion, pabellon }) => { 
  if (typeof codigo_ambiente !== 'string' || codigo_ambiente.trim() === '') { 
    return 'El código de ambiente es obligatorio'; 
  } 
  if (!Number.isInteger(Number(id_tipo_ambiente)) || Number(id_tipo_ambiente) <= 0) { 
    return 'El id_tipo_ambiente debe ser un número entero válido'; 
  } 
  if (!Number.isInteger(Number(aforo_maximo)) || Number(aforo_maximo) <= 0) { 
    return 'El aforo máximo debe ser un número entero mayor a 0'; 
  }
  if (!Number.isInteger(Number(piso_ubicacion))) { 
    return 'El piso de ubicación debe ser un número entero'; 
  }
  if (typeof pabellon !== 'string' || pabellon.trim() === '') { 
    return 'El pabellón es obligatorio'; 
  }
  return null; 
};
 
const listar = async (req, res) => { 
  try { 
    const ambientes = await Ambiente.obtenerTodos(); 
    res.status(200).json(ambientes); 
  } catch (error) { 
    console.error(error); 
    res.status(500).json({ mensaje: 'Error al obtener los ambientes' }); 
  } 
}; 

const listarCursos = async (req, res) => {
  try {
    const cursos = await Ambiente.obtenerCursos();
    res.status(200).json(cursos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error al obtener los cursos' });
  }
};

const listarCursosPermitidos = async (req, res) => {
  try {
    const { id } = req.params;
    const { codigo_periodo: codigoPeriodo } = req.query;
    if (!Number.isInteger(Number(id)) || Number(id) <= 0) {
      return res.status(400).json({ mensaje: 'El id del ambiente no es válido' });
    }
    if (typeof codigoPeriodo !== 'string' || codigoPeriodo.trim() === '') {
      return res.status(400).json({ mensaje: 'El código del período es obligatorio' });
    }

    const ambiente = await Ambiente.obtenerPorId(id);
    if (!ambiente) {
      return res.status(404).json({ mensaje: 'Ambiente no encontrado' });
    }

    const idPeriodo = await Ambiente.obtenerIdPeriodo(codigoPeriodo.trim());
    if (!idPeriodo) {
      return res.status(404).json({ mensaje: 'Período no encontrado' });
    }

    const idsCursos = await Ambiente.obtenerCursosPermitidos(id, idPeriodo);
    res.status(200).json({ id_cursos: idsCursos });
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error al obtener los cursos permitidos' });
  }
};

const actualizarCursosPermitidos = async (req, res) => {
  try {
    const { id } = req.params;
    const idsCursos = req.body?.id_cursos;
    const codigoPeriodo = req.body?.codigo_periodo;

    if (!Number.isInteger(Number(id)) || Number(id) <= 0) {
      return res.status(400).json({ mensaje: 'El id del ambiente no es válido' });
    }
    if (typeof codigoPeriodo !== 'string' || codigoPeriodo.trim() === '') {
      return res.status(400).json({ mensaje: 'El código del período es obligatorio' });
    }
    if (!Array.isArray(idsCursos) || idsCursos.some((idCurso) =>
      !Number.isInteger(Number(idCurso)) || Number(idCurso) <= 0
    )) {
      return res.status(400).json({ mensaje: 'La lista de cursos permitidos no es válida' });
    }

    const ambiente = await Ambiente.obtenerPorId(id);
    if (!ambiente) {
      return res.status(404).json({ mensaje: 'Ambiente no encontrado' });
    }

    const idPeriodo = await Ambiente.obtenerIdPeriodo(codigoPeriodo.trim());
    if (!idPeriodo) {
      return res.status(404).json({ mensaje: 'Período no encontrado' });
    }

    const idsUnicos = [...new Set(idsCursos.map(Number))];
    await Ambiente.reemplazarCursosPermitidos(id, idPeriodo, idsUnicos);
    res.status(200).json({ id_cursos: idsUnicos });
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error al guardar los cursos permitidos' });
  }
};

const actualizarCursoPermitido = async (req, res) => {
  try {
    const { id, idCurso } = req.params;
    const { codigo_periodo: codigoPeriodo, permitido } = req.body ?? {};

    if (!Number.isInteger(Number(id)) || Number(id) <= 0 ||
        !Number.isInteger(Number(idCurso)) || Number(idCurso) <= 0) {
      return res.status(400).json({ mensaje: 'El id del ambiente o del curso no es válido' });
    }
    if (typeof codigoPeriodo !== 'string' || codigoPeriodo.trim() === '') {
      return res.status(400).json({ mensaje: 'El código del período es obligatorio' });
    }
    if (typeof permitido !== 'boolean') {
      return res.status(400).json({ mensaje: 'El estado permitido debe ser verdadero o falso' });
    }

    const referenciasValidas = await Ambiente.actualizarCursoPermitido(
      id,
      codigoPeriodo.trim(),
      idCurso,
      permitido
    );
    if (!referenciasValidas) {
      return res.status(404).json({ mensaje: 'Ambiente, curso o período no encontrado' });
    }
    res.status(200).json({ id_curso: Number(idCurso), permitido });
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error al actualizar el curso permitido' });
  }
};

const actualizarCursosPermitidosEnLote = async (req, res) => {
  try {
    const { id } = req.params;
    const { codigo_periodo: codigoPeriodo, cambios } = req.body ?? {};

    if (!Number.isInteger(Number(id)) || Number(id) <= 0) {
      return res.status(400).json({ mensaje: 'El id del ambiente no es válido' });
    }
    if (typeof codigoPeriodo !== 'string' || codigoPeriodo.trim() === '') {
      return res.status(400).json({ mensaje: 'El código del período es obligatorio' });
    }
    if (!Array.isArray(cambios) || cambios.some((cambio) =>
      !Number.isInteger(Number(cambio?.id_curso)) ||
      Number(cambio.id_curso) <= 0 ||
      typeof cambio.permitido !== 'boolean'
    )) {
      return res.status(400).json({ mensaje: 'La lista de cambios de cursos no es válida' });
    }

    const ambiente = await Ambiente.obtenerPorId(id);
    if (!ambiente) {
      return res.status(404).json({ mensaje: 'Ambiente no encontrado' });
    }

    const idPeriodo = await Ambiente.obtenerIdPeriodo(codigoPeriodo.trim());
    if (!idPeriodo) {
      return res.status(404).json({ mensaje: 'Período no encontrado' });
    }

    const cambiosUnicos = [...new Map(cambios.map((cambio) => [
      Number(cambio.id_curso),
      { id_curso: Number(cambio.id_curso), permitido: cambio.permitido }
    ])).values()];
    await Ambiente.actualizarCursosPermitidosEnLote(id, idPeriodo, cambiosUnicos);
    res.status(200).json({ cambios: cambiosUnicos });
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error al actualizar los cursos permitidos' });
  }
};
 
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
 
module.exports = {
  listar,
  listarCursos,
  listarCursosPermitidos,
  actualizarCursosPermitidos,
  actualizarCursoPermitido,
  actualizarCursosPermitidosEnLote,
  obtener,
  crear,
  actualizar,
  eliminar
};