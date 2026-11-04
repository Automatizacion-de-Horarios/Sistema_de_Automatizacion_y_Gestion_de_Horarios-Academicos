import { useState, useEffect, useMemo, useCallback } from 'react';
import { matchSemestre } from './mallaSemestre.helpers';
import { mallaSemestreService } from './mallaSemestre.service';

// Sub-Hooks modulares (Equipo 4)
import { useMallaTurnos } from './hooks/useMallaTurnos';
import { useMallaDocentes } from './hooks/useMallaDocentes';
import { useMallaCursoModal } from './hooks/useMallaCursoModal';
import { useMallaCambios } from './hooks/useMallaCambios';
import { reconstruirProgramacion } from './hooks/useMallaReconstruccion';

/**
 * Custom Hook Orquestador: useMallaSemestre (Equipo 4)
 * Combina los sub-hooks modulares para gestionar el estado integral de la malla,
 * sincronización con el backend y persistencia masiva en la base de datos.
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

    // 1. Sub-Hook de Turnos
    const turnos = useMallaTurnos({
        semestreFiltro,
        turnosBD: mallaData?.turnos
    });

    // 2. Sub-Hook de Docentes y Asignaciones
    const docentes = useMallaDocentes({
        mallaData,
        turnoActivo: turnos.turnoActivo
    });

    // 3. Sub-Hook de Cambios sin Guardar y Alerta de Salida
    const cambios = useMallaCambios({
        asignacionesDocentes: docentes.asignacionesDocentes,
        asignacionesCursos: docentes.asignacionesCursos,
        cantidadTurnosPorCiclo: turnos.cantidadTurnosPorCiclo,
        turnosInicialesPorCicloRef: turnos.turnosInicialesPorCicloRef,
        onCambiosPendientesChange
    });

    // Cargar la información oficial de la carrera, semestres, cursos, docentes y programación guardada
    const cargarMalla = useCallback(async () => {
        if (!idCarrera) return;
        setCargando(true);
        setError(null);

        try {
            const data = await mallaSemestreService.obtenerMalla(idCarrera);
            setMallaData(data);

            // Reconstruir asignaciones previas mediante el algoritmo de Prioridad + Moda
            const { asigDocentes, asigCursos, conteosFinales } = reconstruirProgramacion(data);

            turnos.setCantidadTurnosPorCiclo(conteosFinales);
            turnos.turnosInicialesPorCicloRef.current = { ...conteosFinales };
            docentes.setAsignacionesDocentes(asigDocentes);
            docentes.setAsignacionesCursos(asigCursos);

            cambios.tomarSnapshot(asigDocentes, asigCursos, conteosFinales);
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

    // 4. Sub-Hook del Modal de Cursos
    const modalCurso = useMallaCursoModal({
        triggerToast,
        onCursoGuardado: cargarMalla
    });

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
            await mallaSemestreService.cambiarEstadoCurso(idCurso, nuevoEstado);
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
            await mallaSemestreService.cambiarEstadoSemestre(idSemestre, nuevoEstado);
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
            await mallaSemestreService.cambiarTipoCurso(idCurso, nuevoValor);
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

    // Guardar la configuración masiva en programacion_academica (Bulk Insert)
    const guardarConfiguracionEnBD = async () => {
        if (!mallaData || !mallaData.semestres) return;
        setGuardandoProg(true);

        try {
            const asignaciones = [];

            for (const sem of mallaData.semestres) {
                const ciclo = sem.semestre;
                const turnosDelSemestre = turnos.cantidadTurnosPorCiclo[ciclo] || 1;

                for (let turno = 1; turno <= turnosDelSemestre; turno++) {
                    const asigTurno = docentes.asignacionesDocentes[ciclo]?.[turno] || {};
                    const docTec = asigTurno.tec || null;
                    const docTal = asigTurno.tal || null;

                    for (const curso of sem.cursos || []) {
                        let idDocenteTec = null;
                        let idDocenteTal = null;

                        const esEmpresa = String(curso.horario_sinfo || '').toUpperCase().includes('EMP');
                        const esNCCU = String(curso.mat_cur || '').toUpperCase().startsWith('NCCU');
                        const esComplementario = Number(curso.is_carrera) !== 1;
                        const tipoHorario = String(curso.horario_sinfo || '').toUpperCase();
                        const esTecTal = tipoHorario === 'TEC-TAL';
                        const esTaller = tipoHorario.includes('TAL') || /seminario/i.test(curso.nombre_curso || '');

                        if (esEmpresa) {
                            idDocenteTec = null;
                            idDocenteTal = null;
                        } else if (esNCCU || esComplementario) {
                            const docIndiv = docentes.asignacionesCursos[curso.id_curso]?.[turno];
                            if (docIndiv !== undefined && docIndiv !== '' && docIndiv !== null) {
                                const docNum = Number(docIndiv);
                                if (esTecTal) {
                                    idDocenteTec = docNum;
                                    idDocenteTal = docNum;
                                } else if (esTaller) {
                                    idDocenteTec = null;
                                    idDocenteTal = docNum;
                                } else {
                                    idDocenteTec = docNum;
                                    idDocenteTal = null;
                                }
                            } else if (!esComplementario) {
                                // Curso NCCU de carrera sin selección manual individual: hereda docente de carrera
                                if (esTecTal) {
                                    idDocenteTec = docTec ? Number(docTec) : null;
                                    idDocenteTal = docTal ? Number(docTal) : null;
                                } else if (esTaller) {
                                    idDocenteTec = null;
                                    idDocenteTal = docTal ? Number(docTal) : null;
                                } else {
                                    idDocenteTec = docTec ? Number(docTec) : null;
                                    idDocenteTal = null;
                                }
                            }
                        } else {
                            // Curso estándar de carrera
                            if (esTecTal) {
                                idDocenteTec = docTec ? Number(docTec) : null;
                                idDocenteTal = docTal ? Number(docTal) : null;
                            } else if (esTaller) {
                                idDocenteTec = null;
                                idDocenteTal = docTal ? Number(docTal) : null;
                            } else {
                                idDocenteTec = docTec ? Number(docTec) : null;
                                idDocenteTal = null;
                            }
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

            await mallaSemestreService.guardarProgramacion(
                mallaData?.carrera?.id_carrera || idCarrera,
                asignaciones
            );

            if (typeof triggerToast === 'function') {
                triggerToast('¡Programación académica guardada exitosamente en la base de datos!');
            }

            cambios.tomarSnapshot(
                docentes.asignacionesDocentes,
                docentes.asignacionesCursos,
                turnos.cantidadTurnosPorCiclo
            );

        } catch (err) {
            console.error('Error al guardar configuración:', err);
            if (typeof triggerToast === 'function') {
                triggerToast(err.message || 'Error al guardar programación');
            }
        } finally {
            setGuardandoProg(false);
        }
    };

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

    return {
        // Estados principales
        cargando,
        error,
        guardandoProg,
        semestreFiltro,
        setSemestreFiltro,
        nombreCarrera,
        semestresDisponiblesCarrera,
        semestres,

        // Sub-hook Turnos
        turnoActivo: turnos.turnoActivo,
        setTurnoActivo: turnos.setTurnoActivo,
        cantidadTurnosActual: turnos.cantidadTurnosActual,
        turnosCicloActual: turnos.turnosCicloActual,
        handleCambiarCantidadTurnos: turnos.handleCambiarCantidadTurnos,

        // Sub-hook Docentes
        asignacionesDocentes: docentes.asignacionesDocentes,
        asignacionesCursos: docentes.asignacionesCursos,
        listaDocentes: docentes.listaDocentes,
        mapaDocentesPorId: docentes.mapaDocentesPorId,
        handleCambiarDocente: docentes.handleCambiarDocente,
        handleCambiarDocenteCurso: docentes.handleCambiarDocenteCurso,

        // Sub-hook Cambios y Salida
        hayCambiosSinGuardar: cambios.hayCambiosSinGuardar,
        modalAlertaVolver: cambios.modalAlertaVolver,
        setModalAlertaVolver: cambios.setModalAlertaVolver,

        // Sub-hook Modal Curso
        modalCursoAbierto: modalCurso.modalCursoAbierto,
        setModalCursoAbierto: modalCurso.setModalCursoAbierto,
        modoModalCurso: modalCurso.modoModalCurso,
        semestreModal: modalCurso.semestreModal,
        guardandoCurso: modalCurso.guardandoCurso,
        errorModalCurso: modalCurso.errorModalCurso,
        formCurso: modalCurso.formCurso,
        setFormCurso: modalCurso.setFormCurso,
        abrirModalCrearCurso: modalCurso.abrirModalCrearCurso,
        abrirModalEditarCurso: modalCurso.abrirModalEditarCurso,
        handleActualizarHoras: modalCurso.handleActualizarHoras,
        guardarCursoForm: modalCurso.guardarCursoForm,

        // Handlers generales
        cargarMalla,
        handleToggleEstadoSemestre,
        handleCambiarTipoCurso,
        handleToggleEstadoCurso,
        guardarConfiguracionEnBD
    };
}
