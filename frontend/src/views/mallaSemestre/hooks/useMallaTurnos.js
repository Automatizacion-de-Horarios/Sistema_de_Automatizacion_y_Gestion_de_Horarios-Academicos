import { useState, useEffect, useMemo, useRef } from 'react';

/**
 * Sub-Hook: useMallaTurnos (Equipo 4)
 * Gestiona el turno activo, la cantidad de turnos (1 a 3) por ciclo y las pestañas visuales.
 */
export function useMallaTurnos({ semestreFiltro, turnosBD }) {
    // Estado del turno activo: 1 = Turno 1, 2 = Turno 2, 3 = Turno 3
    const [turnoActivo, setTurnoActivo] = useState(1);

    // Cantidad de turnos configurados para cada ciclo
    const [cantidadTurnosPorCiclo, setCantidadTurnosPorCiclo] = useState({});

    // Referencia para rastrear si se modificó la cantidad de turnos respecto a la BD
    const turnosInicialesPorCicloRef = useRef({});

    // Al cambiar de ciclo en pantalla, siempre se selecciona por defecto el Turno 1
    useEffect(() => {
        setTurnoActivo(1);
    }, [semestreFiltro]);

    const cantidadTurnosActual = cantidadTurnosPorCiclo[semestreFiltro] || 1;

    // Turnos disponibles para el ciclo actual según la cantidad seleccionada
    const turnosCicloActual = useMemo(() => {
        const catalogo = turnosBD || [
            { id_turno: 1, codigo_turno: 'Turno 1' },
            { id_turno: 2, codigo_turno: 'Turno 2' },
            { id_turno: 3, codigo_turno: 'Turno 3' }
        ];
        return catalogo.slice(0, cantidadTurnosActual);
    }, [turnosBD, cantidadTurnosActual]);

    // Cambiar la cantidad de turnos (1 a 3) para el ciclo actual
    const handleCambiarCantidadTurnos = (nuevaCantidad) => {
        const cantidad = Math.max(1, Math.min(3, parseInt(nuevaCantidad, 10) || 1));
        setCantidadTurnosPorCiclo((prev) => ({
            ...prev,
            [semestreFiltro]: cantidad
        }));
        if (turnoActivo > cantidad) setTurnoActivo(1);
    };

    return {
        turnoActivo,
        setTurnoActivo,
        cantidadTurnosPorCiclo,
        setCantidadTurnosPorCiclo,
        turnosInicialesPorCicloRef,
        cantidadTurnosActual,
        turnosCicloActual,
        handleCambiarCantidadTurnos
    };
}

