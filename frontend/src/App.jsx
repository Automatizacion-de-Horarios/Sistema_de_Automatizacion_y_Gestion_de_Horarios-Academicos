import { useState, useEffect, useCallback, useRef } from 'react';
import senatiLogo from './assets/logo-senati.png';
import { AuthProvider } from './context/AuthContext.jsx';
import { useAuth } from './context/useAuth';
import { authFetch } from './lib/authFetch';
import { API_BASE_URL } from './config/api';
import ProtectedRoute from './components/ProtectedRoute';
import CarrerasView from './views/CarrerasView';
import DocentesView from './views/DocentesView';
// [CONFIGURACIÓN DE DISEÑO] Importación de la imagen de fondo compartida con CarrerasView
import fondoCarreras from './assets/fondoCarreras.png';


function App() {
    return (
        <AuthProvider>
            <ProtectedRoute>
                <Dashboard />
            </ProtectedRoute>
        </AuthProvider>
    );
}

function Dashboard() {
    // Control de navegación entre vistas
    const [activeView, setActiveView] = useState('horario-view');

    // [GRUPO 4 - CAMBIO 1]: ESTADO GLOBAL DEL PERÍODO LECTIVO (CONECTADO A TODO EL SISTEMA)
    const [periodoGlobal, setPeriodoGlobal] = useState('202620');

    // [GRUPO 4 - CAMBIO 2]: ESTADO Y FUNCIÓN PARA MOSTRAR ALERTAS TOAST FLOTANTES EN LA ESQUINA SUPERIOR DERECHA
    const [toast, setToast] = useState({ show: false, mensaje: '' });

    const triggerToast = useCallback((mensaje) => {
        setToast({ show: true, mensaje });
        setTimeout(() => {
            setToast({ show: false, mensaje: '' });
        }, 3000); // SE OCULTA AUTOMÁTICAMENTE A LOS 3 SEGUNDOS
    }, []);

    // Datos dinámicos (se cargan desde la base de datos en el efecto de más abajo)
    const [carreras, setCarreras] = useState([]);
    const { user, logout } = useAuth();
    const currentUser = user ? {
        name: user.nombre,
        role: user.rol,
        avatar: user.nombre.split(/\s+/).slice(0, 2).map((parte) => parte[0]).join('').toUpperCase()
    } : null;

    // Control de modificaciones pendientes en la malla y modales de confirmación
    const [hayCambiosMalla, setHayCambiosMalla] = useState(false);
    const [modalLogoutAbierto, setModalLogoutAbierto] = useState(false);
    const [modalNavegacionSidebar, setModalNavegacionSidebar] = useState({ abierto: false, destino: null });

    const handleNavegarSidebar = (nuevaVista) => {
        // Si no hay cambios, permite navegar a otra carrera o vista inmediatamente; solo alerta si hay cambios sin guardar
        if (activeView === 'malla-semestre-view' && nuevaVista !== 'malla-semestre-view' && hayCambiosMalla) {
            setModalNavegacionSidebar({ abierto: true, destino: nuevaVista });
        } else {
            setActiveView(nuevaVista);
        }
    };

    const handleSolicitarLogout = () => {
        // Si no hay cambios, cierra sesión inmediatamente; solo alerta si hay cambios sin guardar en la malla
        if (activeView === 'malla-semestre-view' && hayCambiosMalla) {
            setModalLogoutAbierto(true);
        } else {
            logout();
        }
    };

    // Listado de carreras desde la base de datos (se comparte con el menu lateral)
    const [cargandoCarreras, setCargandoCarreras] = useState(true);

    const cargarCarreras = useCallback(async () => {
        try {
            const respuesta = await authFetch(`${API_BASE_URL}/api/carreras`);
            const datos = await respuesta.json();
            if (!respuesta.ok) throw new Error(datos.mensaje || 'No se pudo obtener el listado de carreras.');
            setCarreras(Array.isArray(datos.carreras) ? datos.carreras : []);
        } catch (error) {
            console.error('Error al cargar carreras:', error);
            if (typeof triggerToast === 'function') {
                triggerToast(error.message || 'No se pudo cargar el listado de carreras.');
            }
        } finally {
            setCargandoCarreras(false);
        }
    }, [triggerToast]);

    useEffect(() => {
        const cargarCarrerasIniciales = async () => {
            await cargarCarreras();
        };
        cargarCarrerasIniciales();
    }, [cargarCarreras]);

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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeView]);


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
                            onClick={() => handleNavegarSidebar('horario-view')}
                        >
                            <i className="far fa-calendar-alt"></i> Horarios
                        </li>
                        <li 
                            className={activeView === 'carreras-view' || activeView === 'malla-semestre-view' ? 'active' : ''} 
                            onClick={() => handleNavegarSidebar('carreras-view')}
                        >
                            <i className="fas fa-graduation-cap"></i> Carreras y Mallas
                        </li>
                        <li 
                            className={activeView === 'docentes-view' ? 'active' : ''} 
                            onClick={() => handleNavegarSidebar('docentes-view')}
                        >
                            <i className="fas fa-user-friends"></i> Docentes
                        </li>
                        <li 
                            className={activeView === 'aulas-view' ? 'active' : ''} 
                            onClick={() => handleNavegarSidebar('aulas-view')}
                        >
                            <i className="far fa-building"></i> Infraestructura
                        </li>
                        <li 
                            className={activeView === 'feriados-view' ? 'active' : ''} 
                            onClick={() => handleNavegarSidebar('feriados-view')}
                        >
                            <i className="fas fa-flag"></i> Feriados
                        </li>
                        <li 
                            className={activeView === 'config-view' ? 'active' : ''} 
                            onClick={() => handleNavegarSidebar('config-view')}
                        >
                            <i className="fas fa-sliders-h"></i> Configuración
                        </li>
                    </ul>
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
                            <i className="fas fa-shield-alt text-senati" title="Sesión autenticada"></i>
                            <button className="logout-button" type="button" onClick={handleSolicitarLogout} title="Cerrar sesión" aria-label="Cerrar sesión">
                                <i className="fas fa-sign-out-alt" />
                            </button>
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



                {/* ===================== FIN SECCIÓN EQUIPO 4 ==================== */}


                {/* =============================================================== */}
                {/*    [ÁREA DE TRABAJO] EQUIPO 4: CARRERAS Y MALLAS CURRICULARES   */}
                {/* =============================================================== */}
                <CarrerasView
                    activeView={activeView}
                    setActiveView={setActiveView}
                    triggerToast={triggerToast}
                    carreras={carreras}
                    cargandoCarreras={cargandoCarreras}
                    onRefrescarCarreras={cargarCarreras}
                    onCambiosPendientesChange={setHayCambiosMalla}
                />


                {/* =============================================================== */}
                {/*      [ÁREA DE TRABAJO] EQUIPO 1: DOCENTES Y DISPONIBILIDAD      */}
                {/* =============================================================== */}
                <section id="docentes-view" className={`view ${activeView === 'docentes-view' ? 'active' : ''}`}>
                {activeView === 'docentes-view' && <DocentesView key={periodoGlobal} periodo={periodoGlobal} triggerToast={triggerToast} />}
                </section>
                {/* ===================== FIN SECCIÓN EQUIPO 1 ==================== */}


                {/* =============================================================== */}
                {/*    [ÁREA DE TRABAJO] EQUIPO 2: INFRAESTRUCTURA Y AMBIENTES       */}
                {/* =============================================================== */}
                <section id="aulas-view" className={`view ${activeView === 'aulas-view' ? 'active' : ''}`}>
                    <AmbientesModulo periodoGlobal={periodoGlobal} />
                </section>
<section
    id="feriados-view"
    className={`view ${activeView === 'feriados-view' ? 'active' : ''}`}
>
    <div style={{ width: '100%', maxWidth: '1000px', margin: '0 auto', padding: '24px' }}>
        <FeriadosModulo triggerToast={triggerToast} />
    </div>
