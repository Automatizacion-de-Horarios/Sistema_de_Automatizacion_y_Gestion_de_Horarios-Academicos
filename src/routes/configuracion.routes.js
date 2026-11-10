const express = require('express');
const router = express.Router();
const configuracionController = require('../controllers/configuracion.controller');

// GET: Cargar opciones en la pantalla
router.get('/', configuracionController.obtenerConfiguracionGlobal);

// POST: Guardar nueva sede
router.post('/sedes', configuracionController.registrarSede);

// PUT: Guardar horario
router.put('/franja', configuracionController.actualizarFranjaHoraria);

// POST: Crear un nuevo período lectivo
router.post('/periodos', configuracionController.crearPeriodo);

// POST: Duplicar programación y compatibilidad de un período a otro
router.post('/periodos/duplicar', configuracionController.duplicarPeriodo);

module.exports = router;