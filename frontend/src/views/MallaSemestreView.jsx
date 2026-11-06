import React from 'react';
import './MallaSemestreView.css';

// Subcomponentes y lógica modular (Equipo 4)
import BarraTurnosCiclos from './mallaSemestre/BarraTurnosCiclos';
import TablaCursosTurno from './mallaSemestre/TablaCursosTurno';
import ModalCurso from './mallaSemestre/ModalCurso';
import ModalConfirmarSalir from './mallaSemestre/ModalConfirmarSalir';
import { useMallaSemestre } from './mallaSemestre/useMallaSemestre';

/**
 * Vista de Malla Curricular y Cursos por Semestre (Equipo 4)
 * Componente visual conciso que orquesta los subcomponentes
 * apoyándose en el Custom Hook useMallaSemestre.
 */
export default function MallaSemestreView(props) {
    const {
        onVolver,
        onAbrirImportacion,
        procesandoImportacion
    } = props;

    const {
        cargando,
        error,
        guardandoProg,
        semestreFiltro,
        setSemestreFiltro,
        turnoActivo,
        setTurnoActivo,
        cantidadTurnosActual,
        turnosCicloActual,
        hayCambiosSinGuardar,
        nombreCarrera,
        semestresDisponiblesCarrera,
        semestres,
        listaDocentes,
        mapaDocentesPorId,
        asignacionesDocentes,
        asignacionesCursos,
        modalAlertaVolver,
        setModalAlertaVolver,
        modalCursoAbierto,
        setModalCursoAbierto,
        modoModalCurso,
        semestreModal,
        guardandoCurso,
        errorModalCurso,
        formCurso,
        setFormCurso,
        cargarMalla,
        handleCambiarCantidadTurnos,
        handleCambiarDocente,
        handleCambiarDocenteCurso,
        handleToggleEstadoSemestre,
        handleCambiarTipoCurso,
        handleToggleEstadoCurso,
        abrirModalCrearCurso,
        abrirModalEditarCurso,
        handleActualizarHoras,
        guardarCursoForm,
        guardarConfiguracionEnBD
    } = useMallaSemestre(props);

    return (
        <section id="malla-semestre-view" className="view active malla-container-clean">
            {/* Cabecera superior: Título, Volver y Guardar Programación */}
            <div className="malla-clean-header">
                <div className="malla-clean-title-area">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <h1>{nombreCarrera} · Semestre {semestreFiltro}</h1>
                    </div>
                    <p>
                        Mostrando exclusivamente las asignaturas y turnos del Semestre {semestreFiltro}.
                    </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    {hayCambiosSinGuardar && (
                        <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            color: '#d97706',
                            background: '#fef3c7',
                            border: '1px solid #fde68a',
                            padding: '5px 12px',
                            borderRadius: '16px',
                            fontSize: '11px',
                            fontWeight: '700'
                        }}>
                            <i className="fas fa-exclamation-circle" style={{ fontSize: '13px' }}></i>
                            Cambios sin guardar
                        </span>
                    )}

                    <button
                        type="button"
                        className="malla-btn-guardar-prog"
                        onClick={guardarConfiguracionEnBD}
                        disabled={guardandoProg || cargando}
                        title="Guardar asignaciones de docentes en la tabla programacion_academica"
                    >
                        <i className={`fas ${guardandoProg ? 'fa-spinner fa-spin' : 'fa-save'}`}></i>
                        <span>{guardandoProg ? 'Guardando…' : 'Guardar Programación'}</span>
                    </button>

                    <button
                        type="button"
                        className="malla-btn-volver-pill"
                        onClick={() => {
                            if (hayCambiosSinGuardar) {
                                setModalAlertaVolver(true);
                            } else {
                                if (typeof onVolver === 'function') onVolver();
                            }
                        }}
                        title="Regresar al Directorio de Carreras"
                    >
                        <i className="fas fa-arrow-left"></i>
                        <span>Volver a carreras</span>
                    </button>
                </div>
            </div>

            {/* Panel de control de ciclos y turnos */}
            <BarraTurnosCiclos
                semestresDisponiblesCarrera={semestresDisponiblesCarrera}
                semestreFiltro={semestreFiltro}
                onSelectSemestre={setSemestreFiltro}
                cantidadTurnosActual={cantidadTurnosActual}
                onCambiarCantidadTurnos={handleCambiarCantidadTurnos}
                turnosCicloActual={turnosCicloActual}
                turnoActivo={turnoActivo}
                onSelectTurno={setTurnoActivo}
            />

            {/* Estado de carga */}
            {cargando && (
                <div className="workspace-card" style={{ textAlign: 'center', padding: '40px' }}>
                    <i className="fas fa-circle-notch fa-spin" style={{ fontSize: '28px', color: 'var(--senati-blue)', marginBottom: '12px' }}></i>
                    <h2>Consultando Malla Curricular y Cursos…</h2>
                    <p>Obteniendo la información registrada en la base de datos.</p>
                </div>
            )}

            {/* Estado de error */}
            {!cargando && error && (
                <div className="workspace-card" style={{ borderLeft: '4px solid #ef4444' }}>
                    <h2 style={{ color: '#b91c1c' }}>No se pudo cargar la información</h2>
                    <p>{error}</p>
                    <button type="button" className="eq4-btn eq4-btn-primary" onClick={cargarMalla} style={{ marginTop: '12px' }}>
                        <i className="fas fa-redo"></i> Reintentar
                    </button>
                </div>
            )}

            {/* Tabla de asignaturas y tarjetas de semestre */}
            {!cargando && !error && (
                <TablaCursosTurno
                    semestres={semestres}
                    turnoActivo={turnoActivo}
                    asignacionesDocentes={asignacionesDocentes}
                    asignacionesCursos={asignacionesCursos}
                    mapaDocentesPorId={mapaDocentesPorId}
                    listaDocentes={listaDocentes}
                    onToggleEstadoSemestre={handleToggleEstadoSemestre}
                    onAbrirModalCrearCurso={abrirModalCrearCurso}
                    onCambiarDocente={handleCambiarDocente}
                    onCambiarDocenteCurso={handleCambiarDocenteCurso}
                    onCambiarTipoCurso={handleCambiarTipoCurso}
                    onAbrirModalEditarCurso={abrirModalEditarCurso}
                    onToggleEstadoCurso={handleToggleEstadoCurso}
                    onAbrirImportacion={onAbrirImportacion}
                    procesandoImportacion={procesandoImportacion}
                />
            )}

            {/* Modal para Crear y Editar Curso */}
            <ModalCurso
                abierto={modalCursoAbierto}
                modo={modoModalCurso}
                semestre={semestreModal}
                formCurso={formCurso}
                setFormCurso={setFormCurso}
                error={errorModalCurso}
                guardando={guardandoCurso}
                onActualizarHoras={handleActualizarHoras}
                onSubmit={guardarCursoForm}
                onCerrar={() => setModalCursoAbierto(false)}
            />

            {/* Modal de confirmación al salir */}
            <ModalConfirmarSalir
                abierto={modalAlertaVolver}
                nombreCarrera={nombreCarrera}
                hayCambiosSinGuardar={hayCambiosSinGuardar}
                onCerrar={() => setModalAlertaVolver(false)}
                onConfirmar={() => {
                    setModalAlertaVolver(false);
                    if (typeof onVolver === 'function') onVolver();
                }}
            />
        </section>
    );
}
