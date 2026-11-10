const db = require('../config/db');

const ORDEN_SEMESTRE = `
    FIELD(s.semestre, 'I','II','III','IV','V','VI','VII','VIII','IX','X')
`;

const ORDEN_DIA = `
    FIELD(
        UPPER(hg.dia_semana),
        'LUNES','MARTES','MIÉRCOLES','MIERCOLES','JUEVES',
        'VIERNES','SÁBADO','SABADO','DOMINGO'
    )
`;

const ORDEN_ACTIVIDAD = `
    FIELD(
        CASE WHEN hg.tipo_modalidad = 'VIR' THEN 'TEC'
             ELSE hg.tipo_modalidad END,
        'TEC','TAL','EMP'
    )
`;

const COLUMNAS = `
    hg.id_horario,
    hg.tipo_modalidad,
    hg.dia_semana,
    TIME_FORMAT(hg.hora_inicio, '%H:%i:%s') AS hora_inicio,
    TIME_FORMAT(hg.hora_fin, '%H:%i:%s') AS hora_fin,
    hg.semana_inicio,
    hg.semana_fin,
    hg.id_docente,
    hg.id_ambiente,
    hg.estado,
    p.codigo_periodo,
    p.cantidad_semanas,
    p.fecha_inicio,
    p.fecha_fin,
    pa.id_turno,
    pa.grupo,
    pa.id_sede,
    c.id_curso,
    c.mat_cur,
    c.nombre_curso,
    s.semestre,
    ca.id_carrera,
    ca.codigo_carrera,
    ca.nombre_carrera,
    ca.sector,
    sd.codigo_sede,
    sd.nombre_sede,
    sz.codigo_camp,
    sz.nombre_zonal,
    sz.ciudad,
    d.nombres AS docente_nombres,
    d.apellidos AS docente_apellidos,
    a.codigo_ambiente,
    a.pabellon
`;

const DESDE = `
    FROM horarios_generados hg
    INNER JOIN periodos p ON p.id_periodo = hg.id_periodo
    INNER JOIN programacion_academica pa
        ON pa.id_programacion = hg.id_programacion
    INNER JOIN cursos c ON c.id_curso = pa.id_curso
    INNER JOIN semestres s ON s.id_semestre = c.id_semestre
    INNER JOIN carreras ca ON ca.id_carrera = s.id_carrera
    LEFT JOIN sedes sd ON sd.id_sede = pa.id_sede
    LEFT JOIN sedes_zonales sz ON sz.id_zonal = sd.id_zonal
    LEFT JOIN docentes d ON d.id_docente = hg.id_docente
    LEFT JOIN ambientes a ON a.id = hg.id_ambiente
`;

async function obtenerPeriodo(codigoPeriodo) {
    const [filas] = await db.query(
        `SELECT id_periodo, codigo_periodo, descripcion, cantidad_semanas,
                fecha_inicio, fecha_fin
           FROM periodos
          WHERE codigo_periodo = ?
          LIMIT 1`,
        [codigoPeriodo]
    );
    return filas[0] ?? null;
}

async function listarFilasPeriodo(codigoPeriodo, idBorrador) {
    const [filas] = await db.query(
        `SELECT ${COLUMNAS}
         ${DESDE}
         WHERE p.codigo_periodo = ?
           AND hg.id_borrador = ?
           AND hg.estado IN ('BORRADOR', 'CONFIRMADO')
         ORDER BY
           COALESCE(sz.ciudad, sz.nombre_zonal, ''),
           ca.nombre_carrera,
           ${ORDEN_SEMESTRE},
           pa.id_turno,
           c.mat_cur,
           pa.grupo,
           ${ORDEN_ACTIVIDAD},
           hg.semana_inicio,
           ${ORDEN_DIA},
           hg.hora_inicio,
           hg.id_horario`,
        [codigoPeriodo, idBorrador]
    );
    return filas;
}

module.exports = {
    listarFilasPeriodo,
    obtenerPeriodo,
};
