// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const docenteRoutes = require('./src/routes/docenteRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: process.env.CORS_ORIGIN || '*'
}));
app.use(express.json());

// Montaje de rutas del módulo
app.use('/api/docentes', docenteRoutes);

// Manejo de rutas inexistentes (404)
app.use((req, res, next) => {
    res.status(404).json({
        ok: false,
        mensaje: 'Ruta no encontrada en el módulo de docentes'
    });
});

// Manejo de errores globales (500)
app.use((err, req, res, next) => {
    console.error('Error no controlado:', err.stack);
    res.status(500).json({
        ok: false,
        mensaje: 'Error interno del servidor'
    });
});

app.listen(PORT, () => {
    console.log(`Servidor backend corriendo en el puerto ${PORT}`);
});