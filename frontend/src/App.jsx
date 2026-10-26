import React, { useState, useEffect } from 'react';
import senatiLogo from './assets/logo-senati.png';

function App() {
    // Control de navegación entre vistas
    const [activeView, setActiveView] = useState('horario-view');
    const [searchCarrera, setSearchCarrera] = useState('');

    // [GRUPO 4 - CAMBIO 1]: ESTADO GLOBAL DEL PERÍODO LECTIVO (CONECTADO A TODO EL SISTEMA)
    const [periodoGlobal, setPeriodoGlobal] = useState('202620');

    // [GRUPO 4 - CAMBIO 2]: ESTADO Y FUNCIÓN PARA MOSTRAR ALERTAS TOAST FLOTANTES EN LA ESQUINA SUPERIOR DERECHA
    const [toast, setToast] = useState({ show: false, mensaje: '' });

    const triggerToast = (mensaje) => {
        setToast({ show: true, mensaje });
        setTimeout(() => {
            setToast({ show: false, mensaje: '' });
        }, 3000); // SE OCULTA AUTOMÁTICAMENTE A LOS 3 SEGUNDOS
    };

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
            {/* [GRUPO 4 - CAMBIO 3]: COMPONENTE VISUAL DE ALERTA TOAST FLOTANTE */}
            {toast.show && (
                <div style={{
                    position: 'fixed',
                    top: '20px',
                    right: '25px',
                    backgroundColor: '#ffffff',
                    color: '#1e293b',
                    padding: '12px 20px',
                    borderRadius: '10px',
                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
                    borderLeft: '4px solid #0284c7',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    zIndex: 10000,
                    fontSize: '13px',
                    fontWeight: '500',
                    animation: 'fadeIn 0.2s ease-in-out'
                }}>
                    <i className="fas fa-info-circle" style={{ color: '#0284c7', fontSize: '18px' }}></i>
                    <span>{toast.mensaje}</span>
                </div>
            )}

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
                {/* [GRUPO 4 - CAMBIO 4]: BARRA SUPERIOR (TOPBAR) CON SELECTOR GLOBAL DE PERÍODO */}
                <div className="top-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 24px', background: '#fff', borderBottom: '1px solid var(--border)' }}>
                    <div className="breadcrumbs" id="global-breadcrumb">
                        SENATI <i className="fas fa-chevron-right" style={{ fontSize: '11px', margin: '0 6px', color: 'var(--text-light)' }}></i> <strong>Sistema de Horarios Académicos</strong>
                    </div>

                    {/* SELECTOR DE PERÍODO LECTIVO */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#f8fafc', padding: '6px 14px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                        <i className="far fa-calendar-alt" style={{ color: 'var(--senati-blue)', fontSize: '14px' }}></i>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>Período Lectivo:</span>
                        <select 
                            id="header-periodo-global"
                            value={periodoGlobal} 
                            onChange={(e) => setPeriodoGlobal(e.target.value)}
                            style={{ border: 'none', background: 'transparent', fontWeight: '700', fontSize: '13px', color: 'var(--text-dark)', cursor: 'pointer', outline: 'none' }}
                        >
                            <option value="202620">2026 - II</option>
                            <option value="202610">2026 - I</option>
                        </select>
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
                {/*    [ÁREA DE TRABAJO] EQUIPO 3: CARRERAS Y MALLAS CURRICULARES   */}
                {/* =============================================================== */}
                {/* [GRUPO 4 - CAMBIO 5]: ENVÍO DE PERIODOGLOBAL Y TRIGGERTOAST COMO PROPS */}
                <CarrerasModulo 
                    activeView={activeView} 
                    setActiveView={setActiveView} 
                    periodoGlobal={periodoGlobal} 
                    triggerToast={triggerToast}
                />
                    
                
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
                {/*   [GRUPO 4 - CAMBIO 6]: COMPONENTE AUTÓNOMO DE CONFIGURACIÓN     */}
                {/* =============================================================== */}
                <ConfiguracionModulo 
                    activeView={activeView} 
                    periodoGlobal={periodoGlobal} 
                    setPeriodoGlobal={setPeriodoGlobal} 
                    triggerToast={triggerToast}
                />

            </main>
        </div>
    );
}

