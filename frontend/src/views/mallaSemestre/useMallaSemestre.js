import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { API_BASE_URL } from '../../config/api';
import { authFetch } from '../../lib/authFetch';
import { matchSemestre } from './mallaSemestre.helpers';

/**
 * Custom Hook: useMallaSemestre (Equipo 4)
 * Encapsula el 100% de la lógica de estado, consultas a la base de datos,
 * gestión de turnos, semestres, docentes y detección de cambios sin guardar.
 */
export function useMallaSemestre({
    carrera,
    semestreObjetivo,
    triggerToast,
    onCambiosPendientesChange,
    onRefrescarCarreras
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

    // Estado del turno activo: 1 = Turno 1, 2 = Turno 2, 3 = Turno 3
    const [turnoActivo, setTurnoActivo] = useState(1);

    // Cantidad de turnos configurados para el ciclo actual (por defecto 1 Turno)
    const [cantidadTurnosPorCiclo, setCantidadTurnosPorCiclo] = useState({});

    // Turno inicial por ciclo (para rastrear si se hicieron cambios en la cantidad de turnos)
    const turnosInicialesPorCicloRef = useRef({});

    // Regla: Por defecto al entrar y al cambiar de ciclo debe estar marcado el 1.er turno
    useEffect(() => {
        setTurnoActivo(1);
    }, [semestreFiltro]);

    // Asignación de docentes por ciclo, turno y tipo: { 'II': { 1: { tec: 'idDocente', tal: 'idDocente' } } }
    const [asignacionesDocentes, setAsignacionesDocentes] = useState({});

    // Asignación de docentes por curso (para complementarios): { idCurso: { turno: idDocente } }
    const [asignacionesCursos, setAsignacionesCursos] = useState({});

    // Referencia para detectar si hay cambios sin guardar
    const snapshotInicial = useRef(null);
    const [hayCambiosSinGuardar, setHayCambiosSinGuardar] = useState(false);

    // Modal de confirmación al salir con cambios
    const [modalAlertaVolver, setModalAlertaVolver] = useState(false);

    // Modal de Crear y Editar Curso
    const [modalCursoAbierto, setModalCursoAbierto] = useState(false);
    const [modoModalCurso, setModoModalCurso] = useState('crear');
    const [semestreModal, setSemestreModal] = useState(null);
    const [guardandoCurso, setGuardandoCurso] = useState(false);
    const [errorModalCurso, setErrorModalCurso] = useState(null);

    const [formCurso, setFormCurso] = useState({
        id_curso: null,
        mat_cur: '',
        catalogo: '',
        nombre_curso: '',
        horario_sinfo: 'TEC',
        is_carrera: 1,
        semanas: 16,
        horas_teoria: 0,
        horas_taller: 0,
        horas_virtual: 0,
        horas_evaluacion: 0,
        total_horas: 0,
        horas_semestre_meta: 510
    });

    // Abrir modal de creación de curso
    const abrirModalCrearCurso = (semestre) => {
        setSemestreModal(semestre);
        setModoModalCurso('crear');
        setErrorModalCurso(null);
        setFormCurso({
            id_curso: null,
            mat_cur: '',
            catalogo: '',
            nombre_curso: '',
            horario_sinfo: 'TEC',
            is_carrera: 1,
            semanas: 16,
            horas_teoria: 0,
            horas_taller: 0,
            horas_virtual: 0,
            horas_evaluacion: 0,
            total_horas: 0,
            horas_semestre_meta: semestre.horas_meta || 510
        });
        setModalCursoAbierto(true);
    };

    // Abrir modal de edición de curso
    const abrirModalEditarCurso = (curso, semestre) => {
        setSemestreModal(semestre);
        setModoModalCurso('editar');
        setErrorModalCurso(null);
        setFormCurso({
            id_curso: curso.id_curso,
            mat_cur: curso.mat_cur || '',
            catalogo: curso.catalogo || '',
            nombre_curso: curso.nombre_curso || '',
            horario_sinfo: curso.horario_sinfo || 'TEC',
            is_carrera: curso.is_carrera !== undefined ? Number(curso.is_carrera) : 1,
            semanas: curso.semanas || 16,
            horas_teoria: Number(curso.horas_teoria) || 0,
            horas_taller: Number(curso.horas_taller) || 0,
            horas_virtual: Number(curso.horas_virtual) || 0,
            horas_evaluacion: Number(curso.horas_evaluacion) || 0,
            total_horas: Number(curso.total_horas) || 0,
            horas_semestre_meta: semestre.horas_meta || 510
        });
        setModalCursoAbierto(true);
    };

    // Recalcular horas del formulario cuando se edita un campo
    const handleActualizarHoras = (campo, valor) => {
        const valNum = Math.max(0, parseInt(valor, 10) || 0);
        setFormCurso((prev) => {
            const nuevo = { ...prev, [campo]: valNum };
            nuevo.total_horas = (nuevo.horas_teoria || 0) + (nuevo.horas_taller || 0) + (nuevo.horas_virtual || 0) + (nuevo.horas_evaluacion || 0);
            return nuevo;
        });
    };

    // Guardar formulario de curso (Crear o Editar)
    const guardarCursoForm = async (e) => {
        e.preventDefault();
        if (!formCurso.mat_cur.trim() || !formCurso.nombre_curso.trim()) {
            setErrorModalCurso('Debe ingresar el código MAT CUR y el nombre del curso.');
            return;
        }

        if (formCurso.total_horas <= 0) {
            setErrorModalCurso('El total de horas del curso debe ser mayor a 0.');
            return;
        }

        setGuardandoCurso(true);
        setErrorModalCurso(null);

        try {
            const url = modoModalCurso === 'crear'
                ? `${API_BASE_URL}/api/malla-semestre/cursos`
                : `${API_BASE_URL}/api/malla-semestre/cursos/${formCurso.id_curso}`;
            const method = modoModalCurso === 'crear' ? 'POST' : 'PUT';

            const res = await authFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...formCurso,
                    id_semestre: semestreModal?.id_semestre
                })
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

    // Habilitar o inhabilitar un curso específico
    const handleToggleEstadoCurso = async (curso, semestre) => {
        const idCurso = curso.id_curso;
        const nuevoEstado = curso.estado === 'I' ? 'A' : 'I';

        setMallaData((prev) => {
            if (!prev) return prev;
            const semestresActualizados = (prev.semestres || []).map((s) => {
                if (s.id_semestre !== semestre.id_semestre) return s;
                return {
                    ...s,
                    cursos: (s.cursos || []).map((c) =>
                        c.id_curso === idCurso ? { ...c, estado: nuevoEstado } : c
                    )
                };
            });
            return { ...prev, semestres: semestresActualizados };
        });

        try {
            const res = await authFetch(`${API_BASE_URL}/api/malla-semestre/cursos/${idCurso}/estado`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ estado: nuevoEstado })
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.mensaje || 'Error al actualizar estado del curso.');
            }

            if (typeof triggerToast === 'function') {
                triggerToast(`Curso ${nuevoEstado === 'A' ? 'activado' : 'inactivado'} correctamente`);
            }
        } catch (err) {
            console.error('Error al actualizar estado del curso:', err);
            if (typeof triggerToast === 'function') {
                triggerToast(err.message || 'Error al actualizar estado del curso');
            }
            await cargarMalla();
        }
    };

    // Cargar la información oficial de la carrera, semestres, cursos, docentes, turnos y programación guardada
    const cargarMalla = useCallback(async () => {
        if (!idCarrera) return;
        setCargando(true);
        setError(null);

        try {
            const res = await authFetch(`${API_BASE_URL}/api/malla-semestre/${encodeURIComponent(idCarrera)}/malla`);
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.mensaje || 'Error al obtener la malla curricular de la carrera.');
            }

            setMallaData(data);
            setHayCambiosSinGuardar(false);

            // Reconstruir asignaciones previas si existen en programacion_academica
            const asigDocentes = {};
            const asigCursos = {};
            const turnosPorCicloDetectados = {};

            if (Array.isArray(data.programacion)) {
                for (const item of data.programacion) {
                    const ciclo = item.semestre;
                    const idTurno = Number(item.id_turno);

                    if (ciclo && idTurno) {
                        turnosPorCicloDetectados[ciclo] = Math.max(
                            turnosPorCicloDetectados[ciclo] || 1,
                            idTurno
                        );

                        if (!asigDocentes[ciclo]) asigDocentes[ciclo] = {};
                        if (!asigDocentes[ciclo][idTurno]) asigDocentes[ciclo][idTurno] = {};

                        if (item.id_docente_tec) asigDocentes[ciclo][idTurno].tec = String(item.id_docente_tec);
                        if (item.id_docente_tal) asigDocentes[ciclo][idTurno].tal = String(item.id_docente_tal);

                        if (item.id_curso) {
                            if (!asigCursos[item.id_curso]) asigCursos[item.id_curso] = {};
                            const docAsignado = item.id_docente_tal || item.id_docente_tec;
                            if (docAsignado) asigCursos[item.id_curso][idTurno] = String(docAsignado);
                        }
                    }
                }
            }

            // Inicializar cantidad de turnos por ciclo
            const conteosFinales = {};
            (data.semestres || []).forEach((s) => {
                conteosFinales[s.semestre] = turnosPorCicloDetectados[s.semestre] || 1;
            });

            setCantidadTurnosPorCiclo(conteosFinales);
            turnosInicialesPorCicloRef.current = { ...conteosFinales };
            setAsignacionesDocentes(asigDocentes);
            setAsignacionesCursos(asigCursos);

            snapshotInicial.current = JSON.stringify({
                docentes: asigDocentes,
                cursos: asigCursos,
                turnosPorCiclo: conteosFinales
            });

        } catch (err) {
            console.error('Error al cargar malla:', err);
            setError(err.message);
        } finally {
            setCargando(false);
        }
    }, [idCarrera]);

    useEffect(() => {
        cargarMalla();
    }, [cargarMalla]);

    // Calcular si hay cambios sin guardar
    useEffect(() => {
        if (!snapshotInicial.current) {
            setHayCambiosSinGuardar(false);
            if (typeof onCambiosPendientesChange === 'function') onCambiosPendientesChange(false);
            return;
        }

        const hayCambiosEnDocentesOCursos = JSON.stringify({
            docentes: asignacionesDocentes,
            cursos: asignacionesCursos
        }) !== JSON.stringify({
            docentes: JSON.parse(snapshotInicial.current).docentes,
            cursos: JSON.parse(snapshotInicial.current).cursos
        });

        // Regla: Si vuelve a 1 Turno (por defecto), no se considera cambio de turno
        let hayCambiosEnTurnos = false;
        Object.keys(cantidadTurnosPorCiclo).forEach((ciclo) => {
            const countActual = Number(cantidadTurnosPorCiclo[ciclo]) || 1;
            if (countActual > 1) {
                const countInicial = Number(turnosInicialesPorCicloRef.current[ciclo]) || 1;
                if (countActual !== countInicial) hayCambiosEnTurnos = true;
            }
        });

        const hayCambios = hayCambiosEnDocentesOCursos || hayCambiosEnTurnos;
        setHayCambiosSinGuardar(hayCambios);
        if (typeof onCambiosPendientesChange === 'function') onCambiosPendientesChange(hayCambios);
    }, [asignacionesDocentes, asignacionesCursos, cantidadTurnosPorCiclo, onCambiosPendientesChange]);

    const nombreCarrera = mallaData?.carrera?.nombre_carrera || carrera?.nombre_carrera || carrera?.nombre || 'Carrera Profesional';

    // Lista de semestres disponibles en la carrera
    const semestresDisponiblesCarrera = useMemo(() => {
        return mallaData?.semestres || [];
    }, [mallaData]);

    // Filtrar semestres por el filtro actual
    const semestres = useMemo(() => {
        if (!mallaData?.semestres) return [];
        return mallaData.semestres.filter((s) => matchSemestre(s.semestre, semestreFiltro));
    }, [mallaData, semestreFiltro]);

    const listaDocentes = useMemo(() => mallaData?.docentes || [], [mallaData]);

    const mapaDocentesPorId = useMemo(() => {
        const mapa = new Map();
        for (const d of listaDocentes) {
            mapa.set(String(d.id_docente), d);
        }
        return mapa;
    }, [listaDocentes]);

    const cantidadTurnosActual = cantidadTurnosPorCiclo[semestreFiltro] || 1;

    // Turnos disponibles para el ciclo actual según la cantidad seleccionada
    const turnosCicloActual = useMemo(() => {
        const turnosBD = mallaData?.turnos || [
            { id_turno: 1, codigo_turno: 'Turno 1' },
            { id_turno: 2, codigo_turno: 'Turno 2' },
            { id_turno: 3, codigo_turno: 'Turno 3' }
        ];
        return turnosBD.slice(0, cantidadTurnosActual);
    }, [mallaData, cantidadTurnosActual]);

    // Cambiar la cantidad de turnos para el ciclo actual
    const handleCambiarCantidadTurnos = (nuevaCantidad) => {
        const cantidad = Math.max(1, Math.min(3, parseInt(nuevaCantidad, 10) || 1));
        setCantidadTurnosPorCiclo((prev) => ({
            ...prev,
            [semestreFiltro]: cantidad
        }));
        if (turnoActivo > cantidad) setTurnoActivo(1);
    };

    // Asignar docente general para TEC o TAL en un semestre y turno
    const handleCambiarDocente = (semestreRomano, tipoDocente, idDocente) => {
        setAsignacionesDocentes((prev) => {
            const copiaSemestre = { ...(prev[semestreRomano] || {}) };
            const copiaTurno = { ...(copiaSemestre[turnoActivo] || {}) };

            if (!idDocente) {
                delete copiaTurno[tipoDocente];
            } else {
                copiaTurno[tipoDocente] = String(idDocente);
            }

            copiaSemestre[turnoActivo] = copiaTurno;
            return {
                ...prev,
                [semestreRomano]: copiaSemestre
            };
        });
    };

    // Asignar docente para un curso individual (complementario)
    const handleCambiarDocenteCurso = (idCurso, idTurno, idDocente) => {
        setAsignacionesCursos((prev) => {
            const copiaCurso = { ...(prev[idCurso] || {}) };
            if (!idDocente) {
                delete copiaCurso[idTurno];
            } else {
                copiaCurso[idTurno] = String(idDocente);
            }
            return {
                ...prev,
                [idCurso]: copiaCurso
            };
        });
    };

    // Habilitar o inhabilitar un semestre
    const handleToggleEstadoSemestre = async (semestre) => {
        const idSemestre = semestre.id_semestre;
        const nuevoEstado = semestre.estado === 'I' ? 'A' : 'I';

        setMallaData((prev) => {
            if (!prev) return prev;
            const actualizados = (prev.semestres || []).map((s) =>
                s.id_semestre === idSemestre ? { ...s, estado: nuevoEstado } : s
            );
            return { ...prev, semestres: actualizados };
        });

        try {
            const res = await authFetch(`${API_BASE_URL}/api/malla-semestre/semestres/${idSemestre}/estado`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ estado: nuevoEstado })
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.mensaje || 'Error al actualizar estado del semestre.');
            }

            if (typeof triggerToast === 'function') {
                triggerToast(`Semestre ${semestre.semestre} ${nuevoEstado === 'A' ? 'habilitado' : 'inhabilitado'} correctamente`);
            }
            if (typeof onRefrescarCarreras === 'function') {
                onRefrescarCarreras();
            }
        } catch (err) {
            console.error('Error al actualizar estado del semestre:', err);
            if (typeof triggerToast === 'function') {
                triggerToast(err.message || 'Error al actualizar estado del semestre');
            }
            await cargarMalla();
        }
    };

    // Cambiar si un curso es de carrera (1) o complementario (0)
    const handleCambiarTipoCurso = async (idCurso, nuevoValor) => {
        setMallaData((prev) => {
            if (!prev) return prev;
            const semestresActualizados = (prev.semestres || []).map((s) => ({
                ...s,
                cursos: (s.cursos || []).map((c) =>
                    c.id_curso === idCurso ? { ...c, is_carrera: nuevoValor } : c
                )
            }));
            return { ...prev, semestres: semestresActualizados };
        });

        try {
            const res = await authFetch(`${API_BASE_URL}/api/malla-semestre/cursos/${idCurso}/tipo`, {
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
                triggerToast(err.message || 'Error al cambiar tipo de curso');
            }
            await cargarMalla();
        }
    };

    // Guardar la configuración en programacion_academica
    const guardarConfiguracionEnBD = async () => {
        if (!mallaData || !mallaData.semestres) return;
        setGuardandoProg(true);

        try {
            const asignaciones = [];

            for (const sem of mallaData.semestres) {
                const ciclo = sem.semestre;
                const turnosDelSemestre = cantidadTurnosPorCiclo[ciclo] || 1;

                for (let turno = 1; turno <= turnosDelSemestre; turno++) {
                    const asigTurno = asignacionesDocentes[ciclo]?.[turno] || {};
                    const docTec = asigTurno.tec || null;
                    const docTal = asigTurno.tal || null;

                    for (const curso of sem.cursos || []) {
                        let idDocenteTec = null;
                        let idDocenteTal = null;

                        if (Number(curso.is_carrera) === 1) {
                            const esTaller = String(curso.horario_sinfo || '').toUpperCase().includes('TAL') || /seminario/i.test(curso.nombre_curso || '');
                            if (esTaller) {
                                idDocenteTal = docTal;
                            } else {
                                idDocenteTec = docTec;
                            }
                        } else {
                            const docComp = asignacionesCursos[curso.id_curso]?.[turno] || null;
                            idDocenteTec = docComp;
                            idDocenteTal = docComp;
                        }

                        asignaciones.push({
                            id_curso: curso.id_curso,
                            id_turno: turno,
                            grupo: '01',
                            id_docente_tec: idDocenteTec,
                            id_docente_tal: idDocenteTal
                        });
                    }
                }
            }

            const res = await authFetch(`${API_BASE_URL}/api/malla-semestre/programacion`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ asignaciones })
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.mensaje || 'Error al guardar la programación.');
            }

            if (typeof triggerToast === 'function') {
                triggerToast('¡Programación académica guardada exitosamente en la base de datos!');
            }

            setHayCambiosSinGuardar(false);
            snapshotInicial.current = JSON.stringify({
                docentes: asignacionesDocentes,
                cursos: asignacionesCursos,
                turnosPorCiclo: cantidadTurnosPorCiclo
            });

        } catch (err) {
            console.error('Error al guardar configuración:', err);
            if (typeof triggerToast === 'function') {
                triggerToast(err.message || 'Error al guardar programación');
            }
        } finally {
            setGuardandoProg(false);
        }
    };

    return {
        // Estados principales
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

        // Modal de confirmación al salir
        modalAlertaVolver,
        setModalAlertaVolver,

        // Modal de cursos
        modalCursoAbierto,
        setModalCursoAbierto,
        modoModalCurso,
        semestreModal,
        guardandoCurso,
        errorModalCurso,
        formCurso,
        setFormCurso,

        // Acciones y Handlers
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
    };
}

