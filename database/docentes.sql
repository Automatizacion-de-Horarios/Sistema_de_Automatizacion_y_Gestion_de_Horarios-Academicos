

-- 1. Tabla docentes
CREATE TABLE IF NOT EXISTS docentes (
    id_docente SERIAL PRIMARY KEY,
    codigo_instructor CHAR(9) NOT NULL UNIQUE CHECK (codigo_instructor ~ '^[0-9]{9}$'),
    nombre_completo VARCHAR(150) NOT NULL,
    especialidad VARCHAR(100) NOT NULL DEFAULT 'General',
    horas_semanales_contrato INTEGER NOT NULL DEFAULT 0 CHECK (horas_semanales_contrato BETWEEN 0 AND 60),
    estado CHAR(1) NOT NULL DEFAULT 'A' CHECK (estado IN ('A','I','V')),
    fecha_modificacion TIMESTAMP NOT NULL DEFAULT NOW(),
    usuario_modificacion VARCHAR(50) NOT NULL DEFAULT 'sistema'
);

-- 2. Trigger para actualizar fecha_modificacion en docentes
CREATE OR REPLACE FUNCTION actualizar_fecha_modificacion_docentes()
RETURNS TRIGGER AS $$
BEGIN
    NEW.fecha_modificacion = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_actualizar_fecha_docentes ON docentes;
CREATE TRIGGER trg_actualizar_fecha_docentes
BEFORE UPDATE ON docentes
FOR EACH ROW
EXECUTE FUNCTION actualizar_fecha_modificacion_docentes();

-- 3. Tabla disponibilidad_docentes
CREATE TABLE IF NOT EXISTS disponibilidad_docentes (
    id_disponibilidad SERIAL PRIMARY KEY,
    docente_id INTEGER NOT NULL REFERENCES docentes(id_docente) ON DELETE CASCADE,
    dia_semana SMALLINT NOT NULL CHECK (dia_semana BETWEEN 1 AND 6),
    hora_inicio TIME NOT NULL,
    hora_fin TIME NOT NULL,
    fecha_modificacion TIMESTAMP NOT NULL DEFAULT NOW(),
    usuario_modificacion VARCHAR(50) NOT NULL DEFAULT 'sistema',
    CHECK (hora_fin > hora_inicio AND hora_inicio >= '07:00:00'::time AND hora_fin <= '21:00:00'::time)
);

CREATE INDEX IF NOT EXISTS idx_disponibilidad_docente_id ON disponibilidad_docentes(docente_id);

-- 4. Tabla siglas_carreras
CREATE TABLE IF NOT EXISTS siglas_carreras (
    sigla VARCHAR(4) PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL
);

-- 5. Tabla competencias_docentes
CREATE TABLE IF NOT EXISTS competencias_docentes (
    id_competencia SERIAL PRIMARY KEY,
    docente_id INTEGER NOT NULL REFERENCES docentes(id_docente) ON DELETE CASCADE,
    curso_id INTEGER NOT NULL,
    fecha_modificacion TIMESTAMP NOT NULL DEFAULT NOW(),
    usuario_modificacion VARCHAR(50) NOT NULL DEFAULT 'sistema',
    UNIQUE (docente_id, curso_id)
);

CREATE INDEX IF NOT EXISTS idx_competencias_docente_id ON competencias_docentes(docente_id);

-- 6. Tabla docentes_bloques
CREATE TABLE IF NOT EXISTS docentes_bloques (
    id_bloque SERIAL PRIMARY KEY,
    docente_id INTEGER NOT NULL REFERENCES docentes(id_docente) ON DELETE CASCADE,
    carrera_sigla VARCHAR(4) NOT NULL REFERENCES siglas_carreras(sigla),
    semestre SMALLINT NOT NULL CHECK (semestre BETWEEN 1 AND 6),
    grupo SMALLINT NOT NULL DEFAULT 1 CHECK (grupo IN (1,2)),
    fecha_modificacion TIMESTAMP NOT NULL DEFAULT NOW(),
    usuario_modificacion VARCHAR(50) NOT NULL DEFAULT 'sistema',
    UNIQUE (docente_id, carrera_sigla, semestre, grupo)
);

CREATE INDEX IF NOT EXISTS idx_docentes_bloques_docente_id ON docentes_bloques(docente_id);

-- database/00_stub_cursos_SOLO_PRUEBAS.sql
-- NO EJECUTAR en la base compartida si la tabla cursos ya existe

CREATE TABLE IF NOT EXISTS cursos (
    id_curso SERIAL PRIMARY KEY,
    nombre_curso VARCHAR(150) NOT NULL,
    estado CHAR(1) NOT NULL DEFAULT 'A' CHECK (estado IN ('A','I'))
);

INSERT INTO cursos (id_curso, nombre_curso, estado) VALUES
(1, 'Algoritmos y Estructura de Datos', 'A'),
(2, 'Base de Datos Relacionales', 'A'),
(3, 'Desarrollo Web Full Stack', 'A'),
(4, 'Arquitectura de Computadoras', 'A'),
(5, 'Redes y Comunicaciones', 'A'),
(6, 'Ingeniería de Software I', 'A'),
(7, 'Sistemas Operativos', 'A'),
(8, 'Inteligencia Artificial Aplicada', 'A'),
(9, 'Seguridad Informática', 'A'),
(10, 'Gestión de Proyectos de Software', 'A')
ON CONFLICT (id_curso) DO NOTHING;

-- Verificar cantidad de docentes (Esperado: 42)
SELECT COUNT(*) AS total_docentes FROM docentes;

-- Verificar cantidad de siglas de carreras (Esperado: 10)
SELECT COUNT(*) AS total_siglas FROM siglas_carreras;

-- Verificar cantidad de bloques asignados (Esperado: 34)
SELECT COUNT(*) AS total_bloques FROM docentes_bloques;

-- Verificar cantidad de franjas de disponibilidad iniciales (Esperado: 210 = 42 docentes x 5 días)
SELECT COUNT(*) AS total_franjas FROM disponibilidad_docentes;