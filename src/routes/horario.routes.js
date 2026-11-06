const router = require('express').Router();
const controlador = require('../controllers/horario.controller');

router.get('/borradores', controlador.listarBorradores);
router.patch('/borradores/:periodo/mover', controlador.moverBorradores);
router.patch('/borradores/:periodo/estado', controlador.cambiarEstado);

module.exports = router;
