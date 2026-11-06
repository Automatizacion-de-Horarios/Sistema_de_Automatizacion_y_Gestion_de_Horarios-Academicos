"""Resolución CP-SAT con reservas externas de docente y ambiente."""

from __future__ import annotations

from typing import Iterable, Mapping

from ortools.sat.python import cp_model

from solver_horarios.config import Actividad, ErrorDatos, Infactible
from solver_horarios.modelo import (
    ResultadoHorario,
    _extraer_bloques,
    _texto_estado,
    validar_solucion,
)
from solver_horarios.modelo_variables import Construccion
from solver_horarios.planificacion import Contexto

from .ocupaciones import OcupacionExterna, agregar_restricciones_externas


def resolver_grupo(
    ctx: Contexto,
    actividades: list[Actividad],
    ocupaciones: Iterable[OcupacionExterna],
    *,
    tiempo_limite: float = 300.0,
    trabajadores: int = 8,
    semilla: int = 0,
    relajar_topes: bool = False,
    sin_objetivo: bool = False,
    verbose: bool = False,
    pistas_semilla: Mapping[int, tuple[int, int]] | None = None,
    diagnostico_infactibilidad: bool = True,
    tiempo_diagnostico: float = 60.0,
) -> ResultadoHorario:
    if not actividades:
        raise ErrorDatos("No hay actividades para resolver.")

    ocupaciones = list(ocupaciones)
    construccion = Construccion(
        ctx=ctx,
        actividades=actividades,
        relajar_topes=relajar_topes,
        sin_objetivo=sin_objetivo,
        pistas_semilla=dict(pistas_semilla or {}),
    )
    modelo = construccion.construir()
    cantidad_restricciones = agregar_restricciones_externas(
        construccion, ocupaciones
    )

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(1.0, float(tiempo_limite))
    solver.parameters.num_search_workers = max(1, int(trabajadores))
    solver.parameters.random_seed = int(semilla)
    solver.parameters.log_search_progress = bool(verbose)
    solver.parameters.fix_variables_to_their_hinted_value = False
    solver.parameters.repair_hint = bool(pistas_semilla)
    solver.parameters.interleave_search = False

    status = solver.Solve(modelo)
    estado = _texto_estado(status, solver)
    if status in (cp_model.INFEASIBLE, cp_model.MODEL_INVALID):
        detalle = ""
        if diagnostico_infactibilidad and tiempo_diagnostico > 0:
            try:
                from .diagnostico import diagnosticar_infactibilidad

                lineas = diagnosticar_infactibilidad(
                    ctx,
                    actividades,
                    ocupaciones,
                    limite_segundos=tiempo_diagnostico,
                )
                detalle = "\n" + "\n".join(
                    f"  - {linea}" if not linea.startswith("  ") else linea
                    for linea in lineas
                )
            except Exception as exc:  # pragma: no cover - diagnóstico defensivo
                detalle = (
                    "\n  - No se pudo completar el diagnóstico detallado: "
                    f"{type(exc).__name__}: {exc}"
                )
        raise Infactible(
            f"CP-SAT no encontró solución para el grupo ({estado}); "
            f"se añadieron {cantidad_restricciones} restricciones externas."
            f"{detalle}"
        )
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise Infactible(
            f"CP-SAT terminó con estado {estado} sin una solución factible. "
            "Aumente --tiempo-limite o reduzca el tamaño del grupo."
        )

    bloques = _extraer_bloques(solver, construccion)
    problemas, advertencias = validar_solucion(
        ctx, bloques, relajar_topes=relajar_topes
    )
    if problemas:
        detalle = "\n".join(f"  - {problema}" for problema in problemas[:25])
        raise Infactible(
            "La solución del grupo no supera la validación interna:\n" + detalle
        )

    objetivo = None if sin_objetivo else float(solver.ObjectiveValue())
    return ResultadoHorario(
        estado=estado,
        bloques=bloques,
        objetivo=objetivo,
        tiempo_seg=float(solver.WallTime()),
        ramas=int(solver.NumBranches()),
        conflictos=int(solver.NumConflicts()),
        advertencias=advertencias,
    )
