const Docente = require('../models/docente.model');
const Usuario = require('../models/userModel');
const validar = require('../utils/docentes.util');

// Evita consultar la misma cuenta en cada acción seguida del panel de docentes.
const cacheUsuarios = new Map();
const VIGENCIA_USUARIO = 30000;

async function usuarioActivo(identificador) {
    const ahora = Date.now();
    const guardado = cacheUsuarios.get(identificador);
    if (guardado && guardado.expira > ahora) return guardado.usuario;

    const usuario = await Usuario.buscarPorId(identificador);
    if (cacheUsuarios.size >= 200) cacheUsuarios.clear();
    cacheUsuarios.set(identificador, { usuario, expira: ahora + VIGENCIA_USUARIO });
    return usuario;
}

function responderError(respuesta, error) {
    if (error.code === 'ER_DUP_ENTRY') return respuesta.status(409).json({ mensaje: 'Ya existe un registro con esos datos.' });
    if (error.status) return respuesta.status(error.status).json({ mensaje: error.message });
    console.error('Error del módulo de docentes:', error.code || error.message);
    return respuesta.status(500).json({ mensaje: 'No se pudo completar la operación. Revisa la conexión y la configuración de la base de datos.' });
}

const atender = (operacion) => async (peticion, respuesta) => {
    try {
        await operacion(peticion, respuesta);
    } catch (error) {
        responderError(respuesta, error);
    }
};

module.exports = {
    preparar: (peticion, respuesta, continuar) => {
        // La cuenta se valida en paralelo con las consultas de cada acción.
        const usuarioPendiente = usuarioActivo(peticion.user.sub);
        peticion.validarUsuario = async () => {
            const usuario = await usuarioPendiente;
            if (!usuario || String(usuario.estado).toUpperCase() !== 'ACTIVO') {
                const error = new Error('La cuenta ya no está activa.');
                error.status = 401;
                throw error;
            }
            peticion.auditorDocente = (usuario.id_usuario + ': ' + usuario.nombres + ' ' + usuario.apellidos).slice(0, 50);
            return usuario;
        };

        // La configuración horaria solo se consulta en las acciones que realmente la usan.
        let configuracion;
        peticion.configuracionDocentes = () => {
            if (!configuracion) configuracion = Docente.configuracion(peticion.query.periodo);
            return configuracion;
        };
        continuar();
    },
    listar: atender(async (peticion, respuesta) => {
        const [, configuracion, docentes] = await Promise.all([
            peticion.validarUsuario(),
            peticion.configuracionDocentes(),
            Docente.listar(),
        ]);
        respuesta.json({ docentes, configuracion });
    }),
    crear: atender(async (peticion, respuesta) => {
        await peticion.validarUsuario();
        const resultado = await Docente.guardar(null, validar.docente(peticion.body), peticion.auditorDocente);
        respuesta.status(201).json({
            id_docente: resultado.id_docente,
            usa_restriccion_horaria: resultado.usa_restriccion_horaria,
            mensaje: 'Instructor registrado correctamente.',
        });
    }),
    editar: atender(async (peticion, respuesta) => {
        await peticion.validarUsuario();
        const resultado = await Docente.guardar(validar.id(peticion.params.id), validar.docente(peticion.body), peticion.auditorDocente);
        respuesta.json({
            usa_restriccion_horaria: resultado.usa_restriccion_horaria,
            mensaje: 'Datos del instructor actualizados.',
        });
    }),
    cambiarEstado: atender(async (peticion, respuesta) => {
        await peticion.validarUsuario();
        validar.exigir(['A', 'I'].includes(peticion.body?.estado), 'Selecciona activo o inactivo.');
        await Docente.cambiarEstado(validar.id(peticion.params.id), peticion.body.estado, peticion.auditorDocente);
        respuesta.json({ mensaje: 'Estado actualizado. Se conservó la disponibilidad del docente.' });
    }),
    cambiarContrato: atender(async (peticion, respuesta) => {
        await peticion.validarUsuario();
        const contrato = validar.contrato(peticion.body);
        const resultado = await Docente.cambiarContrato(
            validar.id(peticion.params.id),
            contrato.tipo_contrato,
            contrato.horas_semanales_meta,
            peticion.auditorDocente
        );
        respuesta.json({
            ...contrato,
            ...resultado,
            mensaje: 'Tipo de contrato actualizado. Meta semanal: ' + contrato.horas_semanales_meta + ' h.',
        });
    }),
    disponibilidad: atender(async (peticion, respuesta) => {
        await peticion.validarUsuario();
        respuesta.json(await Docente.disponibilidad(validar.id(peticion.params.id)));
    }),
    guardarDisponibilidad: atender(async (peticion, respuesta) => {
        await peticion.validarUsuario();
        const configuracion = await peticion.configuracionDocentes();
        const franjas = validar.consolidar(peticion.body?.franjas, configuracion.horario);
        const restriccion = validar.restriccion(peticion.body?.usa_restriccion_horaria);
        const resultado = await Docente.guardarDisponibilidad(
            validar.id(peticion.params.id),
            franjas,
            peticion.auditorDocente,
            restriccion
        );
        respuesta.json({
            ...resultado,
            mensaje: resultado.usa_restriccion_horaria === 1
                ? 'Disponibilidad y restricción horaria guardadas.'
                : 'Disponibilidad guardada. El solver podrá asignar horario libremente.',
        });
    }),
};
