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