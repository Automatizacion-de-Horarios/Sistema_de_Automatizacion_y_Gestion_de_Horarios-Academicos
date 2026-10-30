import { useState, useEffect, useMemo, useCallback } from 'react';
import { API_BASE_URL } from '../config/api';
import { authFetch } from '../lib/authFetch';
import './MallaSemestreView.css';

/**
 * Vista de Malla Curricular y Cursos por Semestre (Equipo 3 / Grupo 4)
 * Estructurada fielmente según el boceto del usuario:
 * 1. Desplegable "cantidad de turnos" (1, 2 o hasta 3 según la carrera).
 * 2. Pestañas de turnos: [ Turno 1 ], [ Turno 2 ], etc.
 * 3. En cada semestre: Selectores compactos "docente para TEC:" y "docente para TAL:"
 *    mostrando únicamente su nombre y especialidad (sin horarios).
 * 4. Tabla limpia indicando qué asignaturas se llevan en ese turno y qué docente las dicta.
 */

// Normaliza y compara identificadores de semestre tanto romanos como arábigos ('III' == '3')
const matchSemestre = (val1, val2) => {
    if (!val1 || !val2) return false;
    const s1 = String(val1).trim().toUpperCase().replace(/SEMESTRE\s*/i, '');
    const s2 = String(val2).trim().toUpperCase().replace(/SEMESTRE\s*/i, '');
    if (s1 === s2) return true;
    const mapa = {
        '1': 'I', 'I': '1',
        '2': 'II', 'II': '2',
        '3': 'III', 'III': '3',
        '4': 'IV', 'IV': '4',
        '5': 'V', 'V': '5',
        '6': 'VI', 'VI': '6'
    };
    return mapa[s1] === s2 || mapa[s2] === s1;
};

