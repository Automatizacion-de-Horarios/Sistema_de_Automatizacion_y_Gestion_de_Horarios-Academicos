// frontend/src/modules/docentes/components/CentroAcciones.jsx
import React from 'react';

export default function CentroAcciones({ docente, onSeleccionarOpcion }) {
    return (
        <div>
            <p style={{ marginTop: 0, color: '#64748B', marginBottom: '20px' }}>
                Instructor: <strong>{docente.nombre_completo}</strong> (ID: {docente.codigo_instructor})
            </p>
            <div className="doc-acciones-grid">
                <div className="doc-accion-card" onClick={() => onSeleccionarOpcion('competencias')}>
                    <i className="fa-solid fa-book-open"></i>
                    <h4>Asignar Competencias</h4>
                    <p>Gestionar materias y cursos aptos</p>
                </div>
                <div className="doc-accion-card" onClick={() => onSeleccionarOpcion('cuadricula')}>
                    <i className="fa-solid fa-calendar-days"></i>
                    <h4>Ver Horario Visual / Cuadrícula</h4>
                    <p>Editar disponibilidad horaria detallada</p>
                </div>
                <div className="doc-accion-card" onClick={() => onSeleccionarOpcion('estado')}>
                    <i className="fa-solid fa-toggle-on"></i>
                    <h4>Cambiar Estado</h4>
                    <p>Modificar estado operativo (A / I / V)</p>
                </div>
                <div className="doc-accion-card" onClick={() => onSeleccionarOpcion('auditoria')}>
                    <i className="fa-solid fa-clock-rotate-left"></i>
                    <h4>Ver Ficha de Auditoría</h4>
                    <p>Revisar historial de modificaciones</p>
                </div>
            </div>
        </div>
    );
}