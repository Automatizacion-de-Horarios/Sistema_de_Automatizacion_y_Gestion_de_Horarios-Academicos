import { useMemo, useRef, useState } from 'react';
import { API_BASE_URL } from '../config/api';
import { authFetch } from '../lib/authFetch';
import CursosView from './CursosView';
import fondoCarreras from '../assets/fondoCarreras.png';
import MallaSemestreView from './MallaSemestreView';
import './MallaSemestreView.css';

const MAPA_ROMANO_A_NUM = {
    'I': 1, '1': 1,
    'II': 2, '2': 2,
    'III': 3, '3': 3,
    'IV': 4, '4': 4,
    'V': 5, '5': 5,
    'VI': 6, '6': 6,
    'VII': 7, '7': 7,
    'VIII': 8, '8': 8,
    'IX': 9, '9': 9,
    'X': 10, '10': 10
};

// Lista de semestres oficiales para los botones de acceso rápido de cada carrera
const SEMESTRES_CHIPS = [
    { num: 1, romano: 'I', label: 'Sem. 1' },
    { num: 2, romano: 'II', label: 'Sem. 2' },
    { num: 3, romano: 'III', label: 'Sem. 3' },
    { num: 4, romano: 'IV', label: 'Sem. 4' },
    { num: 5, romano: 'V', label: 'Sem. 5' },
    { num: 6, romano: 'VI', label: 'Sem. 6' },
];

/**
 * Vista de Carreras y Mallas Curriculares (Grupo 4)
 * Lista las carreras registradas en la base de datos (GET /api/carreras),
 * permite registrar una nueva (POST /api/carreras) y abre la importación
 * de mallas desde Excel, que vive en CursosView.
 */

