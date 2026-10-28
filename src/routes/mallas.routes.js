const express = require('express');
const router = express.Router();
const multer = require('multer');

// Almacenar el archivo directamente en memoria (Buffer) para procesarlo sin guardarlo en disco
const upload = multer({ storage: multer.memoryStorage() });

const mallasController = require('../controllers/mallasController');

// Ruta POST para recibir el archivo arrastrado/seleccionado por el usuario.
// Con ?progreso=1 responde con un jobId para consultar el avance en tiempo real.
router.post('/importar-excel', upload.single('archivo'), mallasController.importarExcel);

// Ruta GET para consultar el avance de una importación (polling desde el frontend)
router.get('/importar-excel/progreso/:jobId', mallasController.obtenerProgreso);

// Ruta GET para verificar el conteo actual en la BD
router.get('/resumen', mallasController.obtenerResumen);

module.exports = router;
