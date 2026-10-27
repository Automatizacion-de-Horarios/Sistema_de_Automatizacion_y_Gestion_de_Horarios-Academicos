// frontend/src/modules/docentes/components/HorarioVisualModal.jsx
import React, { useState, useEffect } from 'react';
import { docentesApi } from '../services/docentesApi';

export default function HorarioVisualModal({ docente, onClose, onToast }) {
    const [clases, setClases] = useState([]);
    const [cargando, setCargando] = useState(true);

    useEffect(() => {
        async function cargar() {
            try {
                const res = await docentesApi.obtenerClases(docente.id_docente);
                setClases(res.data || []);
            } catch (err) {
                onToast('Error al consultar clases', 'error');
            } finally {
                setCargando(false);
            }
        }
        cargar();
    }, [docente]);

    return (
        <div>
            <p style={{ color: '#475569', marginBottom: '20px' }}>
                Horario de clases para <strong>{docente.nombre_completo}</strong>:
            </p>

            {cargando ? (
                <p>Cargando clases...</p>
            ) : clases.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', background: '#F8FAFC', borderRadius: '12px', border: '1px solid #D5E3E0', color: '#64748B' }}>
                    <i className="fa-solid fa-calendar-xmark" style={{ fontSize: '32px', color: '#0F766E', marginBottom: '12px' }}></i>
                    <p style={{ margin: 0, fontWeight: '600' }}>Este docente aún no tiene clases asignadas</p>
                    <p style={{ margin: '4px 0 0 0', fontSize: '12px' }}>(Lo reemplazará la tabla de horarios del Equipo 4).</p>
                </div>
            ) : (
                <div>Lista de clases...</div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
                <button className="doc-btn doc-btn-primary" onClick={onClose}>Cerrar</button>
            </div>
        </div>
    );
}