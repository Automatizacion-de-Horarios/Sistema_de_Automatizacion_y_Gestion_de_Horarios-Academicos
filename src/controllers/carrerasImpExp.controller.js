const Carrera = require('../models/carrerasImpExp.model');

/**
 * Controlador de Carreras
 * Permite registrar nuevas carreras con su código y nombre institucional,
 * asegurando la creación de sus ciclos I al VI.
 *
 * Este controlador solo valida datos y aplica las reglas de negocio.
 * Todas las consultas e inserciones a la base de datos viven en
 * ../models/carrerasImpExp.model.js.
 */

class ErrorCarreraDuplicada extends Error {
    constructor(codigo) {
        super(`El código de carrera '${codigo}' ya se encuentra registrado en el sistema.`);
        this.name = 'ErrorCarreraDuplicada';
        this.statusCode = 400;
        this.codigo = codigo;
    }
}

const carrerasImpExpController = {

    /**
     * Obtener listado de todas las carreras activas
     */
    obtenerCarreras: async (req, res) => {
        try {
            const carreras = await Carrera.obtenerActivas();
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

            // La carrera y sus semestres se registran en una sola transacción:
            // o se guarda todo, o no se guarda nada.
            const nuevoIdCarrera = await Carrera.enTransaccion(async (conexion) => {
                // 1. Verificar si ya existe el código de carrera
                const carreraExistente = await Carrera.obtenerPorCodigo(codigoLimpio, conexion);

                if (carreraExistente) {
                    throw new ErrorCarreraDuplicada(codigoLimpio);
                }

                // 2. Insertar la nueva carrera
                const idCarrera = await Carrera.crear(
                    { codigo: codigoLimpio, nombre: nombreLimpio, estado: 'A' },
                    conexion
                );

                // 3. Crear automáticamente los 6 semestres (I al VI) con la meta oficial de 510 hrs.
                // Primero se consultan los semestres que ya existen para la carrera y solo se
                // insertan los que faltan, tal como se valida en la importación de mallas.
                const ciclos = ['I', 'II', 'III', 'IV', 'V', 'VI'];

                const semestresExistentes = await Carrera.obtenerSemestres(idCarrera, conexion);

                const semestresRegistrados = new Set(
                    semestresExistentes.map((fila) => String(fila.semestre).trim().toUpperCase())
                );

                for (const ciclo of ciclos) {
                    // Si el semestre ya existe para esta carrera, no se vuelve a insertar.
                    if (semestresRegistrados.has(ciclo)) continue;

                    await Carrera.crearSemestre(
                        { idCarrera, semestre: ciclo, horasMeta: 510, estado: 'A' },
                        conexion
                    );
                }

                return idCarrera;
            });

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
            if (error instanceof ErrorCarreraDuplicada) {
                return res.status(error.statusCode).json({
                    status: 'error',
                    mensaje: error.message
                });
            }

            console.error('Error al registrar carrera:', error);
            return res.status(500).json({
                status: 'error',
                mensaje: 'Error interno al guardar la carrera en la base de datos.',
                detalle: error.message
            });
        }
    }
};

module.exports = carrerasImpExpController;
