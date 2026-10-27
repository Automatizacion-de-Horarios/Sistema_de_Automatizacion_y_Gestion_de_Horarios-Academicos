// src/controllers/docenteController.js
const docenteModel = require('../models/docenteModel');
const { validarFranjas, fusionarFranjas } = require('../utils/tiempo');

function getUsuario(req) {
    return req.headers['x-usuario'] || 'sistema';
}

async function listar(req, res) {
    try {
        const { q, estado, carrera } = req.query;
        const data = await docenteModel.listar({ q, estado, carrera });
        res.json({ ok: true, data });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, mensaje: 'Error interno al listar docentes' });
    }
}

async function obtenerCatalogoCursos(req, res) {
    try {
        const data = await docenteModel.obtenerCatalogoCursos();
        res.json({ ok: true, data });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, mensaje: 'Error al obtener catálogo de cursos' });
    }
}

async function obtenerAptos(req, res) {
    try {
        const { curso_id, dia_semana, hora_inicio, hora_fin } = req.query;
        if (!curso_id) {
            return res.status(400).json({ ok: false, mensaje: 'El parámetro curso_id es obligatorio' });
        }
        const data = await docenteModel.obtenerAptos(
            Number(curso_id),
            dia_semana ? Number(dia_semana) : null,
            hora_inicio,
            hora_fin
        );
        res.json({ ok: true, data });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, mensaje: 'Error al consultar docentes aptos' });
    }
}

async function obtenerPorId(req, res) {
    try {
        const data = await docenteModel.obtenerPorId(req.params.id);
        if (!data) {
            return res.status(404).json({ ok: false, mensaje: 'Docente no encontrado' });
        }
        res.json({ ok: true, data });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, mensaje: 'Error al obtener el docente' });
    }
}

async function crear(req, res) {
    try {
        const { codigo_instructor, nombre_completo, especialidad } = req.body;
        if (!codigo_instructor || !nombre_completo) {
            return res.status(400).json({ ok: false, mensaje: 'codigo_instructor y nombre_completo son obligatorios' });
        }
        if (!/^[0-9]{9}$/.test(codigo_instructor)) {
            return res.status(400).json({ ok: false, mensaje: 'El código del instructor debe ser estrictamente un texto de 9 dígitos' });
        }

        const nombreLimpio = nombre_completo.trim().replace(/\s+/g, ' ').toUpperCase();
        const usuario = getUsuario(req);

        const nuevo = await docenteModel.crear({
            codigo_instructor,
            nombre_completo: nombreLimpio,
            especialidad: especialidad ? especialidad.trim().toUpperCase() : 'GENERAL'
        }, usuario);

        res.status(201).json({ ok: true, data: nuevo });
    } catch (error) {
        console.error(error);
        if (error.code === '23505') {
            return res.status(409).json({ ok: false, mensaje: 'El código de instructor ya existe' });
        }
        res.status(500).json({ ok: false, mensaje: 'Error al crear el docente' });
    }
}

async function actualizar(req, res) {
    try {
        const { nombre_completo, especialidad, horas_semanales_contrato } = req.body;
        const usuario = getUsuario(req);

        let nombreLimpio = undefined;
        if (nombre_completo) {
            nombreLimpio = nombre_completo.trim().replace(/\s+/g, ' ').toUpperCase();
        }

        if (horas_semanales_contrato !== undefined && (typeof horas_semanales_contrato !== 'number' || horas_semanales_contrato < 0 || horas_semanales_contrato > 60)) {
            return res.status(400).json({ ok: false, mensaje: 'Las horas semanales de contrato deben ser un número entre 0 y 60' });
        }

        const actualizado = await docenteModel.actualizar(req.params.id, {
            nombre_completo: nombreLimpio,
            especialidad: especialidad ? especialidad.trim().toUpperCase() : undefined,
            horas_semanales_contrato
        }, usuario);

        if (!actualizado) {
            return res.status(404).json({ ok: false, mensaje: 'Docente no encontrado' });
        }

        res.json({ ok: true, data: actualizado });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, mensaje: 'Error al actualizar el docente' });
    }
}

