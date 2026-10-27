// src/routes/docenteRoutes.js
const { Router } = require('express');
const ctrl = require('../controllers/docenteController');

const router = Router();

// Rutas estáticas obligatoriamente ANTES de /:id
router.get('/catalogo-cursos', ctrl.obtenerCatalogoCursos);
router.get('/catalogo-carreras', ctrl.obtenerCatalogoCarreras);
router.get('/aptos', ctrl.obtenerAptos);

// Rutas generales de docentes
router.get('/', ctrl.listar);
router.post('/', ctrl.crear);

// Rutas específicas por ID
router.get('/:id', ctrl.obtenerPorId);
router.put('/:id', ctrl.actualizar);
router.patch('/:id/estado', ctrl.actualizarEstado);
router.get('/:id/auditoria', ctrl.obtenerAuditoria);

router.get('/:id/disponibilidad', ctrl.obtenerDisponibilidad);
router.put('/:id/disponibilidad', ctrl.reemplazarDisponibilidad);

router.get('/:id/bloques', ctrl.obtenerBloques);
router.put('/:id/bloques', ctrl.reemplazarBloques);

router.get('/:id/competencias', ctrl.obtenerCompetencias);
router.put('/:id/competencias', ctrl.reemplazarCompetencias);

router.get('/:id/clases', ctrl.obtenerClases);

module.exports = router;