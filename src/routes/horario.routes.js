const enrutador = require('express').Router();
const controlador = require('../controllers/horario.controller');

enrutador.get('/borradores', controlador.listarBorradores);
enrutador.patch('/borradores/:periodo/mover', controlador.moverBorradores);
enrutador.patch('/borradores/:periodo/estado', controlador.cambiarEstado);

module.exports = enrutador;
