const express = require('express');
const cors = require('cors');
require('dotenv').config();

const db = require('./src/config/db');

// Importación de las rutas que SÍ existen en tu carpeta src/routes/
const tipoAmbienteRoutes = require('./src/routes/tipoAmbiente.routes');
const ambienteRoutes = require('./src/routes/ambiente.routes');
const feriadoRoutes = require('./src/routes/feriado.routes');

// COMENTADO: const ambienteCarreraRoutes = require('./src/routes/ambienteCarrera.routes');

const app = express();

app.use(cors());
app.use(express.json());

// Rutas del sistema
const mallasRoutes = require('./src/routes/mallas.routes');
const carrerasRoutes = require('./src/routes/carreras.routes');
app.use('/api/mallas', mallasRoutes);
app.use('/api/carreras', carrerasRoutes);

// Ruta base de prueba
app.get('/', (req, res) => {
    res.json({ mensaje: 'API Sistema de Automatización de Horarios corriendo' });
});

// Estado del servicio y de la conexión a MySQL
app.get('/api/health', async (req, res) => {
    try {
        await db.query('SELECT 1');
        res.json({ estado: 'ok', baseDeDatos: 'conectada' });
    } catch (error) {
        res.status(503).json({
            estado: 'error',
            baseDeDatos: 'desconectada',
            detalle: error.code || error.message
        });
    }
});

// Módulo de Infraestructura y Ambientes (Equipo 2)
app.use('/api/tipos-ambiente', tipoAmbienteRoutes);
app.use('/api/ambientes', ambienteRoutes);
app.use('/api/feriados', feriadoRoutes);

// COMENTADO: app.use('/api/ambientes-carreras', ambienteCarreraRoutes);

// Ruta no encontrada
app.use((req, res) => {
    res.status(404).json({ mensaje: `Ruta no encontrada: ${req.method} ${req.originalUrl}` });
});

// Manejo centralizado de errores
app.use((error, req, res, next) => {
    console.error('[ERROR]', error);
    res.status(error.status || 500).json({
        mensaje: error.message || 'Error interno del servidor.'
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Backend corriendo en http://localhost:${PORT}`);
});