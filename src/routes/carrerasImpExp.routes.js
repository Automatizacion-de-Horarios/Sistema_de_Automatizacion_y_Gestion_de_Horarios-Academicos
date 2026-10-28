const express = require('express');
const router = express.Router();
const carrerasImpExpController = require('../controllers/carrerasImpExpController');

// Obtener todas las carreras registradas
router.get('/', carrerasImpExpController.obtenerCarreras);

// Registrar una nueva carrera con su código y nombre oficial
router.post('/', carrerasImpExpController.crearCarrera);

module.exports = router;
