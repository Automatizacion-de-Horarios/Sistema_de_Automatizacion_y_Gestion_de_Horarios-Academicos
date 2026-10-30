-- Archivo: avances_tablas_db/migracion_oferta_academica.sql
-- Ejecutar conectado a la base de datos db_horarios.
-- Crea las tablas de sedes, periodos, turnos y oferta si no existen.
-- No modifica ni elimina ninguna tabla que ya exista de grupo_4.sql.

USE `db_horarios`;

-- Infraestructura de sedes. Si ya existe, CREATE TABLE IF NOT EXISTS la conserva.
CREATE TABLE IF NOT EXISTS `sedes_zonales` (
    `id_zonal` INT NOT NULL AUTO_INCREMENT,
    `codigo_camp` VARCHAR(10) NOT NULL,
    `nombre_zonal` VARCHAR(100) NOT NULL,
    `ciudad` VARCHAR(50) NOT NULL,
    PRIMARY KEY (`id_zonal`),
    UNIQUE KEY `uq_sedes_zonales_codigo_camp` (`codigo_camp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sedes` (
    `id_sede` INT NOT NULL AUTO_INCREMENT,
    `codigo_sede` VARCHAR(20) NOT NULL,
    `id_zonal` INT NOT NULL,
    `nombre_sede` VARCHAR(150) NOT NULL,
    `direccion_sede` VARCHAR(255) NOT NULL,
    PRIMARY KEY (`id_sede`),
    UNIQUE KEY `uq_sedes_codigo_sede` (`codigo_sede`),
    KEY `idx_sedes_id_zonal` (`id_zonal`),
    CONSTRAINT `fk_sedes_zonal`
        FOREIGN KEY (`id_zonal`) REFERENCES `sedes_zonales` (`id_zonal`)
        ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `periodos` (
    `id_periodo` INT NOT NULL AUTO_INCREMENT,
    `codigo_periodo` VARCHAR(10) NOT NULL,
    `descripcion` VARCHAR(100) NOT NULL,
    `estado` ENUM('ACTIVO', 'CERRADO') DEFAULT 'ACTIVO',
    PRIMARY KEY (`id_periodo`),
    UNIQUE KEY `uq_periodos_codigo_periodo` (`codigo_periodo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Añade los dos atributos a cursos. Ejecutar esta migración una sola vez.
ALTER TABLE `cursos`
    ADD COLUMN `is_carrera` TINYINT(1) NOT NULL DEFAULT 1
        COMMENT '1 = Curso de carrera, 0 = Transversal',
    ADD COLUMN `catalogo` VARCHAR(20) DEFAULT NULL
        COMMENT 'Código de catálogo o periodo de la malla, ej: 202610, 202310';

-- Catálogo de turnos académicos.
CREATE TABLE IF NOT EXISTS `turnos` (
    `id_turno` INT NOT NULL AUTO_INCREMENT,
    `codigo_turno` VARCHAR(5) NOT NULL,
    `nombre_turno` VARCHAR(20) NOT NULL,
    `estado` CHAR(1) NOT NULL DEFAULT 'A',
    PRIMARY KEY (`id_turno`),
    UNIQUE KEY `uq_turnos_codigo` (`codigo_turno`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Inserta los turnos sin duplicar códigos existentes (sintaxis MySQL 8.0.19+).
INSERT INTO `turnos` (`codigo_turno`, `nombre_turno`)
VALUES
    ('01', 'Mañana'),
    ('02', 'Tarde'),
    ('03', 'Noche')
    AS nuevos_turnos
ON DUPLICATE KEY UPDATE
    `nombre_turno` = nuevos_turnos.`nombre_turno`;

-- Oferta académica con asignación manual de docentes de TEC y TAL.
CREATE TABLE IF NOT EXISTS `oferta_academica` (
    `id_oferta` INT NOT NULL AUTO_INCREMENT,
    `id_periodo` INT NOT NULL,
    `id_sede` INT NOT NULL,
    `id_curso` INT NOT NULL,
    `id_turno` INT NOT NULL,
    `grupo` VARCHAR(10) NOT NULL DEFAULT '01'
        COMMENT 'Grupo numérico secuencial como cadena: 01, 02, 03...',
    `id_docente_tec` INT NULL DEFAULT NULL,
    `id_docente_tal` INT NULL DEFAULT NULL,
    `estado` CHAR(1) NOT NULL DEFAULT 'A',
    PRIMARY KEY (`id_oferta`),
    UNIQUE KEY `uq_oferta_seccion`
        (`id_periodo`, `id_sede`, `id_curso`, `id_turno`, `grupo`),
    KEY `idx_oferta_sede` (`id_sede`),
    KEY `idx_oferta_curso` (`id_curso`),
    KEY `idx_oferta_turno` (`id_turno`),
    KEY `idx_oferta_docente_tec` (`id_docente_tec`),
    KEY `idx_oferta_docente_tal` (`id_docente_tal`),
    CONSTRAINT `fk_oferta_periodo`
        FOREIGN KEY (`id_periodo`) REFERENCES `periodos` (`id_periodo`)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_oferta_sede`
        FOREIGN KEY (`id_sede`) REFERENCES `sedes` (`id_sede`)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_oferta_curso`
        FOREIGN KEY (`id_curso`) REFERENCES `cursos` (`id_curso`)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_oferta_turno`
        FOREIGN KEY (`id_turno`) REFERENCES `turnos` (`id_turno`)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_oferta_docente_tec`
        FOREIGN KEY (`id_docente_tec`) REFERENCES `docentes` (`id_docente`)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `fk_oferta_docente_tal`
        FOREIGN KEY (`id_docente_tal`) REFERENCES `docentes` (`id_docente`)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `chk_oferta_grupo_numerico`
        CHECK (`grupo` REGEXP '^[0-9]{2,10}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
