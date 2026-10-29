const db = require('../config/db');

/**
 * Controlador de Carreras
 * Permite registrar nuevas carreras con su código y nombre institucional,
 * asegurando la creación de sus ciclos I al VI.
 */
const carrerasImpExpController = {

    /**
     * Obtener listado de todas las carreras activas
     */
    obtenerCarreras: async (req, res) => {
        try {
            const [carreras] = await db.query(
                "SELECT id_carrera, codigo_carrera, nombre_carrera, estado FROM carreras WHERE estado = 'A' ORDER BY codigo_carrera ASC"
            );
            return res.json({
                status: 'ok',
                carreras
            });
        } catch (error) {
            console.error('Error al obtener carreras:', error);
            return res.status(500).json({
                status: 'error',
                mensaje: 'Error al consultar las carreras en la base de datos.'
            });
        }
    },

    /**
     * Registrar una nueva carrera con su código y nombre oficial
     */
    crearCarrera: async (req, res) => {
        let connection;
        try {
            const { codigo_carrera, nombre_carrera } = req.body;

            if (!codigo_carrera || !nombre_carrera) {
                return res.status(400).json({
                    status: 'error',
                    mensaje: 'Debe ingresar tanto el código (sigla) como el nombre oficial de la carrera.'
                });
            }

            const codigoLimpio = String(codigo_carrera).trim().toUpperCase();
            const nombreLimpio = String(nombre_carrera).trim();

            connection = await db.getConnection();
            await connection.beginTransaction();

            // 1. Verificar si ya existe el código de carrera
            const [carreraExistente] = await connection.query(
                'SELECT id_carrera FROM carreras WHERE codigo_carrera = ?',
                [codigoLimpio]
            );

            if (carreraExistente && carreraExistente.length > 0) {
                await connection.rollback();
                return res.status(400).json({
                    status: 'error',
                    mensaje: `El código de carrera '${codigoLimpio}' ya se encuentra registrado en el sistema.`
                });
            }

            // 2. Insertar la nueva carrera
            const [resultadoCarrera] = await connection.query(
                "INSERT INTO carreras (codigo_carrera, nombre_carrera, estado) VALUES (?, ?, 'A')",
                [codigoLimpio, nombreLimpio]
            );

            const nuevoIdCarrera = resultadoCarrera.insertId;

            // 3. Crear automáticamente los 6 semestres (I al VI) con la meta oficial de 510 hrs.
            // Primero se consultan los semestres que ya existen para la carrera y solo se
            // insertan los que faltan, tal como se valida en la importación de mallas.
            const ciclos = ['I', 'II', 'III', 'IV', 'V', 'VI'];

            const [semestresExistentes] = await connection.query(
                'SELECT semestre FROM semestres WHERE id_carrera = ?',
                [nuevoIdCarrera]
            );

            const semestresRegistrados = new Set(
                semestresExistentes.map((fila) => String(fila.semestre).trim().toUpperCase())
            );

            for (const ciclo of ciclos) {
                // Si el semestre ya existe para esta carrera, no se vuelve a insertar.
                if (semestresRegistrados.has(ciclo)) continue;

                await connection.query(
                    'INSERT INTO semestres (id_carrera, semestre, horas_semestre_meta, estado) VALUES (?, ?, ?, ?)',
                    [nuevoIdCarrera, ciclo, 510, 'A']
                );
            }

            await connection.commit();

            return res.json({
                status: 'ok',
                mensaje: `Carrera '${nombreLimpio}' (${codigoLimpio}) registrada exitosamente con sus 6 semestres.`,
                carrera: {
                    id_carrera: nuevoIdCarrera,
                    codigo_carrera: codigoLimpio,
                    nombre_carrera: nombreLimpio
                }
            });

        } catch (error) {
            if (connection) await connection.rollback();
            console.error('Error al registrar carrera:', error);
            return res.status(500).json({
                status: 'error',
                mensaje: 'Error interno al guardar la carrera en la base de datos.',
                detalle: error.message
            });
        } finally {
            if (connection) connection.release();
        }
    }
};

module.exports = carrerasImpExpController;