</section>
                {/* ===================== FIN SECCIÓN EQUIPO 2 ==================== */}

                {/* =============================================================== */}
                {/*   [GRUPO 4 - CAMBIO 6]: COMPONENTE AUTÓNOMO DE CONFIGURACIÓN     */}
                {/* =============================================================== */}
  
                <section
                id="config-view"
                className={`view ${activeView === 'config-view' ? 'active' : ''}`}
                style={{
                    backgroundImage: `linear-gradient(rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.7)), url(${fondoCarreras})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                    flex: '1 1 auto',
                    maxWidth: 'none',
                    margin: 0
                }}
                >
                <ConfiguracionModulo
                    activeView={activeView}
                    periodoGlobal={periodoGlobal}
                    setPeriodoGlobal={setPeriodoGlobal}
                    triggerToast={triggerToast}
                />
                </section>

            </main>

            {/* =============================================================== */}
            {/*        MODAL DE CONFIRMACIÓN: CERRAR SESIÓN DEL SISTEMA         */}
            {/* =============================================================== */}
            {modalLogoutAbierto && (
                <div className="eq4-modal-overlay" onClick={() => setModalLogoutAbierto(false)}>
                    <div className="eq4-modal-content-custom" onClick={(e) => e.stopPropagation()} style={{ width: '450px' }}>
                        <div className="eq4-modal-header-custom">
                            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#1e293b', margin: 0, fontSize: '16px', fontWeight: '700' }}>
                                <i className="fas fa-sign-out-alt" style={{ color: '#dc2626', fontSize: '18px' }}></i>
                                ¿Cerrar sesión?
                            </h3>
                            <button
                                type="button"
                                className="eq4-modal-close-btn"
                                onClick={() => setModalLogoutAbierto(false)}
                                title="Cerrar ventana"
                            >
                                &times;
                            </button>
                        </div>
                        <div className="eq4-modal-body-custom" style={{ padding: '22px 24px' }}>
                            <p style={{ margin: 0, fontSize: '14px', color: '#334155', lineHeight: 1.5 }}>
                                ¿Está seguro de que desea salir del sistema de horarios?
                            </p>
                            {activeView === 'malla-semestre-view' && (
                                <div style={{
                                    background: '#fef2f2',
                                    color: '#991b1b',
                                    padding: '12px 14px',
                                    borderRadius: '8px',
                                    border: '1px solid #fecaca',
                                    marginTop: '12px',
                                    fontSize: '13px',
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: '8px'
                                }}>
                                    <i className="fas fa-exclamation-triangle" style={{ fontSize: '16px', color: '#dc2626', marginTop: '2px', flexShrink: 0 }}></i>
                                    <div>
                                        Se encuentra en la vista de edición de malla curricular. Asegúrese de haber guardado sus cambios antes de salir.
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="eq4-modal-footer-custom" style={{ padding: '14px 24px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                            <button
                                type="button"
                                className="eq4-btn eq4-btn-secondary"
                                onClick={() => setModalLogoutAbierto(false)}
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                className="eq4-btn"
                                style={{ background: '#dc2626', color: '#ffffff', border: 'none', padding: '8px 16px', borderRadius: '6px', fontWeight: '600', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                                onClick={() => {
                                    setModalLogoutAbierto(false);
                                    logout();
                                }}
                            >
                                <i className="fas fa-sign-out-alt"></i>
                                Sí, Cerrar Sesión
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* =============================================================== */}
            {/*  MODAL DE CONFIRMACIÓN: CAMBIAR DE VISTA O CARRERA DESDE MENÚ   */}
            {/* =============================================================== */}
            {modalNavegacionSidebar.abierto && (
                <div className="eq4-modal-overlay" onClick={() => setModalNavegacionSidebar({ abierto: false, destino: null })}>
                    <div className="eq4-modal-content-custom" onClick={(e) => e.stopPropagation()} style={{ width: '460px' }}>
                        <div className="eq4-modal-header-custom">
                            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#1e293b', margin: 0, fontSize: '16px', fontWeight: '700' }}>
                                <i className="fas fa-exclamation-triangle" style={{ color: '#f59e0b', fontSize: '18px' }}></i>
                                ¿Salir de la malla curricular?
                            </h3>
                            <button
                                type="button"
                                className="eq4-modal-close-btn"
                                onClick={() => setModalNavegacionSidebar({ abierto: false, destino: null })}
                                title="Cerrar ventana"
                            >
                                &times;
                            </button>
                        </div>
                        <div className="eq4-modal-body-custom" style={{ padding: '22px 24px' }}>
                            <p style={{ margin: 0, fontSize: '14px', color: '#334155', lineHeight: 1.5 }}>
                                Está por cambiar de módulo o salir de la gestión de la carrera actual.
                            </p>
                            <div style={{
                                background: '#fef3c7',
                                color: '#92400e',
                                padding: '12px 14px',
                                borderRadius: '8px',
                                border: '1px solid #fde68a',
                                marginTop: '12px',
                                fontSize: '13px',
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '8px'
                            }}>
                                <i className="fas fa-exclamation-circle" style={{ fontSize: '16px', color: '#d97706', marginTop: '2px', flexShrink: 0 }}></i>
                                <div>
                                    Si realizó modificaciones en los semestres o docentes y no hizo clic en <strong>"Guardar Programación"</strong>, los cambios se perderán.
                                </div>
                            </div>
                        </div>
                        <div className="eq4-modal-footer-custom" style={{ padding: '14px 24px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                            <button
                                type="button"
                                className="eq4-btn eq4-btn-secondary"
                                onClick={() => setModalNavegacionSidebar({ abierto: false, destino: null })}
                            >
                                Permanecer en la carrera
                            </button>
                            <button
                                type="button"
                                className="eq4-btn eq4-btn-primary"
                                style={{ background: '#003B70' }}
                                onClick={() => {
                                    const dest = modalNavegacionSidebar.destino;
                                    setModalNavegacionSidebar({ abierto: false, destino: null });
                                    if (dest) setActiveView(dest);
                                }}
                            >
                                Sí, continuar
                            </button>
                        </div>
                    </div>
                </div>
            )}
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
            { codigo: "56P", nombre: "56P - CFP Tacna (Cono Sur)" },
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
    
    // ESTADO PARA HABILITAR / DESHABILITAR DOMINGO
    const [incluirDomingo, setIncluirDomingo] = useState(false);
    
    // ESTADOS PARA LAS HORAS OPERATIVAS
    const [horaInicio, setHoraInicio] = useState("07:00");
    const [horaFin, setHoraFin] = useState("21:00");

    // 1. CARGAR CONFIGURACIÓN GLOBAL DESDE EL BACKEND AL MONTAR EL COMPONENTE
    useEffect(() => {
        const obtenerConfiguracion = async () => {
            try {
                const token = localStorage.getItem('token');
                const response = await fetch('http://localhost:3000/api/configuracion', {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                const result = await response.json();

                if (result.success && result.data && result.data.franja) {
                    const franja = result.data.franja;
                    if (franja.hora_inicio_mañana) setHoraInicio(franja.hora_inicio_mañana.slice(0, 5));
                    if (franja.hora_cierre_noche) setHoraFin(franja.hora_cierre_noche.slice(0, 5));
                    
                    // Carga el estado guardado del domingo en la BD (1 = true, 0 = false)
                    setIncluirDomingo(franja.incluir_domingo === 1);
                }
            } catch (error) {
                console.error("Error al obtener la configuración global:", error);
            }
        };

        obtenerConfiguracion();
    }, []);

    // 2. FUNCIÓN PARA GUARDAR LA FRANJA HORARIA Y EL DOMINGO EN LA BASE DE DATOS
    const handleGuardarConfiguracion = async () => {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('http://localhost:3000/api/configuracion/franja', {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    id_periodo: periodoGlobal || 1,
                    hora_inicio_mañana: horaInicio,
                    hora_cierre_noche: horaFin,
                    incluir_domingo: incluirDomingo
                })
            });

            const data = await response.json();

            if (data.success) {
                if (typeof triggerToast === 'function') {
                    triggerToast("Ajustes guardados correctamente en la BD.", "success");
                }
            } else {
                if (typeof triggerToast === 'function') {
                    triggerToast(data.message || "Error al guardar la configuración.", "error");
                }
            }
        } catch (error) {
            console.error("Error al conectar con la API:", error);
            if (typeof triggerToast === 'function') {
                triggerToast("Error de conexión con el servidor.", "error");
            }
        }
    };

    // [GRUPO 4 - CAMBIO 10]: FUNCIÓN PARA REGISTRAR SEDE CON ALERTA TOAST FLOTANTE
    const handleRegistrarSede = () => {
        if (!nuevoCodigo.trim() || !nuevoNombre.trim()) {
            if (typeof triggerToast === 'function') {
                triggerToast("Por favor ingrese el código y nombre de la sede.", "warning");
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
            triggerToast("Sede registrada correctamente.", "success");
        }
    };

    // Obtener el nombre o código de la sede activa actual para mostrar en el KPI
    const sedeActualObj = (sedesPorZonal[zonalActiva] || []).find(s => s.codigo === sedeActiva);
    const nombreSedeMostrar = sedeActualObj ? sedeActualObj.nombre : (sedeActiva || "Sin Sede");

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto', width: '100%', padding: '24px' }}>
            
            {/* 1. ENCABEZADO PRINCIPAL CON BOTÓN DE GUARDADO */}
            <header style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                marginBottom: '24px' 
            }}>
                <div>
                    <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#1e293b', margin: 0 }}>
                        Ajustes Globales del Sistema
                    </h1>
                    <p style={{ color: '#64748b', fontSize: '13px', marginTop: '4px', margin: 0 }}>
                        Parámetros operativos del campus, sede activa y límites de turno.
                    </p>
                </div>
                <button 
                    type="button"
                    onClick={handleGuardarConfiguracion}
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        backgroundColor: '#0045aa',
                        color: '#ffffff',
                        padding: '10px 20px',
                        borderRadius: '8px',
                        border: 'none',
                        fontWeight: '600',
                        fontSize: '14px',
                        cursor: 'pointer',
                        boxShadow: '0 2px 4px rgba(0, 69, 170, 0.25)'
                    }}
                >
                    <i className="fas fa-check"></i> Guardar Ajustes
                </button>
            </header>

            {/* 2. FILA DE TARJETAS INFORMATIVAS (KPIs) */}
            <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', 
                gap: '16px', 
                marginBottom: '24px' 
            }}>
                {/* KPI 1: SEDE ACTIVA */}
                <div style={{ 
                    backgroundColor: '#ffffff', 
                    padding: '16px 20px', 
                    borderRadius: '12px', 
                    border: '1px solid #e2e8f0', 
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px'
                }}>
                    <div style={{ width: '42px', height: '42px', borderRadius: '10px', backgroundColor: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0045aa' }}>
                        <i className="fas fa-building" style={{ fontSize: '18px' }}></i>
                    </div>
                    <div>
                        <span style={{ fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Sede Activa</span>
                        <div style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b', marginTop: '2px' }}>{nombreSedeMostrar}</div>
                    </div>
                </div>

                {/* KPI 2: PERÍODO LECTIVO */}
                <div style={{ 
                    backgroundColor: '#ffffff', 
                    padding: '16px 20px', 
                    borderRadius: '12px', 
                    border: '1px solid #e2e8f0', 
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px'
                }}>
                    <div style={{ width: '42px', height: '42px', borderRadius: '10px', backgroundColor: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0045aa' }}>
                        <i className="fas fa-calendar-alt" style={{ fontSize: '18px' }}></i>
                    </div>
                    <div>
                        <span style={{ fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Período Lectivo</span>
                        <div style={{ fontSize: '14px', fontWeight: '700', color: '#1e293b', marginTop: '2px' }}>{periodoGlobal || "202620"}</div>
                    </div>
                </div>

                {/* KPI 3: JORNADA OPERATIVA */}
                <div style={{ 
                    backgroundColor: '#ffffff', 
                    padding: '16px 20px', 
                    borderRadius: '12px', 
                    border: '1px solid #e2e8f0', 
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px'
                }}>
                    <div style={{ width: '42px', height: '42px', borderRadius: '10px', backgroundColor: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0045aa' }}>
                        <i className="fas fa-clock" style={{ fontSize: '18px' }}></i>
                    </div>
                    <div>
                        <span style={{ fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Jornada Operativa</span>
                        <div style={{ fontSize: '14px', fontWeight: '700', color: '#1e293b', marginTop: '2px' }}>{horaInicio} – {horaFin} hs</div>
                    </div>
                </div>
            </div>

            {/* 3. FORMULARIO SEPARADO EN TARJETAS ESTRUCTURADAS */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                
                {/* TARJETA A: CONTEXTO INSTITUCIONAL */}
                <div style={{ 
                    backgroundColor: '#ffffff', 
                    borderRadius: '12px', 
                    border: '1px solid #e2e8f0', 
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                    padding: '24px'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', paddingBottom: '12px', borderBottom: '1px solid #f1f5f9' }}>
                        <i className="fas fa-university" style={{ color: '#0045aa', fontSize: '16px' }}></i>
                        <h2 style={{ fontSize: '16px', fontWeight: '700', color: '#1e293b', margin: 0 }}>
                            Contexto Institucional Activo
                        </h2>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                        {/* SELECTOR DE ZONAL */}
                        <div>
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#475569', marginBottom: '6px' }}>
                                Dirección Zonal
                            </label>
                            <select 
                                id="config-zonal" 
                                className="form-select input-lg" 
                                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
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

                        {/* SELECTOR DE SEDE */}
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                <label style={{ fontSize: '13px', fontWeight: '600', color: '#475569', margin: 0 }}>
                                    Sede / Campus (CAMP)
                                </label>
                                <button 
                                    type="button"
                                    style={{ 
                                        padding: '4px 10px', 
                                        fontSize: '12px', 
                                        fontWeight: '600',
                                        color: '#0045aa',
                                        backgroundColor: '#eff6ff',
                                        border: '1px solid #bfdbfe',
                                        borderRadius: '16px',
                                        display: 'inline-flex', 
                                        alignItems: 'center', 
                                        gap: '5px', 
                                        cursor: 'pointer',
                                        whiteSpace: 'nowrap'
                                    }}
                                    onClick={() => {
                                        setNuevaZonal(zonalActiva);
                                        document.getElementById('modal-nueva-sede').style.display = 'flex';
                                    }}
                                >
                                    <i className="fas fa-plus-circle" style={{ color: '#0045aa' }}></i> Nueva Sede
                                </button>
                            </div>
                            
                            <select 
                                id="config-sede" 
                                className="form-select input-lg"
                                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
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

                        {/* SELECTOR DE PERÍODO LECTIVO */}
                        <div style={{ gridColumn: 'span 2' }}>
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#475569', marginBottom: '6px' }}>
                                Período Lectivo Activo
                            </label>
                            <select 
                                id="config-periodo" 
                                className="form-select input-lg" 
                                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                                value={periodoGlobal}
                                onChange={(e) => setPeriodoGlobal && setPeriodoGlobal(e.target.value)}
                            >
                                <option value="202620">202620 - Semestre Académico 2026 - II</option>
                                <option value="202610">202610 - Semestre Académico 2026 - I</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* TARJETA B: FRANJA HORARIA OPERATIVA */}
                <div style={{ 
                    backgroundColor: '#ffffff', 
                    borderRadius: '12px', 
                    border: '1px solid #e2e8f0', 
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                    padding: '24px'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', paddingBottom: '12px', borderBottom: '1px solid #f1f5f9' }}>
                        <i className="fas fa-business-time" style={{ color: '#0045aa', fontSize: '16px' }}></i>
                        <h2 style={{ fontSize: '16px', fontWeight: '700', color: '#1e293b', margin: 0 }}>
                            Franja Horaria Operativa
                        </h2>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#475569', marginBottom: '6px' }}>
                                Inicio Turno Mañana
                            </label>
                            <input 
                                type="time" 
                                id="config-inicio" 
                                className="input-lg" 
                                value={horaInicio} 
                                onChange={(e) => setHoraInicio(e.target.value)}
                                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }} 
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#475569', marginBottom: '6px' }}>
                                Cierre Turno Noche
                            </label>
                            <input 
                                type="time" 
                                id="config-fin" 
                                className="input-lg" 
                                value={horaFin} 
                                onChange={(e) => setHoraFin(e.target.value)}
                                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }} 
                            />
                        </div>

                        {/* OPCIÓN: HABILITAR / DESHABILITAR DOMINGO */}
                        <div style={{ gridColumn: 'span 2', marginTop: '10px', paddingTop: '16px', borderTop: '1px dashed #e2e8f0' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
                                <input 
                                    type="checkbox" 
                                    checked={incluirDomingo}
                                    onChange={(e) => setIncluirDomingo(e.target.checked)}
                                    style={{ width: '18px', height: '18px', accentColor: '#0045aa', cursor: 'pointer' }}
                                />
                                <div>
                                    <span style={{ fontSize: '14px', fontWeight: '600', color: '#1e293b', display: 'block' }}>
                                        Habilitar día Domingo en la programación
                                    </span>
                                    <span style={{ fontSize: '12px', color: '#64748b' }}>
                                        Permite asignar clases y horarios académicos los días domingo.
                                    </span>
                                </div>
                            </label>
                        </div>
                    </div>
                </div>

            </div>

            {/* 4. MODAL FLOTANTE DE REGISTRO DE NUEVA SEDE */}
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
                <div className="card" style={{ width: '480px', padding: '24px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', borderRadius: '12px', background: '#fff' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px' }}>
                        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <i className="fas fa-building" style={{ color: '#0045aa' }}></i> Registrar Nueva Sede / Campus
                        </h3>
                        <button 
                            type="button"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#64748b' }}
                            onClick={() => document.getElementById('modal-nueva-sede').style.display = 'none'}
                        >
                            <i className="fas fa-times"></i>
                        </button>
                    </div>

                    <div>
                        <div className="form-group" style={{ marginBottom: '14px' }}>
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#475569', marginBottom: '6px' }}>
                                Dirección Zonal Perteneciente
                            </label>
                            <select 
                                className="input-lg" 
                                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
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
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#475569', marginBottom: '6px' }}>
                                Código de Campus (CAMP)
                            </label>
                            <input 
                                type="text" 
                                className="input-lg" 
                                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                                placeholder="Ej. 56CS, 10P, 01C" 
                                maxLength={10} 
                                value={nuevoCodigo}
                                onChange={(e) => setNuevoCodigo(e.target.value)}
                            />
                        </div>

                        <div className="form-group" style={{ marginBottom: '14px' }}>
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#475569', marginBottom: '6px' }}>
                                Nombre de la Sede / Centro de Formación
                            </label>
                            <input 
                                type="text" 
                                className="input-lg" 
                                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                                placeholder="Ej. CFP Tacna - Cono Sur" 
                                value={nuevoNombre}
                                onChange={(e) => setNuevoNombre(e.target.value)}
                            />
                        </div>

                        <div className="form-group" style={{ marginBottom: '20px' }}>
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#475569', marginBottom: '6px' }}>
                                Ciudad / Ubicación
                            </label>
                            <input 
                                type="text" 
                                className="input-lg" 
                                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                                placeholder="Ej. Tacna, Moquegua, Arequipa" 
                                value={nuevaCiudad}
                                onChange={(e) => setNuevaCiudad(e.target.value)}
                            />
                        </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
                        <button 
                            type="button"
                            className="eq4-btn eq4-btn-secondary" 
                            style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}
                            onClick={() => document.getElementById('modal-nueva-sede').style.display = 'none'}
                        >
                            Cancelar
                        </button>
                        <button 
                            type="button"
                            style={{ padding: '8px 16px', borderRadius: '6px', background: '#0045aa', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: '600' }}
                            onClick={handleRegistrarSede}
                        >
                            <i className="fas fa-save"></i> Registrar Sede
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
// ===============================================================
//   MÓDULO AUTÓNOMO: FERIADOS (EQUIPO 2) - CON FILTRO POR MES
// ===============================================================
function FeriadosModulo({ triggerToast }) {
    // 1. Iniciamos con un arreglo vacío; los datos vendrán de la base de datos
    const [feriados, setFeriados] = useState([]);

    const [mostrarModal, setMostrarModal] = useState(false);
    const [feriadoEditando, setFeriadoEditando] = useState(null);
    const [replicando, setReplicando] = useState(false);
    const [nuevoFeriado, setNuevoFeriado] = useState({
        fecha: '',
        descripcion: '',
        estado: 'activo'
    });

    // [NUEVO]: Estado para almacenar el mes seleccionado (vacío significa "Todos los meses")
    const anioActual = String(new Date().getFullYear());
    const [filtroAnio, setFiltroAnio] = useState(anioActual);
    const [filtroMes, setFiltroMes] = useState('todos');

    // Cargar feriados desde la Base de Datos
    useEffect(() => {
        const obtenerFeriadosBD = async () => {
            try {
                const response = await authFetch(`${API_BASE_URL}/api/feriados`);
                if (!response.ok) throw new Error('Error al obtener feriados');
                const data = await response.json();
                setFeriados(data);
            } catch (error) {
                console.error(error);
                if (typeof triggerToast === 'function') {
                    triggerToast('No se pudo conectar con la base de datos.');
                }
            }
        };
        obtenerFeriadosBD();
    }, [triggerToast]);
  
    const formatearFecha = (fechaStr) => {
        const soloFecha = fechaStr ? fechaStr.split('T')[0] : '';
        const partes = soloFecha.split('-'); // [YYYY, MM, DD]
        if (partes.length === 3) {
            const anio = partes[0];
            const mesIndex = parseInt(partes[1], 10) - 1;
            const dia = partes[2];
            
            // Creamos una fecha usando componentes UTC o mapeando los nombres de los meses directamente para evitar desfases
            const mesesNombres = [
                'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'
            ];
            return `${dia} de ${mesesNombres[mesIndex] || ''}`;
        }
        return '';
    };

    const obtenerDiaMes = (fechaStr) => {
        const soloFecha = fechaStr ? fechaStr.split('T')[0] : '';
        const partes = soloFecha.split('-'); // [YYYY, MM, DD]
        if (partes.length === 3) {
            const mesesCortos = [
                'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN',
                'JUL', 'AGO', 'SET', 'OCT', 'NOV', 'DIC'
            ];
            const mesIndex = parseInt(partes[1], 10) - 1;
            return {
                dia: partes[2],
                mes: mesesCortos[mesIndex] || ''
            };
        }
        return { dia: '--', mes: '---' };
    };
    const aniosDisponibles = [...new Set([
        anioActual,
        feriados
            .filter(feriado => feriado.fecha)
            .map(feriado => feriado.fecha.split('T')[0].slice(0, 4))
            .filter(anio => /^\d{4}$/.test(anio))
    ].flat())].sort((a, b) => b.localeCompare(a));

    // [MODIFICADO]: Filtrar por mes seleccionado además de ordenar cronológicamente
    const feriadosFiltrados = feriados.filter(feriado => {
        if (filtroMes === 'todos') return true;
        if (!feriado.fecha) return false;
        const mesFeriado = feriado.fecha.split('T')[0].split('-')[1]; // Extrae el "MM" de YYYY-MM-DD
        return mesFeriado === filtroMes;
        const [anioFeriado, mesFeriado] = feriado.fecha.split('T')[0].split('-');
        const coincideAnio = anioFeriado === filtroAnio;
        const coincideMes = filtroMes === 'todos' || mesFeriado === filtroMes;
        return coincideAnio && coincideMes;
    });

    const feriadosOrdenados = [...feriadosFiltrados].sort((a, b) => {
        const fechaA = a.fecha ? a.fecha.split('T')[0].slice(5) : ''; 
        const fechaB = b.fecha ? b.fecha.split('T')[0].slice(5) : ''; 
        return fechaA.localeCompare(fechaB);
    });

    const totalFeriados = feriados.length;
    const feriadosActivos = feriados.filter(f => f.estado === 'activo').length;
    const feriadosInhabilitados = feriados.filter(f => f.estado === 'inhabilitado').length;

    const toggleEstadoFeriado = async (idFeriado) => {
        const feriadoActual = feriados.find(f => f.id_feriado === idFeriado);
        if (!feriadoActual) return;

        const nuevoEstado = feriadoActual.estado === 'activo' ? 'inhabilitado' : 'activo';

        try {
            const response = await authFetch(`${API_BASE_URL}/api/feriados/${idFeriado}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fecha: feriadoActual.fecha.split('T')[0],
                    descripcion: feriadoActual.descripcion,
                    estado: nuevoEstado
                })
            });

            if (!response.ok) throw new Error('Error al actualizar estado');

            setFeriados(prev =>
                prev.map(feriado => {
                    if (feriado.id_feriado === idFeriado) {
                        return { ...feriado, estado: nuevoEstado };
                    }
                    return feriado;
                })
            );

            if (typeof triggerToast === 'function') {
                triggerToast(
                    nuevoEstado === 'activo'
                        ? `Feriado "${feriadoActual.descripcion}" activado correctamente.`
                        : `Feriado "${feriadoActual.descripcion}" inhabilitado correctamente.`
                );
            }
        } catch (error) {
            console.error(error);
            if (typeof triggerToast === 'function') {
                triggerToast('Error al actualizar el estado en la base de datos.');
            }
        }
    };

    const abrirModal = () => {
        setFeriadoEditando(null);
        setNuevoFeriado({
            fecha: '',
            descripcion: '',
            estado: 'activo'
        });
        setMostrarModal(true);
    };

    const abrirModalEdicion = (feriado) => {
        setFeriadoEditando(feriado.id_feriado);
        setNuevoFeriado({
            fecha: feriado.fecha ? feriado.fecha.split('T')[0] : '',
            descripcion: feriado.descripcion || '',
            estado: feriado.estado
        });
        setMostrarModal(true);
    };

    const cerrarModal = () => {
        setMostrarModal(false);
        setFeriadoEditando(null);
    };

    const agregarFeriado = async () => {
        if (!nuevoFeriado.fecha) {
            if (typeof triggerToast === 'function') {
                triggerToast('Debe seleccionar una fecha para el feriado.');
            }
            return;
        }
        if (!nuevoFeriado.descripcion.trim()) {
            if (typeof triggerToast === 'function') {
                triggerToast('Debe ingresar una descripción para el feriado.');
            }
            return;
        }

        try {
            const response = await authFetch(
                feriadoEditando
                    ? `${API_BASE_URL}/api/feriados/${feriadoEditando}`
                    : `${API_BASE_URL}/api/feriados`,
                {
                method: feriadoEditando ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fecha: nuevoFeriado.fecha,
                    descripcion: nuevoFeriado.descripcion.trim(),
                    estado: nuevoFeriado.estado
                })
                }
            );

            if (!response.ok) throw new Error('Error al guardar el feriado');

            const feriadoGuardado = await response.json();
            setFeriados(prev => feriadoEditando
                ? prev.map(feriado => feriado.id_feriado === feriadoEditando ? feriadoGuardado : feriado)
                : [...prev, feriadoGuardado]
            );

            if (typeof triggerToast === 'function') {
                triggerToast(feriadoEditando
                    ? 'Feriado actualizado correctamente.'
                    : 'Feriado registrado correctamente en la base de datos.');
            }

            cerrarModal();
        } catch (error) {
            console.error(error);
            if (typeof triggerToast === 'function') {
                triggerToast('Error al guardar el feriado en el servidor.');
            }
        }
    };

    const replicarFeriadosSiguienteAnio = async () => {
        setReplicando(true);
        try {
            const response = await authFetch(`${API_BASE_URL}/api/feriados/replicar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ anioOrigen: filtroAnio })
            });
            if (!response.ok) throw new Error('Error al replicar los feriados');

            const resultado = await response.json();
            setFeriados(prev => [
                ...prev.filter(feriado => {
                    const anio = feriado.fecha ? feriado.fecha.split('T')[0].slice(0, 4) : '';
                    return anio !== String(resultado.anioDestino);
                }),
                ...resultado.feriados
            ]);
            setFiltroAnio(String(resultado.anioDestino));

            if (typeof triggerToast === 'function') {
                triggerToast(resultado.creados > 0
                    ? `Se replicaron ${resultado.creados} feriados a ${resultado.anioDestino}${resultado.omitidos > 0 ? `; ${resultado.omitidos} ya existían y se omitieron` : ''}.`
                    : `No había feriados nuevos para replicar a ${resultado.anioDestino}.`);
            }
        } catch (error) {
            console.error(error);
            if (typeof triggerToast === 'function') {
                triggerToast('No se pudieron replicar los feriados.');
            }
        } finally {
            setReplicando(false);
        }
    };

    const manejarCambioInput = (e) => {
        const { name, value } = e.target;
        setNuevoFeriado(prev => ({
            ...prev,
            [name]: value
        }));
    };

    return (
        <>
            <header className="feriados-header">
                <div className="feriados-header-info">
                    <h1>Gestión de Feriados</h1>
                    <p className="subtitle">Registro, activación e inhabilitación de días feriados del calendario académico</p>
                </div>
                <div className="feriados-actions">
                    {/* [NUEVO]: Selector de filtro por mes integrado en la cabecera */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                        <i className="far fa-calendar-alt" style={{ color: 'var(--senati-blue)' }}></i>
                        <span style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text-muted)' }}>Filtrar mes:</span>
                        <select 
                            value={filtroMes} 
                            onChange={(e) => setFiltroMes(e.target.value)}
                            style={{ border: 'none', background: 'transparent', fontWeight: '600', fontSize: '13px', color: 'var(--text-dark)', cursor: 'pointer', outline: 'none' }}
                        >
                            <option value="todos">Todos los meses</option>
                            <option value="01">Enero</option>
                            <option value="02">Febrero</option>
                            <option value="03">Marzo</option>
                            <option value="04">Abril</option>
                            <option value="05">Mayo</option>
                            <option value="06">Junio</option>
                            <option value="07">Julio</option>
                            <option value="08">Agosto</option>
                            <option value="09">Setiembre</option>
                            <option value="10">Octubre</option>
                            <option value="11">Noviembre</option>
                            <option value="12">Diciembre</option>
                        </select>
                    </div>

                    <button className="eq4-btn eq4-btn-primary" onClick={abrirModal}>
                    <button
                        type="button"
                        className="eq4-btn eq4-btn-secondary"
                        onClick={replicarFeriadosSiguienteAnio}
                        disabled={replicando}
                    >
                        <i className={`fas ${replicando ? 'fa-spinner fa-spin' : 'fa-clone'}`}></i>
                        {replicando ? 'Replicando...' : `Replicar a ${Number(filtroAnio) + 1}`}
                    </button>
                    <button type="button" className="eq4-btn eq4-btn-primary" onClick={abrirModal}>
                        <i className="fas fa-plus"></i>
                        Nuevo Feriado
                    </button>
                </div>
            </header>

            <div className="feriados-filtros">
                <label className="feriado-filtro">
                    <i className="far fa-calendar-alt" aria-hidden="true"></i>
                    <span>Año</span>
                    <select value={filtroAnio} onChange={(e) => setFiltroAnio(e.target.value)}>
                        {aniosDisponibles.map(anio => (
                            <option key={anio} value={anio}>{anio}</option>
                        ))}
                    </select>
                </label>
                <label className="feriado-filtro">
                    <i className="far fa-calendar" aria-hidden="true"></i>
                    <span>Mes</span>
                    <select value={filtroMes} onChange={(e) => setFiltroMes(e.target.value)}>
                        <option value="todos">Todos los meses</option>
                        <option value="01">Enero</option>
                        <option value="02">Febrero</option>
                        <option value="03">Marzo</option>
                        <option value="04">Abril</option>
                        <option value="05">Mayo</option>
                        <option value="06">Junio</option>
                        <option value="07">Julio</option>
                        <option value="08">Agosto</option>
                        <option value="09">Setiembre</option>
                        <option value="10">Octubre</option>
                        <option value="11">Noviembre</option>
                        <option value="12">Diciembre</option>
                    </select>
                </label>
            </div>

            <div className="feriados-resumen">
                <div className="feriado-resumen-card">
                    <div className="feriado-resumen-icon total">
                        <i className="fas fa-calendar-day"></i>
                    </div>
                    <div className="feriado-resumen-info">
                        <span className="feriado-resumen-valor">{totalFeriados}</span>
                        <span className="feriado-resumen-label">Total de Feriados</span>
                    </div>
                </div>
                <div className="feriado-resumen-card">
                    <div className="feriado-resumen-icon activos">
                        <i className="fas fa-check-circle"></i>
                    </div>
                    <div className="feriado-resumen-info">
                        <span className="feriado-resumen-valor">{feriadosActivos}</span>
                        <span className="feriado-resumen-label">Activos</span>
                    </div>
                </div>
                <div className="feriado-resumen-card">
                    <div className="feriado-resumen-icon inhabilitados">
                        <i className="fas fa-ban"></i>
                    </div>
                    <div className="feriado-resumen-info">
                        <span className="feriado-resumen-valor">{feriadosInhabilitados}</span>
                        <span className="feriado-resumen-label">Inhabilitados</span>
                    </div>
                </div>
            </div>

            <div className="feriados-lista">
                {feriadosOrdenados.map(feriado => {
                    const { dia, mes } = obtenerDiaMes(feriado.fecha);
                    const esInhabilitado = feriado.estado === 'inhabilitado';
                    return (
                        <div
                            key={feriado.id_feriado}
                            className={`feriado-card ${esInhabilitado ? 'inhabilitado' : ''}`}
                        >
                            <div className="feriado-card-info">
                                <div className="feriado-fecha-badge">
                                    <span className="feriado-fecha-dia">{dia}</span>
                                    <span className="feriado-fecha-mes">{mes}</span>
                                </div>
                                <div className="feriado-detalles">
                                    <span className="feriado-descripcion">{feriado.descripcion}</span>
                                    <span className="feriado-fecha-completa">
                                        <i className="far fa-calendar-alt"></i>
                                        {formatearFecha(feriado.fecha)}
                                    </span>
                                </div>
                            </div>
                            <div className="feriado-acciones">
                                <span className={`feriado-estado-badge ${feriado.estado}`}>
                                    <span className="feriado-estado-dot"></span>
                                    {feriado.estado === 'activo' ? 'Activo' : 'Inhabilitado'}
                                </span>
                                <button
                                    type="button"
                                    className="btn-editar-feriado"
                                    onClick={() => abrirModalEdicion(feriado)}
                                    aria-label={`Editar feriado ${feriado.descripcion}`}
                                    title="Editar feriado"
                                >
                                    <i className="fas fa-pen"></i>
                                </button>
                                <button
                                    type="button"
                                    className={`btn-toggle-estado ${feriado.estado === 'activo' ? 'desactivar' : 'activar'}`}
                                    onClick={() => toggleEstadoFeriado(feriado.id_feriado)}
                                >
                                    <i className={`fas ${feriado.estado === 'activo' ? 'fa-toggle-off' : 'fa-toggle-on'}`}></i>
                                    {feriado.estado === 'activo' ? 'Inhabilitar' : 'Activar'}
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>

            {feriadosOrdenados.length === 0 && (
                <div className="workspace-card">
                    <h2>No hay feriados registrados para este mes</h2>
                    <p>Intenta seleccionando otro mes o agrega un nuevo feriado.</p>
                </div>
            )}

            <div className={`feriado-modal-backdrop ${mostrarModal ? 'active' : ''}`}>
                <div className="feriado-modal">
                    <div className="feriado-modal-header">
                        <div className="feriado-modal-title">
                            <i className="fas fa-flag"></i>
                            {feriadoEditando ? 'Editar Feriado' : 'Registrar Nuevo Feriado'}
                        </div>
                        <button className="feriado-modal-close" onClick={cerrarModal}>
                            <i className="fas fa-times"></i>
                        </button>
                    </div>
                    <div className="feriado-modal-body">
                        <div className="feriado-form-group">
                            <label htmlFor="feriado-fecha">Fecha</label>
                            <input
                                id="feriado-fecha"
                                type="date"
                                className="feriado-input"
                                name="fecha"
                                value={nuevoFeriado.fecha}
                                onChange={manejarCambioInput}
                            />
                        </div>
                        <div className="feriado-form-group">
                            <label htmlFor="feriado-descripcion">Descripción</label>
                            <input
                                id="feriado-descripcion"
                                type="text"
                                className="feriado-input"
                                name="descripcion"
                                placeholder="Ej. Día de la Independencia"
                                value={nuevoFeriado.descripcion}
                                onChange={manejarCambioInput}
                                maxLength={255}
                            />
                        </div>
                        <div className="feriado-form-group">
                            <label htmlFor="feriado-estado">Estado inicial</label>
                            <select
                                id="feriado-estado"
                                className="feriado-input"
                                name="estado"
                                value={nuevoFeriado.estado}
                                onChange={manejarCambioInput}
                            >
                                <option value="activo">Activo</option>
                                <option value="inhabilitado">Inhabilitado</option>
                            </select>
                        </div>
                    </div>
                    <div className="feriado-modal-footer">
                        <button className="btn btn-secondary" onClick={cerrarModal}>
                            Cancelar
                        </button>
                        <button className="btn btn-primary" onClick={agregarFeriado}>
                            <i className="fas fa-save"></i>
                            {feriadoEditando ? 'Guardar Cambios' : 'Guardar Feriado'}
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}

// ===============================================================
//   MÓDULO AUTÓNOMO: INFRAESTRUCTURA, AULAS Y AMBIENTES (EQUIPO 2)
// ===============================================================
function AmbientesModulo({ periodoGlobal }) {
    // 1. ESTADOS PRINCIPALES (Datos de la base de datos)
    const [tiposDeAmbiente, setTiposDeAmbiente] = useState([]);
    const [listaAmbientes, setListaAmbientes] = useState([]);
    const [laboratorioSeleccionado, setLaboratorioSeleccionado] = useState(null);
    const [cursos, setCursos] = useState([]);
    const [cursosSeleccionados, setCursosSeleccionados] = useState(new Set());
    const [busquedaCursos, setBusquedaCursos] = useState('');
    const [cargandoCursos, setCargandoCursos] = useState(false);
    const [guardandoCursos, setGuardandoCursos] = useState(false);
    const [errorCursos, setErrorCursos] = useState('');
    const solicitudCursosRef = useRef(0);
    const cursosSeleccionadosRef = useRef(new Set());
    const cambiosPendientesCursosRef = useRef(new Map());
    const cambiosEnCursoCursosRef = useRef(new Map());
    const temporizadoresCursosRef = useRef(new Map());
    const revisionGuardadoCursosRef = useRef(new Map());
    const panelCursosActualRef = useRef(null);
    
    // 2. ESTADOS PARA BÚSQUEDA Y FILTROS
    const [filtroTipo, setFiltroTipo] = useState('todos');
    const [terminoBusqueda, setTerminoBusqueda] = useState('');

    // 3. ESTADOS PARA EL FORMULARIO MODAL (Crear / Editar)
    const [mostrarModal, setMostrarModal] = useState(false);
    const [idEdicion, setIdEdicion] = useState(null);
    const [datosFormulario, setDatosFormulario] = useState({
        codigo_ambiente: '',
        id_tipo_ambiente: '',
        aforo_maximo: '',
        piso_ubicacion: '',
        pabellon: '',
        estado: 'DISPONIBLE'
    });

    const UMBRAL_AFORO_RESTRINGIDO = 18;

    // --- FUNCIONES DE COMUNICACIÓN CON LA BASE DE DATOS (BACKEND) ---

    const cargarAmbientesDesdeBD = async () => {
        try {
            const respuesta = await authFetch(`${API_BASE_URL}/api/ambientes`);
            const datos = await respuesta.json();
            if (!respuesta.ok) throw new Error(datos.mensaje || 'No se pudieron cargar los ambientes.');
            setListaAmbientes(Array.isArray(datos) ? datos : []);
        } catch (error) {
            console.error('Error cargando ambientes:', error);
            setListaAmbientes([]);
        }
    };

    // Este efecto se ejecuta una sola vez al cargar la página
    useEffect(() => {
        authFetch(`${API_BASE_URL}/api/tipos-ambiente`)
            .then(respuesta => respuesta.json())
            .then(datos => setTiposDeAmbiente(Array.isArray(datos) ? datos : []))
            .catch(error => {
                console.error('Error cargando tipos de ambiente:', error);
                setTiposDeAmbiente([]);
            });
        
        cargarAmbientesDesdeBD();
    }, []);


    // --- FUNCIONES PARA MANEJAR EL FORMULARIO MODAL ---

    const abrirModal = (ambienteSeleccionado = null) => {
        if (ambienteSeleccionado) {
            // Modo Editar: Llenamos el formulario con los datos del ambiente
            setIdEdicion(ambienteSeleccionado.id);
            setDatosFormulario({
                codigo_ambiente: ambienteSeleccionado.codigo_ambiente,
                id_tipo_ambiente: ambienteSeleccionado.id_tipo_ambiente,
                aforo_maximo: ambienteSeleccionado.aforo_maximo,
                piso_ubicacion: ambienteSeleccionado.piso_ubicacion,
                pabellon: ambienteSeleccionado.pabellon || ambienteSeleccionado.pabellón,
                estado: ambienteSeleccionado.estado
            });
        } else {
            // Modo Crear Nuevo: Vaciamos el formulario
            setIdEdicion(null);
            setDatosFormulario({
                codigo_ambiente: '',
                id_tipo_ambiente: tiposDeAmbiente.length > 0 ? tiposDeAmbiente[0].id_tipo_ambiente : '',
                aforo_maximo: '',
                piso_ubicacion: '',
                pabellon: '',
                estado: 'DISPONIBLE'
            });
        }
        setMostrarModal(true);
    };

    // Actualiza el estado mientras el usuario escribe en los inputs
    const manejarCambioInput = (evento) => {
        setDatosFormulario({ 
            ...datosFormulario, 
            [evento.target.name]: evento.target.value 
        });
    };

    // Enviar datos al backend para Guardar o Actualizar
    const guardarAmbiente = async (evento) => {
        evento.preventDefault(); // Evita que la página se recargue

        const url = idEdicion
            ? `${API_BASE_URL}/api/ambientes/${idEdicion}`
            : `${API_BASE_URL}/api/ambientes`;
        
        const metodoHTTP = idEdicion ? 'PUT' : 'POST';

        // Convertimos números a enteros para evitar errores en MySQL
        const datosAEnviar = {
            ...datosFormulario,
            id_tipo_ambiente: parseInt(datosFormulario.id_tipo_ambiente),
            aforo_maximo: parseInt(datosFormulario.aforo_maximo),
            piso_ubicacion: parseInt(datosFormulario.piso_ubicacion)
        };

        try {
            const respuesta = await authFetch(url, {
                method: metodoHTTP,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(datosAEnviar)
            });

            if (respuesta.ok) {
                setMostrarModal(false);
                cargarAmbientesDesdeBD(); // Recargamos la tabla visual
            } else {
                const errorDelServidor = await respuesta.json();
                alert(`Error: ${errorDelServidor.mensaje}`);
            }
        } catch (error) {
            console.error('Error al guardar el ambiente:', error);
        }
    };

    // Activar o Desactivar un ambiente
    const alternarEstadoAmbiente = async (id, codigo, estadoActual) => {
        const estaInactivo = String(estadoActual).toUpperCase() === 'INACTIVO';
        const nuevoEstado = estaInactivo ? 'DISPONIBLE' : 'INACTIVO';

        try {
            const respuesta = await authFetch(`${API_BASE_URL}/api/ambientes/${id}/estado`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ estado: nuevoEstado })
            });
            if (respuesta.ok) {
                cargarAmbientesDesdeBD();
            } else {
                const errorServidor = await respuesta.json();
                console.error(`Error al cambiar estado de ${codigo}:`, errorServidor.mensaje);
            }
        } catch (error) {
            console.error('Error al cambiar estado:', error);
        }
    };


    // --- LÓGICA DE FILTROS, BÚSQUEDA Y MATEMÁTICAS ---

    const obtenerNombreTipoAmbiente = (idTipo) => {
        const tipoEncontrado = tiposDeAmbiente.find(t => t.id_tipo_ambiente === idTipo);
        return tipoEncontrado ? tipoEncontrado.nombre_tipo_ambiente : 'Sin Tipo';
    };

    const coincideCategoria = (ambiente, categoria) => {
        if (categoria === 'todos') return true;
        const nombreTipo = obtenerNombreTipoAmbiente(ambiente.id_tipo_ambiente).toLowerCase();
        return nombreTipo.includes(categoria);
    };

    // Filtrar la lista de ambientes según el buscador y los botones
    const ambientesFiltrados = listaAmbientes.filter(ambiente => {
        const coincideTipo = coincideCategoria(ambiente, filtroTipo);
        
        const textoBusqueda = terminoBusqueda.toLowerCase().trim();
        const coincideBusqueda = textoBusqueda === '' || 
            ambiente.codigo_ambiente.toLowerCase().includes(textoBusqueda) ||
            (ambiente.pabellon || ambiente.pabellón || '').toLowerCase().includes(textoBusqueda) ||
            obtenerNombreTipoAmbiente(ambiente.id_tipo_ambiente).toLowerCase().includes(textoBusqueda);
            
        return coincideTipo && coincideBusqueda;
    });

    // Contadores para las tarjetas de resumen
    const contarPorTipo = (categoria) => {
        return listaAmbientes.filter(ambiente => coincideCategoria(ambiente, categoria)).length;
    };

    const capacidadTotal = listaAmbientes.reduce((suma, ambiente) => suma + ambiente.aforo_maximo, 0);
    const cantidadDisponibles = listaAmbientes.filter(a => a.estado.toLowerCase() === 'disponible' || a.estado.toLowerCase() === 'activo').length;
    const esLaboratorio = (ambiente) => obtenerNombreTipoAmbiente(ambiente.id_tipo_ambiente)
        .toLowerCase()
        .includes('laboratorio');

    const cerrarPanelCursos = () => {
        if (guardandoCursos) return;
        solicitudCursosRef.current += 1;
        panelCursosActualRef.current = null;
        setLaboratorioSeleccionado(null);
    };

    const abrirPanelCursos = async (ambiente) => {
        if (!esLaboratorio(ambiente)) return;

        const solicitud = ++solicitudCursosRef.current;
        panelCursosActualRef.current = { ambienteId: ambiente.id, codigoPeriodo: periodoGlobal };
        setLaboratorioSeleccionado(ambiente);
        setBusquedaCursos('');
        setErrorCursos('');
        setCargandoCursos(true);

        try {
            const [respuestaCursos, respuestaPermitidos] = await Promise.all([
                authFetch(`${API_BASE_URL}/api/ambientes/cursos`),
                authFetch(`${API_BASE_URL}/api/ambientes/${ambiente.id}/cursos-permitidos?codigo_periodo=${encodeURIComponent(periodoGlobal)}`)
            ]);
            const [datosCursos, datosPermitidos] = await Promise.all([
                respuestaCursos.json(),
                respuestaPermitidos.json()
            ]);
            if (!respuestaCursos.ok) {
                throw new Error(datosCursos.mensaje || 'No se pudieron cargar los cursos.');
            }
            if (!respuestaPermitidos.ok) {
                throw new Error(datosPermitidos.mensaje || 'No se pudieron cargar los cursos permitidos.');
            }
            if (solicitud !== solicitudCursosRef.current) return;

            setCursos(Array.isArray(datosCursos) ? datosCursos : []);
            const seleccion = new Set((datosPermitidos.id_cursos || []).map(String));
            cursosSeleccionadosRef.current = seleccion;
            setCursosSeleccionados(seleccion);
        } catch (error) {
            console.error('Error al cargar los cursos permitidos:', error);
            if (solicitud === solicitudCursosRef.current) {
                setErrorCursos(error.message || 'No se pudieron cargar los cursos.');
            }
        } finally {
            if (solicitud === solicitudCursosRef.current) setCargandoCursos(false);
        }
    };

    const enviarCambiosCursos = async (ambienteId, codigoPeriodo) => {
        const claveGrupo = `${ambienteId}:${codigoPeriodo}`;
        if (cambiosEnCursoCursosRef.current.has(claveGrupo)) return;

        const pendientes = cambiosPendientesCursosRef.current.get(claveGrupo);
        if (!pendientes || pendientes.size === 0) return;

        cambiosPendientesCursosRef.current.delete(claveGrupo);
        cambiosEnCursoCursosRef.current.set(claveGrupo, pendientes);
        setGuardandoCursos(true);

        try {
            const respuesta = await authFetch(
                `${API_BASE_URL}/api/ambientes/${ambienteId}/cursos-permitidos`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        codigo_periodo: codigoPeriodo,
                        cambios: [...pendientes.values()].map(({ idCurso, permitido }) => ({
                            id_curso: Number(idCurso),
                            permitido
                        }))
                    })
                }
            );
            const datos = await respuesta.json();
            if (!respuesta.ok) {
                throw new Error(datos.mensaje || 'No se pudieron guardar los cambios de cursos.');
            }
        } catch (error) {
            console.error('Error al guardar cambios de cursos:', error);
            const panelActual = panelCursosActualRef.current;
            if (panelActual?.ambienteId === ambienteId &&
                panelActual?.codigoPeriodo === codigoPeriodo) {
                const seleccionRestaurada = new Set(cursosSeleccionadosRef.current);
                for (const cambio of pendientes.values()) {
                    const claveCurso = `${claveGrupo}:${cambio.idCurso}`;
                    if (revisionGuardadoCursosRef.current.get(claveCurso) !== cambio.revision) continue;
                    if (cambio.anterior) seleccionRestaurada.add(cambio.idCurso);
                    else seleccionRestaurada.delete(cambio.idCurso);
                }
                cursosSeleccionadosRef.current = seleccionRestaurada;
                setCursosSeleccionados(seleccionRestaurada);
                setErrorCursos(error.message || 'No se pudieron guardar los cambios de cursos.');
            }
        } finally {
            cambiosEnCursoCursosRef.current.delete(claveGrupo);
            setGuardandoCursos(cambiosEnCursoCursosRef.current.size > 0);

            if (cambiosPendientesCursosRef.current.get(claveGrupo)?.size > 0) {
                setTimeout(() => enviarCambiosCursos(ambienteId, codigoPeriodo), 120);
            }
        }
    };

    const programarEnvioCambiosCursos = (ambienteId, codigoPeriodo) => {
        const claveGrupo = `${ambienteId}:${codigoPeriodo}`;
        const temporizadorAnterior = temporizadoresCursosRef.current.get(claveGrupo);
        if (temporizadorAnterior) clearTimeout(temporizadorAnterior);

        const temporizador = setTimeout(() => {
            temporizadoresCursosRef.current.delete(claveGrupo);
            enviarCambiosCursos(ambienteId, codigoPeriodo);
        }, 120);
        temporizadoresCursosRef.current.set(claveGrupo, temporizador);
    };

    const actualizarSeleccionCursos = (cambios) => {
        if (!laboratorioSeleccionado || cambios.length === 0) return;

        const ambienteId = laboratorioSeleccionado.id;
        const codigoPeriodo = periodoGlobal;
        const claveGrupo = `${ambienteId}:${codigoPeriodo}`;
        const pendientes = cambiosPendientesCursosRef.current.get(claveGrupo) || new Map();
        const enCurso = cambiosEnCursoCursosRef.current.get(claveGrupo) || new Map();
        const seleccionNueva = new Set(cursosSeleccionadosRef.current);
        let huboCambios = false;

        for (const { id_curso: cursoId, permitido } of cambios) {
            const idCurso = String(cursoId);
            const claveCurso = `${claveGrupo}:${idCurso}`;
            const seleccionadoAntes = seleccionNueva.has(idCurso);
            if (seleccionadoAntes === permitido) continue;

            const revision = (revisionGuardadoCursosRef.current.get(claveCurso) || 0) + 1;
            revisionGuardadoCursosRef.current.set(claveCurso, revision);
            const anteriorGuardado = pendientes.get(idCurso) || enCurso.get(idCurso);

            const anterior = anteriorGuardado ? anteriorGuardado.anterior : seleccionadoAntes;
            if (permitido === anterior && !enCurso.has(idCurso)) {
                pendientes.delete(idCurso);
            } else {
                pendientes.set(idCurso, { idCurso, permitido, anterior, revision });
            }
            if (permitido) seleccionNueva.add(idCurso);
            else seleccionNueva.delete(idCurso);
            huboCambios = true;
        }

        if (!huboCambios) return;
        cursosSeleccionadosRef.current = seleccionNueva;
        setCursosSeleccionados(seleccionNueva);
        if (pendientes.size > 0) cambiosPendientesCursosRef.current.set(claveGrupo, pendientes);
        else {
            cambiosPendientesCursosRef.current.delete(claveGrupo);
            const temporizador = temporizadoresCursosRef.current.get(claveGrupo);
            if (temporizador) {
                clearTimeout(temporizador);
                temporizadoresCursosRef.current.delete(claveGrupo);
            }
        }
        setErrorCursos('');
        if (pendientes.size > 0) programarEnvioCambiosCursos(ambienteId, codigoPeriodo);
    };

    const cambiarCursoPermitido = (cursoId, permitido) => {
        actualizarSeleccionCursos([{ id_curso: cursoId, permitido }]);
    };

    const textoBusquedaCursos = busquedaCursos.trim().toLocaleLowerCase();
    const cursosVisibles = cursos.filter((curso) => {
        if (textoBusquedaCursos) {
            return String(curso.mat_cur || '').toLocaleLowerCase().includes(textoBusquedaCursos) ||
                String(curso.nombre_curso || '').toLocaleLowerCase().includes(textoBusquedaCursos);
        }
        return cursosSeleccionados.has(String(curso.id_curso));
    });
    const idsParaSeleccionar = textoBusquedaCursos
        ? cursosVisibles.map((curso) => String(curso.id_curso))
        : cursos.map((curso) => String(curso.id_curso));
    const todosSeleccionados = idsParaSeleccionar.length > 0 &&
        idsParaSeleccionar.every((idCurso) => cursosSeleccionados.has(idCurso));


    // --- RENDERIZADO VISUAL (HTML/JSX) ---
    return (
        <>
            {/* CABECERA Y BUSCADOR */}
            <header className="view-header">
                <div className="header-title-area">
                    <h1>Infraestructura y Ambientes</h1>
                    <p className="subtitle">Gestión de aulas, talleres, laboratorios y espacios académicos</p>
                </div>
                
                <div className="header-actions" style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                    <div className="search-box" style={{ margin: 0, width: '250px' }}>
                        <i className="fas fa-search"></i>
                        <input 
                            type="text" 
                            placeholder="Buscar código..." 
                            value={terminoBusqueda}
                            onChange={(e) => setTerminoBusqueda(e.target.value)}
                        />
                    </div>
                    <button className="ambiente-action-btn ambiente-action-btn-primary ambiente-new-btn" onClick={() => abrirModal()}>
                        <i className="fas fa-plus"></i> Nuevo Ambiente
                    </button>
                </div>
            </header>

            {/* TARJETAS DE RESUMEN SUPERIOR */}
            <div className="ambientes-resumen">
                <div className="resumen-card">
                    <div className="resumen-icon"><i className="fas fa-door-open"></i></div>
                    <div className="resumen-info">
                        <span className="resumen-valor">{listaAmbientes.length}</span>
                        <span className="resumen-label">Total de Ambientes</span>
                    </div>
                </div>
                <div className="resumen-card">
                    <div className="resumen-icon"><i className="fas fa-check-circle"></i></div>
                    <div className="resumen-info">
                        <span className="resumen-valor">{cantidadDisponibles}</span>
                        <span className="resumen-label">Disponibles</span>
                    </div>
                </div>
                <div className="resumen-card">
                    <div className="resumen-icon"><i className="fas fa-users"></i></div>
                    <div className="resumen-info">
                        <span className="resumen-valor">{capacidadTotal}</span>
                        <span className="resumen-label">Capacidad Total</span>
                    </div>
                </div>
            </div>

            {/* BOTONES DE FILTRO POR TIPO */}
            <div className="ambientes-filtros">
                <button className={`ambiente-filter-chip ${filtroTipo === 'todos' ? 'active' : ''}`} onClick={() => setFiltroTipo('todos')}>
                    <i className="fas fa-th"></i> Todos <span className="chip-count">{contarPorTipo('todos')}</span>
                </button>
                <button className={`ambiente-filter-chip ${filtroTipo === 'laboratorio' ? 'active' : ''}`} onClick={() => setFiltroTipo('laboratorio')}>
                    <i className="fas fa-flask"></i> Laboratorio <span className="chip-count">{contarPorTipo('laboratorio')}</span>
                </button>
                <button className={`ambiente-filter-chip ${filtroTipo === 'aula' ? 'active' : ''}`} onClick={() => setFiltroTipo('aula')}>
                    <i className="fas fa-chalkboard-teacher"></i> Aula <span className="chip-count">{contarPorTipo('aula')}</span>
                </button>
            </div>

            {/* GRILLA DE TARJETAS DE AULAS */}
            <div className="ambientes-grid">
                {ambientesFiltrados.map(ambiente => {
                    const esAforoPequeno = ambiente.aforo_maximo < UMBRAL_AFORO_RESTRINGIDO;
                    const estadoNormalizado = (ambiente.estado || '').toLowerCase();
                    const estiloEstado = estadoNormalizado === 'disponible' || estadoNormalizado === 'activo'
                        ? 'disponible'
                        : estadoNormalizado === 'inactivo'
                        ? 'inactivo'
                        : estadoNormalizado.includes('mantenimiento')
                        ? 'mantenimiento'
                        : 'ocupado';
                    const estaInactivo = estadoNormalizado === 'inactivo';
                    
                    return (
                        <div
                            key={ambiente.id}
                            className={`aula-card ${esAforoPequeno ? 'aforo-restringido' : ''} ${esLaboratorio(ambiente) ? 'aula-card-laboratorio' : ''}`}
                            onClick={() => abrirPanelCursos(ambiente)}
                            onKeyDown={(evento) => {
                                if (esLaboratorio(ambiente) && (evento.key === 'Enter' || evento.key === ' ')) {
                                    evento.preventDefault();
                                    abrirPanelCursos(ambiente);
                                }
                            }}
                            role={esLaboratorio(ambiente) ? 'button' : undefined}
                            tabIndex={esLaboratorio(ambiente) ? 0 : undefined}
                        >
                            <div className="aula-card-info">
                                <div className="aula-card-heading">
                                    <div className="aula-codigo">
                                        <i className="far fa-building"></i>
                                        {ambiente.codigo_ambiente}
                                    </div>
                                    <span className="aula-tipo-badge">{obtenerNombreTipoAmbiente(ambiente.id_tipo_ambiente)}</span>
                                </div>

                                <div className="aula-card-details">
                                    <div className="aula-info-item">
                                        <span className="aula-info-label">Pabellón</span>
                                        <span className="aula-info-value"><i className="fas fa-map-marker-alt" style={{ color: 'var(--text-muted)', marginRight: '4px' }}></i>{ambiente.pabellon || ambiente.pabellón}</span>
                                    </div>
                                    <div className="aula-info-item">
                                        <span className="aula-info-label">Piso</span>
                                        <span className="aula-info-value">{ambiente.piso_ubicacion}</span>
                                    </div>
                                    <div className="aula-aforo">
                                        <span className="aula-aforo-label"><i className="fas fa-users"></i> Aforo Máximo</span>
                                        <span className="aula-aforo-valor">{ambiente.aforo_maximo} personas</span>
                                    </div>
                                    {esAforoPequeno && (
                                        <span className="aula-alerta-restringido">
                                            <i className="fas fa-exclamation-circle"></i> Capacidad limitada
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="aula-card-actions">
                                <span className={`aula-estado ${estiloEstado}`}>
                                    <span className="estado-dot"></span>{ambiente.estado}
                                </span>
                                <div className="aula-actions">
                                    {esLaboratorio(ambiente) && (
                                        <button
                                            className="btn-icon courses"
                                            onClick={(evento) => {
                                                evento.stopPropagation();
                                                abrirPanelCursos(ambiente);
                                            }}
                                            title="Configurar cursos asignados"
                                            aria-label={`Configurar cursos permitidos para ${ambiente.codigo_ambiente}`}
                                        >
                                            <i className="fas fa-book"></i>
                                        </button>
                                    )}
                                    <button className="btn-icon edit" onClick={(evento) => { evento.stopPropagation(); abrirModal(ambiente); }} title="Editar"><i className="fas fa-pen"></i></button>
                                    <button
                                        className={`btn-icon ${estaInactivo ? 'status-active' : 'status-inactive'}`}
                                        onClick={(evento) => {
                                            evento.stopPropagation();
                                            alternarEstadoAmbiente(ambiente.id, ambiente.codigo_ambiente, ambiente.estado);
                                        }}
                                        title={estaInactivo ? 'Activar ambiente' : 'Desactivar ambiente'}
                                        aria-label={estaInactivo ? `Activar ambiente ${ambiente.codigo_ambiente}` : `Desactivar ambiente ${ambiente.codigo_ambiente}`}
                                    >
                                        <i className={`fas ${estaInactivo ? 'fa-toggle-off' : 'fa-toggle-on'}`}></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* MENSAJE SI NO HAY RESULTADOS */}
            {ambientesFiltrados.length === 0 && (
                <div className="workspace-card">
                    <h2>No se encontraron resultados</h2>
                    <p>Intenta con un término de búsqueda diferente o cambia el filtro de tipo de ambiente.</p>
                </div>
            )}

            {/* FORMULARIO MODAL (CREAR Y EDITAR) */}
            {mostrarModal && (
                <div className="modal-overlay">
                    <div className="modal-content card-modal">
                        
                        <div className="modal-header-modern">
                            <div className="modal-title-area">
                                <div className="modal-icon-bg">
                                    <i className={`fas ${idEdicion ? 'fa-pen' : 'fa-plus'}`}></i>
                                </div>
                                <div>
                                    <h3>{idEdicion ? 'Editar Ambiente' : 'Nuevo Ambiente'}</h3>
                                    <p>Ingrese los detalles del espacio académico</p>
                                </div>
                            </div>
                            <button className="btn-close" onClick={() => setMostrarModal(false)}>
                                <i className="fas fa-times"></i>
                            </button>
                        </div>

                        <form onSubmit={guardarAmbiente} className="modal-form-modern">
                            <div className="form-grid">
                                
                                <div className="form-group col-span-2">
                                    <label><i className="fas fa-qrcode"></i> Código del Ambiente</label>
                                    <input type="text" name="codigo_ambiente" className="input-modern" value={datosFormulario.codigo_ambiente} onChange={manejarCambioInput} required placeholder="Ej: LAB-101" />
                                </div>
                                
                                <div className="form-group col-span-2">
                                    <label><i className="fas fa-tags"></i> Tipo de Ambiente</label>
                                    <select name="id_tipo_ambiente" className="input-modern" value={datosFormulario.id_tipo_ambiente} onChange={manejarCambioInput} required>
                                        <option value="" disabled>Seleccione un tipo</option>
                                        {tiposDeAmbiente.map(tipo => (
                                            <option key={tipo.id_tipo_ambiente} value={tipo.id_tipo_ambiente}>{tipo.nombre_tipo_ambiente}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label><i className="fas fa-users"></i> Aforo Máximo</label>
                                    <input type="number" name="aforo_maximo" className="input-modern" value={datosFormulario.aforo_maximo} onChange={manejarCambioInput} required placeholder="Ej: 30" />
                                </div>

                                <div className="form-group">
                                    <label><i className="fas fa-layer-group"></i> Piso</label>
                                    <input type="number" name="piso_ubicacion" className="input-modern" value={datosFormulario.piso_ubicacion} onChange={manejarCambioInput} required placeholder="Ej: 1" />
                                </div>

                                <div className="form-group col-span-2">
                                    <label><i className="far fa-building"></i> Pabellón</label>
                                    <input type="text" name="pabellon" className="input-modern" value={datosFormulario.pabellon} onChange={manejarCambioInput} required placeholder="Ej: Pabellón 1" />
                                </div>

                            </div>

                            <div className="modal-footer-modern">
                                <button type="button" className="ambiente-action-btn ambiente-action-btn-secondary" onClick={() => setMostrarModal(false)}>Cancelar</button>
                                <button type="submit" className="ambiente-action-btn ambiente-action-btn-primary">
                                    <i className="fas fa-save"></i> Guardar Ambiente
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {laboratorioSeleccionado && (
                <div
                    className="cursos-panel-overlay"
                    onClick={cerrarPanelCursos}
                    role="presentation"
                >
                    <aside
                        className="cursos-panel"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="cursos-panel-titulo"
                        onClick={(evento) => evento.stopPropagation()}
                    >
                        <header className="cursos-panel-header">
                            <div>
                                <span className="cursos-panel-eyebrow">Cursos asignados</span>
                                <h2 id="cursos-panel-titulo">{laboratorioSeleccionado.codigo_ambiente}</h2>
                                <p>{obtenerNombreTipoAmbiente(laboratorioSeleccionado.id_tipo_ambiente)}</p>
                            </div>
                            <button
                                className="btn-close"
                                onClick={cerrarPanelCursos}
                                disabled={guardandoCursos}
                                aria-label="Cerrar panel de cursos"
                            >
                                <i className="fas fa-times"></i>
                            </button>
                        </header>

                        <div className="cursos-panel-search">
                            <i className="fas fa-search" aria-hidden="true"></i>
                            <input
                                type="search"
                                value={busquedaCursos}
                                onChange={(evento) => setBusquedaCursos(evento.target.value)}
                                placeholder="Buscar cursos por código o nombre..."
                                aria-label="Buscar cursos por código o nombre"
                            />
                        </div>

                        <label className="cursos-seleccionar-todos">
                            <input
                                type="checkbox"
                                checked={todosSeleccionados}
                                disabled={cargandoCursos || idsParaSeleccionar.length === 0}
                                onChange={() => {
                                    const permitido = !todosSeleccionados;
                                    actualizarSeleccionCursos(idsParaSeleccionar.map((idCurso) => ({
                                        id_curso: idCurso,
                                        permitido
                                    })));
                                }}
                            />
                            <span>
                                {todosSeleccionados
                                    ? (textoBusquedaCursos ? 'Deseleccionar resultados' : 'Deseleccionar todo')
                                    : (textoBusquedaCursos ? 'Seleccionar resultados' : 'Seleccionar todo')}
                            </span>
                            <small>{cursosSeleccionados.size} seleccionados</small>
                        </label>

                        {errorCursos && <p className="cursos-panel-error" role="alert">{errorCursos}</p>}
                        {guardandoCursos && <p className="cursos-panel-status" role="status">Guardando cambios...</p>}
                        {cargandoCursos ? (
                            <p className="cursos-panel-empty">Cargando cursos...</p>
                        ) : cursosVisibles.length > 0 ? (
                            <div className="cursos-panel-lista">
                                {cursosVisibles.map((curso) => {
                                    const seleccionado = cursosSeleccionados.has(String(curso.id_curso));
                                    return (
                                        <label className="curso-opcion" key={curso.id_curso}>
                                            <input
                                                type="checkbox"
                                                checked={seleccionado}
                                                onChange={() => {
                                                    cambiarCursoPermitido(curso.id_curso, !seleccionado);
                                                }}
                                            />
                                            <span className="curso-opcion-detalle">
                                                <div className="curso-opcion-encabezado">
                                                    <strong>{curso.mat_cur}</strong>
                                                    {(curso.codigo_carrera || curso.semestre) && (
                                                        <span className="curso-carrera-badge">
                                                            {curso.codigo_carrera || 'Carrera'} • Semestre {curso.semestre || '-'}
                                                        </span>
                                                    )}
                                                </div>
                                                <span className="curso-opcion-nombre">{curso.nombre_curso}</span>
                                                {curso.nombre_carrera && (
                                                    <small className="curso-opcion-carrera">{curso.nombre_carrera}</small>
                                                )}
                                            </span>
                                        </label>
                                    );
                                })}
                            </div>
                        ) : (
                            <p className="cursos-panel-empty">
                                {textoBusquedaCursos
                                    ? 'No se encontraron cursos con esa búsqueda.'
                                    : 'No hay cursos asignados. Busca cursos para agregarlos.'}
                            </p>
                        )}
                    </aside>
                </div>
            )}
        </>
    );
}

export default App;