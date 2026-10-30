import { useState, useEffect, useRef } from 'react';
import senatiLogo from './assets/logo-senati.png';
import { API_BASE_URL } from './config/api';

//--------Estructura referencial del Excel de cursos aceptado - EQUIPO 4 SECCION CURSOS ---------------
// La fila 1 es un título general, la fila 2 son los encabezados y desde la fila 3 vienen los cursos.
const columnasExcelCursos = [
    { nombre: 'CODIGO', ejemplo: 'PIAD', omitida: false },
    { nombre: 'CATALOGO', ejemplo: '202610', omitida: true },
    { nombre: 'MAT CUR', ejemplo: 'SCIU-185', omitida: false },
    { nombre: 'HORARIO SINFO', ejemplo: 'TEC', omitida: false },
    { nombre: 'CLASIFICACIÓN BLACKBOARD', ejemplo: 'TEC', omitida: true },
    { nombre: 'SEMESTRE', ejemplo: 'I', omitida: false },
    { nombre: 'DESCRIPCIÓN DE CURSO', ejemplo: 'MATEMÁTICA', omitida: false },
    { nombre: 'SEMANAS', ejemplo: '16', omitida: false },
    { nombre: 'TEORÍA / TECNOLOGÍA', ejemplo: '64', omitida: false },
    { nombre: 'TALLER / EMPRESA', ejemplo: '—', omitida: false },
    { nombre: 'VIRTUAL', ejemplo: '16', omitida: false },
    { nombre: 'EVALUACIÓN SEMESTRAL', ejemplo: '5', omitida: false },
    { nombre: 'TOTAL HORAS', ejemplo: '85', omitida: false }
];
//------------------------------------------------------------------------------------------------------

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
    // eslint-disable-next-line no-unused-vars
    const [carreras, setCarreras] = useState([]);
    // eslint-disable-next-line no-unused-vars
    const [currentUser, setCurrentUser] = useState(null);


// ------------------------Nuevas CONST  (Equipo 4 CURSOS )--------------------------------------
    const [modalImportarAbierto, setModalImportarAbierto] = useState(false);
    const [archivoSeleccionado, setArchivoSeleccionado] = useState(null);
    const [arrastrandoArchivo, setArrastrandoArchivo] = useState(false);
    const [cargandoProceso, setCargandoProceso] = useState(false);
    const [resultadoImportacion, setResultadoImportacion] = useState(null);
    const [errorImportacion, setErrorImportacion] = useState(null);

    // Progreso real de la importación (job + polling al backend) - Equipo 4
    const [progresoImportacion, setProgresoImportacion] = useState(null);
    const [panelProgresoVisible, setPanelProgresoVisible] = useState(false);
    const intervaloProgresoRef = useRef(null);

    const detenerPollingProgreso = () => {
        if (intervaloProgresoRef.current) {
            clearInterval(intervaloProgresoRef.current);
            intervaloProgresoRef.current = null;
        }
    };

    // Limpia el intervalo si el componente se desmonta
    useEffect(() => {
        return () => detenerPollingProgreso();
    }, []);

    // Manejador de selección de archivo mediante el botón de examinar
    const manejarCambioArchivo = (e) => {
        if (e.target.files && e.target.files[0]) {
            setArchivoSeleccionado(e.target.files[0]);
            setResultadoImportacion(null);
            setErrorImportacion(null);
        }
    };

    // Manejadores para arrastrar y soltar (Drag and Drop)
    const manejarArrastreSobre = (e) => {
        e.preventDefault();
        setArrastrandoArchivo(true);
    };

    const manejarSalidaArrastre = () => {
        setArrastrandoArchivo(false);
    };

    const manejarSoltarArchivo = (e) => {
        e.preventDefault();
        setArrastrandoArchivo(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            setArchivoSeleccionado(e.dataTransfer.files[0]);
            setResultadoImportacion(null);
            setErrorImportacion(null);
        }
    };

    // Consulta periódicamente el avance de la importación hasta que termine.
    const seguirProgresoImportacion = (jobId) => {
        return new Promise((resolve) => {
            const consultar = async () => {
                try {
                    const respuesta = await fetch(`http://localhost:3000/api/mallas/importar-excel/progreso/${jobId}`);
                    const datos = await respuesta.json();

                    if (!respuesta.ok) {
                        detenerPollingProgreso();
                        setErrorImportacion({
                            mensaje: datos.mensaje || 'No se pudo consultar el avance de la importación.'
                        });
                        setCargandoProceso(false);
                        resolve();
                        return;
                    }

                    const trabajo = datos.trabajo;

                    setProgresoImportacion({
                        porcentaje: trabajo.porcentaje || 0,
                        paso: trabajo.paso || 'Procesando',
                        mensaje: trabajo.mensaje || '',
                        datos: trabajo.datos || {}
                    });

                    if (trabajo.estado === 'completado') {
                        detenerPollingProgreso();
                        setResultadoImportacion(trabajo.resultado);
                        setCargandoProceso(false);
                        resolve();
                        return;
                    }

                    if (trabajo.estado === 'error') {
                        detenerPollingProgreso();
                        setErrorImportacion(trabajo.error || {
                            mensaje: trabajo.mensaje || 'Error al procesar el archivo.'
                        });
                        setCargandoProceso(false);
                        resolve();
                    }
                } catch (error) {
                    detenerPollingProgreso();
                    console.error('Error al consultar el progreso:', error);
                    setErrorImportacion({
                        mensaje: 'Se perdió la conexión con el servidor mientras se procesaba el archivo.'
                    });
                    setCargandoProceso(false);
                    resolve();
                }
            };

            consultar();
            intervaloProgresoRef.current = setInterval(consultar, 500);
        });
    };

    // Enviar el archivo Excel al backend para que lo lea en memoria y lo inserte
    const subirArchivoExcel = async () => {
        if (!archivoSeleccionado) return;

        detenerPollingProgreso();
        setCargandoProceso(true);
        setErrorImportacion(null);
        setResultadoImportacion(null);
        setPanelProgresoVisible(true);
        setProgresoImportacion({
            porcentaje: 0,
            paso: 'Subiendo archivo',
            mensaje: `Enviando "${archivoSeleccionado.name}" al servidor...`,
            datos: {}
        });

        const datosFormulario = new FormData();
        datosFormulario.append('archivo', archivoSeleccionado);

        try {
            const respuesta = await fetch('http://localhost:3000/api/mallas/importar-excel?progreso=1', {
                method: 'POST',
                body: datosFormulario
            });

            const datos = await respuesta.json();

            if (!respuesta.ok || !datos.jobId) {
                setPanelProgresoVisible(false);
                setErrorImportacion({
                    mensaje: datos.mensaje || 'Error al procesar el archivo',
                    detalle: datos.detalle,
                    tipo: datos.tipo,
                    carrerasFaltantes: datos.carrerasFaltantes || []
                });
                setCargandoProceso(false);
                return;
            }

            // El modal se cierra y el avance sigue visible en el panel flotante.
            setModalImportarAbierto(false);
            await seguirProgresoImportacion(datos.jobId);
        } catch (error) {
            console.error('Error al subir archivo:', error);
            detenerPollingProgreso();
            setPanelProgresoVisible(false);
            setErrorImportacion({
                mensaje: error.message || 'No se pudo conectar con el servidor.'
            });
            setCargandoProceso(false);
        }
    };

    // Abre el modal de importación limpio (no permite abrirlo mientras hay un proceso activo)
    const abrirModalImportacion = () => {
        if (cargandoProceso) return;

        setArchivoSeleccionado(null);
        setResultadoImportacion(null);
        setErrorImportacion(null);
        setProgresoImportacion(null);
        setPanelProgresoVisible(false);
        setModalImportarAbierto(true);
    };

    // Cierra el modal. Si hay una importación en curso, el panel flotante sigue visible.
    const cerrarModal = () => {
        setModalImportarAbierto(false);

        if (!cargandoProceso) {
            detenerPollingProgreso();
            setArchivoSeleccionado(null);
            setResultadoImportacion(null);
            setErrorImportacion(null);
            setProgresoImportacion(null);
            setPanelProgresoVisible(false);
        }
    };

    // Cierra el panel flotante cuando la importación ya terminó (éxito o error).
    const cerrarPanelProgreso = () => {
        if (cargandoProceso) return;

        detenerPollingProgreso();
        setPanelProgresoVisible(false);
        setArchivoSeleccionado(null);
        setResultadoImportacion(null);
        setErrorImportacion(null);
        setProgresoImportacion(null);
    };

    // Estados para el Modal "Agregar Nueva Carrera" (Equipo 3)
    const [modalNuevaCarreraAbierto, setModalNuevaCarreraAbierto] = useState(false);
    const [codigoNuevaCarrera, setCodigoNuevaCarrera] = useState('');
    const [nombreNuevaCarrera, setNombreNuevaCarrera] = useState('');
    const [guardandoCarrera, setGuardandoCarrera] = useState(false);
    const [mensajeNuevaCarrera, setMensajeNuevaCarrera] = useState(null);

    // Función para registrar una nueva carrera con su código y nombre institucional
    const guardarNuevaCarrera = async (e) => {
        if (e) e.preventDefault();
        if (!codigoNuevaCarrera.trim() || !nombreNuevaCarrera.trim()) return;

        setGuardandoCarrera(true);
        setMensajeNuevaCarrera(null);

        try {
            const res = await fetch('http://localhost:3000/api/carreras', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    codigo_carrera: codigoNuevaCarrera.trim().toUpperCase(),
                    nombre_carrera: nombreNuevaCarrera.trim()
                })
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.mensaje || 'Error al guardar la carrera');
            }

            setMensajeNuevaCarrera({ tipo: 'success', texto: data.mensaje });
            setCodigoNuevaCarrera('');
            setNombreNuevaCarrera('');
            setErrorImportacion(null);
        } catch (err) {
            setMensajeNuevaCarrera({ tipo: 'error', texto: err.message });
        } finally {
            setGuardandoCarrera(false);
        }
    };
