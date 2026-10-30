-- Grupo 4 - Creación de Horarios

-- Fernando Vizcarra Vargas
-- Javier Maldonado Barbaran
-- Samuel Jarro Quenta
-- Frank Perez Gallegos

CREATE TABLE sedes_zonales (
    id_zonal INT AUTO_INCREMENT PRIMARY KEY,
    codigo_camp VARCHAR(10) NOT NULL UNIQUE,
    nombre_zonal VARCHAR(100) NOT NULL,
    ciudad VARCHAR(50) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sedes (
    id_sede INT AUTO_INCREMENT PRIMARY KEY,
    codigo_sede VARCHAR(20) NOT NULL UNIQUE,
    id_zonal INT NOT NULL,
    nombre_sede VARCHAR(150) NOT NULL,
    direccion_sede VARCHAR(255) NOT NULL,
    CONSTRAINT fk_sedes_zonal FOREIGN KEY (id_zonal) REFERENCES sedes_zonales(id_zonal) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE periodos (
    id_periodo INT AUTO_INCREMENT PRIMARY KEY,
    codigo_periodo VARCHAR(10) NOT NULL UNIQUE,
    descripcion VARCHAR(100) NOT NULL,
    estado ENUM('ACTIVO', 'CERRADO') DEFAULT 'ACTIVO'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sesiones_horario (
    id_sesion INT AUTO_INCREMENT PRIMARY KEY,

    id_zonal INT NOT NULL,
    id_sede INT NOT NULL,
    id_periodo INT NOT NULL,

    id_curso INT NULL,
    id_salon INT NULL,

    bloque VARCHAR(20) NOT NULL,
    mat_cur VARCHAR(20) NOT NULL,
    actividad VARCHAR(10) NOT NULL,
    tipo_reunion VARCHAR(10) NULL,
    edificio VARCHAR(20) NOT NULL,
    salon VARCHAR(20) NULL,

    hora_ini TIME NOT NULL,
    hora_fin TIME NOT NULL,
    domingo CHAR(1) DEFAULT '0',
    lunes CHAR(1) DEFAULT '0',
    martes CHAR(1) DEFAULT '0',
    miercoles CHAR(1) DEFAULT '0',
    jueves CHAR(1) DEFAULT '0',
    viernes CHAR(1) DEFAULT '0',
    sabado CHAR(1) DEFAULT '0',

    d_inicio DATE NOT NULL,
    d_fin DATE NOT NULL,

    instructor VARCHAR(150) NULL,
    ind_sesion INT NOT NULL DEFAULT 1,

    CONSTRAINT fk_sesion_zonal FOREIGN KEY (id_zonal) REFERENCES sedes_zonales(id_zonal) ON UPDATE CASCADE,
    CONSTRAINT fk_sesion_sede FOREIGN KEY (id_sede) REFERENCES sedes(id_sede) ON UPDATE CASCADE,
    CONSTRAINT fk_sesion_periodo FOREIGN KEY (id_periodo) REFERENCES periodos(id_periodo) ON UPDATE CASCADE,

    CONSTRAINT chk_horas_logica CHECK (hora_ini < hora_fin),
    CONSTRAINT chk_fechas_logica CHECK (d_inicio <= d_fin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_cruce_aula ON sesiones_horario (edificio, salon, hora_ini, hora_fin, d_inicio, d_fin);
CREATE INDEX idx_cruce_instructor ON sesiones_horario (instructor, hora_ini, hora_fin, d_inicio, d_fin);
CREATE INDEX idx_matriz_bloque ON sesiones_horario (bloque, d_inicio, d_fin);

INSERT INTO sedes_zonales (codigo_camp, nombre_zonal, ciudad) VALUES
('56P', 'Dirección Zonal Tacna - Moquegua', 'Tacna');

INSERT INTO sedes (codigo_sede, id_zonal, nombre_sede, direccion_sede) VALUES
('56P-TAC', 1, 'Sede Principal Tacna', 'Av. Miguel Grau Mz. A Lt. 1');

INSERT INTO periodos (codigo_periodo, descripcion, estado) VALUES
('202620', 'Semestre Académico 2026 - II', 'ACTIVO'),
('202610', 'Semestre Académico 2026 - I', 'CERRADO');