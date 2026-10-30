import React, { useState } from 'react';
import Modal, { BotonCerrar } from './Modal';
import { ESTADOS } from '../../../config/app';

export default function EstadoModal({ docente, onGuardar, onClose }) {
  const [estado, setEstado] = useState(docente.estado);
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    setGuardando(true);
    try { await onGuardar(docente.id, estado); } finally { setGuardando(false); }
  };

  return (
    <Modal ancho={450} onClose={onClose}>
      <div className="modal-header">
        <h3>Cambiar Estado Operativo</h3>
        <BotonCerrar onClose={onClose} />
      </div>
      <div className="modal-body">
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
          Registro: <strong style={{ color: 'var(--text-dark)' }}>{docente.nombre}</strong>
        </p>
        <div className="form-group">
          <label>Nuevo Estado</label>
          <select className="input-lg" value={estado} onChange={(e) => setEstado(e.target.value)}>
            {Object.entries(ESTADOS).map(([clave, e]) => (
              <option key={clave} value={clave}>{e.texto} - {e.detalle}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={guardar} disabled={guardando}>
          <i className="fas fa-save"></i> {guardando ? 'Guardando...' : 'Guardar Estado'}
        </button>
      </div>
    </Modal>
  );
}
