-- Ejecutar una sola vez en la base de datos configurada para el proyecto.
-- Las cuentas deben cargarse con una contraseña cifrada con bcrypt (no texto plano).
CREATE TABLE IF NOT EXISTS usuarios (
    id_usuario INT UNSIGNED NOT NULL AUTO_INCREMENT,
    dni VARCHAR(20) NOT NULL,
    correo_institucional VARCHAR(150) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    nombres VARCHAR(100) NOT NULL,
    apellidos VARCHAR(100) NOT NULL,
    rol VARCHAR(40) NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',
    ultimo_acceso TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (id_usuario),
    UNIQUE KEY uq_usuarios_dni (dni),
    UNIQUE KEY uq_usuarios_correo (correo_institucional)
);
