/**
 * Migración idempotente para soportar varios borradores por periodo.
 *
 * - Crea `horarios_borradores`.
 * - Agrega `horarios_generados.id_borrador` con índice y FK.
 * - Asigna las filas existentes al primer borrador de su periodo.
 *
 * Se ejecuta con `npm run migrar:borradores` y también desde el deploy.
 */

const db = require('../src/config/db');

async function existeTabla(nombre) {
    const [filas] = await db.query(
        `SELECT COUNT(*) AS total
           FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [nombre]
    );
    return Number(filas[0]?.total) > 0;
}

async function existeColumna(tabla, columna) {
    const [filas] = await db.query(
        `SELECT COUNT(*) AS total
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [tabla, columna]
    );
    return Number(filas[0]?.total) > 0;
}

async function existeIndice(tabla, indice) {
    const [filas] = await db.query(
        `SELECT COUNT(*) AS total
           FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ? AND INDEX_NAME = ?`,
        [tabla, indice]
    );
    return Number(filas[0]?.total) > 0;
}

async function existeForeignKey(tabla, columna, tablaReferenciada) {
    const [filas] = await db.query(
        `SELECT COUNT(*) AS total
           FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = ?
            AND COLUMN_NAME = ?
            AND REFERENCED_TABLE_NAME = ?`,
        [tabla, columna, tablaReferenciada]
    );
    return Number(filas[0]?.total) > 0;
}