//----------------------------------Fin de agregados CONST EQUIPO 4-------------------------------------------------

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

    const carrerasFiltradas = (carreras || []).filter(c => {
        const nombre = typeof c === 'string' ? c : (c.nombre || '');
        return nombre.toLowerCase().includes(searchCarrera.toLowerCase().trim());
    });

    // ---------Datos derivados para el panel flotante de progreso - Equipo 4 SECCION CURSOS)------------------------------------------------------------
    const datosProgreso = (progresoImportacion && progresoImportacion.datos) || {};
    const porcentajeProgreso = Math.max(0, Math.min(100, progresoImportacion?.porcentaje ?? (resultadoImportacion ? 100 : 0)));
    const panelConError = !cargandoProceso && !!errorImportacion;
    const panelCompletado = !cargandoProceso && !!resultadoImportacion;
    // ----------------------------------------------------------------------------------------------------------------------------------
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



                {/* ===================== FIN SECCIÓN EQUIPO 4 ==================== */}


                {/* =============================================================== */}
                {/*    [ÁREA DE TRABAJO] EQUIPO 4: CARRERAS Y MALLAS CURRICULARES   */}
                {/* =============================================================== */}
                <section id="carreras-view" className={`view ${activeView === 'carreras-view' ? 'active' : ''}`}>
                    {/* Encabezado con Botón para Cargar Mallas Curriculares */}
                    <header className="eq4-view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
                        <div className="eq4-header-title-area">
                            <h1 style={{ fontSize: '22px', fontWeight: '700', color: 'var(--text-dark)' }}>Directorio Institucional de Carreras y Mallas</h1>
                            <p className="eq4-subtitle" style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>
                                Estructura oficial de programas académicos y asignaturas formativas del 1.º al 6.º semestre.
                            </p>
                        </div>
                        <div className="eq4-header-actions" style={{ display: 'flex', gap: '10px' }}>
                            <button 
                                className="eq4-btn eq4-btn-secondary"
                                onClick={() => {
                                    setMensajeNuevaCarrera(null);
                                    setModalNuevaCarreraAbierto(true);
                                }}
                            >
                                <i className="fas fa-plus-circle" style={{ color: 'var(--senati-blue)' }}></i> Agregar Nueva Carrera
                            </button>
                            <button 
                                className="eq4-btn eq4-btn-primary"
                                onClick={abrirModalImportacion}
                                disabled={cargandoProceso}
                                title={cargandoProceso ? 'Espera a que termine la importación en curso' : 'Cargar mallas curriculares desde Excel'}
                            >
                                <i className="fas fa-file-excel" style={{ color: '#A7F3D0' }}></i> Cargar Mallas Curriculares (Excel)
                            </button>
                        </div>
                    </header>

                </section>

                {/* [GRUPO 4 - CAMBIO 5]: ENVÍO DE PERIODOGLOBAL Y TRIGGERTOAST COMO PROPS */}
                <CarrerasModulo 
                    activeView={activeView} 
                    setActiveView={setActiveView} 
                    triggerToast={triggerToast}
                />
                    
                

                
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
                    <AmbientesModulo />
                </section>



                <section id="feriados-view" className={`view ${activeView === 'feriados-view' ? 'active' : ''}`}>
                    <FeriadosModulo triggerToast={triggerToast} />
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

            {/* ================================================================= */}
            {/*        MODAL DE IMPORTACIÓN DRAG & DROP (EXCEL) - EQUIPO 3        */}
            {/* ================================================================= */}
            {modalImportarAbierto && (
                <div className="eq4-modal-overlay" onClick={cerrarModal}>
                    <div className="eq4-modal-content-custom" onClick={(e) => e.stopPropagation()}>
                        <div className="eq4-modal-header-custom">
                            <h3>
                                <i className="fas fa-file-excel" style={{ color: '#10B981' }}></i>
                                Importar y Depurar Tabla Excel
                            </h3>
                            <button className="eq4-modal-close-btn" onClick={cerrarModal}>
                                <i className="fas fa-times"></i>
                            </button>
                        </div>

                        <div className="eq4-modal-body-custom">
                            {!resultadoImportacion ? (
                                <>
                                    <div style={{ marginBottom: '16px' }}>
                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-dark)', marginBottom: '6px' }}>
                                            Estructura / Tabla Destino
                                        </label>
                                        <select 
                                            style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px', background: 'white' }}
                                            defaultValue="mallas"
                                        >
                                            <option value="mallas">Cargar Mallas Curriculares</option>
                                            <option value="docentes" disabled>Cargar Instructores (Docentes)</option>
                                            <option value="aulas" disabled>Cargar Ambientes (Aulas/Laboratorios)</option>
                                        </select>
                                    </div>

                                    {/* Zona Drag and Drop para arrastrar y soltar */}
                                    <div 
                                        className={`eq4-upload-zone-custom ${arrastrandoArchivo ? 'eq4-dragover' : ''}`}
                                        onDragOver={manejarArrastreSobre}
                                        onDragLeave={manejarSalidaArrastre}
                                        onDrop={manejarSoltarArchivo}
                                        onClick={() => document.getElementById('input-archivo-excel').click()}
                                        style={{
                                            pointerEvents: cargandoProceso ? 'none' : 'auto',
                                            opacity: cargandoProceso ? 0.55 : 1
                                        }}
                                    >
                                        <i className="fas fa-cloud-upload-alt eq4-upload-icon-custom"></i>
                                        <span className="eq4-upload-title-custom">Arrastre el archivo (.xlsx / .csv) aquí</span>
                                        <span className="eq4-upload-subtitle-custom">o haga clic para examinar sus archivos</span>
                                        <input 
                                            type="file" 
                                            id="input-archivo-excel" 
                                            accept=".xlsx, .xls, .csv" 
                                            style={{ display: 'none' }}
                                            onChange={manejarCambioArchivo}
                                        />
                                    </div>

                                    {/* Vista previa de la estructura del Excel aceptado - Equipo 3 */}
                                    <div style={{ marginTop: '16px', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden', background: 'white' }}>
                                        <div style={{ padding: '10px 12px', background: '#F8FAFC', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                            <strong style={{ fontSize: '11px', color: 'var(--text-dark)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <i className="fas fa-table" style={{ color: 'var(--senati-blue)' }}></i>
                                                Vista previa de la estructura aceptada
                                            </strong>
                                            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                                                Fila 1: título · Fila 2: encabezados · Fila 3 en adelante: cursos
                                            </span>
                                        </div>

                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={{ borderCollapse: 'collapse', minWidth: '960px', width: '100%', fontSize: '10px' }}>
                                                <thead>
                                                    <tr>
                                                        {columnasExcelCursos.map((columna) => (
                                                            <th
                                                                key={columna.nombre}
                                                                style={{
                                                                    padding: '7px 6px',
                                                                    borderBottom: '1px solid var(--border)',
                                                                    borderRight: '1px solid var(--border-light)',
                                                                    textAlign: 'left',
                                                                    verticalAlign: 'top',
                                                                    minWidth: '82px',
                                                                    background: columna.omitida ? '#FEF2F2' : '#EFF6FF',
                                                                    color: columna.omitida ? '#991B1B' : '#1E3A8A',
                                                                    fontWeight: '700',
                                                                    lineHeight: '1.25'
                                                                }}
                                                            >
                                                                <span style={{ textDecoration: columna.omitida ? 'line-through' : 'none' }}>
                                                                    {columna.nombre}
                                                                </span>
                                                                {columna.omitida && (
                                                                    <span style={{
                                                                        display: 'block',
                                                                        marginTop: '3px',
                                                                        fontSize: '8px',
                                                                        fontWeight: '700',
                                                                        color: '#B91C1C',
                                                                        background: '#FEE2E2',
                                                                        border: '1px solid #FECACA',
                                                                        borderRadius: '999px',
                                                                        padding: '1px 5px',
                                                                        width: 'fit-content',
                                                                        textDecoration: 'none'
                                                                    }}>
                                                                        SE OMITIRÁ
                                                                    </span>
                                                                )}
                                                            </th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    <tr>
                                                        {columnasExcelCursos.map((columna) => (
                                                            <td
                                                                key={columna.nombre}
                                                                style={{
                                                                    padding: '7px 6px',
                                                                    borderBottom: '1px solid var(--border-light)',
                                                                    borderRight: '1px solid var(--border-light)',
                                                                    background: columna.omitida ? '#FEF2F2' : 'white',
                                                                    color: columna.omitida ? '#B91C1C' : 'var(--text-normal)',
                                                                    textDecoration: columna.omitida ? 'line-through' : 'none',
                                                                    whiteSpace: 'nowrap'
                                                                }}
                                                            >
                                                                {columna.ejemplo}
                                                            </td>
                                                        ))}
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>

                                        <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', background: '#FFFBEB', fontSize: '10px', color: '#92400E', lineHeight: '1.5', display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                                            <i className="fas fa-info-circle" style={{ marginTop: '2px' }}></i>
                                            <span>
                                                Las columnas <strong>CATALOGO</strong> y <strong>CLASIFICACIÓN BLACKBOARD</strong> pueden venir en el Excel, pero el sistema <strong>no las insertará</strong> en la base de datos. Los cursos se leen desde la <strong>fila 3</strong>.
                                                <br />
                                                <span style={{ color: '#B45309' }}>Desliza horizontalmente la tabla para ver todas las columnas.</span>
                                            </span>
                                        </div>
                                    </div>

                                    {archivoSeleccionado && (
                                        <div className="eq4-file-selected-badge">
                                            <span>
                                                <i className="fas fa-file-excel" style={{ marginRight: '8px', color: '#10B981' }}></i>
                                                {archivoSeleccionado.name} ({(archivoSeleccionado.size / 1024).toFixed(1)} KB)
                                            </span>
                                            <span style={{ color: '#059669', fontSize: '12px' }}>
                                                <i className="fas fa-check-circle"></i> Listo para procesar
                                            </span>
                                        </div>
                                    )}

                                    {errorImportacion && (
                                        <div style={{ marginTop: '14px', padding: '14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '8px', color: '#991B1B', fontSize: '13px' }}>
                                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                                                <i className="fas fa-exclamation-triangle" style={{ fontSize: '16px', marginTop: '2px' }}></i>
                                                <div style={{ flex: 1 }}>
                                                    <strong>{errorImportacion.mensaje || errorImportacion}</strong>
                                                    {errorImportacion.detalle && (
                                                        <p style={{ margin: '6px 0 10px 0', fontSize: '12px', color: '#7F1D1D' }}>
                                                            {errorImportacion.detalle}
                                                        </p>
                                                    )}
                                                    {errorImportacion.carrerasFaltantes && errorImportacion.carrerasFaltantes.length > 0 && (
                                                        <button 
                                                            type="button"
                                                            className="eq4-btn eq4-btn-sm eq4-btn-primary"
                                                            style={{ marginTop: '4px' }}
                                                            onClick={() => {
                                                                setCodigoNuevaCarrera(errorImportacion.carrerasFaltantes[0] || '');
                                                                setMensajeNuevaCarrera(null);
                                                                cerrarModal();
                                                                setModalNuevaCarreraAbierto(true);
                                                            }}
                                                        >
                                                            <i className="fas fa-plus"></i> Registrar Carrera {errorImportacion.carrerasFaltantes[0]} Ahora
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div>
                                    <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', padding: '16px', borderRadius: '8px', marginBottom: '16px' }}>
                                        <strong style={{ color: '#065F46', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <i className="fas fa-check-circle" style={{ fontSize: '16px' }}></i> {resultadoImportacion.mensaje}
                                        </strong>
                                        <p style={{ fontSize: '12px', color: '#047857', marginTop: '6px' }}>
                                            Archivo procesado: <strong>{resultadoImportacion.nombreArchivo}</strong>
                                        </p>
                                    </div>

                                    <div style={{ background: '#F8FAFC', border: '1px solid var(--border)', borderRadius: '8px', padding: '14px', fontSize: '13px' }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                            <div>Filas leídas: <strong>{resultadoImportacion.reporte?.totalFilasLeidas}</strong></div>
                                            <div>Carreras verificadas: <strong>{resultadoImportacion.reporte?.carrerasVerificadas}</strong></div>
                                            <div>Semestres nuevos: <strong>{resultadoImportacion.reporte?.semestresCreados}</strong></div>
                                            <div>Cursos insertados: <strong style={{ color: '#059669' }}>{resultadoImportacion.reporte?.cursosInsertados}</strong></div>
                                            <div>Duplicados por carrera ignorados: <strong style={{ color: '#D97706' }}>{resultadoImportacion.reporte?.filasIgnoradasPorRepetido}</strong></div>
                                        </div>
                                        <div style={{ marginTop: '12px', fontSize: '11px', color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: '8px', lineHeight: '1.5' }}>
                                            <i className="fas fa-shield-alt"></i> Se ignoraron automáticamente las columnas: <strong>CATALOGO</strong> y <strong>CLASIFICACION BLACKBOARD</strong>.
                                            <br />
                                            <i className="fas fa-copy"></i> {resultadoImportacion.reglaDuplicados || 'Un mismo curso se registra una sola vez por carrera, pero sí puede pertenecer a carreras diferentes.'}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="eq4-modal-footer-custom">
                            <button className="eq4-btn eq4-btn-secondary" onClick={cerrarModal}>
                                {resultadoImportacion ? 'Cerrar' : 'Cancelar'}
                            </button>
                            {!resultadoImportacion && (
                                <button 
                                    className="eq4-btn eq4-btn-primary"
                                    disabled={!archivoSeleccionado || cargandoProceso}
                                    onClick={subirArchivoExcel}
                                >
                                    <i className={cargandoProceso ? "fas fa-spinner fa-spin" : "fas fa-sync-alt"}></i>
                                    {cargandoProceso
                                        ? `Procesando... ${progresoImportacion?.porcentaje || 0}%`
                                        : 'Analizar y Cargar Datos'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ================================================================= */}
            {/*      MODAL PARA REGISTRAR NUEVA CARRERA OFICIAL - EQUIPO 3        */}
            {/* ================================================================= */}
            {modalNuevaCarreraAbierto && (
                <div className="eq4-modal-overlay" onClick={() => setModalNuevaCarreraAbierto(false)}>
                    <div className="eq4-modal-content-custom" onClick={(e) => e.stopPropagation()} style={{ width: '480px' }}>
                        <div className="eq4-modal-header-custom">
                            <h3>
                                <i className="fas fa-graduation-cap" style={{ color: 'var(--senati-blue)' }}></i>
                                Agregar Nueva Carrera
                            </h3>
                            <button className="eq4-modal-close-btn" onClick={() => setModalNuevaCarreraAbierto(false)}>
                                <i className="fas fa-times"></i>
                            </button>
                        </div>

                        <form onSubmit={guardarNuevaCarrera}>
                            <div className="eq4-modal-body-custom">
                                {mensajeNuevaCarrera && (
                                    <div style={{
                                        padding: '12px',
                                        borderRadius: '8px',
                                        marginBottom: '16px',
                                        fontSize: '13px',
                                        background: mensajeNuevaCarrera.tipo === 'success' ? '#ECFDF5' : '#FEF2F2',
                                        border: `1px solid ${mensajeNuevaCarrera.tipo === 'success' ? '#A7F3D0' : '#FECACA'}`,
                                        color: mensajeNuevaCarrera.tipo === 'success' ? '#065F46' : '#991B1B'
                                    }}>
                                        {mensajeNuevaCarrera.texto}
                                    </div>
                                )}

                                <div style={{ marginBottom: '14px' }}>
                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-dark)', marginBottom: '6px' }}>
                                        Código de Carrera (Sigla oficial) *
                                    </label>
                                    <input 
                                        type="text" 
                                        placeholder="Ej. MTRX, PIAD, PCBD"
                                        value={codigoNuevaCarrera}
                                        onChange={(e) => setCodigoNuevaCarrera(e.target.value.toUpperCase())}
                                        style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px' }}
                                        required
                                    />
                                </div>

                                <div style={{ marginBottom: '14px' }}>
                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-dark)', marginBottom: '6px' }}>
                                        Nombre Institucional de la Carrera *
                                    </label>
                                    <input 
                                        type="text" 
                                        placeholder="Ej. Mecatrónica Industrial"
                                        value={nombreNuevaCarrera}
                                        onChange={(e) => setNombreNuevaCarrera(e.target.value)}
                                        style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px' }}
                                        required
                                    />
                                </div>
                                <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>
                                    <i className="fas fa-info-circle"></i> Al registrar la carrera, el sistema asegurará automáticamente los 6 semestres oficiales (I al VI).
                                </p>
                            </div>

                            <div className="eq4-modal-footer-custom">
                                <button type="button" className="eq4-btn eq4-btn-secondary" onClick={() => setModalNuevaCarreraAbierto(false)}>
                                    Cancelar
                                </button>
                                <button type="submit" className="eq4-btn eq4-btn-primary" disabled={guardandoCarrera}>
                                    <i className={guardandoCarrera ? "fas fa-spinner fa-spin" : "fas fa-save"}></i>
                                    {guardandoCarrera ? 'Guardando...' : 'Guardar Carrera'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ================================================================= */}
            {/*   PANEL FLOTANTE DE PROGRESO DE IMPORTACIÓN - EQUIPO 3             */}
            {/*   Se mantiene abajo a la derecha aunque se cierre el modal.       */}
            {/* ================================================================= */}
            {panelProgresoVisible && !modalImportarAbierto && (
                <div style={{
                    position: 'fixed',
                    right: '22px',
                    bottom: '22px',
                    width: '390px',
                    maxWidth: 'calc(100vw - 32px)',
                    background: 'white',
                    borderRadius: '14px',
                    border: '1px solid var(--border)',
                    boxShadow: '0 18px 45px rgba(15, 23, 42, 0.30)',
                    zIndex: 2100,
                    overflow: 'hidden',
                    animation: 'modalIn 0.2s ease-out'
                }}>
                    <div style={{
                        padding: '12px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '10px',
                        background: panelConError
                            ? '#FEF2F2'
                            : panelCompletado
                                ? '#ECFDF5'
                                : 'linear-gradient(135deg, #0A33A6, #1D4ED8)',
                        color: panelConError ? '#991B1B' : panelCompletado ? '#065F46' : 'white'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: '700' }}>
                            <i className={
                                cargandoProceso
                                    ? 'fas fa-circle-notch fa-spin'
                                    : panelCompletado
                                        ? 'fas fa-check-circle'
                                        : 'fas fa-exclamation-triangle'
                            }></i>
                            {cargandoProceso
                                ? 'Importando cursos...'
                                : panelCompletado
                                    ? 'Importación completada'
                                    : 'Importación con errores'}
                        </div>
                        {!cargandoProceso && (
                            <button
                                type="button"
                                onClick={cerrarPanelProgreso}
                                title="Cerrar panel"
                                style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '16px', color: 'inherit', padding: '2px 4px' }}
                            >
                                <i className="fas fa-times"></i>
                            </button>
                        )}
                    </div>

                    <div style={{ padding: '14px 16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '7px', fontSize: '12px', fontWeight: '600', color: 'var(--text-dark)' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <i className="fas fa-tasks" style={{ color: 'var(--senati-blue)' }}></i>
                                {progresoImportacion?.paso || (panelCompletado ? 'Finalizado' : 'Procesando')}
                            </span>
                            <span style={{ color: panelConError ? '#B91C1C' : '#1D4ED8', fontSize: '14px', fontWeight: '700' }}>
                                {porcentajeProgreso}%
                            </span>
                        </div>

                        <div style={{ width: '100%', height: '9px', background: '#E2E8F0', borderRadius: '999px', overflow: 'hidden' }}>
                            <div style={{
                                width: `${porcentajeProgreso}%`,
                                height: '100%',
                                background: panelConError
                                    ? '#DC2626'
                                    : panelCompletado
                                        ? '#10B981'
                                        : 'linear-gradient(90deg, #2563EB, #10B981)',
                                borderRadius: '999px',
                                transition: 'width 0.35s ease'
                            }}></div>
                        </div>

                        <p style={{ margin: '9px 0 0 0', fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.45' }}>
                            {progresoImportacion?.mensaje || (panelCompletado ? 'El archivo fue procesado correctamente.' : 'Preparando el proceso...')}
                        </p>

                        {cargandoProceso && (
                            <div style={{ marginTop: '9px', padding: '7px 9px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '7px', fontSize: '11px', color: '#1E40AF', display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                                <i className="fas fa-info-circle" style={{ marginTop: '2px' }}></i>
                                <span>El proceso continúa en segundo plano. Puedes seguir usando el sistema mientras termina.</span>
                            </div>
                        )}

                        {datosProgreso.totalFilas > 0 && !panelCompletado && !panelConError && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 12px', marginTop: '10px', paddingTop: '9px', borderTop: '1px solid var(--border-light)', fontSize: '11px', color: 'var(--text-normal)' }}>
                                <span>Filas revisadas: <strong>{datosProgreso.filasProcesadas || 0} / {datosProgreso.totalFilas || 0}</strong></span>
                                <span>Cursos insertados: <strong style={{ color: '#059669' }}>{datosProgreso.cursosInsertados || 0}</strong></span>
                                <span>Duplicados ignorados: <strong style={{ color: '#D97706' }}>{datosProgreso.filasIgnoradas || 0}</strong></span>
                                <span>Semestres nuevos: <strong>{datosProgreso.semestresCreados || 0}</strong></span>
                            </div>
                        )}

                        {panelCompletado && (
                            <div style={{ marginTop: '11px', paddingTop: '10px', borderTop: '1px solid var(--border)' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 12px', fontSize: '11px', color: 'var(--text-normal)' }}>
                                    <span>Cursos insertados: <strong style={{ color: '#059669' }}>{resultadoImportacion.reporte?.cursosInsertados}</strong></span>
                                    <span>Duplicados ignorados: <strong style={{ color: '#D97706' }}>{resultadoImportacion.reporte?.filasIgnoradasPorRepetido}</strong></span>
                                    <span>Semestres nuevos: <strong>{resultadoImportacion.reporte?.semestresCreados}</strong></span>
                                    <span>Filas leídas: <strong>{resultadoImportacion.reporte?.totalFilasLeidas}</strong></span>
                                </div>
                                <div style={{ marginTop: '11px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => setModalImportarAbierto(true)}
                                    >
                                        <i className="fas fa-list-alt"></i> Ver detalle
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-primary btn-sm"
                                        onClick={cerrarPanelProgreso}
                                    >
                                        <i className="fas fa-check"></i> Cerrar
                                    </button>
                                </div>
                            </div>
                        )}

                        {panelConError && (
                            <div style={{ marginTop: '11px', paddingTop: '10px', borderTop: '1px solid var(--border)' }}>
                                <p style={{ margin: 0, fontSize: '12px', color: '#991B1B', fontWeight: '600', lineHeight: '1.45' }}>
                                    {errorImportacion.mensaje}
                                </p>
                                {errorImportacion.detalle && (
                                    <p style={{ margin: '6px 0 0 0', fontSize: '11px', color: '#7F1D1D', lineHeight: '1.45' }}>
                                        {errorImportacion.detalle}
                                    </p>
                                )}
                                {errorImportacion.carrerasFaltantes && errorImportacion.carrerasFaltantes.length > 0 && (
                                    <p style={{ margin: '7px 0 0 0', fontSize: '11px', color: '#991B1B' }}>
                                        <strong>Carreras no registradas:</strong> {errorImportacion.carrerasFaltantes.join(', ')}
                                    </p>
                                )}
                                <div style={{ marginTop: '11px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => setModalImportarAbierto(true)}
                                    >
                                        <i className="fas fa-list-alt"></i> Ver detalle
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-primary btn-sm"
                                        onClick={cerrarPanelProgreso}
                                    >
                                        <i className="fas fa-times"></i> Cerrar
                                    </button>
                                </div>
                            </div>
                        )}
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
function CarrerasModulo({ activeView, setActiveView, triggerToast }) {
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

// ===============================================================
//   MÓDULO AUTÓNOMO: FERIADOS (EQUIPO 2)
// ===============================================================
function FeriadosModulo({ triggerToast }) {
    // 1. Iniciamos con un arreglo vacío; los datos vendrán de la base de datos
    const [feriados, setFeriados] = useState([]);

    const [mostrarModal, setMostrarModal] = useState(false);
    const [nuevoFeriado, setNuevoFeriado] = useState({
        fecha: '',
        descripcion: '',
        estado: 'activo'
    });

    // Función para calcular dinámicamente las fechas exactas de Semana Santa según el año
    const calcularFechasSemanaSanta = (anio) => {
        const a = anio % 19;
        const b = Math.floor(anio / 100);
        const c = anio % 100;
        const d = Math.floor(b / 4);
        const e = b % 4;
        const f = Math.floor((b + 8) / 25);
        const g = Math.floor((b - f + 1) / 3);
        const h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4);
        const k = c % 4;
        const l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const mes = Math.floor((h + l - 7 * m + 114) / 31);
        const dia = ((h + l - 7 * m + 114) % 31) + 1;

        const domingoPascua = new Date(anio, mes - 1, dia);
        
        const jueves = new Date(domingoPascua);
        jueves.setDate(domingoPascua.getDate() - 3);

        const viernes = new Date(domingoPascua);
        viernes.setDate(domingoPascua.getDate() - 2);

        const formatYMD = (d) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };

        return {
            juevesSanto: formatYMD(jueves),
            viernesSanto: formatYMD(viernes)
        };
    };

    // Cargar feriados y sincronizar automáticamente las fechas móviles en la Base de Datos
    useEffect(() => {
        const obtenerFeriadosBD = async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/api/feriados`);
                if (!response.ok) throw new Error('Error al obtener feriados');
                let data = await response.json();

                const anioActual = new Date().getFullYear();
                const { juevesSanto, viernesSanto } = calcularFechasSemanaSanta(anioActual);

                // Revisamos si Semana Santa necesita actualizarse en la BD
                for (let feriado of data) {
                    const desc = feriado.descripcion ? feriado.descripcion.toLowerCase() : '';
                    let fechaCalculada = null;

                    if (desc.includes('jueves santo')) {
                        fechaCalculada = juevesSanto;
                    } else if (desc.includes('viernes santo')) {
                        fechaCalculada = viernesSanto;
                    }

                    // Si es Semana Santa y la fecha en la BD no coincide con el año actual
                    if (fechaCalculada && (!feriado.fecha || !feriado.fecha.startsWith(String(anioActual)))) {
                        try {
                            // Actualizamos automáticamente en la base de datos mediante PUT
                            await fetch(`${API_BASE_URL}/api/feriados/${feriado.id_feriado}`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    fecha: fechaCalculada,
                                    descripcion: feriado.descripcion,
                                    estado: feriado.estado
                                })
                            });
                            // Actualizamos el objeto local para reflejarlo de inmediato
                            feriado.fecha = fechaCalculada;
                        } catch (err) {
                            console.error('Error al sincronizar fecha de Semana Santa en BD:', err);
                        }
                    }
                }

                setFeriados(data);
            } catch (error) {
                console.error(error);
                if (typeof triggerToast === 'function') {
                    triggerToast('No se pudo conectar con la base de datos.');
                }
            }
        };
        obtenerFeriadosBD();
    }, []);
  
    

    const formatearFecha = (fechaStr) => {
        const soloFecha = fechaStr ? fechaStr.split('T')[0] : '';
        const partes = soloFecha.split('-'); 
        if (partes.length === 3) {
            const fechaTemp = new Date(soloFecha + 'T00:00:00');
            const mesNombre = fechaTemp.toLocaleDateString('es-PE', { month: 'long' });
            return `${partes[2]} de ${mesNombre} de ${partes[0]}`;
        }
        return '';
    };

    const obtenerDiaMes = (fechaStr) => {
        const soloFecha = fechaStr ? fechaStr.split('T')[0] : '';
        const fecha = new Date(soloFecha + 'T00:00:00');
        return {
            dia: fecha.toLocaleDateString('es-PE', { day: '2-digit' }),
            mes: fecha.toLocaleDateString('es-PE', { month: 'short' }).toUpperCase().replace('.', '')
        };
    };

    const feriadosOrdenados = [...feriados].sort((a, b) => {
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
            const response = await fetch(`${API_BASE_URL}/api/feriados/${idFeriado}`, {
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
        setNuevoFeriado({
            fecha: '',
            descripcion: '',
            estado: 'activo'
        });
        setMostrarModal(true);
    };

    const cerrarModal = () => {
        setMostrarModal(false);
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
            const response = await fetch(`${API_BASE_URL}/api/feriados`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fecha: nuevoFeriado.fecha,
                    descripcion: nuevoFeriado.descripcion.trim(),
                    estado: nuevoFeriado.estado
                })
            });

            if (!response.ok) throw new Error('Error al registrar el feriado');

            const feriadoCreado = await response.json();
            setFeriados(prev => [...prev, feriadoCreado]);

            if (typeof triggerToast === 'function') {
                triggerToast('Feriado registrado correctamente en la base de datos.');
            }

            setMostrarModal(false);
        } catch (error) {
            console.error(error);
            if (typeof triggerToast === 'function') {
                triggerToast('Error al guardar el feriado en el servidor.');
            }
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
                    <button className="btn btn-primary" onClick={abrirModal}>
                        <i className="fas fa-plus"></i>
                        Nuevo Feriado
                    </button>
                </div>
            </header>

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
                    <h2>No hay feriados registrados</h2>
                    <p>Agrega un nuevo feriado utilizando el botón "Nuevo Feriado".</p>
                </div>
            )}

            <div className={`feriado-modal-backdrop ${mostrarModal ? 'active' : ''}`}>
                <div className="feriado-modal">
                    <div className="feriado-modal-header">
                        <div className="feriado-modal-title">
                            <i className="fas fa-flag"></i>
                            Registrar Nuevo Feriado
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
                            Guardar Feriado
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
function AmbientesModulo() {
    // Mock data basado en las tablas futuras: tipo_ambiente, ambientes, ambiente_apto_carreras
    const [tipoAmbiente] = useState([
        { id_tipo: 1, descripcion: 'Taller' },
        { id_tipo: 2, descripcion: 'Laboratorio' },
        { id_tipo: 3, descripcion: 'Teoría' },
        { id_tipo: 4, descripcion: 'Auditorio' }
    ]);

    const [ambientes] = useState([
        {
            id_ambiente: 1,
            codigo_ambiente: 'T-101',
            id_tipo_ambiente: 1,
            descripcion: 'Taller de Mecánica',
            aforo_maximo: 20,
            piso_ubicacion: '1er Piso',
            pabellón: 'Pabellón A',
            estado: 'disponible'
        },
        {
            id_ambiente: 2,
            codigo_ambiente: 'LAB-201',
            id_tipo_ambiente: 2,
            descripcion: 'Laboratorio de Electrónica',
            aforo_maximo: 16,
            piso_ubicacion: '2do Piso',
            pabellón: 'Pabellón B',
            estado: 'disponible'
        },
        {
            id_ambiente: 3,
            codigo_ambiente: 'T-102',
            id_tipo_ambiente: 1,
            descripcion: 'Taller de Soldadura',
            aforo_maximo: 12,
            piso_ubicacion: '1er Piso',
            pabellón: 'Pabellón A',
            estado: 'disponible'
        },
        {
            id_ambiente: 4,
            codigo_ambiente: 'AULA-301',
            id_tipo_ambiente: 3,
            descripcion: 'Aula de Teoría - General',
            aforo_maximo: 40,
            piso_ubicacion: '3er Piso',
            pabellón: 'Pabellón C',
            estado: 'disponible'
        },
        {
            id_ambiente: 5,
            codigo_ambiente: 'LAB-202',
            id_tipo_ambiente: 2,
            descripcion: 'Laboratorio de Redes',
            aforo_maximo: 15,
            piso_ubicacion: '2do Piso',
            pabellón: 'Pabellón B',
            estado: 'mantenimiento'
        },
        {
            id_ambiente: 6,
            codigo_ambiente: 'T-103',
            id_tipo_ambiente: 1,
            descripcion: 'Taller de Carpintería',
            aforo_maximo: 18,
            piso_ubicacion: '1er Piso',
            pabellón: 'Pabellón A',
            estado: 'disponible'
        },
        {
            id_ambiente: 7,
            codigo_ambiente: 'AULA-302',
            id_tipo_ambiente: 3,
            descripcion: 'Aula Multimedia',
            aforo_maximo: 35,
            piso_ubicacion: '3er Piso',
            pabellón: 'Pabellón C',
            estado: 'disponible'
        },
        {
            id_ambiente: 8,
            codigo_ambiente: 'AUD-001',
            id_tipo_ambiente: 4,
            descripcion: 'Auditorio Principal',
            aforo_maximo: 150,
            piso_ubicacion: 'Planta Baja',
            pabellón: 'Pabellón Central',
            estado: 'disponible'
        },
        {
            id_ambiente: 9,
            codigo_ambiente: 'LAB-203',
            id_tipo_ambiente: 2,
            descripcion: 'Laboratorio de Computación',
            aforo_maximo: 14,
            piso_ubicacion: '2do Piso',
            pabellón: 'Pabellón B',
            estado: 'disponible'
        }
    ]);

    const [filtroTipo, setFiltroTipo] = useState('todos');

    // Umbral para considerar aforo restringido (menor a 18 personas)
    const UMBRAL_AFRO_RESTRINGIDO = 18;

    const getTipoAmbiente = (idTipo) => {
        const tipo = tipoAmbiente.find(t => t.id_tipo === idTipo);
        return tipo ? tipo.descripcion : 'Sin Tipo';
    };

    const ambientesFiltrados = filtroTipo === 'todos' 
        ? ambientes 
        : ambientes.filter(a => a.id_tipo_ambiente === parseInt(filtroTipo));

    // Contadores por tipo
    const contarPorTipo = (idTipo) => {
        if (idTipo === 'todos') return ambientes.length;
        return ambientes.filter(a => a.id_tipo_ambiente === parseInt(idTipo)).length;
    };

    const totalAforos = ambientes.reduce((sum, a) => sum + a.aforo_maximo, 0);
    const ambientesDisponibles = ambientes.filter(a => a.estado === 'disponible').length;
    const ambientesRestringidos = ambientes.filter(a => a.aforo_maximo < UMBRAL_AFRO_RESTRINGIDO).length;

    return (
        <>
            <header className="view-header">
                <div className="header-title-area">
                    <h1>Infraestructura y Ambientes</h1>
                    <p className="subtitle">Gestión de aulas, talleres, laboratorios y espacios académicos</p>
                </div>
            </header>

            {/* Resumen de Infraestructura */}
            <div className="ambientes-resumen">
                <div className="resumen-card">
                    <div className="resumen-icon">
                        <i className="fas fa-door-open"></i>
                    </div>
                    <div className="resumen-info">
                        <span className="resumen-valor">{ambientes.length}</span>
                        <span className="resumen-label">Total de Ambientes</span>
                    </div>
                </div>
                <div className="resumen-card">
                    <div className="resumen-icon">
                        <i className="fas fa-check-circle"></i>
                    </div>
                    <div className="resumen-info">
                        <span className="resumen-valor">{ambientesDisponibles}</span>
                        <span className="resumen-label">Disponibles</span>
                    </div>
                </div>
                <div className="resumen-card">
                    <div className="resumen-icon">
                        <i className="fas fa-users"></i>
                    </div>
                    <div className="resumen-info">
                        <span className="resumen-valor">{totalAforos}</span>
                        <span className="resumen-label">Capacidad Total</span>
                    </div>
                </div>
                <div className="resumen-card">
                    <div className="resumen-icon" style={{ background: '#fef3c7', color: '#d97706' }}>
                        <i className="fas fa-exclamation-triangle"></i>
                    </div>
                    <div className="resumen-info">
                        <span className="resumen-valor" style={{ color: '#b45309' }}>{ambientesRestringidos}</span>
                        <span className="resumen-label">Aforo Restringido (&lt;{UMBRAL_AFRO_RESTRINGIDO})</span>
                    </div>
                </div>
            </div>

            {/* Filtros rápidos por tipo de ambiente */}
            <div className="ambientes-filtros">
                <button
                    className={`ambiente-filter-chip ${filtroTipo === 'todos' ? 'active' : ''}`}
                    onClick={() => setFiltroTipo('todos')}
                >
                    <i className="fas fa-th"></i>
                    Todos
                    <span className="chip-count">{contarPorTipo('todos')}</span>
                </button>
                {tipoAmbiente.map(tipo => (
                    <button
                        key={tipo.id_tipo}
                        className={`ambiente-filter-chip ${filtroTipo === tipo.id_tipo.toString() ? 'active' : ''}`}
                        onClick={() => setFiltroTipo(tipo.id_tipo.toString())}
                    >
                        <i className={tipo.descripcion === 'Taller' ? 'fas fa-wrench' : 
                                      tipo.descripcion === 'Laboratorio' ? 'fas fa-flask' :
                                      tipo.descripcion === 'Teoría' ? 'fas fa-chalkboard-teacher' :
                                      'fas fa-users'}></i>
                        {tipo.descripcion}
                        <span className="chip-count">{contarPorTipo(tipo.id_tipo)}</span>
                    </button>
                ))}
            </div>

            {/* Grilla de Aulas / Ambientes */}
            <div className="ambientes-grid">
                {ambientesFiltrados.map(ambiente => {
                    const esAforoRestringido = ambiente.aforo_maximo < UMBRAL_AFRO_RESTRINGIDO;
                    return (
                        <div 
                            key={ambiente.id_ambiente} 
                            className={`aula-card ${esAforoRestringido ? 'aforo-restringido' : ''}`}
                        >
                            <div className="aula-card-header">
                                <div className="aula-codigo">
                                    <i className="far fa-building"></i>
                                    {ambiente.codigo_ambiente}
                                </div>
                                <span className="aula-tipo-badge">
                                    {getTipoAmbiente(ambiente.id_tipo_ambiente)}
                                </span>
                            </div>

                            <div style={{ marginBottom: '10px', fontSize: '13px', color: 'var(--text-normal)', fontWeight: '500' }}>
                                {ambiente.descripcion}
                            </div>

                            <div className="aula-info-grid">
                                <div className="aula-info-item">
                                    <span className="aula-info-label">Pabellón</span>
                                    <span className="aula-info-value">
                                        <i className="fas fa-map-marker-alt" style={{ color: 'var(--text-muted)', marginRight: '4px' }}></i>
                                        {ambiente.pabellón}
                                    </span>
                                </div>
                                <div className="aula-info-item">
                                    <span className="aula-info-label">Ubicación</span>
                                    <span className="aula-info-value">{ambiente.piso_ubicacion}</span>
                                </div>
                            </div>

                            <div className="aula-aforo">
                                <span className="aula-aforo-label">
                                    <i className="fas fa-users"></i>
                                    Aforo Máximo
                                </span>
                                <span className="aula-aforo-valor">{ambiente.aforo_maximo} personas</span>
                            </div>

                            {esAforoRestringido && (
                                <div className="aula-alerta-restringido">
                                    <i className="fas fa-exclamation-circle"></i>
                                    <span>Aforo Restringido - Capacidad Limitada</span>
                                </div>
                            )}

                            <div style={{ marginTop: '12px' }}>
                                <span className={`aula-estado ${ambiente.estado}`}>
                                    <span className="estado-dot"></span>
                                    {ambiente.estado === 'disponible' ? 'Disponible' : 
                                     ambiente.estado === 'mantenimiento' ? 'En Mantenimiento' : 
                                     'Ocupado'}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>

            {ambientesFiltrados.length === 0 && (
                <div className="workspace-card">
                    <h2>No hay ambientes</h2>
                    <p>No se encontraron ambientes con el filtro seleccionado.</p>
                </div>
            )}
        </>
    );
}

export default App;