async function actualizarEstado(req, res) {
    try {
        const { estado } = req.body;
        if (!['A', 'I', 'V'].includes(estado)) {
            return res.status(400).json({ ok: false, mensaje: 'Estado inválido. Debe ser A, I o V' });
        }
        const usuario = getUsuario(req);
        const actualizado = await docenteModel.actualizarEstado(req.params.id, estado, usuario);
        if (!actualizado) {
            return res.status(404).json({ ok: false, mensaje: 'Docente no encontrado' });
        }
        res.json({ ok: true, data: actualizado });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, mensaje: 'Error al actualizar el estado' });
    }
}

async function obtenerAuditoria(req, res) {
    try {
        const data = await docenteModel.obtenerAuditoria(req.params.id);
        if (!data) {
            return res.status(404).json({ ok: false, mensaje: 'Docente no encontrado' });
        }
        res.json({ ok: true, data });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, mensaje: 'Error al obtener la auditoría' });
    }
}

async function obtenerDisponibilidad(req, res) {
    try {
        const data = await docenteModel.obtenerDisponibilidad(req.params.id);
        res.json({ ok: true, data });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, mensaje: 'Error al obtener disponibilidad' });
    }
}

async function reemplazarDisponibilidad(req, res) {
    try {
        const { franjas } = req.body;
        const validacion = validarFranjas(franjas);
        if (!validacion.valido) {
            return res.status(400).json({ ok: false, mensaje: validacion.mensaje });
        }

        const franjasFusionadas = fusionarFranjas(franjas);
        const usuario = getUsuario(req);

        await docenteModel.reemplazarDisponibilidad(req.params.id, franjasFusionadas, usuario);
        res.json({ ok: true, data: franjasFusionadas });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, mensaje: 'Error al actualizar la disponibilidad' });
    }
}

async function obtenerCatalogoCarreras(req, res) {
    try {
        const data = await docenteModel.obtenerCatalogoCarreras();
        res.json({ ok: true, data });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, mensaje: 'Error al obtener catálogo de carreras' });
    }
}

async function obtenerBloques(req, res) {
    try {
        const data = await docenteModel.obtenerBloques(req.params.id);
        res.json({ ok: true, data });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, mensaje: 'Error al obtener bloques' });
    }
}

async function reemplazarBloques(req, res) {
    try {
        const { bloques } = req.body;
        if (!Array.isArray(bloques)) {
            return res.status(400).json({ ok: false, mensaje: 'El formato de bloques debe ser una lista' });
        }

        for (let b of bloques) {
            if (!b.carrera_sigla || !b.semestre || !b.grupo) {
                return res.status(400).json({ ok: false, mensaje: 'Cada bloque requiere carrera_sigla, semestre y grupo' });
            }
            if (b.semestre < 1 || b.semestre > 6 || ![1, 2].includes(b.grupo)) {
                return res.status(400).json({ ok: false, mensaje: 'Semestre debe ser entre 1 y 6, y grupo 1 o 2' });
            }
        }

        const usuario = getUsuario(req);
        await docenteModel.reemplazarBloques(req.params.id, bloques, usuario);
        res.json({ ok: true, data: bloques });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, mensaje: 'Error al actualizar bloques' });
    }
}

async function obtenerCompetencias(req, res) {
    try {
        const data = await docenteModel.obtenerCompetencias(req.params.id);
        res.json({ ok: true, data });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, mensaje: 'Error al obtener competencias' });
    }
}

async function reemplazarCompetencias(req, res) {
    try {
        const { curso_ids } = req.body;
        if (!Array.isArray(curso_ids) || !curso_ids.every(id => typeof id === 'number')) {
            return res.status(400).json({ ok: false, mensaje: 'curso_ids debe ser una lista de números' });
        }

        const usuario = getUsuario(req);
        await docenteModel.reemplazarCompetencias(req.params.id, curso_ids, usuario);
        res.json({ ok: true, data: curso_ids });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, mensaje: 'Error al actualizar competencias' });
    }
}

async function obtenerClases(req, res) {
    // Módulo reservado para el Equipo 4 (motor de horarios)
    res.json({
        ok: true,
        data: [],
        comentario: 'Lo reemplazará la tabla de horarios del Equipo 4.'
    });
}

module.exports = {
    listar,
    obtenerCatalogoCursos,
    obtenerAptos,
    obtenerPorId,
    crear,
    actualizar,
    actualizarEstado,
    obtenerAuditoria,
    obtenerDisponibilidad,
    reemplazarDisponibilidad,
    obtenerCatalogoCarreras,
    obtenerBloques,
    reemplazarBloques,
    obtenerCompetencias,
    reemplazarCompetencias,
    obtenerClases
};