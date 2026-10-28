const express = require('express');
const router = express.Router();
const carrerasController = require('../controllers/carrerasController');

// Obtener todas las carreras registradas
router.get('/', carrerasController.obtenerCarreras);

// Registrar una nueva carrera con su código y nombre oficial
router.post('/', carrerasController.crearCarrera);

module.exports = router;
