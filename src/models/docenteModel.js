// src/models/docenteModel.js
const pool = require('../config/db');

async function listar(filtros) {
    let query = `
        SELECT d.id_docente, d.codigo_instructor, d.nombre_completo,
               d.especialidad, d.estado, d.fecha_modificacion, d.usuario_modificacion,
               COALESCE(
                   (SELECT SUM(EXTRACT(EPOCH FROM (hora_fin - hora_inicio))/3600) 
                    FROM disponibilidad_docentes WHERE docente_id = d.id_docente), 0
               ) AS horas_disponibles,
               COALESCE(
                   (SELECT COUNT(*) FROM competencias_docentes WHERE docente_id = d.id_docente), 0
               ) AS total_competencias
        FROM docentes d
        WHERE 1=1
    `;
    const params = [];
    let idx = 1;

    if (filtros.q) {
        query += ` AND (d.nombre_completo ILIKE $${idx} OR d.codigo_instructor ILIKE $${idx})`;
        params.push(`%${filtros.q}%`);
        idx++;
    }
    if (filtros.estado) {
        query += ` AND d.estado = $${idx}`;
        params.push(filtros.estado);
        idx++;
    }
    if (filtros.carrera) {
        query += ` AND EXISTS (SELECT 1 FROM docentes_bloques db WHERE db.docente_id = d.id_docente AND db.carrera_sigla = $${idx})`;
        params.push(filtros.carrera);
        idx++;
    }

    query += ` ORDER BY d.nombre_completo ASC`;
    const res = await pool.query(query, params);
    
    const docentes = res.rows;
    for (let doc of docentes) {
        const bloquesRes = await pool.query(`
            SELECT db.carrera_sigla, sc.nombre AS carrera_nombre, db.semestre, db.grupo
            FROM docentes_bloques db
            JOIN siglas_carreras sc ON sc.sigla = db.carrera_sigla
            WHERE db.docente_id = $1
        `, [doc.id_docente]);
        doc.bloques = bloquesRes.rows;
        doc.horas_disponibles = parseFloat(doc.horas_disponibles);
        doc.total_competencias = parseInt(doc.total_competencias, 10);
    }
    return docentes;
}

async function obtenerCatalogoCursos() {
    const res = await pool.query(`SELECT id_curso, nombre_curso, estado FROM cursos ORDER BY nombre_curso ASC`);
    return res.rows;
}

async function obtenerAptos(curso_id, dia_semana, hora_inicio, hora_fin) {
    let query = `
        SELECT DISTINCT d.id_docente, d.codigo_instructor, d.nombre_completo, d.especialidad
        FROM docentes d
        JOIN competencias_docentes cd ON cd.docente_id = d.id_docente
        WHERE d.estado = 'A' AND cd.curso_id = $1
    `;
    const params = [curso_id];
    let idx = 2;

    if (dia_semana && hora_inicio && hora_fin) {
        query += ` AND EXISTS (
            SELECT 1 FROM disponibilidad_docentes disp
            WHERE disp.docente_id = d.id_docente
              AND disp.dia_semana = $${idx}
              AND disp.hora_inicio <= $${idx+1}::time
              AND disp.hora_fin >= $${idx+2}::time
        )`;
        params.push(dia_semana, hora_inicio, hora_fin);
    }

    const res = await pool.query(query, params);
    return res.rows;
}

async function obtenerPorId(id) {
    const res = await pool.query(`SELECT * FROM docentes WHERE id_docente = $1`, [id]);
    if (res.rows.length === 0) return null;
    const doc = res.rows[0];

    const bloquesRes = await pool.query(`
        SELECT db.carrera_sigla, sc.nombre AS carrera_nombre, db.semestre, db.grupo
        FROM docentes_bloques db
        JOIN siglas_carreras sc ON sc.sigla = db.carrera_sigla
        WHERE db.docente_id = $1
    `, [doc.id_docente]);
    doc.bloques = bloquesRes.rows;

    const compRes = await pool.query(`SELECT curso_id FROM competencias_docentes WHERE docente_id = $1`, [doc.id_docente]);
    doc.competencias = compRes.rows.map(r => r.curso_id);

    return doc;
}

async function crear(data, usuario) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const insertDoc = `
            INSERT INTO docentes (codigo_instructor, nombre_completo, especialidad, estado, usuario_modificacion)
            VALUES ($1, $2, $3, 'A', $4)
            RETURNING *
        `;
        const resDoc = await client.query(insertDoc, [
            data.codigo_instructor,
            data.nombre_completo,
            data.especialidad || 'General',
            usuario
        ]);
        const nuevoDocente = resDoc.rows[0];

        const insertDisp = `
            INSERT INTO disponibilidad_docentes (docente_id, dia_semana, hora_inicio, hora_fin, usuario_modificacion)
            VALUES ($1, $2, '08:00', '12:00', $3)
        `;
        for (let dia = 1; dia <= 5; dia++) {
            await client.query(insertDisp, [nuevoDocente.id_docente, dia, usuario]);
        }

        await client.query('COMMIT');
        return nuevoDocente;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

