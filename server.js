const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

// Rutas del sistema
const mallasRoutes = require('./src/routes/mallasImpExp.routes');
const carrerasRoutes = require('./src/routes/carrerasImpExp.routes');
app.use('/api/mallas', mallasRoutes);
app.use('/api/carreras', carrerasRoutes);

// Ruta base de prueba
app.get('/', (req, res) => {
    res.json({ mensaje: "API Sistema de Automatización de Horarios corriendo" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Backend corriendo en http://localhost:${PORT}`);
});