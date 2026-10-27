const mysql = require('mysql2');
// src/config/db.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('Error al conectar a la base de datos PostgreSQL:', err.message);
    } else {
        console.log('Conexión exitosa a PostgreSQL en Supabase:', res.rows[0].now);
    }
});

module.exports = pool;