const db = require('../config/db'); 

const Ambiente = { 
  async obtenerTodos() { 
    const [filas] = await db.query('SELECT * FROM ambientes'); 
    return filas; 
  }, 
 
  async obtenerPorId(id) { 
    const [filas] = await db.query('SELECT * FROM ambientes WHERE id = ?', [id]); 
    return filas[0]; 
  }, 

  async obtenerCursos() {
    const [filas] = await db.query(
      'SELECT id_curso, mat_cur, nombre_curso FROM cursos ORDER BY mat_cur, nombre_curso'
    );
    return filas;
  },

  async obtenerIdPeriodo(codigoPeriodo) {
    const [filas] = await db.query(
      'SELECT id_periodo FROM periodos WHERE codigo_periodo = ?',
      [codigoPeriodo]
    );
    return filas[0]?.id_periodo ?? null;
  },

  async obtenerCursosPermitidos(idAmbiente, idPeriodo) {
    const [filas] = await db.query(
      'SELECT id_curso FROM ambiente_cursos_permitidos WHERE id_ambiente = ? AND id_periodo = ? ORDER BY id_curso',
      [idAmbiente, idPeriodo]
    );
    return filas.map((fila) => Number(fila.id_curso));
  },

  async reemplazarCursosPermitidos(idAmbiente, idPeriodo, idsCursos) {
    const conexion = await db.getConnection();

    try {
      await conexion.beginTransaction();
      await conexion.query(
        'DELETE FROM ambiente_cursos_permitidos WHERE id_ambiente = ? AND id_periodo = ?',
        [idAmbiente, idPeriodo]
      );

      if (idsCursos.length > 0) {
        const parametros = idsCursos.flatMap((idCurso) => [idPeriodo, idAmbiente, idCurso]);
        await conexion.query(
          `INSERT INTO ambiente_cursos_permitidos (id_periodo, id_ambiente, id_curso) VALUES ${idsCursos.map(() => '(?, ?, ?)').join(', ')}`,
          parametros
        );
      }

      await conexion.commit();
    } catch (error) {
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }
  },

  async actualizarCursoPermitido(idAmbiente, codigoPeriodo, idCurso, permitido) {
    let resultado;
    if (permitido) {
      [resultado] = await db.query(
        `INSERT INTO ambiente_cursos_permitidos (id_periodo, id_ambiente, id_curso)
         SELECT id_periodo, ?, ?
         FROM periodos
         WHERE codigo_periodo = ?
         ON DUPLICATE KEY UPDATE id_curso = VALUES(id_curso)`,
        [idAmbiente, idCurso, codigoPeriodo]
      );
    } else {
      [resultado] = await db.query(
        `DELETE FROM ambiente_cursos_permitidos
         WHERE id_periodo = (
           SELECT id_periodo FROM periodos WHERE codigo_periodo = ?
         ) AND id_ambiente = ? AND id_curso = ?`,
        [codigoPeriodo, idAmbiente, idCurso]
      );
    }

    if (resultado.affectedRows > 0) return true;

    const [filas] = await db.query(
      `SELECT EXISTS (
         SELECT 1
         FROM periodos p
         INNER JOIN ambientes a ON a.id = ?
         INNER JOIN cursos c ON c.id_curso = ?
         WHERE p.codigo_periodo = ?
       ) AS referencias_validas`,
      [idAmbiente, idCurso, codigoPeriodo]
    );
    return Boolean(filas[0]?.referencias_validas);
  },

  async actualizarCursosPermitidosEnLote(idAmbiente, idPeriodo, cambios) {
    const conexion = await db.getConnection();

    try {
      await conexion.beginTransaction();

      const cursosPermitidos = cambios
        .filter((cambio) => cambio.permitido)
        .map((cambio) => Number(cambio.id_curso));
      const cursosNoPermitidos = cambios
        .filter((cambio) => !cambio.permitido)
        .map((cambio) => Number(cambio.id_curso));

      if (cursosPermitidos.length > 0) {
        const valores = cursosPermitidos.map(() => '(?, ?, ?)').join(', ');
        const parametros = cursosPermitidos.flatMap((idCurso) => [idPeriodo, idAmbiente, idCurso]);
        await conexion.query(
          `INSERT INTO ambiente_cursos_permitidos (id_periodo, id_ambiente, id_curso)
           VALUES ${valores}
           ON DUPLICATE KEY UPDATE id_curso = VALUES(id_curso)`,
          parametros
        );
      }

      if (cursosNoPermitidos.length > 0) {
        const marcadores = cursosNoPermitidos.map(() => '?').join(', ');
        await conexion.query(
          `DELETE FROM ambiente_cursos_permitidos
           WHERE id_periodo = ? AND id_ambiente = ? AND id_curso IN (${marcadores})`,
          [idPeriodo, idAmbiente, ...cursosNoPermitidos]
        );
      }

      await conexion.commit();
    } catch (error) {
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }
  },
 
  async crear({ codigo_ambiente, id_tipo_ambiente, aforo_maximo, piso_ubicacion, estado = 'DISPONIBLE', pabellon }) { 
    const [resultado] = await db.query( 
      'INSERT INTO ambientes (codigo_ambiente, id_tipo_ambiente, aforo_maximo, piso_ubicacion, estado, pabellon) VALUES (?, ?, ?, ?, ?, ?)', 
      [codigo_ambiente, id_tipo_ambiente, aforo_maximo, piso_ubicacion, estado, pabellon] 
    ); 
    return { id: resultado.insertId, codigo_ambiente, id_tipo_ambiente, aforo_maximo, piso_ubicacion, estado, pabellon }; 
  }, 
 
  async actualizar(id, { codigo_ambiente, id_tipo_ambiente, aforo_maximo, piso_ubicacion, estado, pabellon }) { 
    const [resultado] = await db.query( 
      'UPDATE ambientes SET codigo_ambiente = ?, id_tipo_ambiente = ?, aforo_maximo = ?, piso_ubicacion = ?, estado = ?, pabellon = ? WHERE id = ?', 
      [codigo_ambiente, id_tipo_ambiente, aforo_maximo, piso_ubicacion, estado, pabellon, id] 
    ); 
    return resultado.affectedRows; 
  }, 
 
  async eliminar(id) { 
    const [resultado] = await db.query('DELETE FROM ambientes WHERE id = ?', [id]); 
    return resultado.affectedRows; 
  } 
}; 

module.exports = Ambiente;