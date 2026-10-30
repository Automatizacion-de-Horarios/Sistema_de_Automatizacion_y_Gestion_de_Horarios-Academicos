import { useMemo, useRef, useState } from 'react';
import { API_BASE_URL } from '../config/api';
import { authFetch } from '../lib/authFetch';
import CursosView from './CursosView';
import MallaSemestreView from './MallaSemestreView';
import './MallaSemestreView.css';

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
 * Vista de Carreras y Mallas Curriculares (Equipo 3 / Grupo 4)
 * Lista las carreras registradas en la base de datos (GET /api/carreras),
 * permite registrar una nueva (POST /api/carreras) y abre la importación
 * de mallas desde Excel, que vive en CursosView.
 */
export default function CarrerasView({ activeView, setActiveView, triggerToast, carreras, cargandoCarreras, onRefrescarCarreras, onCambiosPendientesChange }) {
    const cursosRef = useRef(null);
    const [procesandoImportacion, setProcesandoImportacion] = useState(false);
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

            return {
                id,
                codigo: carrera.codigo_carrera || '',
                nombre: carrera.nombre_carrera || carrera.nombre || '',
                semestres: carrera.semestres ?? 5,
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

    return (
        <>
            {activeView === 'malla-semestre-view' ? (
                <MallaSemestreView
                    carrera={carreraSeleccionada || carrerasLocales[0]}
                    semestreObjetivo={semestreObjetivo}
                    onVolver={() => {
                        setCarreraSeleccionada(null);
                        setSemestreObjetivo(null);
                        if (typeof setActiveView === 'function') {
                            setActiveView('carreras-view');
                        }
                    }}
                    triggerToast={triggerToast}
                    onAbrirImportacion={() => cursosRef.current?.abrirImportacion()}
                    procesandoImportacion={procesandoImportacion}
                    onCambiosPendientesChange={onCambiosPendientesChange}
                />
            ) : (
                <section id="carreras-view" className={`view ${activeView === 'carreras-view' ? 'active' : ''}`}>
                    {/* Encabezado con Botón para Cargar Mallas Curriculares */}
                    <header className="eq4-view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
                        <div className="eq4-header-title-area">
                            <h1 style={{ fontSize: '22px', fontWeight: '700', color: 'var(--text-dark)' }}>Directorio Institucional de Carreras y Mallas</h1>
                            <p className="eq4-subtitle" style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>
                                Estructura oficial de programas académicos y asignaturas formativas del 2.º al 6.º semestre.
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
                                                    6 Semestres
                                                </span>
                                            </div>

                                            <p className="carrera-card-instructions">
                                                Seleccione un semestre para ver su malla oficial y fichas curriculares:
                                            </p>

                                            {/* Grilla de 6 botones de semestres (Sem. 1 a Sem. 6) */}
                                            <div className="carrera-semestres-grid">
                                                {SEMESTRES_CHIPS.map((sem) => (
                                                    <button
                                                        key={sem.num}
                                                        type="button"
                                                        className="btn-semestre-chip"
                                                        onClick={(e) => handleClicSemestre(e, carrera, sem)}
                                                        title={`Ver asignaturas de ${carrera.nombre} - ${sem.label}`}
                                                    >
                                                        {sem.label}
                                                    </button>
                                                ))}
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
