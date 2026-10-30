import React, { useMemo, useState } from 'react';
import Modal, { BotonCerrar } from './Modal';

// Asignación de cursos/competencias al docente. Los cursos los administra el Equipo 3.
export default function CompetenciasModal({ docente, cursos, onGuardar, onClose }) {
  const [seleccion, setSeleccion] = useState(() => new Set(docente.cursosPermitidos));
  const [busqueda, setBusqueda] = useState('');
  const [ciclo, setCiclo] = useState('TODOS');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const ciclos = useMemo(
    () => [...new Set(cursos.map((c) => c.ciclo).filter((c) => c !== null && c !== undefined))].sort((a, b) => a - b),
    [cursos]
  );

  const visibles = useMemo(() => {
    const q = busqueda.toLowerCase().trim();
    return cursos.filter((c) => {
      if (ciclo === 'SELECCIONADOS' && !seleccion.has(c.id)) return false;
      if (ciclo !== 'TODOS' && ciclo !== 'SELECCIONADOS' && String(c.ciclo) !== String(ciclo)) return false;
      if (!q) return true;
      return c.nombre.toLowerCase().includes(q) || c.codigo.toLowerCase().includes(q) || `ciclo ${c.ciclo}`.includes(q);
    });
  }, [cursos, busqueda, ciclo, seleccion]);

  const alternar = (id) =>
    setSeleccion((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });

  const marcarVisibles = (marcar) =>
    setSeleccion((prev) => {
      const s = new Set(prev);
      visibles.forEach((c) => (marcar ? s.add(c.id) : s.delete(c.id)));
      return s;
    });

  const guardar = async () => {
    setGuardando(true);
    setError('');
    try {
      await onGuardar(docente.id, [...seleccion]);
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  };

  return (
    <Modal ancho={840} onClose={onClose} cerrarAlFondo={false}>
      <div className="modal-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="avatar" style={{ background: 'var(--senati-blue)' }}><i className="fas fa-chalkboard-teacher"></i></div>
          <div>
            <h3>Asignación de Asignaturas y Competencias</h3>
            <p className="text-muted" style={{ fontSize: 13, marginTop: 2 }}>
              <span className="badge badge-secondary" style={{ marginRight: 6 }}>Instructor / Docente</span>
              <strong style={{ color: 'var(--text-dark)' }}>{docente.nombre}</strong>
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="badge badge-success" style={{ fontSize: 12, padding: '6px 12px' }}>
            <i className="fas fa-check-circle"></i> {seleccion.size} asignadas
          </span>
          <BotonCerrar onClose={onClose} />
        </div>
      </div>

      <div className="modal-body">
        {cursos.length === 0 ? (
          <p className="tabla-vacia">Aún no hay cursos cargados. Los administra el Equipo 3 (tabla de cursos).</p>
        ) : (
          <>
            <div className="assign-courses-toolbar">
              <div className="search-box" style={{ marginBottom: 0, minWidth: 280, flex: 1 }}>
                <i className="fas fa-search"></i>
                <input type="text" placeholder="Filtrar por código, nombre o ciclo..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => marcarVisibles(true)}><i className="fas fa-check-double"></i> Marcar Visibles</button>
                <button className="btn btn-secondary btn-sm" onClick={() => marcarVisibles(false)}><i className="fas fa-times"></i> Desmarcar Visibles</button>
              </div>
            </div>

            <div className="assign-semester-tabs">
              <button className={`assign-tab-btn ${ciclo === 'TODOS' ? 'active' : ''}`} onClick={() => setCiclo('TODOS')}>Todos los Ciclos</button>
              {ciclos.map((c) => (
                <button key={c} className={`assign-tab-btn ${String(ciclo) === String(c) ? 'active' : ''}`} onClick={() => setCiclo(c)}>Ciclo {c}</button>
              ))}
              <button className={`assign-tab-btn ${ciclo === 'SELECCIONADOS' ? 'active' : ''}`} onClick={() => setCiclo('SELECCIONADOS')}>
                <i className="fas fa-check"></i> Solo Seleccionadas
              </button>
            </div>

            {error && <p className="form-error"><i className="fas fa-exclamation-circle"></i> {error}</p>}

            <div className="course-assign-grid">
              {visibles.length === 0 && (
                <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                  <i className="fas fa-search" style={{ fontSize: 28, marginBottom: 8, opacity: 0.5 }}></i>
                  <p>No se encontraron cursos con ese filtro.</p>
                </div>
              )}
              {visibles.map((c) => {
                const marcado = seleccion.has(c.id);
                return (
                  <div key={c.id} className={`course-assign-card ${marcado ? 'selected' : ''}`} onClick={() => alternar(c.id)}>
                    <div className="card-check">
                      <input type="checkbox" checked={marcado} onChange={() => alternar(c.id)} onClick={(e) => e.stopPropagation()} />
                    </div>
                    <div className="card-content">
                      <div className="card-top-tags">
                        {c.ciclo !== null && c.ciclo !== undefined && <span className="badge-semestre">Ciclo {c.ciclo}</span>}
                        {c.codigo && <span className="badge-matcur">{c.codigo}</span>}
                        <span className="badge-horas"><i className="far fa-clock"></i> {c.horas}h</span>
                      </div>
                      <div className="card-name" title={c.nombre}>{c.nombre}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="modal-footer">
        <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={guardar} disabled={guardando || cursos.length === 0}>
          <i className="fas fa-save"></i> {guardando ? 'Guardando...' : 'Guardar Competencias Asignadas'}
        </button>
      </div>
    </Modal>
  );
}
