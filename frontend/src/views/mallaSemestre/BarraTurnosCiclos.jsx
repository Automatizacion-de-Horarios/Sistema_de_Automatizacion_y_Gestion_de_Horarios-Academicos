import React from 'react';
import { matchSemestre, obtenerTextoTurno } from './mallaSemestre.helpers';

/**
 * Barra superior de control de ciclos y turnos (Equipo 4)
 * - Muestra la lista de ciclos (Sem. II al VI)
 * - Muestra el selector de cantidad de turnos (1, 2 o 3 turnos)
 * - Muestra las pestañas correspondientes a los turnos seleccionados
 */
export default function BarraTurnosCiclos({
    semestresDisponiblesCarrera,
    semestreFiltro,
    onSelectSemestre,
    cantidadTurnosActual,
    onCambiarCantidadTurnos,
    turnosCicloActual,
    turnoActivo,
    onSelectTurno
}) {
    return (
        <div className="malla-turnos-control-panel">
            {/* Selector rápido de ciclo / semestre */}
            <div className="malla-control-row">
                <span className="malla-control-label">ciclo en pantalla:</span>
                <div className="malla-ciclos-chips-list">
                    {semestresDisponiblesCarrera.map((s) => {
                        const isLocked = s.estado === 'I';
                        const esActivo = matchSemestre(semestreFiltro, s.semestre);
                        return (
                            <button
                                key={s.id_semestre || s.semestre}
                                type="button"
                                className={`malla-ciclo-chip-btn ${esActivo ? 'active' : ''} ${isLocked ? 'chip-semestre-inactivo' : ''}`}
                                onClick={() => onSelectSemestre(s.semestre)}
                                title={isLocked ? `Semestre ${s.semestre} Inhabilitado` : `Ver Semestre ${s.semestre}`}
                            >
                                Sem. {s.semestre}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Selector de cantidad de turnos y pestañas de turno */}
            <div className="malla-control-row">
                <span className="malla-control-label">turno:</span>
                <select
                    className="malla-select-turnos-count"
                    value={cantidadTurnosActual}
                    onChange={(e) => onCambiarCantidadTurnos(e.target.value)}
                    title="Seleccionar cuántos turnos tendrá el semestre actual (1, 2 o 3 turnos)"
                >
                    <option value={1}>1 Turno</option>
                    <option value={2}>2 Turnos</option>
                    <option value={3}>3 Turnos</option>
                </select>

                {/* Cuadros marcados de turnos: Turno 1, Turno 2, Turno 3 */}
                <div className="malla-turnos-tabs-list">
                    {turnosCicloActual.map((turno) => {
                        const esActivo = Number(turnoActivo) === Number(turno.id_turno);
                        return (
                            <button
                                key={turno.id_turno}
                                type="button"
                                className={`malla-turno-tab-btn ${esActivo ? 'active' : ''}`}
                                onClick={() => onSelectTurno(Number(turno.id_turno))}
                                title={`Configurar asignaciones para ${obtenerTextoTurno(turno.id_turno)}`}
                            >
                                {obtenerTextoTurno(turno.id_turno)}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