async function actualizar(id, data, usuario) {
    const query = `
        UPDATE docentes
        SET nombre_completo = COALESCE($1, nombre_completo),
            especialidad = COALESCE($2, especialidad),
            horas_semanales_contrato = COALESCE($3, horas_semanales_contrato),
            usuario_modificacion = $4
        WHERE id_docente = $5
        RETURNING *
    `;
    const res = await pool.query(query, [
        data.nombre_completo,
        data.especialidad,
        data.horas_semanales_contrato,
        usuario,
        id
    ]);
    return res.rows[0] || null;
}

async function actualizarEstado(id, estado, usuario) {
    const res = await pool.query(`
        UPDATE docentes
        SET estado = $1, usuario_modificacion = $2
        WHERE id_docente = $3
        RETURNING *
    `, [estado, usuario, id]);
    return res.rows[0] || null;
}

async function obtenerAuditoria(id) {
    const res = await pool.query(`
        SELECT usuario_modificacion, fecha_modificacion
        FROM docentes
        WHERE id_docente = $1
    `, [id]);
    return res.rows[0] || null;
}

async function obtenerDisponibilidad(id) {
    const res = await pool.query(`
        SELECT dia_semana, to_char(hora_inicio, 'HH24:MI') AS hora_inicio, to_char(hora_fin, 'HH24:MI') AS hora_fin
        FROM disponibilidad_docentes
        WHERE docente_id = $1
        ORDER BY dia_semana, hora_inicio
    `, [id]);
    return res.rows;
}

async function reemplazarDisponibilidad(id, franjas, usuario) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM disponibilidad_docentes WHERE docente_id = $1`, [id]);

        const insertQuery = `
            INSERT INTO disponibilidad_docentes (docente_id, dia_semana, hora_inicio, hora_fin, usuario_modificacion)
            VALUES ($1, $2, $3, $4, $5)
        `;
        for (let f of franjas) {
            await client.query(insertQuery, [id, f.dia_semana, f.hora_inicio, f.hora_fin, usuario]);
        }

        await client.query(`UPDATE docentes SET usuario_modificacion = $1 WHERE id_docente = $2`, [usuario, id]);
        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

async function obtenerCatalogoCarreras() {
    const res = await pool.query(`SELECT sigla, nombre FROM siglas_carreras ORDER BY sigla ASC`);
    return res.rows;
}

async function obtenerBloques(id) {
    const res = await pool.query(`
        SELECT carrera_sigla, semestre, grupo
        FROM docentes_bloques
        WHERE docente_id = $1
        ORDER BY carrera_sigla, semestre, grupo
    `, [id]);
    return res.rows;
}

async function reemplazarBloques(id, bloques, usuario) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM docentes_bloques WHERE docente_id = $1`, [id]);

        const insertQuery = `
            INSERT INTO docentes_bloques (docente_id, carrera_sigla, semestre, grupo, usuario_modificacion)
            VALUES ($1, $2, $3, $4, $5)
        `;
        for (let b of bloques) {
            await client.query(insertQuery, [id, b.carrera_sigla, b.semestre, b.grupo, usuario]);
        }

        await client.query(`UPDATE docentes SET usuario_modificacion = $1 WHERE id_docente = $2`, [usuario, id]);
        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

async function obtenerCompetencias(id) {
    const res = await pool.query(`
        SELECT c.id_curso, c.nombre_curso, c.estado
        FROM competencias_docentes cd
        JOIN cursos c ON c.id_curso = cd.curso_id
        WHERE cd.docente_id = $1
        ORDER BY c.nombre_curso ASC
    `, [id]);
    return res.rows;
}

async function reemplazarCompetencias(id, curso_ids, usuario) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM competencias_docentes WHERE docente_id = $1`, [id]);

        const insertQuery = `
            INSERT INTO competencias_docentes (docente_id, curso_id, usuario_modificacion)
            VALUES ($1, $2, $3)
        `;
        for (let curso_id of curso_ids) {
            await client.query(insertQuery, [id, curso_id, usuario]);
        }

        await client.query(`UPDATE docentes SET usuario_modificacion = $1 WHERE id_docente = $2`, [usuario, id]);
        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

module.exports = {
    listar,
    obtenerCatalogoCursos,
    obtenerAptos,
    obtenerPorId,
    crear,
    actualizar,
    actualizarEstado,
    obtenerAuditoria,
    obtenerDisponibilidad,
    reemplazarDisponibilidad,
    obtenerCatalogoCarreras,
    obtenerBloques,
    reemplazarBloques,
    obtenerCompetencias,
    reemplazarCompetencias
};