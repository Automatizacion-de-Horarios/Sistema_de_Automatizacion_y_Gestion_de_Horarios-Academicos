// frontend/src/modules/docentes/DocentesView.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { docentesApi } from './services/docentesApi';
import AltaRapida from './components/AltaRapida';
import DocenteTabla from './components/DocenteTabla';
import Modal from './components/Modal';
import CentroAcciones from './components/CentroAcciones';
import CompetenciasModal from './components/CompetenciasModal';
import RangoModal from './components/RangoModal';
import CuadriculaModal from './components/CuadriculaModal';
import EstadoModal from './components/EstadoModal';
import AuditoriaModal from './components/AuditoriaModal';
import HorarioVisualModal from './components/HorarioVisualModal';
import Toast from './components/Toast';
import './docentes.css';

export default function DocentesView() {
    const [docentes, setDocentes] = useState([]);
    const [carreras, setCarreras] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [errorApi, setErrorApi] = useState(null);

    // Filtros
    const [busqueda, setBusqueda] = useState('');
    const [filtroCarrera, setFiltroCarrera] = useState('');
    const [filtroEstado, setFiltroEstado] = useState('');

    // Modales y Toast
    const [modalActivo, setModalActivo] = useState(null); // 'centro', 'competencias', 'rango', 'cuadricula', 'estado', 'auditoria', 'clases'
    const [docenteSeleccionado, setDocenteSeleccionado] = useState(null);
    const [toast, setToast] = useState(null);

    const cargarDatos = useCallback(async () => {
        setCargando(true);
        setErrorApi(null);
        try {
            const [docRes, carRes] = await Promise.all([
                docentesApi.listar({ q: busqueda, carrera: filtroCarrera, estado: filtroEstado }),
                docentesApi.obtenerCatalogoCarreras()
            ]);
            setDocentes(docRes.data || []);
            setCarreras(carRes.data || []);
        } catch (err) {
            setErrorApi(err.message);
        } finally {
            setCargando(false);
        }
    }, [busqueda, filtroCarrera, filtroEstado]);

    useEffect(() => {
        const timer = setTimeout(() => {
            cargarDatos();
        }, 300);
        return () => clearTimeout(timer);
    }, [cargarDatos]);

    function mostrarToast(mensaje, tipo = 'success') {
        setToast({ mensaje, tipo });
    }

    function abrirModal(docente, tipo) {
        setDocenteSeleccionado(docente);
        setModalActivo(tipo);
    }

    function cerrarModal() {
        setModalActivo(null);
        setDocenteSeleccionado(null);
        cargarDatos();
    }

    async function cambiarEstadoDirecto(docente) {
        const ciclos = { A: 'I', I: 'V', V: 'A' };
        const nuevoEstado = ciclos[docente.estado] || 'A';
        try {
            await docentesApi.actualizarEstado(docente.id_docente, nuevoEstado);
            mostrarToast(`Estado cambiado a ${nuevoEstado}`);
            cargarDatos();
        } catch (err) {
            mostrarToast(err.message, 'error');
        }
    }

    return (
        <div className="doc-wrapper">
            <div className="doc-container">
                <div className="doc-header">
                    <h1 className="doc-title">Gestión de Instructores y Docentes</h1>
                    <p className="doc-subtitle">Control de disponibilidad, estado operativo (A/I/V) y auditoría de cambios.</p>
                </div>

                {/* Tarjeta Alta Rápida */}
                <div className="doc-card">
                    <AltaRapida onCreado={cargarDatos} onToast={mostrarToast} />
                </div>

                {/* Filtros y Buscador */}
                <div className="doc-card">
                    <div className="doc-filtros-bar">
                        <div className="doc-search-box">
                            <i className="fa-solid fa-magnifying-glass"></i>
                            <input
                                type="text"
                                className="doc-input"
                                placeholder="Buscar por nombre o ID..."
                                value={busqueda}
                                onChange={(e) => setBusqueda(e.target.value)}
                            />
                        </div>
                        <select
                            className="doc-select"
                            value={filtroCarrera}
                            onChange={(e) => setFiltroCarrera(e.target.value)}
                        >
                            <option value="">Todas las carreras</option>
                            {carreras.map(c => (
                                <option key={c.sigla} value={c.sigla}>{c.sigla} - {c.nombre}</option>
                            ))}
                        </select>
                        <select
                            className="doc-select"
                            value={filtroEstado}
                            onChange={(e) => setFiltroEstado(e.target.value)}
                        >
                            <option value="">Todos los estados</option>
                            <option value="A">Activo</option>
                            <option value="I">Inactivo</option>
                            <option value="V">Vacaciones</option>
                        </select>
                    </div>

                    {/* Tabla de Docentes */}
                    {errorApi ? (
                        <div style={{ padding: '30px', textAlign: 'center', color: '#EF4444', fontWeight: '600' }}>
                            <i className="fa-solid fa-triangle-exclamation" style={{ fontSize: '24px', marginBottom: '8px' }}></i>
                            <p>Error al conectar con la API: {errorApi}</p>
                        </div>
                    ) : cargando ? (
                        <div style={{ padding: '40px', textAlign: 'center', color: '#64748B' }}>Cargando...</div>
                    ) : (
                        <DocenteTabla
                            docentes={docentes}
                            onAbrirModal={abrirModal}
                            onCambiarEstado={cambiarEstadoDirecto}
                        />
                    )}

                    <div className="doc-footer-table">
                        <span>{docentes.length} instructores en sistema</span>
                    </div>
                </div>
            </div>

            {/* Modales Dinámicos */}
            {modalActivo && docenteSeleccionado && (
                <Modal
                    titulo={
                        modalActivo === 'centro' ? 'Centro de Control' :
                        modalActivo === 'competencias' ? 'Asignar Competencias / Materias' :
                        modalActivo === 'rango' ? 'Rango Horario (Foto)' :
                        modalActivo === 'cuadricula' ? 'Cuadrícula de Disponibilidad (Nh)' :
                        modalActivo === 'estado' ? 'Cambiar Estado Operativo' :
                        modalActivo === 'auditoria' ? 'Ficha de Auditoría' : 'Horario Visual (Clases)'
                    }
                    onClose={cerrarModal}
                >
                    {modalActivo === 'centro' && (
                        <CentroAcciones
                            docente={docenteSeleccionado}
                            onSeleccionarOpcion={(op) => setModalActivo(op)}
                        />
                    )}
                    {modalActivo === 'competencias' && (
                        <CompetenciasModal docente={docenteSeleccionado} onClose={cerrarModal} onToast={mostrarToast} />
                    )}
                    {modalActivo === 'rango' && (
                        <RangoModal docente={docenteSeleccionado} onClose={cerrarModal} onToast={mostrarToast} abrirCuadricula={() => setModalActivo('cuadricula')} />
                    )}
                    {modalActivo === 'cuadricula' && (
                        <CuadriculaModal docente={docenteSeleccionado} onClose={cerrarModal} onToast={mostrarToast} abrirRango={() => setModalActivo('rango')} />
                    )}
                    {modalActivo === 'estado' && (
                        <EstadoModal docente={docenteSeleccionado} onClose={cerrarModal} onToast={mostrarToast} />
                    )}
                    {modalActivo === 'auditoria' && (
                        <AuditoriaModal docente={docenteSeleccionado} onClose={cerrarModal} onToast={mostrarToast} />
                    )}
                    {modalActivo === 'clases' && (
                        <HorarioVisualModal docente={docenteSeleccionado} onClose={cerrarModal} onToast={mostrarToast} />
                    )}
                </Modal>
            )}

            {/* Toast */}
            {toast && <Toast mensaje={toast.mensaje} tipo={toast.tipo} onClose={() => setToast(null)} />}
        </div>
    );
}