import { useState, useMemo } from 'react';
import { matchSemestre } from '../mallaSemestre.helpers';

/**
 * Sub-Hook: useMallaDocentes (Equipo 4)
 * Gestiona las asignaciones de docentes para teoría (TEC), taller (TAL),
 * la sincronización automática TEC-TAL y las excepciones individuales (NCCU / complementarios).
 */
export function useMallaDocentes({ mallaData, turnoActivo }) {
    // Asignación de docentes por ciclo, turno y tipo: { 'II': { 1: { tec: 'id', tal: 'id' } } }
    const [asignacionesDocentes, setAsignacionesDocentes] = useState({});

    // Asignación de docentes por curso (complementarios / excepciones NCCU): { idCurso: { turno: idDocente } }
    const [asignacionesCursos, setAsignacionesCursos] = useState({});

    const listaDocentes = useMemo(() => mallaData?.docentes || [], [mallaData]);

    const mapaDocentesPorId = useMemo(() => {
        const mapa = new Map();
        for (const d of listaDocentes) {
            mapa.set(String(d.id_docente), d);
        }
        return mapa;
    }, [listaDocentes]);

    // Asignar docente general para TEC o TAL en un semestre y turno
    const handleCambiarDocente = (semestreRomano, tipoDocente, idDocente) => {
        const semObj = (mallaData?.semestres || []).find((s) => matchSemestre(s.semestre, semestreRomano));
        const tieneTecTal = semObj?.cursos?.some((c) => String(c.horario_sinfo || '').toUpperCase() === 'TEC-TAL');

        setAsignacionesDocentes((prev) => {
            const copiaSemestre = { ...(prev[semestreRomano] || {}) };
            const copiaTurno = { ...(copiaSemestre[turnoActivo] || {}) };

            if (!idDocente) {
                delete copiaTurno[tipoDocente];
                if (tieneTecTal) {
                    delete copiaTurno.tec;
                    delete copiaTurno.tal;
                }
            } else {
                copiaTurno[tipoDocente] = String(idDocente);
                // Sincronización automática TEC-TAL: ambos comparten el mismo docente
                if (tieneTecTal) {
                    copiaTurno.tec = String(idDocente);
                    copiaTurno.tal = String(idDocente);
                }
            }

            if (Object.keys(copiaTurno).length === 0) {
                delete copiaSemestre[turnoActivo];
            } else {
                copiaSemestre[turnoActivo] = copiaTurno;
            }

            const copiaTotal = { ...prev };
            if (Object.keys(copiaSemestre).length === 0) {
                delete copiaTotal[semestreRomano];
            } else {
                copiaTotal[semestreRomano] = copiaSemestre;
            }

            return copiaTotal;
        });
    };

    // Asignar docente para un curso individual (complementario o NCCU)
    const handleCambiarDocenteCurso = (idCurso, idTurno, idDocente) => {
        setAsignacionesCursos((prev) => {
            const copiaCurso = { ...(prev[idCurso] || {}) };
            if (!idDocente) {
                delete copiaCurso[idTurno];
            } else {
                copiaCurso[idTurno] = String(idDocente);
            }

            const copiaTotal = { ...prev };
            if (Object.keys(copiaCurso).length === 0) {
                delete copiaTotal[idCurso];
            } else {
                copiaTotal[idCurso] = copiaCurso;
            }
            return copiaTotal;
        });
    };

    return {
        asignacionesDocentes,
        setAsignacionesDocentes,
        asignacionesCursos,
        setAsignacionesCursos,
        listaDocentes,
        mapaDocentesPorId,
        handleCambiarDocente,
        handleCambiarDocenteCurso
    };
}

