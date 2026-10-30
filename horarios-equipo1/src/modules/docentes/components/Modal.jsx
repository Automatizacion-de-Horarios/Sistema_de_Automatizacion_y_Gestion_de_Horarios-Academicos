import React, { useEffect } from 'react';

// Contenedor base de todos los modales (usa las clases .modal y .modal-content de la referencia).
export default function Modal({ ancho = 450, onClose, cerrarAlFondo = true, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal"
      style={{ display: 'flex' }}
      onMouseDown={(e) => {
        if (cerrarAlFondo && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-content" style={{ width: ancho, maxWidth: '95vw' }}>
        {children}
      </div>
    </div>
  );
}

export function BotonCerrar({ onClose }) {
  return (
    <button className="close-btn" onClick={onClose} aria-label="Cerrar">
      <i className="fas fa-times"></i>
    </button>
  );
}
