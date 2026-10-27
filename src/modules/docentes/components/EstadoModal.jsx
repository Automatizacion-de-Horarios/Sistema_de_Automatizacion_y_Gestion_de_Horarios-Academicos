// frontend/src/modules/docentes/components/EstadoModal.jsx
import React, { useState } from 'react';
import { docentesApi } from '../services/docentesApi';

export default function EstadoModal({ docente, onClose, onToast }) {
    const [estado, setEstado] = useState(docente.estado);
    const [guardando, setGuardando] = useState(false);

    async function handleGuardar() {
        setGuardando(true);
        try {
            await docentesApi.actualizarEstado(docente.id_docente, estado);
            onToast('Estado operativo actualizado exitosamente');
            onClose();
        } catch (err) {
            onToast(err.message, 'error');
        } finally {
            setGuardando(false);
        }
    }

    return (
        <div>
            <p style={{ color: '#475569', marginBottom: '20px' }}>
                Selecciona el nuevo estado operativo para <strong>{docente.nombre_completo}</strong>:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', borderRadius: '12px', border: '1px solid #D5E3E0', cursor: 'pointer', background: estado === 'A' ? '#E6F4F1' : '#FFFFFF' }}>
                    <input type="radio" name="estado" value="A" checked={estado === 'A'} onChange={() => setEstado('A')} style={{ accentColor: '#0F766E' }} />
                    <div>
                        <strong style={{ color: '#166534' }}>Activo (A)</strong>
                        <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748B' }}>Disponible para asignaciones y dictado regular.</p>
                    </div>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', borderRadius: '12px', border: '1px solid #D5E3E0', cursor: 'pointer', background: estado === 'I' ? '#F1F5F9' : '#FFFFFF' }}>
                    <input type="radio" name="estado" value="I" checked={estado === 'I'} onChange={() => setEstado('I')} style={{ accentColor: '#0F766E' }} />
                    <div>
                        <strong style={{ color: '#475569' }}>Inactivo (I)</strong>
                        <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748B' }}>Temporalmente desvinculado de la programación horaria.</p>
                    </div>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', borderRadius: '12px', border: '1px solid #D5E3E0', cursor: 'pointer', background: estado === 'V' ? '#F3E8FF' : '#FFFFFF' }}>
                    <input type="radio" name="estado" value="V" checked={estado === 'V'} onChange={() => setEstado('V')} style={{ accentColor: '#0F766E' }} />
                    <div>
                        <strong style={{ color: '#6B21A8' }}>Vacaciones (V)</strong>
                        <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748B' }}>En período de licencia o vacaciones reglamentarias.</p>
                    </div>
                </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button className="doc-btn doc-btn-secondary" onClick={onClose}>Cancelar</button>
                <button className="doc-btn doc-btn-primary" onClick={handleGuardar} disabled={guardando}>
                    {guardando ? 'Guardando...' : 'Cambiar Estado'}
                </button>
            </div>
        </div>
    );
}