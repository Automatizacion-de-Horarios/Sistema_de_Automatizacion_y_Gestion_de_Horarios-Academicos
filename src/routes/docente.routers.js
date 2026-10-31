const router = require('express').Router();
const controlador = require('../controllers/docente.controller');

// server.js verifica el JWT antes de ingresar en estas rutas.
router.use(controlador.preparar);
router.get('/', controlador.listar);
router.get('/buscar-dni', controlador.buscarPorDni);
router.get('/buscar-nombre', controlador.buscarPorNombre);
router.post('/', controlador.crear);
router.post('/:id/registrar', controlador.registrarExistente);
router.put('/:id', controlador.editar);
router.patch('/:id/estado', controlador.cambiarEstado);
router.get('/:id/cursos', controlador.cursos);
router.put('/:id/cursos', controlador.guardarCursos);
router.get('/:id/disponibilidad', controlador.disponibilidad);
router.put('/:id/disponibilidad', controlador.guardarDisponibilidad);
router.get('/:id/ficha', controlador.ficha);

module.exports = router;
