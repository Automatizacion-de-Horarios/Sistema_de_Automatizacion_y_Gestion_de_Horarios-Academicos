require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./src/config/db');

// Importación de rutas de los módulos
const ambienteRoutes = require('./src/routes/ambiente.routes');
const feriadoRoutes = require('./src/routes/feriado.routes'); // 👈 Nueva ruta de Feriados (Equipo 2)
const authRoutes = require('./src/routes/authRoutes');
const { verifyJWT } = require('./src/middlewares/authMiddleware');

// Opcionales (si falta alguno, se avisa en consola en lugar de romper el arranque)
let carrerasRoutes, mallasRoutes, expExcelCursosRoutes;
try {
    carrerasRoutes = require('./src/routes/carrerasImpExp.routes');
} catch (e) {
    console.error('No se pudieron cargar las rutas de carreras:', e.message);
}
try {
    mallasRoutes = require('./src/routes/mallasImpExp.routes');
} catch (e) {
    console.error('No se pudieron cargar las rutas de mallas/cursos:', e.message);
}
try {
    expExcelCursosRoutes = require('./src/routes/expExcelCursos.routes');
} catch (e) {
    console.error('No se pudieron cargar las rutas de exportación de cursos:', e.message);
}

const app = express();
const PORT = process.env.PORT || 3000;

// El origen local se permite por defecto; agrega el dominio del frontend en CORS_ORIGINS al desplegar.
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

app.use(cors({
    origin(origin, callback) {
        if (!origin) return callback(null, true);
        return callback(null, allowedOrigins.includes(origin));
    }
}));
app.use(express.json());

// Montaje de rutas de la API
app.use('/api/ambientes', verifyJWT, ambienteRoutes);
app.use('/api/feriados', verifyJWT, feriadoRoutes); // 👈 Endpoint montado en /api/feriados
app.use('/api/auth', authRoutes);

app.use('/api/carreras', verifyJWT, carrerasRoutes);
app.use('/api/mallas', verifyJWT, mallasRoutes);

// Exportación de la estructura curricular en Excel (mismo prefijo que la importación)
if (expExcelCursosRoutes) {
    app.use('/api/mallas', verifyJWT, expExcelCursosRoutes);
}

async function iniciarServidor() {
    try {
        await db.query('SELECT 1');
        console.log('Conectado a MySQL');
        app.listen(PORT, () => {
            console.log(`Servidor escuchando en http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('No se pudo conectar a MySQL. El servidor no se iniciará:', error.message);
        process.exitCode = 1;
        await db.end();
    }
}

iniciarServidor();
