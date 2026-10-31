const express = require('express');
const router = express.Router();
const mallaSemestreController = require('../controllers/mallaSemestre.controller');

/**
 * Rutas de Malla Curricular, Semestres y Cursos (Equipo 4 / Malla Semestre)
 * Prefijo montado en: /api/malla-semestre
 */

// Obtener la malla curricular oficial y cursos de una carrera (Semestres II al VI)
router.get('/:id/malla', mallaSemestreController.obtenerMallaCarrera);

// Guardar la configuración de asignaciones en la tabla programacion_academica
router.post('/programacion', mallaSemestreController.guardarProgramacion);

// Actualizar si un curso es de carrera (1) o complementario (0)
router.put('/cursos/:id/tipo', mallaSemestreController.actualizarTipoCurso);

// Crear un nuevo curso en un semestre de la carrera
router.post('/cursos', mallaSemestreController.crearCurso);

// Actualizar un curso existente
router.put('/cursos/:id', mallaSemestreController.actualizarCurso);

// Eliminar un curso de la malla
router.delete('/cursos/:id', mallaSemestreController.eliminarCurso);

// Habilitar o inhabilitar un curso específico de la malla
router.put('/cursos/:id/estado', mallaSemestreController.actualizarEstadoCurso);

// Habilitar o inhabilitar un semestre específico de una carrera
router.put('/semestres/:id/estado', mallaSemestreController.actualizarEstadoSemestre);

module.exports = router;