async function motorTabla(tabla) {
    const [filas] = await db.query(
        `SELECT ENGINE AS motor
           FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [tabla]
    );
    return String(filas[0]?.motor ?? '').toUpperCase();
}

async function crearTablaBorradores() {
    if (await existeTabla('horarios_borradores')) {
        console.log('- horarios_borradores ya existe.');
        return;
    }

    await db.query(`
        CREATE TABLE horarios_borradores (
            id_borrador INT NOT NULL AUTO_INCREMENT,
            id_periodo INT NOT NULL,
            nombre VARCHAR(120) NOT NULL,
            estado ENUM('BORRADOR', 'CONFIRMADO') NOT NULL DEFAULT 'BORRADOR',
            fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            fecha_confirmacion DATETIME NULL,
            PRIMARY KEY (id_borrador),
            KEY idx_hb_periodo (id_periodo),
            CONSTRAINT fk_hb_periodo
                FOREIGN KEY (id_periodo) REFERENCES periodos (id_periodo)
                ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('+ Tabla horarios_borradores creada.');
}

async function agregarColumnaBorrador() {
    if (await existeColumna('horarios_generados', 'id_borrador')) {
        console.log('- horarios_generados.id_borrador ya existe.');
        return;
    }

    await db.query(
        `ALTER TABLE horarios_generados
            ADD COLUMN id_borrador INT NULL AFTER id_periodo`
    );
    console.log('+ Columna horarios_generados.id_borrador creada.');
}

async function agregarIndiceBorrador() {
    if (await existeIndice('horarios_generados', 'idx_hg_borrador')) {
        console.log('- Índice idx_hg_borrador ya existe.');
        return;
    }

    await db.query(
        'ALTER TABLE horarios_generados ADD KEY idx_hg_borrador (id_borrador)'
    );
    console.log('+ Índice idx_hg_borrador creado.');
}

async function agregarForeignKeyBorrador() {
    if (
        await existeForeignKey(
            'horarios_generados',
            'id_borrador',
            'horarios_borradores'
        )
    ) {
        console.log('- FK de horarios_generados.id_borrador ya existe.');
        return;
    }

    const motor = await motorTabla('horarios_generados');
    if (motor !== 'INNODB') {
        console.warn(
            `! horarios_generados usa ${motor || 'un motor desconocido'}; ` +
            'se omite la FK y se conserva solo el índice.'
        );
        return;
    }

    await db.query(
        `ALTER TABLE horarios_generados
            ADD CONSTRAINT fk_hg_borrador
            FOREIGN KEY (id_borrador) REFERENCES horarios_borradores (id_borrador)
            ON DELETE CASCADE ON UPDATE CASCADE`
    );
    console.log('+ FK fk_hg_borrador creada.');
}

async function backfill() {
    const [periodos] = await db.query(
        `SELECT DISTINCT id_periodo
           FROM horarios_generados
          WHERE id_borrador IS NULL`
    );

    if (!periodos.length) {
        console.log('- No hay filas pendientes de asignar a un borrador.');
        return;
    }

    for (const { id_periodo: idPeriodo } of periodos) {
        const [resumen] = await db.query(
            `SELECT
                CASE WHEN SUM(estado = 'CONFIRMADO') > 0
                     THEN 'CONFIRMADO' ELSE 'BORRADOR' END AS estado,
                MIN(fecha_registro) AS fecha_creacion,
                COUNT(*) AS total
               FROM horarios_generados
              WHERE id_periodo = ? AND id_borrador IS NULL`,
            [idPeriodo]
        );
        const datos = resumen[0];

        const [existentes] = await db.query(
            `SELECT id_borrador
               FROM horarios_borradores
              WHERE id_periodo = ?
              ORDER BY fecha_creacion ASC, id_borrador ASC
              LIMIT 1`,
            [idPeriodo]
        );

        let idBorrador;
        if (existentes.length) {
            idBorrador = Number(existentes[0].id_borrador);
            console.log(
                `- Periodo ${idPeriodo}: se reutiliza el borrador ${idBorrador}.`
            );
        } else {
            const [resultado] = await db.query(
                `INSERT INTO horarios_borradores
                    (id_periodo, nombre, estado, fecha_creacion)
                 VALUES (?, 'Borrador 1', ?, COALESCE(?, CURRENT_TIMESTAMP))`,
                [idPeriodo, datos.estado, datos.fecha_creacion]
            );
            idBorrador = Number(resultado.insertId);
            console.log(
                `+ Periodo ${idPeriodo}: borrador ${idBorrador} creado.`
            );
        }

        const [resultado] = await db.query(
            `UPDATE horarios_generados
                SET id_borrador = ?
              WHERE id_periodo = ? AND id_borrador IS NULL`,
            [idBorrador, idPeriodo]
        );
        console.log(
            `+ Periodo ${idPeriodo}: ${resultado.affectedRows} fila(s) ` +
            `asignadas al borrador ${idBorrador}.`
        );
    }
}

async function verificar() {
    const [filas] = await db.query(
        `SELECT COUNT(*) AS total
           FROM horarios_generados hg
           LEFT JOIN horarios_borradores hb
             ON hb.id_borrador = hg.id_borrador
          WHERE hg.id_borrador IS NULL OR hb.id_borrador IS NULL`
    );
    const huerfanas = Number(filas[0]?.total) || 0;
    if (huerfanas > 0) {
        throw new Error(
            `Quedaron ${huerfanas} fila(s) de horarios_generados sin borrador válido.`
        );
    }

    const [resumen] = await db.query(
        `SELECT
            (SELECT COUNT(*) FROM horarios_borradores) AS borradores,
            (SELECT COUNT(*) FROM horarios_generados WHERE id_borrador IS NOT NULL) AS filas`
    );
    console.log(
        `OK: ${Number(resumen[0]?.borradores) || 0} borrador(es), ` +
        `${Number(resumen[0]?.filas) || 0} fila(s) de horario agrupadas.`
    );
}

async function main() {
    console.log('Migrando soporte de varios borradores por periodo...');
    await crearTablaBorradores();
    await agregarColumnaBorrador();
    await agregarIndiceBorrador();
    await agregarForeignKeyBorrador();
    await backfill();
    await verificar();
}

main()
    .then(async () => {
        await db.end();
    })
    .catch(async (error) => {
        console.error('No se pudo completar la migración:', error.message);
        try {
            await db.end();
        } catch {
            // El pool puede estar ya cerrado.
        }
        process.exitCode = 1;
    });
