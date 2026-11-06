const router = require('express').Router();
const controlador = require('../controllers/docente.controller');

// server.js verifica el JWT antes de ingresar en estas rutas.
router.use(controlador.preparar);
router.get('/', controlador.listar);
router.post('/', controlador.crear);
router.put('/:id', controlador.editar);
router.patch('/:id/estado', controlador.cambiarEstado);
router.patch('/:id/contrato', controlador.cambiarContrato);
router.get('/:id/disponibilidad', controlador.disponibilidad);
router.put('/:id/disponibilidad', controlador.guardarDisponibilidad);

module.exports = router;
