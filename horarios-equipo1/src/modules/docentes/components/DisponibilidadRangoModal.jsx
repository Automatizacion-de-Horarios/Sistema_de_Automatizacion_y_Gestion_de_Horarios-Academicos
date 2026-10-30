import React, { useState } from 'react';
import Modal, { BotonCerrar } from './Modal';
import { DIAS } from '../../../config/app';
import { aMinutos, rangosASlots, slotsARangos } from '../utils/disponibilidad';

// Vista alternativa: un rango Inicio–Fin por día (formato tradicional).
export default function DisponibilidadRangoModal({ docente, onGuardar, onVerCuadricula, onClose }) {
  const rangos = slotsARangos(docente.slots);
  const [filas, setFilas] = useState(() =>
    DIAS.map((d) => {
      const delDia = rangos.filter((r) => r.dia === d.n);
      return {
        dia: d.n,
        activo: delDia.length > 0,
        inicio: delDia.length ? delDia[0].inicio : '08:00',
        fin: delDia.length ? delDia[delDia.length - 1].fin : '18:00',
        conHuecos: delDia.length > 1
      };
    })
  );
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const hayHuecos = filas.some((f) => f.conHuecos);

  const cambiar = (i, campo, valor) =>
    setFilas(filas.map((f, idx) => (idx === i ? { ...f, [campo]: valor, conHuecos: false } : f)));

  const guardar = async () => {
    const invalida = filas.find((f) => f.activo && aMinutos(f.fin) <= aMinutos(f.inicio));
    if (invalida) return setError('En cada día habilitado, la hora fin debe ser mayor que la hora inicio.');
    setError('');
    setGuardando(true);
    try {
      const slots = rangosASlots(filas.filter((f) => f.activo).map((f) => ({ dia: f.dia, inicio: f.inicio, fin: f.fin })));
      await onGuardar(docente.id, slots);
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  };

  return (
    <Modal ancho={700} onClose={onClose} cerrarAlFondo={false}>
      <div className="modal-header">
        <div>
          <h3>Matriz de Disponibilidad Horaria</h3>
          <p className="text-muted" style={{ fontSize: 13, marginTop: 4 }}>
            Turnos para: <span style={{ fontWeight: 600, color: 'var(--text-dark)' }}>{docente.nombre}</span>
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={onVerCuadricula}>
            <i className="fas fa-th"></i> Ver en Cuadrícula Interactiva
          </button>
          <BotonCerrar onClose={onClose} />
        </div>
      </div>
      <div className="modal-body">
        {hayHuecos && (
          <p className="form-warning">
            <i className="fas fa-exclamation-triangle"></i> Algunos días tienen horas intermedias libres. Si edita el día aquí, se
            guardará como un solo rango continuo. Use la cuadrícula para conservar los huecos.
          </p>
        )}
        {error && <p className="form-error"><i className="fas fa-exclamation-circle"></i> {error}</p>}
        <table className="data-table borderless-table">
          <thead>
            <tr><th>Día</th><th>Inicio</th><th>Fin</th><th style={{ textAlign: 'center' }}>Habilitado</th></tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={f.dia}>
                <td style={{ fontWeight: 500 }}>{DIAS[i].nombre}</td>
                <td><input type="time" className="input-lg" style={{ padding: '6px 10px' }} value={f.inicio} disabled={!f.activo}
                  onChange={(e) => cambiar(i, 'inicio', e.target.value)} /></td>
                <td><input type="time" className="input-lg" style={{ padding: '6px 10px' }} value={f.fin} disabled={!f.activo}
                  onChange={(e) => cambiar(i, 'fin', e.target.value)} /></td>
                <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" style={{ width: 16, height: 16, cursor: 'pointer' }} checked={f.activo}
                    onChange={(e) => cambiar(i, 'activo', e.target.checked)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="modal-footer">
        <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando...' : 'Guardar Disponibilidad'}
        </button>
      </div>
    </Modal>
  );
}
