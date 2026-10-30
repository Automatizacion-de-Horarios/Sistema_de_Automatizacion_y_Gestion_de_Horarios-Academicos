import React, { useEffect, useRef, useState } from 'react';
import Modal, { BotonCerrar } from './Modal';
import { DIAS, HORAS } from '../../../config/app';
import { claveSlot } from '../utils/disponibilidad';

const HORAS_MANANA = ['07:00', '08:00', '09:00', '10:00', '11:00', '12:00'];
const HORAS_TARDE = ['13:00', '14:00', '15:00', '16:00', '17:00'];
const HORAS_NOCHE = ['18:00', '19:00', '20:00'];

// Cuadrícula Lunes–Sábado × 07:00–21:00. Clic o arrastre para pintar/despintar.
export default function DisponibilidadCuadriculaModal({ docente, onGuardar, onVerRango, onClose }) {
  const [slots, setSlots] = useState(() => new Set(docente.slots));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const arrastre = useRef({ activo: false, modo: true });

  useEffect(() => {
    const soltar = () => { arrastre.current.activo = false; };
    window.addEventListener('mouseup', soltar);
    return () => window.removeEventListener('mouseup', soltar);
  }, []);

  const aplicar = (claves, modo) =>
    setSlots((prev) => {
      const s = new Set(prev);
      claves.forEach((k) => (modo ? s.add(k) : s.delete(k)));
      return s;
    });

  const alternar = (claves) => aplicar(claves, !claves.every((k) => slots.has(k)));

  const preset = (tipo) => {
    const dias = tipo === 'lunes_viernes' ? [1, 2, 3, 4, 5] : DIAS.map((d) => d.n);
    const horas =
      tipo === 'manana' ? HORAS_MANANA : tipo === 'tarde' ? HORAS_TARDE : tipo === 'noche' ? HORAS_NOCHE : HORAS.map((h) => h.id);
    if (tipo === 'limpiar') return setSlots(new Set());
    const s = new Set();
    dias.forEach((d) => horas.forEach((h) => s.add(claveSlot(d, h))));
    setSlots(s);
  };

  const horasSel = slots.size;
  const diasSel = new Set([...slots].map((k) => k.split('-')[0])).size;
  const faltan = docente.horasContrato > 0 && horasSel < docente.horasContrato;

  const guardar = async () => {
    setError('');
    setGuardando(true);
    try {
      await onGuardar(docente.id, [...slots]);
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  };

  return (
    <Modal ancho={950} onClose={onClose} cerrarAlFondo={false}>
      <div className="modal-header">
        <div>
          <h3><i className="fas fa-th text-senati" style={{ marginRight: 8 }}></i> Cuadrícula Semanal de Disponibilidad Horaria</h3>
          <p className="text-muted" style={{ fontSize: 13, marginTop: 4 }}>
            Turnos e intervalos para: <strong style={{ color: 'var(--text-dark)' }}>{docente.nombre}</strong>
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={onVerRango}>
            <i className="far fa-clock"></i> Ver Rango Horario
          </button>
          <BotonCerrar onClose={onClose} />
        </div>
      </div>

      <div className="modal-body">
        <div className="disp-toolbar-bar">
          <div className="disp-info-counters">
            <span className="badge badge-success" style={{ fontSize: 12, padding: '6px 12px' }}>
              <i className="far fa-clock"></i> <strong>{horasSel} hrs</strong> seleccionadas
            </span>
            <span className="badge badge-secondary" style={{ fontSize: 12, padding: '6px 12px' }}>
              <i className="far fa-calendar-check"></i> <strong>{diasSel} días</strong> activos
            </span>
          </div>
          <div className="disp-presets">
            <button className="btn btn-secondary btn-sm" onClick={() => preset('todo')}><i className="fas fa-check-double"></i> Todo Disponible</button>
            <button className="btn btn-secondary btn-sm" onClick={() => preset('limpiar')}><i className="fas fa-eraser"></i> Limpiar Todo</button>
            <button className="btn btn-secondary btn-sm" onClick={() => preset('manana')}><i className="fas fa-sun" style={{ color: '#F59E0B' }}></i> Mañana (07-13h)</button>
            <button className="btn btn-secondary btn-sm" onClick={() => preset('tarde')}><i className="fas fa-cloud-sun" style={{ color: '#3B82F6' }}></i> Tarde (13-18h)</button>
            <button className="btn btn-secondary btn-sm" onClick={() => preset('noche')}><i className="fas fa-moon" style={{ color: '#8B5CF6' }}></i> Noche (18-21h)</button>
            <button className="btn btn-secondary btn-sm" onClick={() => preset('lunes_viernes')}><i className="fas fa-business-time"></i> Lun-Vie Completo</button>
          </div>
        </div>

        <div className="disp-guide-hint">
          <i className="fas fa-info-circle text-senati" style={{ fontSize: 16 }}></i>
          <span>
            <strong>Interacción Ágil:</strong> Haga clic o arrastre el cursor sobre las celdas para marcar o desmarcar turnos.
            También puede hacer clic en el nombre de cualquier día o en una franja horaria para alternar toda la columna o fila.
          </span>
        </div>

        {faltan && (
          <p className="form-warning">
            <i className="fas fa-exclamation-triangle"></i> El contrato es de {docente.horasContrato} h/sem, pero solo hay {horasSel} h marcadas como disponibles.
          </p>
        )}
        {error && <p className="form-error"><i className="fas fa-exclamation-circle"></i> {error}</p>}

        <div className="disp-matrix-container">
          <div className="disp-grid">
            <div className="disp-col-header" style={{ background: '#E2E8F0', fontWeight: 800 }}><i className="far fa-clock"></i> HORA</div>
            {DIAS.map((d) => (
              <div key={d.n} className="disp-col-header" title={`Alternar todo el ${d.nombre}`}
                onClick={() => alternar(HORAS.map((h) => claveSlot(d.n, h.id)))}>
                <i className="far fa-calendar-alt"></i> {d.nombre}
              </div>
            ))}
            {HORAS.map((h) => (
              <React.Fragment key={h.id}>
                <div className="disp-hour-header" title={`Alternar las ${h.label}`}
                  onClick={() => alternar(DIAS.map((d) => claveSlot(d.n, h.id)))}>
                  {h.label}
                </div>
                {DIAS.map((d) => {
                  const k = claveSlot(d.n, h.id);
                  const activo = slots.has(k);
                  return (
                    <div key={k} className={`disp-cell ${activo ? 'disponible' : 'no-disponible'}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        const modo = !activo;
                        arrastre.current = { activo: true, modo };
                        aplicar([k], modo);
                      }}
                      onMouseEnter={() => arrastre.current.activo && aplicar([k], arrastre.current.modo)}>
                      {activo ? <><i className="fas fa-check" style={{ fontSize: 10, marginRight: 4 }}></i> Disp.</> : <span style={{ opacity: 0.35 }}>-</span>}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="disp-legend">
          <div className="legend-item"><span className="legend-box disp-legend-on"></span> Habilitado / Disponible</div>
          <div className="legend-item"><span className="legend-box disp-legend-off"></span> No Disponible</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={guardar} disabled={guardando}>
            <i className="fas fa-save"></i> {guardando ? 'Guardando...' : 'Guardar Disponibilidad en Cuadrícula'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
