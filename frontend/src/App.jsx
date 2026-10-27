import React, { useState, useEffect, useRef } from 'react';
import senatiLogo from './assets/logo-senati.png';

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

    // Datos dinámicos (se cargarán desde la base de datos)
    const [carreras, setCarreras] = useState([]);
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

                    {/* Espacio para el Grid de Carreras */}
                    <div className="eq4-workspace-card">
                        <span className="eq4-workspace-badge">Módulo de Carreras y Mallas Activo</span>
                        <h2>Gestión Curricular y Asignaturas</h2>
                        <p>
                            Utilice el botón <strong>"Cargar Mallas Curriculares (Excel)"</strong> superior para arrastrar y cargar el archivo de cursos de todas las carreras.
                            El sistema escaneará los datos para evitar duplicados e ignorará las columnas no requeridas.
                        </p>
                    </div>
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

export default App;
