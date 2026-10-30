const express = require('express');
const router = express.Router();
const multer = require('multer');

// Almacenar el archivo directamente en memoria (Buffer) para procesarlo sin guardarlo en disco
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
});
const recibirArchivo = (req, res, next) => {
    upload.single('archivo')(req, res, (error) => {
        if (!error) return next();
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ mensaje: 'El archivo supera el límite permitido de 10 MB.' });
        }
        return res.status(400).json({ mensaje: 'No se pudo recibir el archivo Excel.' });
    });
};

const mallasImpExpController = require('../controllers/mallasImpExp.controller');

// Ruta POST para recibir el archivo arrastrado/seleccionado por el usuario.
// Con ?progreso=1 responde con un jobId para consultar el avance en tiempo real.
router.post('/importar-excel', recibirArchivo, mallasImpExpController.importarExcel);

// Ruta GET para consultar el avance de una importación (polling desde el frontend)
router.get('/importar-excel/progreso/:jobId', mallasImpExpController.obtenerProgreso);

// Ruta GET para verificar el conteo actual en la BD
router.get('/resumen', mallasImpExpController.obtenerResumen);

module.exports = router;
