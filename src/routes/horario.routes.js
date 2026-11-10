const enrutador = require('express').Router();
const controlador = require('../controllers/horario.controller');
const controladorExportacion = require('../controllers/horarioExport.controller');
const controladorSolver = require('../controllers/horarioSolver.controller');

enrutador.get('/exportar', controladorExportacion.exportarHorariosZip);
enrutador.post('/solver/ejecutar', controladorSolver.ejecutar);
enrutador.post('/solver/cancelar', controladorSolver.cancelar);
enrutador.get('/solver/actual', controladorSolver.actual);
enrutador.get('/solver/estado/:jobId', controladorSolver.estado);
enrutador.get('/borradores/versiones', controlador.listarVersiones);
enrutador.delete(
    '/borradores/:periodo/versiones/:idBorrador',
    controlador.eliminarBorrador
);
enrutador.get('/ambientes', controlador.listarAmbientes);
enrutador.patch('/borradores/:periodo/aula', controlador.cambiarAula);
enrutador.get('/borradores', controlador.listarBorradores);
enrutador.patch('/borradores/:periodo/mover', controlador.moverBorradores);
enrutador.patch('/borradores/:periodo/estado', controlador.cambiarEstado);

module.exports = enrutador;
