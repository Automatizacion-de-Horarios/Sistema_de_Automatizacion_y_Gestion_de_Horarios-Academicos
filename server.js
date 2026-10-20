const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Servir la carpeta public donde está el index.html
app.use(express.static(path.join(__dirname, 'public')));

// Pool de conexiones a MySQL en Aiven
const db = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DB,
    port: process.env.MYSQL_PORT,
    waitForConnections: true,
    connectionLimit: 10
});

db.getConnection((err, connection) => {
    if (err) {
        console.error('Error conexión a MySQL:', err.message);
    } else {
        console.log('Conexión exitosa a MySQL');
        connection.release();
    }
});

// Endpoint de prueba para obtener docentes
app.get('/api/docentes', (req, res) => {
    db.query('SELECT * FROM docentes', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
});