export default function CarrerasView({ activeView, setActiveView, triggerToast, carreras, cargandoCarreras, onRefrescarCarreras, onCambiosPendientesChange }) {
    const cursosRef = useRef(null);
    const [procesandoImportacion, setProcesandoImportacion] = useState(false);
    const [descargandoEstructura, setDescargandoEstructura] = useState(false);
    const [carreraSeleccionada, setCarreraSeleccionada] = useState(null);
    const [semestreObjetivo, setSemestreObjetivo] = useState(null);

    // Estados de habilitación/inhabilitación elegidos en pantalla (como antes, solo visual)
    const [estadosLocales, setEstadosLocales] = useState({});

    // Normaliza los datos que llegan de la base de datos al formato de las tarjetas
    const carrerasLocales = useMemo(() => {
        return (carreras || []).map((carrera) => {
            const id = String(carrera.id_carrera ?? carrera.id ?? '');
            const estadoBase = carrera.estado === 'I' || carrera.estado === 'inhabilitada'
                ? 'inhabilitada'
                : carrera.estado === 'sin_datos'
                    ? 'sin_datos'
                    : 'activa';

            const listaSem = Array.isArray(carrera.semestres) && carrera.semestres.length > 0
                ? carrera.semestres
                : [
                    { id_semestre: 1, semestre: 'I', estado: 'A' },
                    { id_semestre: 2, semestre: 'II', estado: 'A' },
                    { id_semestre: 3, semestre: 'III', estado: 'A' },
                    { id_semestre: 4, semestre: 'IV', estado: 'A' },
                    { id_semestre: 5, semestre: 'V', estado: 'A' },
                    { id_semestre: 6, semestre: 'VI', estado: 'A' }
                ];

            return {
                id,
                codigo: carrera.codigo_carrera || '',
                nombre: carrera.nombre_carrera || carrera.nombre || '',
                semestres: carrera.semestres ?? 6,
                semestres: listaSem,
                totalSemestres: listaSem.length,
                estado: estadosLocales[id] ?? estadoBase
            };
        });
    }, [carreras, estadosLocales]);

    const toggleEstadoCarrera = (id) => {
        const carrera = carrerasLocales.find((item) => item.id === id);
        const nuevoEstado = carrera?.estado === 'activa' ? 'inhabilitada' : 'activa';
        setEstadosLocales((prev) => ({ ...prev, [id]: nuevoEstado }));
    };

    // Al hacer clic en un botón de semestre específico (Sem. 1 a Sem. 6)
    const handleClicSemestre = (e, carrera, sem) => {
        e.stopPropagation();
        if (carrera.estado !== 'activa') {
            if (typeof triggerToast === 'function') {
                triggerToast(`La carrera "${carrera.nombre}" se encuentra inhabilitada.`);
            }
            return;
        }

        if (sem.num === 1) {
            if (typeof triggerToast === 'function') {
                triggerToast('El 1.º Semestre (Estudios Generales) se cursa de manera transversal y no forma parte de la especialidad técnica.');
            }
            return;
        }

        if (sem.estado === 'I') {
            if (typeof triggerToast === 'function') {
                triggerToast(`El Semestre ${sem.romano} de "${carrera.nombre}" se encuentra inhabilitado.`);
            }
        }

        setCarreraSeleccionada(carrera);
        setSemestreObjetivo(sem.romano);
        if (typeof setActiveView === 'function') {
            setActiveView('malla-semestre-view');
        }
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
            const res = await authFetch(`${API_BASE_URL}/api/carreras`, {
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

            // Refresca el listado real desde la base de datos
            if (typeof onRefrescarCarreras === 'function') {
                await onRefrescarCarreras();
            }
        } catch (err) {
            setMensajeNuevaCarrera({ tipo: 'error', texto: err.message });
        } finally {
            setGuardandoCarrera(false);
        }
    };

    // Descarga TODA la estructura curricular en Excel (mismas columnas que el archivo de importación)
    const exportarEstructura = async () => {
        setDescargandoEstructura(true);

        try {
            const res = await authFetch(`${API_BASE_URL}/api/mallas/exportar-excel`);

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.mensaje || 'No se pudo exportar la estructura curricular.');
            }

            const blob = await res.blob();
            const disposicion = res.headers.get('Content-Disposition') || '';
            const coincidencia = disposicion.match(/filename\*=UTF-8''([^;]+)/i)
                || disposicion.match(/filename="?([^";]+)"?/i);
            const nombreArchivo = coincidencia
                ? decodeURIComponent(coincidencia[1])
                : 'Estructura_curricular_consolidado.xlsx';

            const url = URL.createObjectURL(blob);
            const enlace = document.createElement('a');
            enlace.href = url;
            enlace.download = nombreArchivo;
            document.body.appendChild(enlace);
            enlace.click();
            enlace.remove();
            URL.revokeObjectURL(url);

            if (typeof triggerToast === 'function') {
                triggerToast('Estructura curricular exportada correctamente en Excel.');
            }
        } catch (err) {
            if (typeof triggerToast === 'function') {
                triggerToast(err.message || 'No se pudo exportar la estructura curricular.');
            }
        } finally {
            setDescargandoEstructura(false);
        }
    };

    return (
        <>
            {activeView === 'malla-semestre-view' ? (
                <MallaSemestreView
                    carrera={carreraSeleccionada || carrerasLocales[0]}
                    semestreObjetivo={semestreObjetivo}
                    onVolver={() => {
                        setCarreraSeleccionada(null);
                        setSemestreObjetivo(null);
                        if (typeof onRefrescarCarreras === 'function') {
                            onRefrescarCarreras();
                        }
                        if (typeof setActiveView === 'function') {
                            setActiveView('carreras-view');
                        }
                    }}
                    onRefrescarCarreras={onRefrescarCarreras}
                    triggerToast={triggerToast}
                    onAbrirImportacion={() => cursosRef.current?.abrirImportacion()}
                    procesandoImportacion={procesandoImportacion}
                    onCambiosPendientesChange={onCambiosPendientesChange}
                />
            ) : (
                <section
                    id="carreras-view"
                    className={`view ${activeView === 'carreras-view' ? 'active' : ''}`}
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
                                className="eq4-btn eq4-btn-secondary"
                                onClick={exportarEstructura}
                                disabled={descargandoEstructura}
                                title={descargandoEstructura
                                    ? 'Generando el archivo Excel...'
                                    : 'Descargar todas las carreras, semestres y cursos en Excel'}
                            >
                                <i className={descargandoEstructura ? 'fas fa-spinner fa-spin' : 'fas fa-file-download'} style={{ color: 'var(--success)' }}></i>{' '}
                                {descargandoEstructura ? 'Generando Excel...' : 'Exportar Estructura (Excel)'}
                            </button>
                            <button
                                className="eq4-btn eq4-btn-primary"
                                onClick={() => cursosRef.current?.abrirImportacion()}
                                disabled={procesandoImportacion}
                                title={procesandoImportacion ? 'Espera a que termine la importación en curso' : 'Cargar mallas curriculares desde Excel'}
                            >
                                <i className="fas fa-file-excel" style={{ color: '#A7F3D0' }}></i> Cargar Mallas Curriculares (Excel)
                            </button>
                        </div>
                    </header>

                    {cargandoCarreras && carrerasLocales.length === 0 ? (
                        <div className="workspace-card">
                            <h2>Cargando carreras…</h2>
                            <p>Consultando los programas académicos registrados en la base de datos.</p>
                        </div>
                    ) : (
                        <div className="carreras-grid">
                            {carrerasLocales.map((carrera) => {
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
                                                setCarreraSeleccionada(carrera);
                                                setSemestreObjetivo(null);
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

                                        <div className="carrera-card-body">
                                            {/* Cabecera de la tarjeta: Título con icono y Badge con número de semestres */}
                                            <div className="carrera-card-header-row">
                                                <h3 className="carrera-card-title">
                                                    <i className="fas fa-graduation-cap" style={{ color: 'var(--senati-blue)', marginRight: '8px' }}></i>
                                                    {carrera.nombre}
                                                </h3>
                                                <span className="carrera-card-badge-semestres">
                                                    {carrera.totalSemestres} Semestres
                                                </span>
                                            </div>

                                            <p className="carrera-card-instructions">
                                                Seleccione un semestre para ver su malla oficial y fichas curriculares:
                                            </p>

                                            {/* Grilla dinámica con los semestres registrados para esta carrera */}
                                            <div className="carrera-semestres-grid">
                                                {carrera.semestres.map((sem) => {
                                                    const num = MAPA_ROMANO_A_NUM[String(sem.semestre).trim().toUpperCase()] || sem.semestre;
                                                    const isPrimerSemestre = Number(num) === 1 || String(sem.semestre).trim().toUpperCase() === 'I';
                                                    const isSemLocked = sem.estado === 'I';
                                                    return (
                                                        <button
                                                            key={sem.id_semestre || sem.semestre}
                                                            type="button"
                                                            className={`btn-semestre-chip ${isPrimerSemestre ? 'semestre-primer-ciclo' : isSemLocked ? 'semestre-disabled' : ''}`}
                                                            onClick={(e) => handleClicSemestre(e, carrera, { num, romano: sem.semestre, estado: sem.estado, id_semestre: sem.id_semestre })}
                                                            title={
                                                                isPrimerSemestre
                                                                    ? '1.er Semestre (Estudios Generales transversal - No forma parte de la especialidad técnica)'
                                                                    : isSemLocked
                                                                    ? `Semestre ${sem.semestre} Inhabilitado`
                                                                    : `Ver asignaturas de ${carrera.nombre} - Sem. ${num}`
                                                            }
                                                        >
                                                            Sem. {num}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {!cargandoCarreras && carrerasLocales.length === 0 && (
                        <div className="workspace-card">
                            <h2>No hay carreras registradas</h2>
                            <p>Use el botón "Agregar Nueva Carrera" para registrar el primer programa académico.</p>
                        </div>
                    )}
                </section>
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

            {/* Importación de cursos / mallas desde Excel (modal + panel de progreso) */}
            <CursosView
                ref={cursosRef}
                onProcesandoChange={setProcesandoImportacion}
                onRegistrarCarrera={(codigo) => {
                    setCodigoNuevaCarrera(codigo || '');
                    setMensajeNuevaCarrera(null);
                    setModalNuevaCarreraAbierto(true);
                }}
            />
        </>
    );
}
