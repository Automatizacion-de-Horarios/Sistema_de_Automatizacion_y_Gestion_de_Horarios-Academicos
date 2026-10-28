<<<<<<< HEAD
const { Router } = require('express'); 
const controller = require('../controllers/ambiente.controller'); 
 
const router = Router(); 
 
router.get('/', controller.listar); 
router.get('/:id', controller.obtener); 
router.post('/', controller.crear); 
router.put('/:id', controller.actualizar); 
router.delete('/:id', controller.eliminar); 

module.exports = router;
=======
const { Router } = require('express');
const controller = require('../controllers/ambiente.controller');
const router = Router();

router.get('/', controller.listar);
router.get('/:id', controller.obtener);
router.post('/', controller.crear);
router.put('/:id', controller.actualizar);
router.delete('/:id', controller.eliminar);

module.exports = router;
>>>>>>> main
