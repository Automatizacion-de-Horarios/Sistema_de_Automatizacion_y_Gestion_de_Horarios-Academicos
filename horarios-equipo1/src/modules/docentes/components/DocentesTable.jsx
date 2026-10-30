import React from 'react';
import { ESTADOS } from '../../../config/app';

export default function DocentesTable({ docentes, loading, onEstado, onCompetencias, onRango, onCuadricula, onClases, onCentro }) {
  return (
    <table className="data-table" id="tabla-docentes">
      <thead>
        <tr>
          <th>Instructor</th>
          <th>Especialidad / Competencias</th>
          <th>Disponibilidad</th>
          <th>Estado Operativo</th>
          <th>Auditoría</th>
          <th style={{ textAlign: 'right' }}>Acciones</th>
        </tr>
      </thead>
      <tbody>
        {loading && (
          <tr><td colSpan="6" className="tabla-vacia"><i className="fas fa-spinner fa-spin"></i> Cargando instructores...</td></tr>
        )}
        {!loading && docentes.length === 0 && (
          <tr><td colSpan="6" className="tabla-vacia">No hay instructores para mostrar.</td></tr>
        )}
        {!loading && docentes.map((d) => {
          const est = ESTADOS[d.estado] || ESTADOS.A;
          return (
            <tr key={d.id}>
              <td>
                <span className="td-title">{d.nombre}</span>
                <span className="td-subtitle">DNI: {d.dni} · Contrato: {d.horasContrato} h/sem</span>
              </td>
              <td>
                <span className="td-title" style={{ fontSize: 13 }}>{d.especialidad}</span>
                <button className="btn btn-secondary btn-sm" style={{ marginTop: 4 }} onClick={() => onCompetencias(d.id)}>
                  <i className="fas fa-book-reader text-senati"></i> {d.cursosPermitidos.length} asignadas
                </button>
              </td>
              <td>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => onRango(d.id)} title="Formato de rango horario">
                    <i className="far fa-clock"></i> Rango
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={() => onCuadricula(d.id)} title="Cuadrícula interactiva">
                    <i className="fas fa-th"></i> Cuadrícula ({d.slots.length}h)
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => onClases(d.id)} title="Clases asignadas en la matriz">
                    <i className="fas fa-calendar-week text-senati"></i> Clases
                  </button>
                </div>
              </td>
              <td>
                <span className={`status-badge ${est.clase}`} onClick={() => onEstado(d.id)} title="Clic para cambiar el estado">
                  <i className={`fas ${est.icono}`}></i> {est.texto}
                </span>
              </td>
              <td>
                <span className="audit-tag"><strong>{d.usuarioModificacion}</strong></span>
                <span className="audit-tag">{d.fechaModificacion}</span>
              </td>
              <td style={{ textAlign: 'right' }}>
                <button className="btn-icon-action" title="Centro de Control" onClick={() => onCentro(d.id)}>
                  <i className="fas fa-cog"></i>
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
