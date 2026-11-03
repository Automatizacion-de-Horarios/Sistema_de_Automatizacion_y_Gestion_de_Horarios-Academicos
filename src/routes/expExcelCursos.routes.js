const express = require('express');
const router = express.Router();
const expExcelCursosController = require('../controllers/expExcelCursos.controler');

router.get('/exportar-excel', expExcelCursosController.exportarExcel);

module.exports = router;
