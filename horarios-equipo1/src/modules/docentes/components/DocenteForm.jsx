import React, { useState } from 'react';

const VACIO = { apellidos: '', nombres: '', dni: '', especialidad: '', horasContrato: '' };

// Formulario de registro/edición. Si recibe `docente`, funciona en modo edición.
export default function DocenteForm({ docente, onGuardar, onCancelar }) {
  const [f, setF] = useState(
    docente
      ? { apellidos: docente.apellidos, nombres: docente.nombres, dni: docente.dni, especialidad: docente.especialidad, horasContrato: docente.horasContrato }
      : VACIO
  );
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const set = (campo) => (e) => setF({ ...f, [campo]: e.target.value });

  const enviar = async () => {
    if (!f.apellidos.trim() || !f.nombres.trim()) return setError('Ingrese los apellidos y nombres del instructor.');
    if (!/^\d{8}$/.test(f.dni.trim())) return setError('El DNI debe tener exactamente 8 dígitos.');
    const horas = Number(f.horasContrato || 0);
    if (isNaN(horas) || horas < 0 || horas > 60) return setError('Las horas de contrato deben estar entre 0 y 60.');
    setError('');
    setGuardando(true);
    try {
      await onGuardar({
        apellidos: f.apellidos.trim().toUpperCase(),
        nombres: f.nombres.trim().toUpperCase(),
        dni: f.dni.trim(),
        especialidad: f.especialidad.trim() || 'General',
        horasContrato: horas
      });
      if (!docente) setF(VACIO);
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div>
      <div className="form-row-custom" style={{ flexWrap: 'wrap' }}>
        <input className="input-lg" placeholder="Apellidos..." value={f.apellidos} onChange={set('apellidos')} style={{ flex: '1 1 200px' }} />
        <input className="input-lg" placeholder="Nombres..." value={f.nombres} onChange={set('nombres')} style={{ flex: '1 1 200px' }} />
        <input className="input-lg" placeholder="DNI (8 dígitos)" maxLength={8} inputMode="numeric" value={f.dni}
          onChange={(e) => setF({ ...f, dni: e.target.value.replace(/\D/g, '') })} style={{ flex: '0 1 150px' }} />
        <input className="input-lg" placeholder="Especialidad" value={f.especialidad} onChange={set('especialidad')} style={{ flex: '1 1 180px' }} />
        <input className="input-lg" type="number" min="0" max="60" placeholder="Horas contrato" value={f.horasContrato}
          onChange={set('horasContrato')} style={{ flex: '0 1 140px' }} />
        <button className="btn btn-primary btn-lg" onClick={enviar} disabled={guardando}>
          <i className={`fas ${docente ? 'fa-save' : 'fa-plus'}`}></i> {guardando ? 'Guardando...' : docente ? 'Guardar cambios' : 'Registrar Instructor'}
        </button>
        {onCancelar && (
          <button className="btn btn-secondary btn-lg" onClick={onCancelar}>Cancelar</button>
        )}
      </div>
      {error && <p className="form-error"><i className="fas fa-exclamation-circle"></i> {error}</p>}
    </div>
  );
}
