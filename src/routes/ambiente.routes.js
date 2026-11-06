const { Router } = require('express'); 
const controller = require('../controllers/ambiente.controller'); 
 
const router = Router(); 
 
router.get('/cursos', controller.listarCursos);
router.get('/:id/cursos-permitidos', controller.listarCursosPermitidos);
router.patch('/:id/cursos-permitidos', controller.actualizarCursosPermitidosEnLote);
router.patch('/:id/cursos-permitidos/:idCurso', controller.actualizarCursoPermitido);
router.put('/:id/cursos-permitidos', controller.actualizarCursosPermitidos);
router.get('/', controller.listar); 
router.get('/:id', controller.obtener); 
router.post('/', controller.crear); 
router.put('/:id', controller.actualizar); 
router.patch('/:id/estado', controller.cambiarEstado);
router.delete('/:id', controller.eliminar); 

module.exports = router;