import React, { useState } from 'react';
import Modal, { BotonCerrar } from './Modal';
import { ESTADOS } from '../../../config/app';

export default function CentroControlModal({ docente, onAccion, onEditar, onClose }) {
  const [verAuditoria, setVerAuditoria] = useState(false);
  const est = ESTADOS[docente.estado] || ESTADOS.A;

  return (
    <Modal ancho={550} onClose={onClose}>
      <div className="modal-header">
        <div>
          <h3><i className="fas fa-cog text-senati" style={{ marginRight: 8 }}></i> {docente.nombre}</h3>
          <p className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>Gestión integral (Instructor)</p>
        </div>
        <BotonCerrar onClose={onClose} />
      </div>
      <div className="modal-body">
        <div className="action-grid-options">
          <button className="btn btn-secondary action-card-btn" onClick={() => onAccion('competencias')}>
            <i className="fas fa-book-reader text-senati" style={{ fontSize: 20 }}></i>
            <span>Asignar Competencias / Materias</span>
          </button>
          <button className="btn btn-secondary action-card-btn" onClick={() => onAccion('cuadricula')}>
            <i className="fas fa-calendar-alt text-senati" style={{ fontSize: 20 }}></i>
            <span>Ver Horario Visual / Cuadrícula</span>
          </button>
          <button className="btn btn-secondary action-card-btn" onClick={() => onAccion('estado')}>
            <i className="fas fa-toggle-on text-senati" style={{ fontSize: 20 }}></i>
            <span>Cambiar Estado (A / I / V)</span>
          </button>
          <button className="btn btn-secondary action-card-btn" onClick={() => setVerAuditoria(!verAuditoria)}>
            <i className="fas fa-history text-senati" style={{ fontSize: 20 }}></i>
            <span>Ver Ficha de Auditoría</span>
          </button>
          <button className="btn btn-secondary action-card-btn" onClick={onEditar}>
            <i className="fas fa-user-edit text-senati" style={{ fontSize: 20 }}></i>
            <span>Editar Datos del Instructor</span>
          </button>
        </div>
        {verAuditoria && (
          <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div style={{ background: 'var(--bg-main)', padding: 12, borderRadius: 8, fontSize: 12 }}>
              <strong style={{ color: 'var(--text-dark)', display: 'block', marginBottom: 6 }}>
                <i className="fas fa-history text-senati"></i> Ficha de Trazabilidad Auditoría
              </strong>
              <span><strong>Modificado por:</strong> {docente.usuarioModificacion}</span><br />
              <span><strong>Último Timestamp:</strong> {docente.fechaModificacion}</span><br />
              <span><strong>Estado Operativo:</strong> {est.texto}</span>
            </div>
          </div>
        )}
      </div>
      <div className="modal-footer">
        <button className="btn btn-primary" onClick={onClose}>Cerrar</button>
      </div>
    </Modal>
  );
}
