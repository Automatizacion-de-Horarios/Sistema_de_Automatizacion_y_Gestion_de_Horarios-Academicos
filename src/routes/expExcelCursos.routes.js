const express = require('express');
const router = express.Router();
const expExcelCursosController = require('../controllers/expExcelCursos.controler');

// Descarga la estructura curricular completa (carreras + semestres I a VI + cursos) en Excel.
router.get('/exportar-excel', expExcelCursosController.exportarExcel);

module.exports = router;
