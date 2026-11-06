import { useState, useEffect, useRef } from 'react';
import { limpiarAsignaciones } from '../mallaSemestre.helpers';

/**
 * Sub-Hook: useMallaCambios (Equipo 4)
 * Rastrea si hay modificaciones sin persistir mediante comparación por snapshot,
 * controlando la alerta de "Cambios sin guardar" y la protección de salida involuntaria.
 */
export function useMallaCambios({
    asignacionesDocentes,
    asignacionesCursos,
    cantidadTurnosPorCiclo,
    turnosInicialesPorCicloRef,
    onCambiosPendientesChange
}) {
    const snapshotInicial = useRef(null);
    const [hayCambiosSinGuardar, setHayCambiosSinGuardar] = useState(false);
    const [modalAlertaVolver, setModalAlertaVolver] = useState(false);

    // Toma la "foto" inicial del estado guardado
    const tomarSnapshot = (docentes, cursos, turnos) => {
        snapshotInicial.current = JSON.stringify({
            docentes,
            cursos,
            turnosPorCiclo: { ...turnos }
        });
        setHayCambiosSinGuardar(false);
        if (typeof onCambiosPendientesChange === 'function') {
            onCambiosPendientesChange(false);
        }
    };

    // Calcular reactivamente si el estado actual difiere del snapshot
    useEffect(() => {
        if (!snapshotInicial.current) {
            setHayCambiosSinGuardar(false);
            if (typeof onCambiosPendientesChange === 'function') onCambiosPendientesChange(false);
            return;
        }

        const snapshotParsed = JSON.parse(snapshotInicial.current || '{}');
        const docentesActualesLimpio = limpiarAsignaciones(asignacionesDocentes);
        const docentesInicialLimpio = limpiarAsignaciones(snapshotParsed.docentes);
        const cursosActualesLimpio = limpiarAsignaciones(asignacionesCursos);
        const cursosInicialLimpio = limpiarAsignaciones(snapshotParsed.cursos);

        const hayCambiosEnDocentesOCursos =
            JSON.stringify(docentesActualesLimpio) !== JSON.stringify(docentesInicialLimpio) ||
            JSON.stringify(cursosActualesLimpio) !== JSON.stringify(cursosInicialLimpio);

        // Regla: Si vuelve a 1 Turno (por defecto), no se considera cambio de turno
        let hayCambiosEnTurnos = false;
        Object.keys(cantidadTurnosPorCiclo || {}).forEach((ciclo) => {
            const countActual = Number(cantidadTurnosPorCiclo[ciclo]) || 1;
            if (countActual > 1) {
                const countInicial = Number(turnosInicialesPorCicloRef?.current?.[ciclo]) || 1;
                if (countActual !== countInicial) hayCambiosEnTurnos = true;
            }
        });

        const hayCambios = hayCambiosEnDocentesOCursos || hayCambiosEnTurnos;
        setHayCambiosSinGuardar(hayCambios);
        if (typeof onCambiosPendientesChange === 'function') onCambiosPendientesChange(hayCambios);
    }, [asignacionesDocentes, asignacionesCursos, cantidadTurnosPorCiclo, turnosInicialesPorCicloRef, onCambiosPendientesChange]);

    return {
        snapshotInicial,
        hayCambiosSinGuardar,
        setHayCambiosSinGuardar,
        modalAlertaVolver,
        setModalAlertaVolver,
        tomarSnapshot
    };
}

