const db = require('../config/db'); 

const TipoAmbiente = { 
  async obtenerTodos() { 
    const [filas] = await db.query('SELECT * FROM tipo_ambiente'); 
    return filas; 
  }, 
 
  async obtenerPorId(id) { 
    const [filas] = await db.query('SELECT * FROM tipo_ambiente WHERE id_tipo_ambiente = ?', [id]); 
    return filas[0]; 
  }, 
 
  async crear({ nombre_tipo_ambiente, estado = 'ACTIVO' }) { 
    const [resultado] = await db.query( 
      'INSERT INTO tipo_ambiente (nombre_tipo_ambiente, estado) VALUES (?, ?)', 
      [nombre_tipo_ambiente, estado] 
    ); 
    return { id_tipo_ambiente: resultado.insertId, nombre_tipo_ambiente, estado }; 
  }, 
 
  async actualizar(id, { nombre_tipo_ambiente, estado }) { 
    const [resultado] = await db.query( 
      'UPDATE tipo_ambiente SET nombre_tipo_ambiente = ?, estado = ? WHERE id_tipo_ambiente = ?', 
      [nombre_tipo_ambiente, estado, id] 
    ); 
    return resultado.affectedRows; 
  }, 
 
  async eliminar(id) { 
    const [resultado] = await db.query('DELETE FROM tipo_ambiente WHERE id_tipo_ambiente = ?', [id]); 
    return resultado.affectedRows; 
  } 
}; 

module.exports = TipoAmbiente;