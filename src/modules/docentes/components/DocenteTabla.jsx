// frontend/src/modules/docentes/components/DocenteTabla.jsx
import React from 'react';

export default function DocenteTabla({ docentes, onAbrirModal, onCambiarEstado }) {
    if (!docentes || docentes.length === 0) {
        return <div style={{ textAlign: 'center', padding: '30px', color: '#64748B' }}>No hay docentes con esos filtros</div>;
    }

    const estadoLabels = { A: 'Activo', I: 'Inactivo', V: 'Vacaciones' };

    return (
        <div className="doc-table-responsive">
            <table className="doc-table">
                <thead>
                    <tr>
                        <th>INSTRUCTOR</th>
                        <th>ESPECIALIDAD / COMPETENCIAS</th>
                        <th>DISPONIBILIDAD</th>
                        <th>ESTADO OPERATIVO</th>
                        <th>AUDITORÍA</th>
                        <th>ACCIONES</th>
                    </tr>
                </thead>
                <tbody>
                    {docentes.map(doc => {
                        const iniciales = doc.nombre_completo.split(',')[0].substring(0, 2).toUpperCase();
                        return (
                            <tr key={doc.id_docente}>
                                <td>
                                    <div className="doc-instructor-info">
                                        <div className="doc-avatar">{iniciales}</div>
                                        <div>
                                            <span className="doc-nombre">{doc.nombre_completo}</span>
                                            <span className="doc-codigo">ID: {doc.codigo_instructor}</span>
                                        </div>
                                    </div>
                                </td>
                                <td>
                                    <div style={{ fontWeight: '600', marginBottom: '4px' }}>{doc.especialidad}</div>
                                    <div>
                                        {doc.bloques && doc.bloques.map((b, idx) => (
                                            <span key={idx} className="doc-badge-bloque">
                                                {b.carrera_sigla} · S{b.semestre} · G{b.grupo}
                                            </span>
                                        ))}
                                    </div>
                                    <div style={{ fontSize: '12px', color: '#0F766E', marginTop: '4px', fontWeight: '600' }}>
                                        {doc.total_competencias} asignadas
                                    </div>
                                </td>
                                <td>
                                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                        <button className="doc-btn doc-btn-secondary" style={{ padding: '4px 10px', fontSize: '11px' }} onClick={() => onAbrirModal(doc, 'rango')}>
                                            Rango (Foto)
                                        </button>
                                        <button className="doc-btn doc-btn-primary" style={{ padding: '4px 10px', fontSize: '11px' }} onClick={() => onAbrirModal(doc, 'cuadricula')}>
                                            Cuadrícula ({doc.horas_disponibles}h)
                                        </button>
                                        <button className="doc-btn doc-btn-accent" style={{ padding: '4px 10px', fontSize: '11px' }} onClick={() => onAbrirModal(doc, 'clases')}>
                                            Clases
                                        </button>
                                    </div>
                                </td>
                                <td>
                                    <button
                                        className={`doc-badge-estado doc-estado-${doc.estado}`}
                                        onClick={() => onCambiarEstado(doc)}
                                        title="Hacer clic para cambiar estado"
                                    >
                                        <i className="fa-solid fa-circle" style={{ fontSize: '8px' }}></i>
                                        {estadoLabels[doc.estado]}
                                    </button>
                                </td>
                                <td style={{ fontSize: '12px', color: '#64748B' }}>
                                    <div style={{ fontWeight: '600', color: '#334155' }}>{doc.usuario_modificacion}</div>
                                    <div>{new Date(doc.fecha_modificacion).toLocaleString()}</div>
                                </td>
                                <td>
                                    <button className="doc-btn-gear" onClick={() => onAbrirModal(doc, 'centro')} aria-label="Centro de control">
                                        <i className="fa-solid fa-gear"></i>
                                    </button>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}