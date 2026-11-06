const express = require('express');
const router = express.Router();
const configuracionController = require('../controllers/configuracion.controller');

// GET: Cargar opciones en la pantalla
router.get('/', configuracionController.obtenerConfiguracionGlobal);

// POST: Guardar nueva sede
router.post('/sedes', configuracionController.registrarSede);

// PUT: Guardar horario
router.put('/franja', configuracionController.actualizarFranjaHoraria);

module.exports = router;