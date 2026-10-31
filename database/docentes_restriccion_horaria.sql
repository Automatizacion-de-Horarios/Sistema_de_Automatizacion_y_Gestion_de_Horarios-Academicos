-- Bandera que decide si el solver respeta la cuadrícula de disponibilidad.
-- Es idempotente: no falla si la columna ya existe.
SET @existe_columna = (
    SELECT COUNT(*)
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'docentes'
       AND COLUMN_NAME = 'usa_restriccion_horaria'
    );
SET @sql_columna = IF(
    @existe_columna = 0,
    'ALTER TABLE docentes ADD COLUMN usa_restriccion_horaria TINYINT(1) NOT NULL DEFAULT 0 AFTER horas_semanales_meta',
    'SELECT 1'
);
PREPARE stmt_columna FROM @sql_columna;
EXECUTE stmt_columna;
DEALLOCATE PREPARE stmt_columna;

-- Los docentes de tiempo parcial usan obligatoriamente la cuadrícula.
UPDATE docentes
   SET usa_restriccion_horaria = 1
 WHERE tipo_contrato = 'TIEMPO_PARCIAL'
   AND usa_restriccion_horaria <> 1;
