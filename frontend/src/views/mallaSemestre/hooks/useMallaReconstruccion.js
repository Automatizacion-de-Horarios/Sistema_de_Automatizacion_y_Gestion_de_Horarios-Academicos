/**
 * Algoritmo de reconstrucción de asignaciones docentes (Prioridad + Moda)
 * Analiza la programación académica guardada y deduce el docente de cabecera
 * para TEC y TAL sin que asignaciones individuales (como Inglés NCCU) lo contaminen.
 */
export function reconstruirProgramacion(data) {
    const asigDocentes = {};
    const asigCursos = {};
    const turnosPorCicloDetectados = {};

    // Crear mapa de cursos de la carrera con metadatos completos
    const mapaCursosInfo = new Map();
    (data.semestres || []).forEach((s) => {
        (s.cursos || []).forEach((c) => {
            const esNCCU = String(c.mat_cur || '').toUpperCase().startsWith('NCCU');
            const esComp = Number(c.is_carrera) !== 1;
            const esTaller = String(c.horario_sinfo || '').toUpperCase().includes('TAL') || /seminario/i.test(c.nombre_curso || '');
            mapaCursosInfo.set(Number(c.id_curso), {
                esNCCU,
                esComp,
                esTaller,
                is_carrera: Number(c.is_carrera) === 1
            });
        });
    });

    if (Array.isArray(data.programacion)) {
        // Paso 1: Agrupar registros por ciclo y turno
        const itemsPorCicloTurno = {};

        for (const item of data.programacion) {
            const ciclo = item.semestre;
            const idTurno = Number(item.id_turno);
            if (!ciclo || !idTurno) continue;

            turnosPorCicloDetectados[ciclo] = Math.max(
                turnosPorCicloDetectados[ciclo] || 1,
                idTurno
            );

            const key = `${ciclo}_${idTurno}`;
            if (!itemsPorCicloTurno[key]) itemsPorCicloTurno[key] = { ciclo, idTurno, items: [] };
            itemsPorCicloTurno[key].items.push(item);
        }

        // Función auxiliar para obtener el docente con más cursos asignados (moda)
        const obtenerModa = (conteo) => {
            let maxDoc = null;
            let maxCount = 0;
            for (const [docId, count] of Object.entries(conteo)) {
                if (count > maxCount) {
                    maxCount = count;
                    maxDoc = docId;
                }
            }
            return maxDoc;
        };

        // Paso 2: Para cada ciclo y turno, determinar el docente general de TEC y TAL por prioridad y mayoría
        for (const group of Object.values(itemsPorCicloTurno)) {
            const { ciclo, idTurno, items } = group;

            if (!asigDocentes[ciclo]) asigDocentes[ciclo] = {};
            if (!asigDocentes[ciclo][idTurno]) asigDocentes[ciclo][idTurno] = {};

            // Contadores de votos de docentes para TEC y TAL
            const conteoTecTroncal = {};
            const conteoTecCarrera = {};
            const conteoTalTroncal = {};
            const conteoTalCarrera = {};

            for (const item of items) {
                const info = mapaCursosInfo.get(Number(item.id_curso));
                const esDeCarrera = info ? info.is_carrera : true;
                const esTroncal = esDeCarrera && (!info || !info.esNCCU);

                if (item.id_docente_tec) {
                    const dId = String(item.id_docente_tec);
                    if (esTroncal) conteoTecTroncal[dId] = (conteoTecTroncal[dId] || 0) + 1;
                    if (esDeCarrera) conteoTecCarrera[dId] = (conteoTecCarrera[dId] || 0) + 1;
                }

                if (item.id_docente_tal) {
                    const dId = String(item.id_docente_tal);
                    if (esTroncal) conteoTalTroncal[dId] = (conteoTalTroncal[dId] || 0) + 1;
                    if (esDeCarrera) conteoTalCarrera[dId] = (conteoTalCarrera[dId] || 0) + 1;
                }
            }

            // TEC: Prioridad 1 cursos troncales; si no hay, mayoría de carrera
            const docTecFinal = obtenerModa(conteoTecTroncal) || obtenerModa(conteoTecCarrera);
            // TAL: Prioridad 1 cursos troncales; si no hay, mayoría de carrera
            const docTalFinal = obtenerModa(conteoTalTroncal) || obtenerModa(conteoTalCarrera);

            if (docTecFinal) asigDocentes[ciclo][idTurno].tec = docTecFinal;
            if (docTalFinal) asigDocentes[ciclo][idTurno].tal = docTalFinal;

            // Paso 3: Asignaciones individuales por curso (NCCU o complementarios)
            for (const item of items) {
                if (!item.id_curso) continue;
                const info = mapaCursosInfo.get(Number(item.id_curso));
                const docAsignado = item.id_docente_tal || item.id_docente_tec;

                if (info && (info.esNCCU || info.esComp)) {
                    if (docAsignado) {
                        const docCarreraEsperado = info.esTaller ? docTalFinal : docTecFinal;
                        if (info.esComp || String(docAsignado) !== String(docCarreraEsperado)) {
                            if (!asigCursos[item.id_curso]) asigCursos[item.id_curso] = {};
                            asigCursos[item.id_curso][idTurno] = String(docAsignado);
                        }
                    }
                }
            }
        }
    }

    // Inicializar cantidad de turnos por ciclo
    const conteosFinales = {};
    (data.semestres || []).forEach((s) => {
        conteosFinales[s.semestre] = turnosPorCicloDetectados[s.semestre] || 1;
    });

    return {
        asigDocentes,
        asigCursos,
        conteosFinales
    };
}

