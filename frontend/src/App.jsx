import React, { useState, useEffect } from 'react';
import senatiLogo from './assets/logo-senati.png';

function App() {
    // Control de navegación entre vistas
    const [activeView, setActiveView] = useState('horario-view');
    const [searchCarrera, setSearchCarrera] = useState('');

    // Datos dinámicos (se cargarán desde la base de datos)
    const [carreras, setCarreras] = useState([]);
    const [currentUser, setCurrentUser] = useState(null);

    // Títulos de pestaña por sección
    const sectionTitles = {
        'horario-view':          'SENATI - Horarios',
        'carreras-view':         'SENATI - Carreras y Mallas',
        'malla-semestre-view':   'SENATI - Malla Curricular',
        'docentes-view':         'SENATI - Docentes',
        'aulas-view':            'SENATI - Infraestructura',
        'feriados-view':         'SENATI - Feriados',
        'config-view':           'SENATI - Configuración',
    };

    // Cambia el título de la pestaña al cambiar de sección
    useEffect(() => {
        document.title = sectionTitles[activeView] || 'SENATI - Gestión Académica';
    }, [activeView]);

    const carrerasFiltradas = (carreras || []).filter(c => {
        const nombre = typeof c === 'string' ? c : (c.nombre || '');
        return nombre.toLowerCase().includes(searchCarrera.toLowerCase().trim());
    });

    return (
        <div className="app-container">
            {/* ================================================================= */}
            {/*                   MENÚ LATERAL (SIDEBAR INTACTO)                  */}
            {/* ================================================================= */}
            <aside className="sidebar">
                {/* Logo oficial SENATI (Logo y Nombre) */}
                <div className="logo-container">
                    <img src={senatiLogo} alt="SENATI" className="senati-logo-img" />
                </div>

                <nav className="main-nav">
                    <ul className="nav-links">
                        <li 
                            className={activeView === 'horario-view' ? 'active' : ''} 
                            onClick={() => setActiveView('horario-view')}
                        >
                            <i className="far fa-calendar-alt"></i> Horarios
                        </li>
                        <li 
                            className={activeView === 'carreras-view' ? 'active' : ''} 
                            onClick={() => setActiveView('carreras-view')}
                        >
                            <i className="fas fa-graduation-cap"></i> Carreras y Mallas
                        </li>
                        <li 
                            className={activeView === 'docentes-view' ? 'active' : ''} 
                            onClick={() => setActiveView('docentes-view')}
                        >
                            <i className="fas fa-user-friends"></i> Docentes
                        </li>
                        <li 
                            className={activeView === 'aulas-view' ? 'active' : ''} 
                            onClick={() => setActiveView('aulas-view')}
                        >
                            <i className="far fa-building"></i> Infraestructura
                        </li>
                        <li 
                            className={activeView === 'feriados-view' ? 'active' : ''} 
                            onClick={() => setActiveView('feriados-view')}
                        >
                            <i className="fas fa-flag"></i> Feriados
                        </li>
                        <li 
                            className={activeView === 'config-view' ? 'active' : ''} 
                            onClick={() => setActiveView('config-view')}
                        >
                            <i className="fas fa-sliders-h"></i> Configuración
                        </li>
                    </ul>

                    <div className="carreras-section">
                        <div className="section-header">
                            <span className="header-title">PROGRAMAS ACADÉMICOS</span>
                            <span className="header-count" id="nav-count-carreras">
                                {String(carrerasFiltradas.length).padStart(2, '0')}
                            </span>
                        </div>
                        <div className="search-box">
                            <i className="fas fa-search"></i>
                            <input 
                                type="text" 
                                id="buscar-carrera" 
                                placeholder="Buscar programa..." 
                                value={searchCarrera}
                                onChange={(e) => setSearchCarrera(e.target.value)}
                            />
                        </div>
                        <ul id="lista-carreras" className="accordion-list">
                            {/* Generado dinámicamente desde la base de datos */}
                            {carrerasFiltradas.map((carrera, index) => {
                                const nombre = typeof carrera === 'string' ? carrera : carrera.nombre;
                                return (
                                    <li 
                                        key={index} 
                                        className="carrera-item"
                                        onClick={() => setActiveView('carreras-view')}
                                    >
                                        <i className="fas fa-chevron-right" style={{ fontSize: '10px', color: 'var(--text-light)' }}></i>
                                        <span>{nombre}</span>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                </nav>

                <div className="user-profile-bottom">
                    {/* Dependerá de la sesión activa / Login */}
                    {currentUser && (
                        <>
                            <div className="avatar">{currentUser.avatar || ''}</div>
                            <div className="user-info">
                                <span className="name">{currentUser.name}</span>
                                <span className="role">{currentUser.role}</span>
                            </div>
                            <i className="fas fa-shield-alt text-senati" title="Usuario con permisos de auditoría activos"></i>
                        </>
                    )}
                </div>
            </aside>

            {/* ================================================================= */}
            {/*                   ÁREA PRINCIPAL DE TRABAJO                       */}
            {/* ================================================================= */}
            <main className="main-content">
                {/* Barra Superior Global (Topbar) */}
                <div className="top-bar">
                    <div className="breadcrumbs" id="global-breadcrumb">
                        SENATI <i className="fas fa-chevron-right"></i> <strong>Sistema de Horarios Académicos</strong>
                    </div>
                </div>

                {/* =============================================================== */}
                {/*      [ÁREA DE TRABAJO] EQUIPO 4: MOTOR, MATRIZ Y EXPORTADOR     */}
                {/* =============================================================== */}
                <section id="horario-view" className={`view ${activeView === 'horario-view' ? 'active' : ''}`}>
                    {/* El Equipo 4 colocará aquí la Matriz Semanal, la visualización de Bloques y el Motor Global */}
                </section>
                {/* ===================== FIN SECCIÓN EQUIPO 4 ==================== */}


                {/* =============================================================== */}
                {/*    [ÁREA DE TRABAJO] EQUIPO 3: CARRERAS, MALLAS Y FERIADOS      */}
                {/* =============================================================== */}
                <section id="carreras-view" className={`view ${activeView === 'carreras-view' ? 'active' : ''}`}>
                    {/* El Equipo 3 colocará aquí el Directorio Institucional de Carreras */}
                </section>

                <section id="malla-semestre-view" className={`view ${activeView === 'malla-semestre-view' ? 'active' : ''}`}>
                    {/* El Equipo 3 colocará aquí la Estructura Curricular y Malla por Semestre */}
                </section>

                <section id="feriados-view" className={`view ${activeView === 'feriados-view' ? 'active' : ''}`}>
                    {/* El Equipo 3 colocará aquí el Módulo de Calendario y Fechas Inamovibles */}
                </section>
                {/* ===================== FIN SECCIÓN EQUIPO 3 ==================== */}


                {/* =============================================================== */}
                {/*      [ÁREA DE TRABAJO] EQUIPO 1: DOCENTES Y DISPONIBILIDAD      */}
                {/* =============================================================== */}
                <section id="docentes-view" className={`view ${activeView === 'docentes-view' ? 'active' : ''}`}>
                    {/* El Equipo 1 colocará aquí el Módulo de Gestión de Instructores y Disponibilidad */}
                </section>
                {/* ===================== FIN SECCIÓN EQUIPO 1 ==================== */}


                {/* =============================================================== */}
                {/*    [ÁREA DE TRABAJO] EQUIPO 2: INFRAESTRUCTURA Y AMBIENTES       */}
                {/* =============================================================== */}
                <section id="aulas-view" className={`view ${activeView === 'aulas-view' ? 'active' : ''}`}>
                    {/* El Equipo 2 colocará aquí el Módulo de Infraestructura, Aulas y Plazas Libres */}
                </section>
                {/* ===================== FIN SECCIÓN EQUIPO 2 ==================== */}


                {/* =============================================================== */}
                {/*                CONFIGURACIÓN / AJUSTES SISTEMA                   */}
                {/* =============================================================== */}
                <section id="config-view" className={`view ${activeView === 'config-view' ? 'active' : ''}`}>
                    {/* Ajustes generales y parámetros globales */}
                </section>
            </main>
        </div>
    );
}

export default App;
