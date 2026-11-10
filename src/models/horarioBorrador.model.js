const baseDatos = require('../config/db');

const ESTADOS = new Set(['BORRADOR', 'CONFIRMADO']);

const CONSULTA_BORRADORES = `
    SELECT
        hb.id_borrador,
        hb.id_periodo,
        hb.nombre,
        hb.estado,
        hb.fecha_creacion,
        hb.fecha_confirmacion,
        COUNT(hg.id_horario) AS total,
        MIN(hg.fecha_registro) AS primera_fila,
        MAX(hg.fecha_registro) AS ultima_fila
    FROM horarios_borradores hb
    INNER JOIN periodos p ON p.id_periodo = hb.id_periodo
    LEFT JOIN horarios_generados hg ON hg.id_borrador = hb.id_borrador
    WHERE p.codigo_periodo = ?
    GROUP BY
        hb.id_borrador,
        hb.id_periodo,
        hb.nombre,
        hb.estado,
        hb.fecha_creacion,
        hb.fecha_confirmacion
    ORDER BY hb.fecha_creacion ASC, hb.id_borrador ASC
`;

function normalizarBorrador(fila) {
    return {
        id_borrador: Number(fila.id_borrador),
        id_periodo: Number(fila.id_periodo),
        nombre: fila.nombre,
        estado: fila.estado,
        fecha_creacion: fila.fecha_creacion,
        fecha_confirmacion: fila.fecha_confirmacion ?? null,
        total: Number(fila.total) || 0,
        primera_fila: fila.primera_fila ?? null,
        ultima_fila: fila.ultima_fila ?? null,
    };
}

async function obtenerPeriodo(codigoPeriodo) {
    const [periodos] = await baseDatos.query(
        'SELECT id_periodo, codigo_periodo FROM periodos WHERE codigo_periodo = ? LIMIT 1',
        [codigoPeriodo]
    );
    return periodos[0] ?? null;
}

function errorHttp(mensaje, estado) {
    const error = new Error(mensaje);
    error.status = estado;
    return error;
}

const HorarioBorrador = {
    async listar(codigoPeriodo) {
        const [filas] = await baseDatos.query(CONSULTA_BORRADORES, [codigoPeriodo]);
        return filas.map(normalizarBorrador);
    },

    async resolver(codigoPeriodo, idBorrador = null) {
        const borradores = await this.listar(codigoPeriodo);
        if (!borradores.length) return { borrador: null, borradores };

        if (idBorrador != null) {
            const solicitado = borradores.find(
                (borrador) => borrador.id_borrador === Number(idBorrador)
            );
            if (!solicitado) {
                throw errorHttp(
                    `No existe el borrador ${idBorrador} para el periodo ${codigoPeriodo}.`,
                    404
                );
            }
            return { borrador: solicitado, borradores };
        }

        return { borrador: borradores[0], borradores };
    },

    async crear(codigoPeriodo, nombre = null) {
        const periodo = await obtenerPeriodo(codigoPeriodo);
        if (!periodo) {
            throw errorHttp(`No existe el periodo ${codigoPeriodo}.`, 404);
        }

        let nombreFinal = String(nombre ?? '').trim();
        if (!nombreFinal) {
            const [existentes] = await baseDatos.query(
                'SELECT nombre FROM horarios_borradores WHERE id_periodo = ?',
                [periodo.id_periodo]
            );
            const usados = new Set(existentes.map((fila) => fila.nombre));
            let consecutivo = 1;
            while (usados.has(`Borrador ${consecutivo}`)) consecutivo += 1;
            nombreFinal = `Borrador ${consecutivo}`;
        }

        const [resultado] = await baseDatos.query(
            `INSERT INTO horarios_borradores (id_periodo, nombre, estado)
             VALUES (?, ?, 'BORRADOR')`,
            [periodo.id_periodo, nombreFinal]
        );

        return {
            id_borrador: Number(resultado.insertId),
            id_periodo: Number(periodo.id_periodo),
            nombre: nombreFinal,
            estado: 'BORRADOR',
            total: 0,
        };
    },

    async eliminar(codigoPeriodo, idBorrador) {
        const [filas] = await baseDatos.query(
            `SELECT hb.id_borrador, hb.estado
               FROM horarios_borradores hb
               INNER JOIN periodos p ON p.id_periodo = hb.id_periodo
              WHERE p.codigo_periodo = ? AND hb.id_borrador = ?`,
            [codigoPeriodo, idBorrador]
        );

        if (!filas.length) {
            throw errorHttp(
                `No existe el borrador ${idBorrador} para el periodo ${codigoPeriodo}.`,
                404
            );
        }
        if (filas[0].estado === 'CONFIRMADO') {
            throw errorHttp(
                'No se puede eliminar un borrador confirmado. Cambia su estado a Borrador primero.',
                409
            );
        }

        await baseDatos.query(
            'DELETE FROM horarios_generados WHERE id_borrador = ?',
            [idBorrador]
        );
        await baseDatos.query(
            'DELETE FROM horarios_borradores WHERE id_borrador = ?',
            [idBorrador]
        );

        return Number(idBorrador);
    },

    async eliminarSiVacio(idBorrador) {
        const [filas] = await baseDatos.query(
            'SELECT COUNT(*) AS total FROM horarios_generados WHERE id_borrador = ?',
            [idBorrador]
        );
        if (Number(filas[0]?.total) > 0) return false;
        await baseDatos.query(
            'DELETE FROM horarios_borradores WHERE id_borrador = ?',
            [idBorrador]
        );
        return true;
    },

    async cambiarEstado(codigoPeriodo, idBorrador, estado) {
        if (!ESTADOS.has(estado)) {
            throw errorHttp('El estado del borrador no es válido.', 400);
        }

        const [filas] = await baseDatos.query(
            `SELECT hb.id_borrador
               FROM horarios_borradores hb
               INNER JOIN periodos p ON p.id_periodo = hb.id_periodo
              WHERE p.codigo_periodo = ? AND hb.id_borrador = ?`,
            [codigoPeriodo, idBorrador]
        );
        if (!filas.length) {
            throw errorHttp(
                `No existe el borrador ${idBorrador} para el periodo ${codigoPeriodo}.`,
                404
            );
        }

        const conexion = await baseDatos.getConnection();
        try {
            await conexion.beginTransaction();
            await conexion.query(
                `UPDATE horarios_borradores
                    SET estado = ?,
                        fecha_confirmacion = CASE WHEN ? = 'CONFIRMADO'
                            THEN CURRENT_TIMESTAMP ELSE NULL END
                  WHERE id_borrador = ?`,
                [estado, estado, idBorrador]
            );
            const [resultado] = await conexion.query(
                'UPDATE horarios_generados SET estado = ? WHERE id_borrador = ?',
                [estado, idBorrador]
            );
            await conexion.commit();

            return {
                id_borrador: Number(idBorrador),
                estado,
                afectados: resultado.affectedRows,
            };
        } catch (error) {
            await conexion.rollback();
            throw error;
        } finally {
            conexion.release();
        }
    },
};

module.exports = HorarioBorrador;
