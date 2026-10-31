const Docente = require('../models/docente.model');
const Usuario = require('../models/userModel');
const validar = require('../utils/docentes.util');

function responderError(respuesta, error) {
    if (error.code === 'ER_DUP_ENTRY') return respuesta.status(409).json({ mensaje: 'El DNI o la asignación ya están registrados.' });
    if (error.status) return respuesta.status(error.status).json({ mensaje: error.message });
    console.error('Error del módulo de docentes:', error.code || error.message);
    return respuesta.status(500).json({ mensaje: 'No se pudo completar la operación. Revisa la conexión y la preparación de la base de datos.' });
}
const atender = (operacion) => async (peticion, respuesta) => {
    try { await operacion(peticion, respuesta); } catch (error) { responderError(respuesta, error); }
};
function preparado(peticion) {
    validar.exigir(peticion.configuracionDocentes.preparado, 'Falta ejecutar database/grupo1_docentes_real.sql en HeidiSQL para habilitar el registro real.', 409);
}
module.exports = {
    preparar: async (peticion, respuesta, continuar) => {
        try {
            const usuario = await Usuario.buscarPorId(peticion.user.sub);
            if (!usuario || String(usuario.estado).toUpperCase() !== 'ACTIVO') return respuesta.status(401).json({ mensaje: 'La cuenta ya no está activa.' });
            peticion.auditorDocente = (usuario.id_usuario + ': ' + usuario.nombres + ' ' + usuario.apellidos).slice(0, 50);
            peticion.configuracionDocentes = await Docente.configuracion(peticion.query.periodo);
            continuar();
        } catch (error) { responderError(respuesta, error); }
    },
    listar: atender(async (peticion, respuesta) => respuesta.json({
        docentes: await Docente.listar(peticion.configuracionDocentes),
        configuracion: peticion.configuracionDocentes,
    })),
    buscarPorDni: atender(async (peticion, respuesta) => {
        preparado(peticion);
        const docente = await Docente.buscarPorDni(peticion.query.dni);
        respuesta.json({ docente });
    }),
    buscarPorNombre: atender(async (peticion, respuesta) => {
        preparado(peticion);
        respuesta.json({ docentes: await Docente.buscarPorNombre(peticion.query.nombre) });
    }),
    registrarExistente: atender(async (peticion, respuesta) => {
        preparado(peticion);
        const identificador = validar.id(peticion.params.id);
        const dni = peticion.body?.dni || null;
        validar.exigir(dni === null || typeof dni === 'string' && /^\d{8}$/.test(dni), 'El DNI debe tener 8 dígitos o quedar vacío.');
        const resultado = await Docente.registrarExistente(identificador, peticion.auditorDocente, dni);
        respuesta.json({ id_docente: identificador, mensaje: resultado.yaRegistrado && !resultado.dniActualizado ? 'Este docente ya está registrado en el panel.' : 'Docente registrado con su identificador existente.' });
    }),
    crear: atender(async (peticion, respuesta) => {
        preparado(peticion);
        const identificador = await Docente.guardar(null, validar.docente(peticion.body), peticion.auditorDocente);
        respuesta.status(201).json({ id_docente: identificador, mensaje: 'Instructor registrado correctamente.' });
    }),
    editar: atender(async (peticion, respuesta) => {
        preparado(peticion);
        await Docente.guardar(validar.id(peticion.params.id), validar.docente(peticion.body), peticion.auditorDocente);
        respuesta.json({ mensaje: 'Datos del instructor actualizados.' });
    }),
    cambiarEstado: atender(async (peticion, respuesta) => {
        preparado(peticion);
        validar.exigir(['A', 'I', 'V'].includes(peticion.body?.estado), 'Selecciona activo, inactivo o vacaciones.');
        await Docente.cambiarEstado(validar.id(peticion.params.id), peticion.body.estado, peticion.auditorDocente);
        respuesta.json({ mensaje: 'Estado actualizado. Se conservaron los cursos y la disponibilidad.' });
    }),
    cursos: atender(async (peticion, respuesta) => {
        preparado(peticion);
        respuesta.json({ cursos: await Docente.cursos(validar.id(peticion.params.id), peticion.configuracionDocentes.periodo) });
    }),
    guardarCursos: atender(async (peticion, respuesta) => {
        preparado(peticion);
        validar.exigir(Array.isArray(peticion.body?.ids_cursos) && peticion.body.ids_cursos.length <= 5000, 'La selección de cursos no es válida.');
        const identificadores = [...new Set(peticion.body.ids_cursos.map(validar.id))];
        await Docente.guardarCursos(validar.id(peticion.params.id), peticion.configuracionDocentes.periodo, identificadores, peticion.auditorDocente);
        respuesta.json({ mensaje: 'Asignaciones guardadas para ' + peticion.configuracionDocentes.periodo.descripcion + '.' });
    }),
    disponibilidad: atender(async (peticion, respuesta) => {
        preparado(peticion);
        respuesta.json({ franjas: await Docente.disponibilidad(validar.id(peticion.params.id)) });
    }),
    guardarDisponibilidad: atender(async (peticion, respuesta) => {
        preparado(peticion);
        const franjas = validar.consolidar(peticion.body?.franjas);
        await Docente.guardarDisponibilidad(validar.id(peticion.params.id), franjas, peticion.auditorDocente);
        respuesta.json({ franjas, mensaje: 'Disponibilidad guardada sin tramos duplicados ni superpuestos.' });
    }),
    ficha: atender(async (peticion, respuesta) => {
        preparado(peticion);
        respuesta.json(await Docente.ficha(validar.id(peticion.params.id), peticion.configuracionDocentes));
    }),
};
