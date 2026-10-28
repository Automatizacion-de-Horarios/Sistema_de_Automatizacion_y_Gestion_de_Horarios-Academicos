const db = require('../config/db'); 

const Feriado = { 
  async obtenerTodos() { 
    const [filas] = await db.query('SELECT * FROM feriados'); 
    return filas; 
  }, 
 
  async obtenerPorId(id) { 
    const [filas] = await db.query('SELECT * FROM feriados WHERE id_feriado = ?', [id]); 
    return filas[0]; 
  }, 
 
  async crear({ fecha, descripcion, estado }) { 
    const [resultado] = await db.query( 
      'INSERT INTO feriados (fecha, descripcion, estado) VALUES (?, ?, ?)', 
      [fecha, descripcion, estado] 
    ); 
    return { id_feriado: resultado.insertId, fecha, descripcion, estado }; 
  }, 
 
  async actualizar(id, { fecha, descripcion, estado }) { 
    const [resultado] = await db.query( 
      'UPDATE feriados SET fecha = ?, descripcion = ?, estado = ? WHERE id_feriado = ?', 
      [fecha, descripcion, estado, id] 
    ); 
    return resultado.affectedRows; 
  }, 
 
  async eliminar(id) { 
    const [resultado] = await db.query('DELETE FROM feriados WHERE id_feriado = ?', [id]); 
    return resultado.affectedRows; 
  } 
}; 

module.exports = Feriado;