import React from 'react';
import Modal, { BotonCerrar } from './Modal';
import DocenteForm from './DocenteForm';

export default function EditarDocenteModal({ docente, onGuardar, onClose }) {
  return (
    <Modal ancho={900} onClose={onClose} cerrarAlFondo={false}>
      <div className="modal-header">
        <h3><i className="fas fa-user-edit text-senati" style={{ marginRight: 8 }}></i> Editar Instructor</h3>
        <BotonCerrar onClose={onClose} />
      </div>
      <div className="modal-body">
        <DocenteForm docente={docente} onGuardar={onGuardar} onCancelar={onClose} />
      </div>
    </Modal>
  );
}
