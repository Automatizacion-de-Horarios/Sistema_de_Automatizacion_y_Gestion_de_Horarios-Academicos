const express = require('express');
const router = express.Router();
const carrerasImpExpController = require('../controllers/carrerasImpExp.controller');

// Obtener todas las carreras registradas
router.get('/', carrerasImpExpController.obtenerCarreras);

// Obtener la malla curricular oficial y cursos de una carrera
router.get('/:id/malla', carrerasImpExpController.obtenerMallaCarrera);

// Registrar una nueva carrera con su código y nombre oficial
router.post('/', carrerasImpExpController.crearCarrera);

// Guardar la configuración de asignaciones en la tabla programacion_academica
router.post('/programacion', carrerasImpExpController.guardarProgramacion);

// Actualizar si un curso es de carrera (1) o complementario (0)
router.put('/cursos/:id/tipo', carrerasImpExpController.actualizarTipoCurso);

// Crear un nuevo curso en un semestre de la carrera
router.post('/cursos', carrerasImpExpController.crearCurso);

// Actualizar un curso existente
router.put('/cursos/:id', carrerasImpExpController.actualizarCurso);

// Eliminar un curso de la malla
router.delete('/cursos/:id', carrerasImpExpController.eliminarCurso);

// Habilitar o inhabilitar un semestre específico de una carrera
// Habilitar o inhabilitar un curso específico de la malla
router.put('/cursos/:id/estado', carrerasImpExpController.actualizarEstadoCurso);

router.put('/semestres/:id/estado', carrerasImpExpController.actualizarEstadoSemestre);

module.exports = router;
