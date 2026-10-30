import React, { useState } from 'react';
import { DocentesPage } from './modules/docentes';

// Menú lateral. Cada equipo reemplaza su "Placeholder" por su página cuando la tenga lista.
const VISTAS = [
  { id: 'horarios', icono: 'far fa-calendar-alt', texto: 'Horarios', equipo: 4 },
  { id: 'carreras', icono: 'fas fa-graduation-cap', texto: 'Carreras y Mallas', equipo: 3 },
  { id: 'docentes', icono: 'fas fa-user-friends', texto: 'Docentes', equipo: 1 },
  { id: 'aulas', icono: 'far fa-building', texto: 'Infraestructura', equipo: 2 },
  { id: 'feriados', icono: 'fas fa-flag', texto: 'Feriados', equipo: 3 },
  { id: 'config', icono: 'fas fa-sliders-h', texto: 'Configuración', equipo: null }
];

function Placeholder({ vista }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
      <i className={vista.icono} style={{ fontSize: 36, marginBottom: 12, opacity: 0.5 }}></i>
      <h2 style={{ color: 'var(--text-dark)', marginBottom: 6 }}>{vista.texto}</h2>
      <p>{vista.equipo ? `Módulo del Equipo ${vista.equipo}: pendiente de integrar.` : 'Ajustes generales: pendiente.'}</p>
    </div>
  );
}

export default function App() {
  const [actual, setActual] = useState('docentes');
  const vista = VISTAS.find((v) => v.id === actual);

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="logo-container">
          <div className="logo-icon">S</div>
          <div className="logo-text">
            <h2>SENATI</h2>
            <span>GESTIÓN ACADÉMICA</span>
          </div>
        </div>

        <nav className="main-nav">
          <ul className="nav-links">
            {VISTAS.map((v) => (
              <li key={v.id} className={actual === v.id ? 'active' : ''} onClick={() => setActual(v.id)}>
                <i className={v.icono}></i> {v.texto}
              </li>
            ))}
          </ul>
        </nav>

        <div className="user-profile-bottom">
          <div className="avatar">JQ</div>
          <div className="user-info">
            <span className="name">Joaquin_Coordinador</span>
            <span className="role">Jefatura Académica</span>
          </div>
          <i className="fas fa-shield-alt text-senati" title="Usuario con permisos de auditoría activos"></i>
        </div>
      </aside>

      <main className="main-content">
        <div className="top-bar">
          <div className="breadcrumbs">
            SENATI <i className="fas fa-chevron-right"></i> <strong>Sistema de Horarios Académicos</strong>
          </div>
        </div>
        <section className="view active">
          {actual === 'docentes' ? <DocentesPage /> : <Placeholder vista={vista} />}
        </section>
      </main>
    </div>
  );
}
