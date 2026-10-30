import React, { useEffect, useState } from 'react';
import Modal, { BotonCerrar } from './Modal';
import { DIAS } from '../../../config/app';

// Solo lectura: muestra las clases del docente que programa el Equipo 4.
export default function HorarioDocenteModal({ docente, cargarClases, onClose }) {
  const [clases, setClases] = useState(null);

  useEffect(() => {
    let vivo = true;
    cargarClases(docente.id).then((c) => vivo && setClases(c)).catch(() => vivo && setClases([]));
    return () => { vivo = false; };
  }, [docente.id]);

  return (
    <Modal ancho={850} onClose={onClose}>
      <div className="modal-header">
        <div>
          <h3><i className="fas fa-calendar-week text-senati" style={{ marginRight: 8 }}></i> Horario Visual Semanal</h3>
          <p className="text-muted" style={{ fontSize: 13, marginTop: 4 }}>
            Instructor: <strong style={{ color: 'var(--text-dark)' }}>{docente.nombre}</strong>
          </p>
        </div>
        <BotonCerrar onClose={onClose} />
      </div>
      <div className="modal-body" style={{ maxHeight: 500, overflowY: 'auto' }}>
        {clases === null ? (
          <p className="tabla-vacia"><i className="fas fa-spinner fa-spin"></i> Cargando clases...</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
            {DIAS.map((d) => {
              const delDia = clases.filter((c) => c.dia === d.n).sort((a, b) => a.inicio.localeCompare(b.inicio));
              return (
                <div key={d.n} style={{ background: 'var(--bg-main)', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                  <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-dark)', marginBottom: 8, borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>{d.nombre}</h4>
                  {delDia.length === 0 ? (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Sin clases asignadas</span>
                  ) : (
                    delDia.map((c) => (
                      <div key={c.id} style={{ background: 'white', borderLeft: '3px solid var(--senati-blue)', borderRadius: 4, padding: 6, marginBottom: 6, fontSize: 11, boxShadow: 'var(--shadow-sm)' }}>
                        <strong style={{ display: 'block', color: 'var(--text-dark)' }}>{c.curso}</strong>
                        {c.ambiente && <span style={{ color: 'var(--text-muted)' }}><i className="far fa-building"></i> {c.ambiente}</span>}
                        <br />
                        <span style={{ color: 'var(--senati-blue)', fontWeight: 600 }}><i className="far fa-clock"></i> {c.inicio} - {c.fin}</span>
                      </div>
                    ))
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="modal-footer">
        <button className="btn btn-primary" onClick={onClose}>Cerrar Vista</button>
      </div>
    </Modal>
  );
}
