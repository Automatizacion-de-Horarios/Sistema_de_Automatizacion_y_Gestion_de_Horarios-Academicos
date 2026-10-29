require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./src/config/db');

// Importación de rutas de los módulos
const ambienteRoutes = require('./src/routes/ambiente.routes');
const feriadoRoutes = require('./src/routes/feriado.routes'); // 👈 Nueva ruta de Feriados (Equipo 2)
const authRoutes = require('./src/routes/authRoutes');
const { verifyJWT } = require('./src/middlewares/authMiddleware');

// Opcionales (asegúrate de que existan en src/routes/, si no, coméntalos temporalmente)
let carrerasRoutes, mallasRoutes;
try { carrerasRoutes = require('./src/routes/carrerasImpExp.routes'); } catch (e) {}
try { mallasRoutes = require('./src/routes/mallasImpExp.routes'); } catch (e) {}

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// Rutas del sistema
const mallasRoutes = require('./src/routes/mallasImpExp.routes');
const carrerasRoutes = require('./src/routes/carrerasImpExp.routes');
app.use('/api/mallas', mallasRoutes);
app.use('/api/carreras', carrerasRoutes);
// Montaje de rutas de la API
app.use('/api/ambientes', verifyJWT, ambienteRoutes);
app.use('/api/feriados', verifyJWT, feriadoRoutes); // 👈 Endpoint montado en /api/feriados
app.use('/api/auth', authRoutes);

if (carrerasRoutes) app.use('/api/carreras', verifyJWT, carrerasRoutes);
if (mallasRoutes) app.use('/api/mallas', verifyJWT, mallasRoutes);

// Comprobamos que la conexión con MySQL funciona
db.query('SELECT 1')
    .then(() => console.log('Conectado a MySQL'))
    .catch((error) => console.error('Error al conectar con MySQL:', error.message));

// Inicialización del servidor
app.listen(PORT, () => {
    console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
