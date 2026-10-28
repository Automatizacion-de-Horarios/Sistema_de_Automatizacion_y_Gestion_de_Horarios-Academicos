require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./src/config/db');

// Importación de rutas de los módulos
const ambienteRoutes = require('./src/routes/ambiente.routes');
const feriadoRoutes = require('./src/routes/feriado.routes'); // 👈 Nueva ruta de Feriados (Equipo 2)

// Opcionales (asegúrate de que existan en src/routes/, si no, coméntalos temporalmente)
let carrerasRoutes, mallasRoutes;
try { carrerasRoutes = require('./src/routes/carreras.routes'); } catch (e) {}
try { mallasRoutes = require('./src/routes/mallas.routes'); } catch (e) {}

const db = require('./src/config/db');

// Importación de las rutas que SÍ existen en tu carpeta src/routes/
const tipoAmbienteRoutes = require('./src/routes/tipoAmbiente.routes');
const ambienteRoutes = require('./src/routes/ambiente.routes');
const feriadoRoutes = require('./src/routes/feriado.routes');

// COMENTADO: const ambienteCarreraRoutes = require('./src/routes/ambienteCarrera.routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());

<<<<<<< HEAD
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
=======
// Montaje de rutas de la API
app.use('/api/ambientes', ambienteRoutes);
app.use('/api/feriados', feriadoRoutes); // 👈 Endpoint montado en /api/feriados
>>>>>>> main

if (carrerasRoutes) app.use('/api/carreras', carrerasRoutes);
if (mallasRoutes) app.use('/api/mallas', mallasRoutes);

// Comprobamos que la conexión con MySQL funciona
db.query('SELECT 1')
    .then(() => console.log('Conectado a MySQL'))
    .catch((error) => console.error('Error al conectar con MySQL:', error.message));

// Inicialización del servidor
app.listen(PORT, () => {
    console.log(`Servidor escuchando en http://localhost:${PORT}`);
});