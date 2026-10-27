// frontend/src/modules/docentes/components/AuditoriaModal.jsx
import React, { useState, useEffect } from 'react';
import { docentesApi } from '../services/docentesApi';

export default function AuditoriaModal({ docente, onClose, onToast }) {
    const [auditoria, setAuditoria] = useState(null);
    const [cargando, setCargando] = useState(true);

    useEffect(() => {
        async function cargar() {
            try {
                const res = await docentesApi.obtenerAuditoria(docente.id_docente);
                setAuditoria(res.data);
            } catch (err) {
                onToast('Error al cargar auditoría', 'error');
            } finally {
                setCargando(false);
            }
        }
        cargar();
    }, [docente]);

    return (
        <div>
            {cargando ? (
                <p>Cargando auditoría...</p>
            ) : auditoria ? (
                <div style={{ background: '#F8FAFC', padding: '20px', borderRadius: '12px', border: '1px solid #D5E3E0' }}>
                    <p style={{ margin: '0 0 12px 0' }}>
                        <strong>Instructor:</strong> {docente.nombre_completo} (ID: {docente.codigo_instructor})
                    </p>
                    <p style={{ margin: '0 0 12px 0' }}>
                        <strong>Último usuario responsable:</strong> <span style={{ color: '#0F766E', fontWeight: '700' }}>{auditoria.usuario_modificacion}</span>
                    </p>
                    <p style={{ margin: 0 }}>
                        <strong>Fecha y hora de última modificación:</strong> {new Date(auditoria.fecha_modificacion).toLocaleString()}
                    </p>
                </div>
            ) : (
                <p>No hay registros de auditoría disponibles.</p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
                <button className="doc-btn doc-btn-primary" onClick={onClose}>Cerrar</button>
            </div>
        </div>
    );
}