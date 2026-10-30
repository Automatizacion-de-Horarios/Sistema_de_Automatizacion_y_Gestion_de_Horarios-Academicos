-- GRUPO 1: estructura para docentes, disponibilidad y cursos por periodo.
-- Este cambio YA fue aplicado a la base actual: no ejecutarlo nuevamente allí.
-- Conservar este archivo para preparar una base nueva que no tenga estas columnas.

ALTER TABLE docentes
    ADD COLUMN dni VARCHAR(8) NULL UNIQUE,
    ADD COLUMN registrado_en_panel TINYINT NOT NULL DEFAULT 0,
    ADD COLUMN fecha_registro DATETIME NULL;

CREATE TABLE cursos_docentes (
    id_asignacion INT AUTO_INCREMENT PRIMARY KEY,
    id_docente INT NOT NULL,
    id_curso INT NOT NULL,
    id_periodo INT NOT NULL,
    estado CHAR(1) NOT NULL DEFAULT 'A',
    fecha_modificacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    usuario_modificacion VARCHAR(50) NOT NULL,

    UNIQUE (id_docente, id_curso, id_periodo),

    FOREIGN KEY (id_docente) REFERENCES docentes(id_docente),
    FOREIGN KEY (id_curso) REFERENCES cursos(id_curso),
    FOREIGN KEY (id_periodo) REFERENCES periodos(id_periodo),

    CHECK (estado IN ('A', 'I'))
);
