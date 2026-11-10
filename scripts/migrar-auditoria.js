const db = require('../src/config/db');

const TABLAS = [
  'ambiente_cursos_permitidos',
  'ambientes',
  'configuracion_franja_horaria',
  'periodos',
  'programacion_academica',
  'sedes',
  'sedes_zonales',
  'tipo_ambiente',
  'turnos',
  'usuarios',
];

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

async function agregarColumna(tabla, columna, definicion) {
  if (await existeColumna(tabla, columna)) {
    console.log(`- ${tabla}.${columna} ya existe.`);
    return;
  }

  await db.query(
    `ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`
  );
  console.log(`+ ${tabla}.${columna} creada.`);
}

async function main() {
  console.log('Migrando columnas de auditoría faltantes...');

  for (const tabla of TABLAS) {
    await agregarColumna(
      tabla,
      'fecha_modificacion',
      'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
    );
  }

  if (await existeColumna('usuarios', 'fecha_registro') === false) {
    await agregarColumna(
      'usuarios',
      'fecha_registro',
      'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'
    );
  }

  console.log('OK: auditoría actualizada.');
}

main()
  .then(async () => {
    await db.end();
  })
  .catch(async (error) => {
    console.error('No se pudo completar la migración:', error.message);
    try { await db.end(); } catch {}
    process.exitCode = 1;
  });