// ===============================================================
//   MÓDULO AUTÓNOMO: CONFIGURACIÓN Y GESTIÓN DINÁMICA DE SEDES (GRUPO 4)
// ===============================================================
function ConfiguracionModulo({ activeView, periodoGlobal, setPeriodoGlobal, triggerToast }) {
    // [GRUPO 4 - CAMBIO 7]: ESTADO DE SEDES POR ZONAL. TACNA INICIA CON CIUDAD NUEVA Y CONO SUR
    const [sedesPorZonal, setSedesPorZonal] = useState({
        "Dirección Zonal Moquegua - Tacna": [
            { codigo: "56P", nombre: "56P - CFP Tacna (Ciudad Nueva)" },
            { codigo: "56CS", nombre: "56CS - UPC Tacna (Cono Sur)" }
        ]
    });

    // [GRUPO 4 - CAMBIO 8]: ESTADOS PARA SELECCIÓN ACTIVA DE ZONAL Y SEDE
    const [zonalActiva, setZonalActiva] = useState("Dirección Zonal Moquegua - Tacna");
    const [sedeActiva, setSedeActiva] = useState("56P");

    // [GRUPO 4 - CAMBIO 9]: ESTADOS FORMULARIO DEL MODAL NUEVA SEDE
    const [nuevaZonal, setNuevaZonal] = useState("Dirección Zonal Moquegua - Tacna");
    const [nuevoCodigo, setNuevoCodigo] = useState("");
    const [nuevoNombre, setNuevoNombre] = useState("");
    const [nuevaCiudad, setNuevaCiudad] = useState("");

    // [GRUPO 4 - CAMBIO 10]: FUNCIÓN PARA REGISTRAR SEDE CON ALERTA TOAST FLOTANTE
    const handleRegistrarSede = () => {
        if (!nuevoCodigo.trim() || !nuevoNombre.trim()) {
            if (typeof triggerToast === 'function') {
                triggerToast("Por favor ingrese el código y nombre de la sede.");
            }
            return;
        }

        const nuevaSedeObj = { 
            codigo: nuevoCodigo.trim(), 
            nombre: `${nuevoCodigo.trim()} - ${nuevoNombre.trim()}` 
        };

        setSedesPorZonal(prev => ({
            ...prev,
            [nuevaZonal]: [...(prev[nuevaZonal] || []), nuevaSedeObj]
        }));

        if (nuevaZonal === zonalActiva) {
            setSedeActiva(nuevoCodigo.trim());
        }

        setNuevoCodigo("");
        setNuevoNombre("");
        setNuevaCiudad("");
        document.getElementById('modal-nueva-sede').style.display = 'none';

        if (typeof triggerToast === 'function') {
            triggerToast("Sede registrada correctamente.");
        }
    };

    return (
        <>
            <section id="config-view" className={`view ${activeView === 'config-view' ? 'active' : ''}`}>
                <header className="view-header">
                    <div className="header-title-area">
                        <h1>Ajustes Globales del Sistema</h1>
                        <p className="subtitle">Parámetros operativos del campus, sede activa y límites de turno.</p>
                    </div>
                </header>

                <div className="card config-form">
                    <h3 className="section-title" style={{ marginBottom: '16px', fontSize: '15px' }}>
                        Contexto Institucional Activo
                    </h3>
                    
                    <div className="form-row-custom">
                        {/* [GRUPO 4 - CAMBIO 11]: SELECTOR DE ZONAL QUE REACCIONA AL CAMBIO FILTRANDO O VACIANDO SEDES */}
                        <div className="form-group">
                            <label>Dirección Zonal</label>
                            <select 
                                id="config-zonal" 
                                className="input-lg" 
                                value={zonalActiva}
                                onChange={(e) => {
                                    const zonalSeleccionada = e.target.value;
                                    setZonalActiva(zonalSeleccionada);
                                    const sedesDisponibles = sedesPorZonal[zonalSeleccionada] || [];
                                    setSedeActiva(sedesDisponibles.length > 0 ? sedesDisponibles[0].codigo : "");
                                }}
                            >
                                <option value="Dirección Zonal Áncash">Dirección Zonal Áncash</option>
                                <option value="Dirección Zonal Arequipa - Puno">Dirección Zonal Arequipa - Puno</option>
                                <option value="Dirección Zonal Cajamarca - Amazonas - San Martín">Dirección Zonal Cajamarca - Amazonas - San Martín</option>
                                <option value="Dirección Zonal Cusco - Apurímac - Madre de Dios">Dirección Zonal Cusco - Apurímac - Madre de Dios</option>
                                <option value="Dirección Zonal Ica - Ayacucho">Dirección Zonal Ica - Ayacucho</option>
                                <option value="Dirección Zonal Junín - Pasco - Huancavelica">Dirección Zonal Junín - Pasco - Huancavelica</option>
                                <option value="Dirección Zonal La Libertad">Dirección Zonal La Libertad</option>
                                <option value="Dirección Zonal Lambayeque">Dirección Zonal Lambayeque</option>
                                <option value="Dirección Zonal Lima - Callao">Dirección Zonal Lima - Callao</option>
                                <option value="Dirección Zonal Loreto">Dirección Zonal Loreto</option>
                                <option value="Dirección Zonal Moquegua - Tacna">Dirección Zonal Moquegua - Tacna</option>
                                <option value="Dirección Zonal Piura - Tumbes">Dirección Zonal Piura - Tumbes</option>
                                <option value="Dirección Zonal Ucayali - Huánuco">Dirección Zonal Ucayali - Huánuco</option>
                            </select>
                        </div>

                        {/* [GRUPO 4 - CAMBIO 12]: SELECTOR DE SEDE FILTRADO DINÁMICAMENTE POR LA ZONAL ACTIVA */}
                        <div className="form-group">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                <label style={{ margin: 0 }}>Sede / Campus (CAMP)</label>
                                <button 
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    style={{ padding: '2px 10px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                                    onClick={() => {
                                        setNuevaZonal(zonalActiva);
                                        document.getElementById('modal-nueva-sede').style.display = 'flex';
                                    }}
                                >
                                    <i className="fas fa-plus" style={{ color: 'var(--senati-blue)' }}></i> Nueva Sede
                                </button>
                            </div>
                            
                            <select 
                                id="config-sede" 
                                className="input-lg"
                                value={sedeActiva}
                                onChange={(e) => setSedeActiva(e.target.value)}
                            >
                                {(sedesPorZonal[zonalActiva] && sedesPorZonal[zonalActiva].length > 0) ? (
                                    sedesPorZonal[zonalActiva].map((sede) => (
                                        <option key={sede.codigo} value={sede.codigo}>{sede.nombre}</option>
                                    ))
                                ) : (
                                    <option value="">-- Sin sedes registradas (Use + Nueva Sede) --</option>
                                )}
                            </select>
                        </div>
                    </div>

                    {/* [GRUPO 4 - CAMBIO 13]: SELECTOR DE PERÍODO CONECTADO A PERIODOGLOBAL */}
                    <div className="form-row-custom">
                        <div className="form-group">
                            <label>Período Lectivo Activo</label>
                            <select 
                                id="config-periodo" 
                                className="input-lg" 
                                value={periodoGlobal}
                                onChange={(e) => setPeriodoGlobal(e.target.value)}
                            >
                                <option value="202620">202620 - Semestre Académico 2026 - II</option>
                                <option value="202610">202610 - Semestre Académico 2026 - I</option>
                            </select>
                        </div>
                    </div>

                    {/* FRANJA HORARIA OPERATIVA */}
                    <h3 className="section-title" style={{ marginTop: '20px', marginBottom: '16px', fontSize: '15px' }}>
                        Franja Horaria Operativa
                    </h3>
                    <div className="form-row-custom">
                        <div className="form-group">
                            <label>Inicio Turno Mañana</label>
                            <input type="time" id="config-inicio" className="input-lg" defaultValue="07:00" />
                        </div>
                        <div className="form-group">
                            <label>Cierre Turno Noche</label>
                            <input type="time" id="config-fin" className="input-lg" defaultValue="21:00" />
                        </div>
                    </div>

                    {/* GUARDAR AJUSTES */}
                    <div className="form-actions" style={{ marginTop: '20px', borderTop: '1px solid var(--border)', paddingTop: '20px' }}>
                        <button className="btn btn-primary btn-lg">
                            <i className="fas fa-check"></i> Guardar Ajustes
                        </button>
                    </div>
                </div>
            </section>

            {/* [GRUPO 4 - CAMBIO 14]: MODAL FLOTANTE DE REGISTRO DE NUEVA SEDE */}
            <div 
                id="modal-nueva-sede" 
                style={{ 
                    display: 'none', 
                    position: 'fixed', 
                    top: 0, 
                    left: 0, 
                    width: '100vw', 
                    height: '100vh', 
                    backgroundColor: 'rgba(15, 23, 42, 0.5)', 
                    backdropFilter: 'blur(3px)',
                    zIndex: 9999, 
                    justifyContent: 'center', 
                    alignItems: 'center' 
                }}
            >
                <div className="card" style={{ width: '480px', padding: '24px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)', borderRadius: '12px', background: '#fff' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
                        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: 'var(--text-dark)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <i className="fas fa-building" style={{ color: 'var(--senati-blue)' }}></i> Registrar Nueva Sede / Campus
                        </h3>
                        <button 
                            type="button"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: 'var(--text-muted)' }}
                            onClick={() => document.getElementById('modal-nueva-sede').style.display = 'none'}
                        >
                            <i className="fas fa-times"></i>
                        </button>
                    </div>

                    <div>
                        <div className="form-group" style={{ marginBottom: '14px' }}>
                            <label>Dirección Zonal Perteneciente</label>
                            <select 
                                className="input-lg" 
                                value={nuevaZonal} 
                                onChange={(e) => setNuevaZonal(e.target.value)}
                            >
                                <option value="Dirección Zonal Áncash">Dirección Zonal Áncash</option>
                                <option value="Dirección Zonal Arequipa - Puno">Dirección Zonal Arequipa - Puno</option>
                                <option value="Dirección Zonal Cajamarca - Amazonas - San Martín">Dirección Zonal Cajamarca - Amazonas - San Martín</option>
                                <option value="Dirección Zonal Cusco - Apurímac - Madre de Dios">Dirección Zonal Cusco - Apurímac - Madre de Dios</option>
                                <option value="Dirección Zonal Ica - Ayacucho">Dirección Zonal Ica - Ayacucho</option>
                                <option value="Dirección Zonal Junín - Pasco - Huancavelica">Dirección Zonal Junín - Pasco - Huancavelica</option>
                                <option value="Dirección Zonal La Libertad">Dirección Zonal La Libertad</option>
                                <option value="Dirección Zonal Lambayeque">Dirección Zonal Lambayeque</option>
                                <option value="Dirección Zonal Lima - Callao">Dirección Zonal Lima - Callao</option>
                                <option value="Dirección Zonal Loreto">Dirección Zonal Loreto</option>
                                <option value="Dirección Zonal Moquegua - Tacna">Dirección Zonal Moquegua - Tacna</option>
                                <option value="Dirección Zonal Piura - Tumbes">Dirección Zonal Piura - Tumbes</option>
                                <option value="Dirección Zonal Ucayali - Huánuco">Dirección Zonal Ucayali - Huánuco</option>
                            </select>
                        </div>

                        <div className="form-group" style={{ marginBottom: '14px' }}>
                            <label>Código de Campus (CAMP)</label>
                            <input 
                                type="text" 
                                className="input-lg" 
                                placeholder="Ej. 56CS, 10P, 01C" 
                                maxLength={10} 
                                value={nuevoCodigo}
                                onChange={(e) => setNuevoCodigo(e.target.value)}
                            />
                        </div>

                        <div className="form-group" style={{ marginBottom: '14px' }}>
                            <label>Nombre de la Sede / Centro de Formación</label>
                            <input 
                                type="text" 
                                className="input-lg" 
                                placeholder="Ej. CFP Tacna - Cono Sur" 
                                value={nuevoNombre}
                                onChange={(e) => setNuevoNombre(e.target.value)}
                            />
                        </div>

                        <div className="form-group" style={{ marginBottom: '20px' }}>
                            <label>Ciudad / Ubicación</label>
                            <input 
                                type="text" 
                                className="input-lg" 
                                placeholder="Ej. Tacna, Moquegua, Arequipa" 
                                value={nuevaCiudad}
                                onChange={(e) => setNuevaCiudad(e.target.value)}
                            />
                        </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
                        <button 
                            type="button"
                            className="btn btn-secondary" 
                            onClick={() => document.getElementById('modal-nueva-sede').style.display = 'none'}
                        >
                            Cancelar
                        </button>
                        <button 
                            type="button"
                            className="btn btn-primary"
                            onClick={handleRegistrarSede}
                        >
                            <i className="fas fa-save"></i> Registrar Sede
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}

// ===============================================================
//   MÓDULO AUTÓNOMO: CARRERAS Y CANDADOS VISUALES (GRUPO 4)
// ===============================================================
function CarrerasModulo({ activeView, setActiveView, periodoGlobal, triggerToast }) {
    const [carreras, setCarreras] = useState([
        { id: '1', nombre: 'Ingeniería de Software con IA', semestres: 6, estado: 'activa' },
        { id: '2', nombre: 'Ciberseguridad', semestres: 6, estado: 'activa' },
        { id: '3', nombre: 'Diseño Gráfico Digital', semestres: 6, estado: 'inhabilitada' },
        { id: '4', nombre: 'Seguridad Industrial', semestres: 6, estado: 'activa' },
        { id: '5', nombre: 'Administración de Empresas', semestres: 6, estado: 'activa' },
        { id: '6', nombre: 'Soporte TI', semestres: 6, estado: 'sin_datos' },
        { id: '7', nombre: 'Contabilidad', semestres: 6, estado: 'activa' },
        { id: '8', nombre: 'Marketing', semestres: 6, estado: 'activa' }
    ]);

    const toggleEstadoCarrera = (id) => {
        setCarreras(prev => prev.map(carrera => {
            if (carrera.id === id) {
                const nuevoEstado = carrera.estado === 'activa' ? 'inhabilitada' : 'activa';
                return { ...carrera, estado: nuevoEstado };
            }
            return carrera;
        }));
    };

    return (
        <section id="carreras-view" className={`view ${activeView === 'carreras-view' ? 'active' : ''}`}>
            <header className="view-header">
                <div className="header-title-area">
                    <h1>Directorio Institucional de Carreras (8)</h1>
                    <p className="subtitle">Estructura oficial de mallas formativas del 1.º al 6.º semestre.</p>
                </div>
            </header>

            <div className="carreras-grid">
                {carreras.map((carrera) => {
                    const isLocked = carrera.estado !== 'activa';

                    return (
                        <div 
                            key={carrera.id} 
                            className={`carrera-card ${isLocked ? 'disabled' : ''}`}
                            style={{ cursor: isLocked ? 'not-allowed' : 'pointer' }}
                            onClick={() => {
                                if (isLocked) {
                                    // [GRUPO 4 - CAMBIO 15]: ALERTA TOAST FLOTANTE AL INTERACTUAR CON TARJETA INHABILITADA
                                    if (typeof triggerToast === 'function') {
                                        triggerToast(`La carrera "${carrera.nombre}" se encuentra inhabilitada en esta sede.`);
                                    }
                                } else {
                                    if (typeof setActiveView === 'function') {
                                        setActiveView('malla-semestre-view');
                                    }
                                }
                            }}
                        >
                            {/* [GRUPO 4 - CAMBIO 16]: BOTÓN CIRCULAR DE ALTERNANCIA Y CANDADO EN TARJETAS */}
                            <button 
                                type="button"
                                className="btn-toggle-lock"
                                title={isLocked ? "Habilitar Carrera" : "Inhabilitar / Bloquear Carrera"}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    toggleEstadoCarrera(carrera.id);
                                }}
                            >
                                <i className={`fas ${isLocked ? 'fa-lock-open' : 'fa-lock'}`} style={{ color: isLocked ? 'var(--success)' : 'var(--danger)' }}></i>
                            </button>

                            {/* [GRUPO 4 - CAMBIO 17]: CAPA OSCURA OVERLAY Y BADGE DE ESTADO DE CARRERA */}
                            {isLocked && (
                                <div className="carrera-card-overlay">
                                    <i className="fas fa-lock lock-icon"></i>
                                    <span className={`overlay-status-badge ${carrera.estado === 'sin_datos' ? 'sin-datos' : ''}`}>
                                        {carrera.estado === 'sin_datos' ? 'Falta de Datos' : 'Inhabilitado'}
                                    </span>
                                </div>
                            )}

                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px', paddingRight: '36px' }}>
                                    <h3 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-dark)', margin: 0 }}>
                                        <i className="fas fa-graduation-cap" style={{ color: 'var(--senati-blue)', marginRight: '8px' }}></i>
                                        {carrera.nombre}
                                    </h3>
                                </div>
                                <span className="badge" style={{ background: '#f1f5f9', color: 'var(--text-dark)', fontSize: '11px', marginBottom: '10px', display: 'inline-block' }}>
                                    {carrera.semestres} Semestres
                                </span>
                                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                                    Seleccione un semestre para ver su malla oficial y fichas curriculares.
                                </p>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

export default App;