export default function MallaSemestreView({
    carrera,
    semestreObjetivo,
    onVolver,
    triggerToast,
    onAbrirImportacion,
    procesandoImportacion,
    onCambiosPendientesChange
}) {
    const [cargando, setCargando] = useState(true);
    const [mallaData, setMallaData] = useState(null);
    const [error, setError] = useState(null);
    const [guardandoProg, setGuardandoProg] = useState(false);

    // Filtro para mostrar exclusivamente el semestre seleccionado
    const [semestreFiltro, setSemestreFiltro] = useState(semestreObjetivo || 'II');

    useEffect(() => {
        if (semestreObjetivo) {
            setSemestreFiltro(semestreObjetivo);
        } else if (!semestreFiltro) {
            setSemestreFiltro('II');
        }
    }, [semestreObjetivo]);

    const idCarrera = carrera?.id_carrera ?? carrera?.id ?? carrera?.codigo_carrera ?? carrera?.codigo;

    // Estado de turnos extraídos de la base de datos (tabla turnos)
    const [turnosBD, setTurnosBD] = useState([]);
    const [turnoActivo, setTurnoActivo] = useState(1); // id_turno de la BD

    // Regla: Por defecto al entrar y al cambiar de ciclo debe estar marcado el 1.er turno en todas las carreras
    useEffect(() => {
        if (turnosBD.length > 0) {
            setTurnoActivo(turnosBD[0].id_turno);
        }
    }, [idCarrera, semestreFiltro, turnosBD]);

    // Asignación de docentes por semestre y por turno: { [semestre]: { [id_turno]: { tec, tal } } }
    const [asignacionesDocentes, setAsignacionesDocentes] = useState({});

    // Asignación de docentes para cursos individuales complementarios: { [id_curso]: { [id_turno]: idDocente } }
    const [asignacionesCursos, setAsignacionesCursos] = useState({});

    // Control de modificaciones pendientes para alertar antes de salir de la carrera
    const [hayCambiosSinGuardar, setHayCambiosSinGuardar] = useState(false);
    const [modalAlertaVolver, setModalAlertaVolver] = useState(false);

    // Notificar al componente padre si hay cambios sin guardar
    useEffect(() => {
        if (typeof onCambiosPendientesChange === 'function') {
            onCambiosPendientesChange(hayCambiosSinGuardar);
        }
        return () => {
            if (typeof onCambiosPendientesChange === 'function') {
                onCambiosPendientesChange(false);
            }
        };
    }, [hayCambiosSinGuardar, onCambiosPendientesChange]);

    // Alerta del navegador al recargar o cerrar pestaña si hay cambios sin guardar
    useEffect(() => {
        const handleBeforeUnload = (e) => {
            if (hayCambiosSinGuardar) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [hayCambiosSinGuardar]);

    // Si NO hay cambios, permite salir o cambiar de carrera de forma inmediata; si hay cambios pendientes, alerta al usuario
    const handleClicVolver = () => {
        if (hayCambiosSinGuardar) {
            setModalAlertaVolver(true);
        } else {
            if (typeof onVolver === 'function') {
                onVolver();
            }
        }
    };

    // Estados para el Modal Agregar / Editar Curso
    const [modalCursoAbierto, setModalCursoAbierto] = useState(false);
    const [modoModalCurso, setModoModalCurso] = useState('crear'); // 'crear' | 'editar'
    const [semestreModal, setSemestreModal] = useState(null);
    const [formCurso, setFormCurso] = useState({
        id_curso: null,
        id_semestre: null,
        mat_cur: '',
        catalogo: '202610',
        nombre_curso: '',
        horario_sinfo: 'TEC',
        is_carrera: 1,
        semanas: 16,
        horas_teoria: 20,
        horas_taller: 40,
        horas_virtual: 36,
        horas_evaluacion: 6,
        total_horas: 102,
        horas_semestre_meta: 510
    });
    const [guardandoCurso, setGuardandoCurso] = useState(false);
    const [errorModalCurso, setErrorModalCurso] = useState(null);

    const handleActualizarHoras = (campo, valor) => {
        const numVal = Math.max(0, parseInt(valor, 10) || 0);
        setFormCurso((prev) => {
            const nuevo = {
                ...prev,
                [campo]: numVal
            };
            const total = (Number(nuevo.horas_teoria) || 0) +
                          (Number(nuevo.horas_taller) || 0) +
                          (Number(nuevo.horas_virtual) || 0) +
                          (Number(nuevo.horas_evaluacion) || 0);
            nuevo.total_horas = total;
            return nuevo;
        });
    };

    const abrirModalCrearCurso = (sem) => {
        setModoModalCurso('crear');
        setSemestreModal(sem);
        const meta = sem.horas_meta || sem.horas_semestre_meta || 510;
        setFormCurso({
            id_curso: null,
            id_semestre: sem.id_semestre,
            mat_cur: '',
            catalogo: '202610',
            nombre_curso: '',
            horario_sinfo: 'TEC',
            is_carrera: 1,
            semanas: 16,
            horas_teoria: 20,
            horas_taller: 40,
            horas_virtual: 36,
            horas_evaluacion: 6,
            total_horas: 102,
            horas_semestre_meta: meta
        });
        setErrorModalCurso(null);
        setModalCursoAbierto(true);
    };

    const abrirModalEditarCurso = (curso, sem) => {
        setModoModalCurso('editar');
        setSemestreModal(sem);
        const meta = sem.horas_meta || sem.horas_semestre_meta || 510;
        const teoria = Number(curso.horas_teoria) || 0;
        const taller = Number(curso.horas_taller) || 0;
        const virtualH = Number(curso.horas_virtual) || 0;
        const evaluacion = Number(curso.horas_evaluacion) || 0;
        const total = Number(curso.total_horas) || (teoria + taller + virtualH + evaluacion);

        setFormCurso({
            id_curso: curso.id_curso,
            id_semestre: sem.id_semestre,
            mat_cur: curso.mat_cur || '',
            catalogo: curso.catalogo || '',
            nombre_curso: curso.nombre_curso || '',
            horario_sinfo: curso.horario_sinfo || 'TEC',
            is_carrera: Number(curso.is_carrera) === 1 ? 1 : 0,
            semanas: curso.semanas ?? 16,
            horas_teoria: teoria,
            horas_taller: taller,
            horas_virtual: virtualH,
            horas_evaluacion: evaluacion,
            total_horas: total,
            horas_semestre_meta: meta
        });
        setErrorModalCurso(null);
        setModalCursoAbierto(true);
    };

    const guardarCursoForm = async (e) => {
        if (e) e.preventDefault();
        if (!formCurso.mat_cur.trim() || !formCurso.nombre_curso.trim() || !formCurso.total_horas) {
            setErrorModalCurso('Por favor complete los campos obligatorios: MAT CUR, Nombre del curso y Total de horas.');
            return;
        }

        setGuardandoCurso(true);
        setErrorModalCurso(null);

        try {
            const url = modoModalCurso === 'crear'
                ? `${API_BASE_URL}/api/carreras/cursos`
                : `${API_BASE_URL}/api/carreras/cursos/${formCurso.id_curso}`;
            const method = modoModalCurso === 'crear' ? 'POST' : 'PUT';

            const res = await authFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formCurso)
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.mensaje || 'Error al guardar los datos del curso.');
            }

            if (typeof triggerToast === 'function') {
                triggerToast(modoModalCurso === 'crear' ? '¡Curso agregado exitosamente!' : '¡Curso actualizado correctamente!');
            }

            setModalCursoAbierto(false);
            await cargarMalla();
        } catch (err) {
            console.error('Error al guardar curso:', err);
            setErrorModalCurso(err.message);
        } finally {
            setGuardandoCurso(false);
        }
    };

    const handleEliminarCurso = async (idCurso, nombreCurso) => {
        if (!window.confirm(`¿Está seguro de eliminar el curso "${nombreCurso}" de la malla curricular?`)) {
            return;
        }

        try {
            const res = await authFetch(`${API_BASE_URL}/api/carreras/cursos/${idCurso}`, {
                method: 'DELETE'
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.mensaje || 'Error al eliminar el curso.');
            }

            if (typeof triggerToast === 'function') {
                triggerToast(`El curso "${nombreCurso}" fue eliminado.`);
            }

            await cargarMalla();
        } catch (err) {
            console.error('Error al eliminar curso:', err);
            if (typeof triggerToast === 'function') {
                triggerToast(err.message || 'Error al eliminar el curso.');
            }
        }
    };

    // Cargar la información oficial de la carrera, semestres, cursos, docentes, turnos y programación guardada
    const cargarMalla = useCallback(async () => {
        if (!idCarrera) return;
        setCargando(true);
        setError(null);

        try {
            const res = await authFetch(`${API_BASE_URL}/api/carreras/${encodeURIComponent(idCarrera)}/malla`);
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.mensaje || 'Error al obtener la malla curricular de la carrera.');
            }

            setMallaData(data);
            setHayCambiosSinGuardar(false);

            // 1. Configurar turnos provenientes de la base de datos
            const listaTurnos = data.turnos && data.turnos.length > 0
                ? data.turnos
                : [
                    { id_turno: 1, codigo_turno: '01' },
                    { id_turno: 2, codigo_turno: '02' },
                    { id_turno: 3, codigo_turno: '03' }
                ];
            setTurnosBD(listaTurnos);

            if (listaTurnos.length > 0) {
                setTurnoActivo(listaTurnos[0].id_turno);
            }

            // 2. Restaurar asignaciones guardadas previamente en programacion_academica
            if (data.programacion && Array.isArray(data.programacion) && data.programacion.length > 0) {
                const mapaSem = {};
                const mapaCur = {};

                for (const prog of data.programacion) {
                    const idT = prog.id_turno;
                    const sem = prog.semestre;
                    const idC = prog.id_curso;

                    if (sem) {
                        if (!mapaSem[sem]) mapaSem[sem] = {};
                        if (!mapaSem[sem][idT]) mapaSem[sem][idT] = {};
                        if (prog.id_docente_tec) mapaSem[sem][idT].tec = String(prog.id_docente_tec);
                        if (prog.id_docente_tal) mapaSem[sem][idT].tal = String(prog.id_docente_tal);
                    }

                    if (idC) {
                        if (!mapaCur[idC]) mapaCur[idC] = {};
                        const docId = prog.id_docente_tec || prog.id_docente_tal;
                        if (docId) {
                            mapaCur[idC][idT] = String(docId);
                        }
                    }
                }

                setAsignacionesDocentes(mapaSem);
                setAsignacionesCursos(mapaCur);
            }
        } catch (err) {
            console.error('Error al cargar malla curricular:', err);
            setError(err.message);
            if (typeof triggerToast === 'function') {
                triggerToast(err.message || 'Error al conectar con la base de datos.');
            }
        } finally {
            setCargando(false);
        }
    }, [idCarrera, triggerToast]);

    useEffect(() => {
        cargarMalla();
    }, [cargarMalla]);

    // Asegurar que la pantalla esté al inicio al abrir o cambiar de semestre
    useEffect(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [semestreFiltro]);

    // Semestres registrados de la carrera: si el usuario seleccionó un semestre específico, se muestra SOLO ese
    const semestres = useMemo(() => {
        const lista = mallaData?.semestres || [];
        const base = lista.filter((s) => !['I', '1'].includes(String(s.semestre).trim().toUpperCase()));
        if (!semestreFiltro) return base;
        const filtrado = base.filter((s) => matchSemestre(s.semestre, semestreFiltro));
        return filtrado.length > 0 ? filtrado : base;
    }, [mallaData, semestreFiltro]);

    const nombreCarrera = mallaData?.carrera?.nombre_carrera || carrera?.nombre || carrera?.nombre_carrera || 'Carrera';
    const listaDocentes = useMemo(() => mallaData?.docentes || [], [mallaData]);
    // Mapa rápido de docentes por ID para mostrar su nombre
    const mapaDocentesPorId = useMemo(() => {
        const map = new Map();
        for (const doc of listaDocentes) {
            map.set(String(doc.id_docente), doc);
        }
        return map;
    }, [listaDocentes]);

    // Turnos disponibles: todas las carreras cuentan con los 3 turnos oficiales de la BD para total escalabilidad
    const turnosDisponibles = useMemo(() => {
        if (turnosBD && turnosBD.length > 0) {
            return turnosBD;
        }
        return [
            { id_turno: 1, codigo_turno: '01' },
            { id_turno: 2, codigo_turno: '02' },
            { id_turno: 3, codigo_turno: '03' }
        ];
    }, [turnosBD]);

    // Obtener etiqueta legible de turno basada en el registro de la BD: Turno 1, Turno 2, Turno 3
    const obtenerTextoTurno = (idTurno) => {
        const t = turnosBD.find((item) => Number(item.id_turno) === Number(idTurno));
        if (t) {
            if (t.codigo_turno === '01') return 'Turno 1';
            if (t.codigo_turno === '02') return 'Turno 2';
            if (t.codigo_turno === '03') return 'Turno 3';
            return `Turno ${parseInt(t.codigo_turno, 10) || t.codigo_turno}`;
        }
        return `Turno ${idTurno}`;
    };

    /**
     * Regla: Si el curso es TEC-TAL, por defecto debe llevar el mismo docente.
     * Al seleccionar TEC, automáticamente se sincroniza el mismo para TAL.
     */
    const handleCambiarDocente = (semestreRomano, tipo, idDocente) => {
        setHayCambiosSinGuardar(true);
        const semObj = semestres.find((s) => matchSemestre(s.semestre, semestreRomano));
        const tieneTecTal = semObj?.cursos?.some((c) => String(c.horario_sinfo || '').toUpperCase() === 'TEC-TAL');

        setAsignacionesDocentes((prev) => {
            const sem = prev[semestreRomano] || {};
            const tur = sem[turnoActivo] || {};

            const nuevoTur = {
                ...tur,
                [tipo]: idDocente || ''
            };

            // Sincronización automática TEC-TAL: ambos comparten el mismo docente
            if (tieneTecTal) {
                nuevoTur.tec = idDocente || '';
                nuevoTur.tal = idDocente || '';
            }

            return {
                ...prev,
                [semestreRomano]: {
                    ...sem,
                    [turnoActivo]: nuevoTur
                }
            };
        });
    };

    /**
     * Regla: Para cursos complementarios (is_carrera === 0), permite elegir docente mediante comboBox individual.
     */
    const handleCambiarDocenteCurso = (idCurso, idTurno, idDocente) => {
        setHayCambiosSinGuardar(true);
        setAsignacionesCursos((prev) => {
            const cur = prev[idCurso] || {};
            return {
                ...prev,
                [idCurso]: {
                    ...cur,
                    [idTurno]: idDocente || ''
                }
            };
        });
    };

    /**
     * Regla: Cambiar si un curso es de carrera (1) o complementario (0) mediante ComboBox y persistir en la BD.
     */
    const handleCambiarTipoCurso = async (idCurso, nuevoValor) => {
        // Actualizar estado local inmediatamente
        setMallaData((prev) => {
            if (!prev) return prev;
            const semestresActualizados = prev.semestres.map((s) => ({
                ...s,
                cursos: (s.cursos || []).map((c) =>
                    c.id_curso === idCurso ? { ...c, is_carrera: nuevoValor } : c
                )
            }));
            return { ...prev, semestres: semestresActualizados };
        });

        try {
            const res = await authFetch(`${API_BASE_URL}/api/carreras/cursos/${idCurso}/tipo`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_carrera: nuevoValor })
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.mensaje || 'Error al actualizar tipo de curso.');
            }

            if (typeof triggerToast === 'function') {
                triggerToast(`Curso marcado como: ${nuevoValor === 1 ? 'Carrera' : 'Complementario'}`);
            }
        } catch (err) {
            console.error('Error al actualizar tipo de curso:', err);
            if (typeof triggerToast === 'function') {
                triggerToast(err.message || 'Error al actualizar en la base de datos.');
            }
        }
    };

    /**
     * Regla: Guardar toda la configuración en la tabla programacion_academica (Sede 1, Periodo 1).
     */
    const guardarConfiguracionEnBD = async () => {
        setGuardandoProg(true);
        try {
            const asignaciones = [];
            const listaSemestres = mallaData?.semestres || [];

            for (const sem of listaSemestres) {
                const cursos = sem.cursos || [];

                for (const turno of turnosDisponibles) {
                    const idTurno = turno.id_turno;
                    const asignSem = asignacionesDocentes[sem.semestre]?.[idTurno] || {};

                    for (const curso of cursos) {
                        // Cursos con EMP son de empresa y no llevan docente
                        const esEmpresa = String(curso.horario_sinfo || '').toUpperCase().includes('EMP');
                        if (esEmpresa) continue;

                        const esDeCarrera = Number(curso.is_carrera) === 1;
                        let idDocenteTec = null;
                        let idDocenteTal = null;

                        if (esDeCarrera) {
                            // Cursos de carrera: toman la asignación del docente general del semestre
                            const horario = String(curso.horario_sinfo || '').toUpperCase();
                            if (horario.includes('TEC') && horario.includes('TAL')) {
                                idDocenteTec = asignSem.tec || asignSem.tal || null;
                                idDocenteTal = asignSem.tec || asignSem.tal || null;
                            } else if (horario.includes('TAL') || /seminario/i.test(curso.nombre_curso)) {
                                idDocenteTal = asignSem.tal || null;
                            } else {
                                idDocenteTec = asignSem.tec || null;
                            }
                        } else {
                            // Cursos complementarios: toman el docente elegido en su propio comboBox
                            const docIndiv = asignacionesCursos[curso.id_curso]?.[idTurno] || null;
                            const horario = String(curso.horario_sinfo || '').toUpperCase();
                            if (horario.includes('TAL')) {
                                idDocenteTal = docIndiv;
                            } else {
                                idDocenteTec = docIndiv;
                            }
                        }

                        asignaciones.push({
                            id_curso: curso.id_curso,
                            id_turno: idTurno,
                            grupo: '01',
                            id_docente_tec: idDocenteTec,
                            id_docente_tal: idDocenteTal
                        });
                    }
                }
            }

            const res = await authFetch(`${API_BASE_URL}/api/carreras/programacion`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ asignaciones })
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.mensaje || 'Error al guardar la programación.');
            }

            setHayCambiosSinGuardar(false);
            if (typeof triggerToast === 'function') {
                triggerToast('¡Configuración guardada exitosamente en la tabla programacion_academica!');
            }
        } catch (err) {
            console.error('Error al guardar en programacion_academica:', err);
            if (typeof triggerToast === 'function') {
                triggerToast(err.message || 'Error al guardar en la base de datos.');
            }
        } finally {
            setGuardandoProg(false);
        }
    };

    // Obtener clase para el badge de TIPO (TAL, TEC, TEC-TAL, EMP, SEM)
    const getClaseTipo = (curso) => {
        if (/seminario/i.test(curso?.nombre_curso || '')) return 'sem';
        const h = String(curso?.horario_sinfo || '').toUpperCase();
        if (h.includes('TAL')) return 'tal';
        if (h.includes('TEC-TAL')) return 'tec-tal';
        if (h.includes('TEC')) return 'tec';
        if (h.includes('EMP')) return 'emp';
        return 'tec';
    };

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
                        onClick={handleClicVolver}
                        title="Regresar al Directorio de Carreras"
                    >
                        <i className="fas fa-arrow-left"></i>
                        <span>Volver a carreras</span>
                    </button>
                </div>
            </div>

            {/* =============================================================== */}
            {/* PANEL DE CONTROL SUPERIOR: CANTIDAD DE TURNOS Y PESTAÑAS (BD)   */}
            {/* =============================================================== */}
            <div className="malla-turnos-control-panel">
                {/* Selector rápido de ciclo / semestre */}
                <div className="malla-control-row">
                    <span className="malla-control-label">ciclo en pantalla:</span>
                    <div className="malla-ciclos-chips-list">
                        {['II', 'III', 'IV', 'V', 'VI'].map((sem) => (
                            <button
                                key={sem}
                                type="button"
                                className={`malla-ciclo-chip-btn ${matchSemestre(semestreFiltro, sem) ? 'active' : ''}`}
                                onClick={() => setSemestreFiltro(sem)}
                            >
                                Sem. {sem}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Desplegable de selección de turno según la BD */}
                <div className="malla-control-row">
                    <span className="malla-control-label">turno:</span>
                    <select
                        className="malla-select-turnos-count"
                        value={turnoActivo}
                        onChange={(e) => setTurnoActivo(Number(e.target.value))}
                        title="Seleccionar el turno de clases a configurar"
                    >
                        {turnosDisponibles.map((turno) => (
                            <option key={turno.id_turno} value={turno.id_turno}>
                                {obtenerTextoTurno(turno.id_turno)}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

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

            {/* Listado consecutivo de tarjetas por cada semestre (Semestre II al VI) */}
            {!cargando && !error && (
                <>
                    {semestres.map((semestre) => {
                        const cursosDelCiclo = semestre.cursos || [];
                        const totalHorasCiclo = semestre.total_horas || 0;
                        const metaHoras = semestre.horas_meta || 510;

                        // Asignaciones del turno activo para este ciclo
                        const asignacionTurno = asignacionesDocentes[semestre.semestre]?.[turnoActivo] || {};
                        const docenteTecAsignado = mapaDocentesPorId.get(String(asignacionTurno.tec));
                        const docenteTalAsignado = mapaDocentesPorId.get(String(asignacionTurno.tal));

                        const tieneTecTal = cursosDelCiclo.some((c) => String(c.horario_sinfo || '').toUpperCase() === 'TEC-TAL');

                        return (
                            <div
                                key={semestre.id_semestre || semestre.semestre}
                                id={`semestre-card-${String(semestre.semestre).trim().toUpperCase()}`}
                                className="malla-semester-card"
                            >
                                {/* Encabezado de la tarjeta del semestre */}
                                <div className="malla-semester-card-header">
                                    <div>
                                        <h3 className="malla-semester-card-title">
                                            Semestre {semestre.semestre}
                                        </h3>
                                        <p className="malla-semester-card-subtitle">
                                            {cursosDelCiclo.length} cursos
                                        </p>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <button
                                            type="button"
                                            className="malla-btn-agregar-curso"
                                            onClick={() => abrirModalCrearCurso(semestre)}
                                            title={`Agregar nuevo curso al Semestre ${semestre.semestre}`}
                                        >
                                            <i className="fas fa-plus"></i>
                                            <span>Agregar Curso</span>
                                        </button>
                                        <span className="malla-badge-meta">
                                            {totalHorasCiclo} H
                                        </span>
                                    </div>
                                </div>

                                {/* =============================================================== */}
                                {/* SELECTORES DE DOCENTES PARA TEC Y TAL EN ESTE TURNO             */}
                                {/* Aplica solo a cursos de carrera (is_carrera = 1)                 */}
                                {/* =============================================================== */}
                                <div className="malla-docentes-selectores-bar">
                                    {/* Selector Docente para TEC */}
                                    <div className="malla-docente-select-group">
                                        <label htmlFor={`doc-tec-${semestre.semestre}`}>
                                            docente para TEC:
                                        </label>
                                        <select
                                            id={`doc-tec-${semestre.semestre}`}
                                            className="malla-docente-combobox"
                                            value={asignacionTurno.tec || ''}
                                            onChange={(e) => handleCambiarDocente(semestre.semestre, 'tec', e.target.value)}
                                        >
                                            <option value="">-- Seleccionar docente para TEC --</option>
                                            {listaDocentes.map((d) => (
                                                <option key={d.id_docente} value={d.id_docente}>
                                                    {d.nombre_completo} ({d.especialidad})
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* Selector Docente para TAL */}
                                    <div className="malla-docente-select-group">
                                        <label htmlFor={`doc-tal-${semestre.semestre}`}>
                                            docente para TAL:
                                            {tieneTecTal && <span style={{ fontSize: '10px', color: '#0284c7', marginLeft: '4px' }}>(Sincronizado TEC-TAL)</span>}
                                        </label>
                                        <select
                                            id={`doc-tal-${semestre.semestre}`}
                                            className="malla-docente-combobox"
                                            value={asignacionTurno.tal || ''}
                                            onChange={(e) => handleCambiarDocente(semestre.semestre, 'tal', e.target.value)}
                                        >
                                            <option value="">-- Seleccionar docente para TAL --</option>
                                            {listaDocentes.map((d) => (
                                                <option key={d.id_docente} value={d.id_docente}>
                                                    {d.nombre_completo} ({d.especialidad})
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                {/* Tabla oficial de asignaturas del semestre en este turno */}
                                {cursosDelCiclo.length > 0 ? (
                                    <div style={{ overflowX: 'auto' }}>
                                        <table className="malla-clean-table">
                                            <thead>
                                                <tr>
                                                    <th>MAT CUR</th>
                                                    <th>CATÁLOGO</th>
                                                    <th>CURSO</th>
                                                    <th>TIPO HORARIO</th>
                                                    <th>CATEGORÍA</th>
                                                    <th>DOCENTE ASIGNADO ({obtenerTextoTurno(turnoActivo)})</th>
                                                    <th className="center">SEMANAS</th>
                                                    <th className="center">TOTAL HORAS</th>
                                                    <th className="center" style={{ width: '90px' }}>ACCIONES</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {cursosDelCiclo.map((curso) => {
                                                    const esSeminario = /seminario/i.test(curso.nombre_curso || '');
                                                    const esEmpresa = String(curso.horario_sinfo || '').toUpperCase().includes('EMP');
                                                    const esDeCarrera = Number(curso.is_carrera) === 1;

                                                    // Para cursos de carrera:
                                                    const esTaller = String(curso.horario_sinfo || '').toUpperCase().includes('TAL') || esSeminario;
                                                    const docenteAsignadoCarrera = esTaller ? docenteTalAsignado : docenteTecAsignado;

                                                    return (
                                                        <tr key={curso.id_curso || curso.mat_cur}>
                                                            <td>
                                                                <span className="malla-badge-matcur-blue">
                                                                    {curso.mat_cur}
                                                                </span>
                                                            </td>
                                                            <td>
                                                                <span className="malla-badge-catalogo">
                                                                    {curso.catalogo || '—'}
                                                                </span>
                                                            </td>
                                                            <td>
                                                                <span className="malla-curso-nombre-bold">
                                                                    {curso.nombre_curso}
                                                                </span>
                                                            </td>
                                                            <td>
                                                                <span className={`malla-badge-tipo ${getClaseTipo(curso)}`}>
                                                                    {esSeminario ? 'SEMINARIO' : (curso.horario_sinfo || 'TEC')}
                                                                </span>
                                                            </td>
                                                            <td>
                                                                <select
                                                                    className={`malla-select-is-carrera ${esDeCarrera ? 'carrera' : 'complementario'}`}
                                                                    value={esDeCarrera ? '1' : '0'}
                                                                    onChange={(e) => handleCambiarTipoCurso(curso.id_curso, Number(e.target.value))}
                                                                    title="Seleccione si el curso es de Carrera o Complementario"
                                                                >
                                                                    <option value="1">Carrera</option>
                                                                    <option value="0">Complementario</option>
                                                                </select>
                                                            </td>
                                                            <td>
                                                                {esEmpresa ? (
                                                                    <span className="malla-docente-asignado-pill empresa">
                                                                        <i className="fas fa-building" style={{ color: '#ca8a04' }}></i>
                                                                        Empresa Formadora (Sin docente)
                                                                    </span>
                                                                ) : esDeCarrera ? (
                                                                    docenteAsignadoCarrera ? (
                                                                        <span className="malla-docente-asignado-pill">
                                                                            <i className="fas fa-user-check" style={{ color: '#059669' }}></i>
                                                                            {docenteAsignadoCarrera.nombre_completo}
                                                                        </span>
                                                                    ) : (
                                                                        <span className="malla-docente-asignado-pill sin-asignar">
                                                                            Por asignar ({esTaller ? 'Docente TAL' : 'Docente TEC'})
                                                                        </span>
                                                                    )
                                                                ) : (
                                                                    <select
                                                                        className="malla-docente-row-combobox"
                                                                        value={asignacionesCursos[curso.id_curso]?.[turnoActivo] || ''}
                                                                        onChange={(e) => handleCambiarDocenteCurso(curso.id_curso, turnoActivo, e.target.value)}
                                                                    >
                                                                        <option value="">-- Seleccionar docente complementario --</option>
                                                                        {listaDocentes.map((d) => (
                                                                            <option key={d.id_docente} value={d.id_docente}>
                                                                                {d.nombre_completo} ({d.especialidad})
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                )}
                                                            </td>
                                                            <td className="center">
                                                                {curso.semanas ?? '—'}
                                                            </td>
                                                            <td className="center">
                                                                <span className="malla-horas-bold">
                                                                    {curso.total_horas || 0}
                                                                </span>
                                                            </td>
                                                            <td className="center">
                                                                <div className="malla-row-actions">
                                                                    <button
                                                                        type="button"
                                                                        className="malla-action-btn edit"
                                                                        onClick={() => abrirModalEditarCurso(curso, semestre)}
                                                                        title={`Editar curso: ${curso.nombre_curso}`}
                                                                    >
                                                                        <i className="fas fa-pencil-alt"></i>
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        className="malla-action-btn delete"
                                                                        onClick={() => handleEliminarCurso(curso.id_curso, curso.nombre_curso)}
                                                                        title={`Eliminar curso: ${curso.nombre_curso}`}
                                                                    >
                                                                        <i className="fas fa-trash-alt"></i>
                                                                    </button>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div className="malla-semester-empty">
                                        No hay cursos registrados para el Semestre {semestre.semestre} en la base de datos.
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {/* Mensaje si la carrera no tiene ningún semestre registrado del II al VI */}
                    {semestres.length === 0 && (
                        <div className="workspace-card" style={{ textAlign: 'center', padding: '50px 20px' }}>
                            <i className="fas fa-folder-open" style={{ fontSize: '32px', color: '#94a3b8', marginBottom: '12px' }}></i>
                            <h2>No se encontraron semestres registrados (II al VI)</h2>
                            <p>Esta carrera aún no cuenta con asignaturas registradas para los ciclos formativos.</p>
                            {typeof onAbrirImportacion === 'function' && (
                                <button
                                    type="button"
                                    className="eq4-btn eq4-btn-primary"
                                    onClick={onAbrirImportacion}
                                    disabled={procesandoImportacion}
                                    style={{ marginTop: '16px' }}
                                >
                                    <i className="fas fa-file-excel" style={{ color: '#A7F3D0' }}></i> Cargar Mallas Curriculares (Excel)
                                </button>
                            )}
                        </div>
                    )}
                </>
            )}

            {/* Modal para Crear y Editar Curso en el Semestre */}
            {modalCursoAbierto && (
                <div className="eq4-modal-overlay" onClick={() => setModalCursoAbierto(false)}>
                    <div className="eq4-modal-content-custom" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '680px', width: '95%' }}>
                        <div className="eq4-modal-header-custom">
                            <h3>
                                <i className="fas fa-book" style={{ color: 'var(--senati-blue)', marginRight: '8px' }}></i>
                                {modoModalCurso === 'crear' ? 'Agregar Nuevo Curso' : 'Editar Curso'}
                                {semestreModal ? ` · Semestre ${semestreModal.semestre}` : ''}
                            </h3>
                            <button className="eq4-modal-close-btn" onClick={() => setModalCursoAbierto(false)}>
                                <i className="fas fa-times"></i>
                            </button>
                        </div>

                        <form onSubmit={guardarCursoForm}>
                            <div className="eq4-modal-body-custom">
                                {errorModalCurso && (
                                    <div style={{
                                        padding: '10px 14px',
                                        borderRadius: '8px',
                                        marginBottom: '16px',
                                        fontSize: '13px',
                                        background: '#FEF2F2',
                                        border: '1px solid #FECACA',
                                        color: '#991B1B'
                                    }}>
                                        <i className="fas fa-exclamation-triangle" style={{ marginRight: '6px' }}></i>
                                        {errorModalCurso}
                                    </div>
                                )}

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-dark)', marginBottom: '6px' }}>
                                            Código MAT CUR *
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="Ej. PIAD-525"
                                            value={formCurso.mat_cur}
                                            onChange={(e) => setFormCurso({ ...formCurso, mat_cur: e.target.value.toUpperCase() })}
                                            style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px' }}
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-dark)', marginBottom: '6px' }}>
                                            Catálogo / Malla
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="Ej. 202610, 202310"
                                            value={formCurso.catalogo}
                                            onChange={(e) => setFormCurso({ ...formCurso, catalogo: e.target.value })}
                                            style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px' }}
                                        />
                                    </div>
                                </div>

                                <div style={{ marginBottom: '14px' }}>
                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-dark)', marginBottom: '6px' }}>
                                        Nombre de la Asignatura / Curso *
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="Ej. DISEÑO Y DESARROLLO DE APLICACIONES MÓVILES"
                                        value={formCurso.nombre_curso}
                                        onChange={(e) => setFormCurso({ ...formCurso, nombre_curso: e.target.value.toUpperCase() })}
                                        style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px' }}
                                        required
                                    />
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-dark)', marginBottom: '6px' }}>
                                            Tipo Horario (SINFO)
                                        </label>
                                        <select
                                            value={formCurso.horario_sinfo}
                                            onChange={(e) => setFormCurso({ ...formCurso, horario_sinfo: e.target.value })}
                                            style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px', background: '#fff' }}
                                        >
                                            <option value="TEC">TEC (Tecnología / Teoría)</option>
                                            <option value="TAL">TAL (Taller / Práctica)</option>
                                            <option value="TEC-TAL">TEC-TAL (Tecnología y Taller)</option>
                                            <option value="EMP">EMP (Formación en Empresa)</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-dark)', marginBottom: '6px' }}>
                                            Categoría de Curso
                                        </label>
                                        <select
                                            value={formCurso.is_carrera}
                                            onChange={(e) => setFormCurso({ ...formCurso, is_carrera: Number(e.target.value) })}
                                            style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px', background: '#fff' }}
                                        >
                                            <option value={1}>Carrera</option>
                                            <option value={0}>Complementario</option>
                                        </select>
                                    </div>
                                </div>

                                <div style={{ marginBottom: '14px' }}>
                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-dark)', marginBottom: '6px' }}>
                                        Duración (Semanas)
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        max="24"
                                        value={formCurso.semanas}
                                        onChange={(e) => setFormCurso({ ...formCurso, semanas: Number(e.target.value) })}
                                        style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px' }}
                                    />
                                </div>

                                {/* Desglose oficial de horas curriculares según diseño de SENATI */}
                                <div style={{ marginBottom: '14px' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '12px', alignItems: 'end' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                                            <label style={{ minHeight: '28px', display: 'flex', alignItems: 'flex-end', fontSize: '11px', fontWeight: '700', color: '#1e293b', marginBottom: '6px', textTransform: 'uppercase', lineHeight: '1.25' }}>
                                                TEORÍA / TECNOLOGÍA
                                            </label>
                                            <input
                                                type="number"
                                                min="0"
                                                value={formCurso.horas_teoria}
                                                onChange={(e) => handleActualizarHoras('horas_teoria', e.target.value)}
                                                style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', background: '#ffffff', boxSizing: 'border-box' }}
                                            />
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                                            <label style={{ minHeight: '28px', display: 'flex', alignItems: 'flex-end', fontSize: '11px', fontWeight: '700', color: '#1e293b', marginBottom: '6px', textTransform: 'uppercase', lineHeight: '1.25' }}>
                                                TALLER / EMPRESA
                                            </label>
                                            <input
                                                type="number"
                                                min="0"
                                                value={formCurso.horas_taller}
                                                onChange={(e) => handleActualizarHoras('horas_taller', e.target.value)}
                                                style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', background: '#ffffff', boxSizing: 'border-box' }}
                                            />
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                                            <label style={{ minHeight: '28px', display: 'flex', alignItems: 'flex-end', fontSize: '11px', fontWeight: '700', color: '#1e293b', marginBottom: '6px', textTransform: 'uppercase', lineHeight: '1.25' }}>
                                                VIRTUAL
                                            </label>
                                            <input
                                                type="number"
                                                min="0"
                                                value={formCurso.horas_virtual}
                                                onChange={(e) => handleActualizarHoras('horas_virtual', e.target.value)}
                                                style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', background: '#ffffff', boxSizing: 'border-box' }}
                                            />
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                                            <label style={{ minHeight: '28px', display: 'flex', alignItems: 'flex-end', fontSize: '11px', fontWeight: '700', color: '#1e293b', marginBottom: '6px', textTransform: 'uppercase', lineHeight: '1.25' }}>
                                                EVALUACIÓN SEMESTRAL
                                            </label>
                                            <input
                                                type="number"
                                                min="0"
                                                value={formCurso.horas_evaluacion}
                                                onChange={(e) => handleActualizarHoras('horas_evaluacion', e.target.value)}
                                                style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', background: '#ffffff', boxSizing: 'border-box' }}
                                            />
                                        </div>
                                    </div>

                                    {/* Card resumen: TOTAL HORAS ASIGNATURA y HORAS TOTALES SEMESTRE */}
                                    <div style={{
                                        background: '#f8fafc',
                                        border: '1px solid #e2e8f0',
                                        borderRadius: '10px',
                                        padding: '12px 16px',
                                        display: 'grid',
                                        gridTemplateColumns: '1fr 1fr',
                                        gap: '16px',
                                        alignItems: 'center'
                                    }}>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '11px', fontWeight: '800', color: '#003B70', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                                                TOTAL HORAS ASIGNATURA
                                            </label>
                                            <input
                                                type="number"
                                                value={formCurso.total_horas}
                                                readOnly
                                                style={{
                                                    width: '100%',
                                                    padding: '9px 12px',
                                                    borderRadius: '8px',
                                                    border: '1px solid #cbd5e1',
                                                    fontSize: '15px',
                                                    fontWeight: '700',
                                                    color: '#003B70',
                                                    background: '#ffffff',
                                                    boxSizing: 'border-box'
                                                }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#334155', marginBottom: '6px', textTransform: 'uppercase' }}>
                                                HORAS TOTALES SEMESTRE
                                            </label>
                                            <input
                                                type="number"
                                                value={formCurso.horas_semestre_meta}
                                                onChange={(e) => setFormCurso({ ...formCurso, horas_semestre_meta: Number(e.target.value) })}
                                                style={{
                                                    width: '100%',
                                                    padding: '9px 12px',
                                                    borderRadius: '8px',
                                                    border: '1px solid #cbd5e1',
                                                    fontSize: '14px',
                                                    color: '#334155',
                                                    background: '#ffffff',
                                                    boxSizing: 'border-box'
                                                }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="eq4-modal-footer-custom">
                                <button
                                    type="button"
                                    className="eq4-btn eq4-btn-secondary"
                                    onClick={() => setModalCursoAbierto(false)}
                                    disabled={guardandoCurso}
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="eq4-btn eq4-btn-primary"
                                    disabled={guardandoCurso}
                                >
                                    <i className={guardandoCurso ? 'fas fa-spinner fa-spin' : (modoModalCurso === 'crear' ? 'fas fa-plus' : 'fas fa-save')}></i>
                                    <span>{guardandoCurso ? 'Guardando...' : (modoModalCurso === 'crear' ? 'Registrar Curso' : 'Guardar Cambios')}</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* =============================================================== */}
            {/* MODAL DE CONFIRMACIÓN: CAMBIAR DE CARRERA O SALIR AL DIRECTORIO */}
            {/* =============================================================== */}
            {modalAlertaVolver && (
                <div className="eq4-modal-overlay" onClick={() => setModalAlertaVolver(false)}>
                    <div className="eq4-modal-content-custom" onClick={(e) => e.stopPropagation()} style={{ width: '480px' }}>
                        <div className="eq4-modal-header-custom">
                            <h3 style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#1e293b', margin: 0, fontSize: '16px', fontWeight: '700' }}>
                                <i className="fas fa-exclamation-triangle" style={{ color: '#f59e0b', fontSize: '18px' }}></i>
                                ¿Cambiar de carrera o salir?
                            </h3>
                            <button
                                type="button"
                                className="eq4-modal-close-btn"
                                onClick={() => setModalAlertaVolver(false)}
                                title="Cerrar ventana"
                            >
                                &times;
                            </button>
                        </div>
                        <div className="eq4-modal-body-custom" style={{ padding: '22px 24px' }}>
                            <p style={{ margin: 0, fontSize: '14px', color: '#334155', lineHeight: 1.5 }}>
                                Está a punto de salir de la gestión del programa académico:
                            </p>
                            <div style={{
                                marginTop: '8px',
                                padding: '10px 14px',
                                background: '#f8fafc',
                                border: '1px solid #e2e8f0',
                                borderRadius: '8px',
                                fontWeight: '700',
                                color: '#003B70',
                                fontSize: '14px'
                            }}>
                                <i className="fas fa-graduation-cap" style={{ marginRight: '8px', color: '#003B70' }}></i>
                                {nombreCarrera}
                            </div>

                            {hayCambiosSinGuardar ? (
                                <div style={{
                                    background: '#fef2f2',
                                    color: '#991b1b',
                                    padding: '12px 14px',
                                    borderRadius: '8px',
                                    border: '1px solid #fecaca',
                                    marginTop: '14px',
                                    fontSize: '13px',
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: '10px'
                                }}>
                                    <i className="fas fa-exclamation-circle" style={{ fontSize: '18px', color: '#dc2626', marginTop: '2px', flexShrink: 0 }}></i>
                                    <div>
                                        <strong>¡Atención! Tiene modificaciones sin guardar.</strong>
                                        <div style={{ marginTop: '3px', lineHeight: 1.4 }}>
                                            Ha realizado asignaciones de docentes en los semestres que aún no se han persistido. Si sale ahora para cambiar de carrera, los cambios se perderán.
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <p style={{ color: '#64748b', fontSize: '13px', marginTop: '14px', marginBottom: 0, lineHeight: 1.4 }}>
                                    Las asignaciones de docentes guardadas se encuentran seguras en la base de datos. ¿Desea volver al directorio institucional de carreras?
                                </p>
                            )}
                        </div>
                        <div className="eq4-modal-footer-custom" style={{ padding: '14px 24px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                            <button
                                type="button"
                                className="eq4-btn eq4-btn-secondary"
                                onClick={() => setModalAlertaVolver(false)}
                            >
                                Seguir en esta carrera
                            </button>
                            <button
                                type="button"
                                className="eq4-btn eq4-btn-primary"
                                style={{ background: '#003B70' }}
                                onClick={() => {
                                    setModalAlertaVolver(false);
                                    if (typeof onVolver === 'function') onVolver();
                                }}
                            >
                                <i className="fas fa-arrow-left"></i>
                                Sí, cambiar de carrera
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}

