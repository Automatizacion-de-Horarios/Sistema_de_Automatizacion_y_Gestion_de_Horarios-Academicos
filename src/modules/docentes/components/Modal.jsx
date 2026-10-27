// frontend/src/modules/docentes/components/Modal.jsx
import React, { useEffect } from 'react';

export default function Modal({ titulo, children, onClose }) {
    useEffect(() => {
        function handleKeyDown(e) {
            if (e.key === 'Escape') {
                onClose();
            }
        }
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    return (
        <div className="doc-modal-overlay" onClick={onClose}>
            <div className="doc-modal-container" onClick={(e) => e.stopPropagation()}>
                <div className="doc-modal-header">
                    <h3 className="doc-modal-title">{titulo}</h3>
                    <button className="doc-modal-close" onClick={onClose} aria-label="Cerrar modal">
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div className="doc-modal-body">
                    {children}
                </div>
            </div>
        </div>
    );
}