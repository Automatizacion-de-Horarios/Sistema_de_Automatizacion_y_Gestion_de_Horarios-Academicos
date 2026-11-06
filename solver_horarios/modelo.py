"""Orquestación de CP-SAT, extracción de la solución y validación final."""

from __future__ import annotations

from collections import defaultdict
import logging
from dataclasses import dataclass, field
from typing import Any, Mapping

from ortools.sat.python import cp_model

from .config import (
    ACADEMIC_HOUR_MIN,
    BREAK_MIN,
    EMP_END_MIN,
    EMP_MAX_ACAD_HOURS,
    EMP_START_MIN,
    LONG_BREAK_MIN,
    LONG_BREAK_THRESHOLD,
    MAX_COHORT_CROSS_TURN_GAP_MIN,
    MAX_COHORT_DAILY_SPAN_MIN,
    MAX_COHORT_FIRST_CLASS_START_MIN,
    MAX_SESSION_ACAD_HOURS,
    MAX_TEACHER_DAILY_ACAD_HOURS,
    MAX_TEACHER_DAILY_SPAN_MIN,
    MORNING_END_MIN,
    NIGHT_START_MIN,
    SEMANAS_LECTIVAS,
    VIR_SEPARACION_PREFERIDA_MIN,
    BloqueProgramado,
    ErrorDatos,
    Infactible,
    Actividad,
    ambiente_es_aula_comun,
)
from .modelo_variables import Construccion
from .planificacion import Contexto, bandas_cohorte, bandas_virtuales

log = logging.getLogger(__name__)

DIAS = ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")


@dataclass
class ResultadoHorario:
    estado: str
    bloques: list[BloqueProgramado]
    objetivo: float | None
    tiempo_seg: float
    ramas: int
    conflictos: int
    advertencias: list[str] = field(default_factory=list)

    @property
    def horas_semanales(self) -> int:
        return sum(bloque.actividad.horas_academicas for bloque in self.bloques)


def _extraer_bloques(
    solver: cp_model.CpSolver, construccion: Construccion
) -> list[BloqueProgramado]:
    bloques: list[BloqueProgramado] = []
    for actividad in construccion.actividades:
        uid = actividad.uid
        dia = int(solver.Value(construccion.dia[uid]))
        inicio = int(solver.Value(construccion.inicio[uid]))
        fin = inicio + actividad.duracion_min

        ambiente: int | None = None
        selectores = construccion.selector_ambiente.get(uid, [])
        if selectores:
            elegidos = [
                id_ambiente
                for id_ambiente, selector in selectores
                if solver.Value(selector)
            ]
            if len(elegidos) != 1:
                raise ErrorDatos(
                    f"El solver no eligió exactamente un ambiente para "
                    f"{actividad.descripcion}: {elegidos}."
                )
            ambiente = elegidos[0]

        bloques.append(
            BloqueProgramado(
                actividad=actividad,
                dia=dia,
                inicio_min=inicio,
                fin_min=fin,
                id_ambiente=ambiente,
            )
        )
    return bloques


def _texto_estado(status: int, solver: cp_model.CpSolver) -> str:
    nombres = {
        cp_model.OPTIMAL: "OPTIMO",
        cp_model.FEASIBLE: "FACTIBLE",
        cp_model.INFEASIBLE: "INFACTIBLE",
        cp_model.MODEL_INVALID: "MODELO_INVALIDO",
        cp_model.UNKNOWN: "DESCONOCIDO",
    }
    return nombres.get(status, solver.StatusName(status))


def diagnosticar_infactibilidad(
    ctx: Contexto,
    actividades: list[Actividad],
    *,
    tiempo_limite: float = 900.0,
) -> dict[str, Any]:
    """Obtiene un núcleo suficiente de grupos de restricciones incompatibles.

    Todos los supuestos se activan durante la búsqueda, por lo que este modo
    no relaja las reglas del modelo ni produce una solución para persistir.
    """
    construccion = Construccion(
        ctx=ctx,
        actividades=actividades,
        sin_objetivo=True,
        diagnostico_infactibilidad=True,
    )
    modelo = construccion.construir()
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(1.0, float(tiempo_limite))
    solver.parameters.num_search_workers = 1
    solver.parameters.interleave_search = False

    status = solver.Solve(modelo)
    core = []
    if status == cp_model.INFEASIBLE:
        core = [
            construccion.supuestos_diagnostico[indice]
            for indice in solver.SufficientAssumptionsForInfeasibility()
            if indice in construccion.supuestos_diagnostico
        ]
    return {
        "estado": _texto_estado(status, solver),
        "tiempo_seg": float(solver.WallTime()),
        "variables": len(modelo.Proto().variables),
        "restricciones": len(modelo.Proto().constraints),
        "grupos": sorted(set(construccion.supuestos_diagnostico.values())),
        "nucleo_suficiente": core,
    }


def _nombre_dia(dia: int) -> str:
    return DIAS[dia] if 0 <= dia < len(DIAS) else str(dia)


def _hora_minutos(minutos: int) -> str:
    return f"{minutos // 60:02d}:{minutos % 60:02d}"


def diagnosticar_pistas_semilla(
    ctx: Contexto,
    actividades: list[Actividad],
    pistas_semilla: Mapping[int, tuple[int, int]],
    asociaciones: list[dict[str, Any]],
    *,
    tiempo_limite: float = 60.0,
    trabajadores: int = 8,
    relajar_topes: bool = False,
) -> dict[str, Any]:
    """Compara la factibilidad del modelo base con las pistas temporalmente fijas.

    Las pistas se convierten en supuestos sólo en este modelo de diagnóstico;
    el flujo normal continúa agregándolas únicamente mediante ``AddHint``.
    """
    construccion = Construccion(
        ctx=ctx,
        actividades=actividades,
        relajar_topes=relajar_topes,
        sin_objetivo=True,
    )
    modelo = construccion.construir()
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(1.0, float(tiempo_limite))
    solver.parameters.num_search_workers = max(1, int(trabajadores))
    solver.parameters.interleave_search = False

    estado_base_num = solver.Solve(modelo)
    estado_base = _texto_estado(estado_base_num, solver)
    tiempo_base = float(solver.WallTime())
    estadisticas_base = solver.ResponseStats()

    por_uid = {asociacion["uid"]: asociacion for asociacion in asociaciones}
    supuesto_por_indice: dict[int, dict[str, Any]] = {}
    for uid, (dia, inicio) in sorted(pistas_semilla.items()):
        if uid not in construccion.por_uid:
            raise ErrorDatos(
                f"La pista semilla de la actividad {uid} no pertenece al modelo."
            )
        if (dia, inicio) not in construccion.pares[uid]:
            raise ErrorDatos(
                f"La pista semilla de la actividad {uid} no pertenece a sus "
                "pares candidatos."
            )
        actividad = construccion.por_uid[uid]
        asociacion = por_uid.get(uid, {})
        supuesto = modelo.NewBoolVar(f"supuesto_semilla_{uid}")
        modelo.Add(construccion.dia[uid] == dia).OnlyEnforceIf(supuesto)
        modelo.Add(construccion.inicio[uid] == inicio).OnlyEnforceIf(supuesto)
        supuesto_por_indice[supuesto.Index()] = {
            "uid": uid,
            "bloque": asociacion.get("bloque"),
            "origen_celda": asociacion.get("origen_celda"),
            "actividad": actividad.descripcion,
            "dia": dia,
            "inicio_min": inicio,
            "fin_min": inicio + actividad.duracion_min,
            "docente_id": actividad.docente_id,
            "cohorte": actividad.oferta.cohorte,
            "id_programacion": actividad.oferta.id_programacion,
        }
    if supuesto_por_indice:
        modelo.AddAssumptions(
            [
                modelo.GetBoolVarFromProtoIndex(indice)
                for indice in sorted(supuesto_por_indice)
            ]
        )

    estado_pistas_num = solver.Solve(modelo)
    estado_pistas = _texto_estado(estado_pistas_num, solver)
    estadisticas_pistas = solver.ResponseStats()
    nucleo: list[dict[str, Any]] = []
    if estado_pistas_num == cp_model.INFEASIBLE:
        for literal in solver.SufficientAssumptionsForInfeasibility():
            indice = literal if literal >= 0 else -literal - 1
            detalle = supuesto_por_indice.get(indice)
            if detalle is not None:
                nucleo.append(detalle)

    conflictos_directos, observaciones = _conflictos_directos_semilla(
        construccion, pistas_semilla, por_uid, relajar_topes
    )
    return {
        "estado_sin_pistas": estado_base,
        "tiempo_sin_pistas": tiempo_base,
        "estado_con_pistas": estado_pistas,
        "tiempo_con_pistas": float(solver.WallTime()),
        "estadisticas_sin_pistas": estadisticas_base,
        "estadisticas_con_pistas": estadisticas_pistas,
        "ramas": int(solver.NumBranches()),
        "conflictos_solver": int(solver.NumConflicts()),
        "variables": len(modelo.Proto().variables),
        "restricciones": len(modelo.Proto().constraints),
        "pistas": list(supuesto_por_indice.values()),
        "nucleo": nucleo,
        "conflictos_directos": conflictos_directos,
        "observaciones": observaciones,
    }


def _conflictos_directos_semilla(
    construccion: Construccion,
    pistas: Mapping[int, tuple[int, int]],
    asociaciones: Mapping[int, dict[str, Any]],
    relajar_topes: bool,
) -> tuple[list[str], list[str]]:
    conflictos: list[str] = []
    observaciones: list[str] = []
    fijadas = [
        (construccion.por_uid[uid], dia, inicio, asociaciones.get(uid, {}))
        for uid, (dia, inicio) in sorted(pistas.items())
        if uid in construccion.por_uid
    ]

    def referencia(actividad: Actividad) -> str:
        asociacion = asociaciones.get(actividad.uid, {})
        partes = []
        if asociacion.get("bloque") is not None:
            partes.append(f"bloque #{asociacion['bloque']}")
        if asociacion.get("origen_celda"):
            partes.append(str(asociacion["origen_celda"]))
        return f" [{', '.join(partes)}]" if partes else ""

    for actividad, dia, inicio, _ in fijadas:
        if (dia, inicio) not in construccion.pares[actividad.uid]:
            conflictos.append(
                f"{actividad.descripcion}: {_nombre_dia(dia)} "
                f"{_hora_minutos(inicio)} fuera "
                "de la ventana candidata (dominio de día/hora)."
            )
        docente = construccion.ctx.docentes.get(actividad.docente_id)
        if (
            docente is not None
            and docente.usa_restriccion
            and not any(
                desde <= inicio
                and inicio + actividad.duracion_min <= hasta
                for desde, hasta in docente.disponibilidad.get(dia, ())
            )
        ):
            observaciones.append(
                f"{actividad.descripcion}: cae fuera de la disponibilidad "
                f"de {docente.nombre}; la disponibilidad es una restricción "
                "dura y la pista no puede aplicarse."
            )

    for indice, (izquierda, dia_i, inicio_i, _) in enumerate(fijadas):
        for derecha, dia_d, inicio_d, _ in fijadas[indice + 1:]:
            if max(
                izquierda.semana_inicio, derecha.semana_inicio
            ) >= min(izquierda.semana_fin, derecha.semana_fin):
                continue
            mismo_dia = dia_i == dia_d
            fin_i = inicio_i + izquierda.duracion_min
            fin_d = inicio_d + derecha.duracion_min
            fin_i_con_receso = fin_i + (
                0 if izquierda.modalidad == "EMP" else BREAK_MIN
            )
            fin_d_con_receso = fin_d + (
                0 if derecha.modalidad == "EMP" else BREAK_MIN
            )
            se_solapan_clases = (
                mismo_dia
                and inicio_i < fin_d
                and inicio_d < fin_i
            )
            se_solapan_intervalos = (
                mismo_dia
                and inicio_i < fin_d_con_receso
                and inicio_d < fin_i_con_receso
            )
            recursos = []
            if izquierda.oferta.cohorte == derecha.oferta.cohorte:
                recursos.append("cohorte")
            if (
                izquierda.docente_id is not None
                and izquierda.docente_id == derecha.docente_id
            ):
                recursos.append(f"docente {izquierda.docente_id}")
            if (
                se_solapan_clases
                and izquierda.ambientes
                and derecha.ambientes
                and len(izquierda.ambientes) == len(derecha.ambientes) == 1
                and izquierda.ambientes == derecha.ambientes
            ):
                recursos.append(f"ambiente {izquierda.ambientes[0]}")
            if (
                se_solapan_intervalos
                and any(
                    recurso == "cohorte" or recurso.startswith("docente ")
                    for recurso in recursos
                )
            ):
                conflictos.append(
                    f"{izquierda.descripcion}{referencia(izquierda)} y "
                    f"{derecha.descripcion}{referencia(derecha)}: "
                    f"solapamiento o receso insuficiente el {_nombre_dia(dia_i)} "
                    f"({_hora_minutos(inicio_i)}-{_hora_minutos(fin_i)} y "
                    f"{_hora_minutos(inicio_d)}-{_hora_minutos(fin_d)}) para "
                    f"{' y '.join(recursos)}."
                )
            elif se_solapan_clases and any(
                recurso.startswith("ambiente ") for recurso in recursos
            ):
                conflictos.append(
                    f"{izquierda.descripcion}{referencia(izquierda)} y "
                    f"{derecha.descripcion}{referencia(derecha)}: "
                    f"solapamiento el {_nombre_dia(dia_i)} "
                    f"({_hora_minutos(inicio_i)}-{_hora_minutos(fin_i)} y "
                    f"{_hora_minutos(inicio_d)}-{_hora_minutos(fin_d)}) para "
                    f"{' y '.join(recursos)}."
                )

            if (
                izquierda.oferta.cohorte == derecha.oferta.cohorte
                and izquierda.modalidad in {"TEC", "TAL"}
                and derecha.modalidad in {"TEC", "TAL"}
                and Construccion._clasificar_banda(
                    inicio_i, izquierda.duracion_min
                )
                != Construccion._clasificar_banda(
                    inicio_d, derecha.duracion_min
                )
            ):
                conflictos.append(
                    f"{izquierda.descripcion}{referencia(izquierda)} y "
                    f"{derecha.descripcion}{referencia(derecha)}: "
                    "la cohorte quedaría en bandas horarias distintas."
                )

            if (
                izquierda.plantilla_id
                and izquierda.plantilla_id == derecha.plantilla_id
                and izquierda.plantilla_slot == derecha.plantilla_slot
                and (dia_i, inicio_i) != (dia_d, inicio_d)
            ):
                conflictos.append(
                    f"{izquierda.descripcion}{referencia(izquierda)} y "
                    f"{derecha.descripcion}{referencia(derecha)}: "
                    "difieren en un slot de la plantilla modular."
                )

    por_cohorte_dia_semana: dict[tuple[tuple, int, int], list[Actividad]] = defaultdict(list)
    por_docente_dia_semana: dict[tuple[int, int, int], list[Actividad]] = defaultdict(list)
    por_docente_semana: dict[tuple[int, int], list[Actividad]] = defaultdict(list)
    for actividad, dia, _, _ in fijadas:
        for semana in range(actividad.semana_inicio, actividad.semana_fin):
            por_cohorte_dia_semana[
                (actividad.oferta.cohorte, semana, dia)
            ].append(actividad)
            if actividad.docente_id is not None:
                por_docente_dia_semana[
                    (actividad.docente_id, semana, dia)
                ].append(actividad)
                por_docente_semana[(actividad.docente_id, semana)].append(
                    actividad
                )
    if not relajar_topes:
        for (docente_id, semana), grupo in por_docente_semana.items():
            docente = construccion.ctx.docentes.get(docente_id)
            carga_min = sum(actividad.duracion_min for actividad in grupo)
            if docente is not None and carga_min > docente.tope_semanal_min:
                conflictos.append(
                    f"Docente {docente_id}, semana {semana + 1}: las pistas "
                    f"fijan {carga_min} minutos frente al tope contractual "
                    f"de {docente.tope_semanal_min} minutos."
                )

    for (cohorte, semana, dia), grupo in por_cohorte_dia_semana.items():
        inicio_jornada = min(inicio for actividad, dia_fijado, inicio, _ in fijadas
                             if actividad.oferta.cohorte == cohorte
                             and dia_fijado == dia
                             and actividad.semana_inicio <= semana < actividad.semana_fin)
        fin_jornada = max(
            inicio + actividad.duracion_min
            for actividad, dia_fijado, inicio, _ in fijadas
            if actividad.oferta.cohorte == cohorte
            and dia_fijado == dia
            and actividad.semana_inicio <= semana < actividad.semana_fin
        )
        if fin_jornada - inicio_jornada > MAX_COHORT_DAILY_SPAN_MIN:
            conflictos.append(
                f"Cohorte {cohorte}, semana {semana + 1}, "
                f"día {_nombre_dia(dia)}: jornada de "
                f"{fin_jornada - inicio_jornada} min supera el máximo de "
                f"{MAX_COHORT_DAILY_SPAN_MIN} min."
            )
    for (docente_id, semana, dia), grupo in por_docente_dia_semana.items():
        horas = sum(actividad.horas_academicas for actividad in grupo)
        if horas > MAX_TEACHER_DAILY_ACAD_HOURS and not relajar_topes:
            conflictos.append(
                f"Docente {docente_id}, semana {semana + 1}, "
                f"día {_nombre_dia(dia)}: "
                f"{horas} horas académicas superan el tope "
                f"{MAX_TEACHER_DAILY_ACAD_HOURS}."
            )
        inicios = [
            inicio
            for actividad, dia_fijado, inicio, _ in fijadas
            if actividad.docente_id == docente_id and dia_fijado == dia
            and actividad.semana_inicio <= semana < actividad.semana_fin
        ]
        fines = [
            inicio + actividad.duracion_min
            for actividad, dia_fijado, inicio, _ in fijadas
            if actividad.docente_id == docente_id and dia_fijado == dia
            and actividad.semana_inicio <= semana < actividad.semana_fin
        ]
        if (
            inicios
            and fines
            and max(fines) - min(inicios) > MAX_TEACHER_DAILY_SPAN_MIN
        ):
            conflictos.append(
                f"Docente {docente_id}, semana {semana + 1}, "
                f"día {_nombre_dia(dia)}: "
                "la jornada fijada supera las 9 horas reloj."
            )
    return conflictos, observaciones


def resolver_horario(
    ctx: Contexto,
    actividades: list[Actividad],
    *,
    tiempo_limite: float = 300.0,
    trabajadores: int = 8,
    semilla: int = 0,
    relajar_topes: bool = False,
    sin_objetivo: bool = False,
    modo_prueba_factibilidad: bool = False,
    recesos_estrictos: bool = True,
    validar: bool = True,
    verbose: bool = False,
    pistas_semilla: Mapping[int, tuple[int, int]] | None = None,
) -> ResultadoHorario:
    """Construye y resuelve el modelo CP-SAT.

    Cualquier solución se valida antes de devolverla. Si CP-SAT no encuentra
    una solución factible se lanza ``Infactible`` con un diagnóstico; el
    llamador no debe persistir nada en ese caso.
    """
    if not actividades:
        raise ErrorDatos("No hay actividades para resolver.")

    construccion = Construccion(
        ctx=ctx,
        actividades=actividades,
        relajar_topes=relajar_topes,
        modo_prueba_factibilidad=modo_prueba_factibilidad,
        recesos_estrictos=recesos_estrictos,
        sin_objetivo=sin_objetivo,
        pistas_semilla=dict(pistas_semilla or {}),
    )
    modelo = construccion.construir()

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(1.0, float(tiempo_limite))
    solver.parameters.num_search_workers = max(1, int(trabajadores))
    solver.parameters.random_seed = int(semilla)
    solver.parameters.log_search_progress = bool(verbose)
    solver.parameters.fix_variables_to_their_hinted_value = False
    solver.parameters.repair_hint = bool(pistas_semilla)
    # Una semilla fija y un número de trabajadores reproducible ayudan a
    # comparar ejecuciones de borrador.
    solver.parameters.interleave_search = False

    log.info(
        "Resolviendo %d actividades, %d variables y %d restricciones "
        "(%d pistas suaves; reparación %s; límite %.0fs, %d workers, semilla %d).",
        len(actividades),
        len(modelo.Proto().variables),
        len(modelo.Proto().constraints),
        len(pistas_semilla or {}),
        "activada" if pistas_semilla else "inactiva",
        tiempo_limite,
        trabajadores,
        semilla,
    )
    status = solver.Solve(modelo)
    estado = _texto_estado(status, solver)
    if status in (cp_model.INFEASIBLE, cp_model.MODEL_INVALID):
        raise Infactible(
            f"CP-SAT no encontró una solución ({estado}). Revise el reporte de "
            "capacidad y disponibilidad docente, los turnos y las ventanas "
            "semanales. La disponibilidad es una restricción dura: "
            "--relajar-topes no la relaja. Ajuste las franjas del docente o "
            "reasigne la carga antes de volver a ejecutar."
        )
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise Infactible(
            f"CP-SAT terminó con estado {estado} sin una solución factible. "
            "Aumente --tiempo-limite o revise las restricciones."
        )

    bloques = _extraer_bloques(solver, construccion)
    objetivo = None
    if not sin_objetivo:
        try:
            objetivo = float(solver.ObjectiveValue())
        except Exception:  # pragma: no cover - defensa entre versiones
            objetivo = None

    advertencias: list[str] = []
    if validar:
        problemas, advertencias = validar_solucion(
            ctx,
            bloques,
            relajar_topes=relajar_topes,
            modo_prueba_factibilidad=modo_prueba_factibilidad,
        )
        if problemas:
            detalle = "\n".join(f"  - {p}" for p in problemas[:25])
            extra = "" if len(problemas) <= 25 else f"\n  ... y {len(problemas) - 25} más."
            raise Infactible(
                "La solución encontrada no supera la validación interna:\n"
                + detalle
                + extra
            )

    if modo_prueba_factibilidad:
        advertencias.extend(
            (
                "Modo de prueba: se omitió la regla de descanso docente de "
                "45 minutos tras más de 5 horas académicas.",
                "Modo de prueba: se omitió el máximo diario de 9 horas "
                "entre primera y última clase docente.",
                "Modo de prueba: se omitió la restricción de continuidad "
                "presencial de cohorte (30 min entre clases consecutivas).",
                "Modo de prueba: se omitieron las preferencias de banda, la "
                "penalización por día partido y el tope diario de horas "
                "académicas por cohorte.",
                "Modo de prueba: se desactivaron las preferencias blandas de "
                "concentración/equilibrio de TEC y de orden TEC/TAL.",
                "Modo de prueba: no se comprueba exclusividad de ambientes; "
                "pueden coincidir varios bloques en la misma aula.",
            )
        )

    for advertencia in advertencias:
        log.warning(advertencia)

    return ResultadoHorario(
        estado=estado,
        bloques=bloques,
        objetivo=objetivo,
        tiempo_seg=float(solver.WallTime()),
        ramas=int(solver.NumBranches()),
        conflictos=int(solver.NumConflicts()),
        advertencias=advertencias,
    )


# ---------------------------------------------------------------------------
# Validación de la solución
# ---------------------------------------------------------------------------


def _se_solapan(inicio_a: int, fin_a: int, inicio_b: int, fin_b: int) -> bool:
    return inicio_a < fin_b and inicio_b < fin_a


def _clave_recurso_semana(bloque: BloqueProgramado, recurso: object) -> tuple:
    return (recurso, bloque.actividad.semana_inicio, bloque.actividad.semana_fin)


def _agrupar_por_semana(
    bloques: list[BloqueProgramado],
) -> dict[tuple, list[BloqueProgramado]]:
    grupos: dict[tuple, list[BloqueProgramado]] = defaultdict(list)
    for bloque in bloques:
        actividad = bloque.actividad
        for semana in range(actividad.semana_inicio, actividad.semana_fin):
            grupos[(semana, bloque.dia)].append(bloque)
    return grupos


def _validar_solapamientos(
    bloques: list[BloqueProgramado],
    *,
    relajar_ambientes: bool = False,
) -> list[str]:
    problemas: list[str] = []
    por_cohorte: dict[tuple, list[BloqueProgramado]] = defaultdict(list)
    por_docente: dict[tuple, list[BloqueProgramado]] = defaultdict(list)
    por_ambiente: dict[tuple, list[BloqueProgramado]] = defaultdict(list)

    for bloque in bloques:
        actividad = bloque.actividad
        por_cohorte[(actividad.oferta.cohorte, bloque.dia)].append(bloque)
        if actividad.docente_id is not None:
            por_docente[(actividad.docente_id, bloque.dia)].append(bloque)
        if bloque.id_ambiente is not None:
            por_ambiente[(bloque.id_ambiente, bloque.dia)].append(bloque)

    def revisar(grupos: dict[tuple, list[BloqueProgramado]], etiqueta: str) -> None:
        for (recurso, dia), elementos in grupos.items():
            for i, izquierda in enumerate(elementos):
                for derecha in elementos[i + 1:]:
                    if not _rangos_se_solapan(
                        izquierda.actividad.semana_inicio,
                        izquierda.actividad.semana_fin,
                        derecha.actividad.semana_inicio,
                        derecha.actividad.semana_fin,
                    ):
                        continue
                    if _se_solapan(
                        izquierda.inicio_min, izquierda.fin_min,
                        derecha.inicio_min, derecha.fin_min,
                    ):
                        problemas.append(
                            f"Solapamiento de {etiqueta} {recurso!r} el día {dia}: "
                            f"{izquierda.actividad.descripcion} vs "
                            f"{derecha.actividad.descripcion}."
                        )
                    elif etiqueta != "ambiente":
                        if izquierda.fin_min <= derecha.inicio_min:
                            anterior, posterior = izquierda, derecha
                            gap = derecha.inicio_min - izquierda.fin_min
                        else:
                            anterior, posterior = derecha, izquierda
                            gap = izquierda.inicio_min - derecha.fin_min
                        descanso = (
                            0
                            if anterior.actividad.modalidad == "EMP"
                            else BREAK_MIN
                        )
                        if gap < descanso:
                            problemas.append(
                                f"Falta el receso de {descanso} min de {etiqueta} "
                                f"{recurso!r} el día {dia}: "
                                f"{anterior.actividad.descripcion} vs "
                                f"{posterior.actividad.descripcion}."
                            )

    revisar(por_cohorte, "grupo")
    revisar(por_docente, "docente")
    if not relajar_ambientes:
        revisar(por_ambiente, "ambiente")
    return problemas


def _rangos_se_solapan(a0: int, a1: int, b0: int, b1: int) -> bool:
    return max(a0, b0) < min(a1, b1)


def _validar_docentes(
    ctx: Contexto,
    bloques: list[BloqueProgramado],
    *,
    relajar_topes: bool,
    relajar_recesos: bool = False,
) -> list[str]:
    problemas: list[str] = []
    por_docente_dia: dict[tuple[int, int, int], list[BloqueProgramado]] = defaultdict(list)
    por_docente_semana: dict[tuple[int, int], int] = defaultdict(int)

    for bloque in bloques:
        actividad = bloque.actividad
        if actividad.docente_id is None:
            continue
        for semana in range(actividad.semana_inicio, actividad.semana_fin):
            por_docente_dia[(actividad.docente_id, semana, bloque.dia)].append(bloque)
            por_docente_semana[(actividad.docente_id, semana)] += (
                actividad.duracion_min
            )

    for (docente_id, semana, dia), elementos in sorted(por_docente_dia.items()):
        total = sum(b.actividad.horas_academicas for b in elementos)
        inicio = min(b.inicio_min for b in elementos)
        fin = max(b.fin_min for b in elementos)
        nombre = _nombre_docente(ctx, docente_id)
        if total > MAX_TEACHER_DAILY_ACAD_HOURS and not relajar_topes:
            problemas.append(
                f"Docente {nombre} supera {MAX_TEACHER_DAILY_ACAD_HOURS} h "
                f"académicas el día {dia} de la semana {semana + 1} "
                f"({total} h académicas)."
            )
        if fin - inicio > MAX_TEACHER_DAILY_SPAN_MIN and not relajar_topes:
            problemas.append(
                f"Docente {nombre} supera una jornada real de 9 h el día {dia} "
                f"de la semana {semana + 1} "
                f"({fin - inicio} min entre la primera y la última clase)."
            )
        if not relajar_recesos:
            ordenados = sorted(elementos, key=lambda b: b.inicio_min)
            horas_continuas = ordenados[0].actividad.horas_academicas
            for anterior, posterior in zip(ordenados, ordenados[1:]):
                gap = posterior.inicio_min - anterior.fin_min
                if horas_continuas >= LONG_BREAK_THRESHOLD and gap < LONG_BREAK_MIN:
                    problemas.append(
                        f"Docente {nombre}: tras {horas_continuas} h académicas "
                        f"continuas el día {dia} de la semana {semana + 1}, "
                        f"hay clases posteriores con solo {gap} min de descanso; "
                        f"se requieren {LONG_BREAK_MIN} min."
                    )
                    break
                if gap >= LONG_BREAK_MIN:
                    horas_continuas = posterior.actividad.horas_academicas
                else:
                    horas_continuas += posterior.actividad.horas_academicas

    for (docente_id, semana), total in sorted(por_docente_semana.items()):
        docente = ctx.docentes.get(docente_id)
        if docente is None:
            continue
        if total > docente.tope_semanal_min and not relajar_topes:
            problemas.append(
                f"Docente {docente.nombre} supera su tope semanal de "
                f"{docente.tope_semanal} h reloj en la semana {semana + 1} "
                f"({total / 60:g} h reloj)."
            )
    return problemas


def _nombre_docente(ctx: Contexto, docente_id: int) -> str:
    docente = ctx.docentes.get(docente_id)
    return docente.nombre if docente else f"Docente {docente_id}"


def _banda_horaria(inicio: int, fin: int) -> int:
    if fin <= MORNING_END_MIN:
        return 0
    if inicio >= NIGHT_START_MIN:
        return 2
    return 1


def _validar_modalidades(
    ctx: Contexto,
    bloques: list[BloqueProgramado],
) -> tuple[list[str], list[str]]:
    problemas: list[str] = []
    advertencias: list[str] = []
    for bloque in bloques:
        actividad = bloque.actividad
        modalidad = actividad.modalidad
        if bloque.fin_min - bloque.inicio_min != actividad.horas_academicas * ACADEMIC_HOUR_MIN:
            problemas.append(
                f"{actividad.descripcion}: la duración real no coincide con sus "
                "horas académicas."
            )
        if modalidad != "EMP" and actividad.horas_academicas > MAX_SESSION_ACAD_HOURS:
            problemas.append(
                f"{actividad.descripcion}: una sesión supera "
                f"{MAX_SESSION_ACAD_HOURS} h académicas."
            )
        if modalidad == "EMP":
            if actividad.horas_academicas > EMP_MAX_ACAD_HOURS:
                problemas.append(
                    f"{actividad.descripcion}: bloque EMP mayor a "
                    f"{EMP_MAX_ACAD_HOURS} h académicas."
                )
            if bloque.inicio_min < EMP_START_MIN or bloque.fin_min > EMP_END_MIN:
                problemas.append(
                    f"{actividad.descripcion}: bloque EMP fuera de 08:00-14:00."
                )
            if bloque.id_ambiente is not None:
                problemas.append(
                    f"{actividad.descripcion}: un bloque EMP no debe ocupar ambiente."
                )
            if actividad.docente_id is not None:
                problemas.append(
                    f"{actividad.descripcion}: un bloque EMP no debe tener docente."
                )
            continue

        bandas = (
            bandas_virtuales(ctx, actividad.oferta)
            if modalidad == "VIR"
            else bandas_cohorte(ctx, actividad.oferta)
        )
        permitidas = list(bandas)
        if ctx.permitir_banda_alterna and len(bandas) > 1:
            permitidas.append(
                (min(inicio for inicio, _ in bandas), max(fin for _, fin in bandas))
            )
        if not any(
            inicio <= bloque.inicio_min and bloque.fin_min <= fin
            for inicio, fin in permitidas
        ):
            detalle = ", ".join(
                f"{inicio // 60:02d}:{inicio % 60:02d}-{fin // 60:02d}:{fin % 60:02d}"
                for inicio, fin in bandas
            )
            problemas.append(
                f"{actividad.descripcion}: fuera de las bandas horarias del turno "
                f"({detalle})."
            )

        if modalidad in {"TEC", "TAL"}:
            if bloque.id_ambiente is None:
                problemas.append(
                    f"{actividad.descripcion}: falta ambiente para modalidad {modalidad}."
                )
            else:
                ambiente = ctx.ambientes.get(bloque.id_ambiente)
                if ambiente is None:
                    problemas.append(
                        f"{actividad.descripcion}: ambiente {bloque.id_ambiente} "
                        "inexistente o inactivo."
                    )
                elif ambiente.id_sede != actividad.oferta.id_sede:
                    problemas.append(
                        f"{actividad.descripcion}: ambiente de otra sede."
                    )
                compatibles = ctx.compatibilidad.get(
                    actividad.oferta.curso.id_curso, ()
                )
                autorizado = (
                    bloque.id_ambiente in compatibles
                    if compatibles
                    else ambiente_es_aula_comun(ambiente)
                )
                if not autorizado:
                    problemas.append(
                        f"{actividad.descripcion}: el ambiente no cumple la regla "
                        "de asignación de ambiente_cursos_permitidos."
                    )
        else:
            if bloque.id_ambiente is not None:
                problemas.append(
                    f"{actividad.descripcion}: modalidad {modalidad} no debe ocupar ambiente."
                )
            if actividad.docente_id is not None:
                problemas.append(
                    f"{actividad.descripcion}: modalidad {modalidad} no debe tener docente."
                )

        if actividad.docente_id is not None:
            docente = ctx.docentes.get(actividad.docente_id)
            if docente is None:
                problemas.append(
                    f"{actividad.descripcion}: docente {actividad.docente_id} inexistente."
                )
            elif docente.usa_restriccion:
                franjas = docente.disponibilidad.get(bloque.dia, ())
                if not any(
                    inicio <= bloque.inicio_min and bloque.fin_min <= fin
                    for inicio, fin in franjas
                ):
                    problemas.append(
                        f"{actividad.descripcion}: fuera de la disponibilidad "
                        f"estricta del docente {docente.nombre}. La "
                        "disponibilidad es una restricción dura y no se relaja "
                        "automáticamente."
                    )
    return problemas, advertencias


def _validar_cohortes(
    ctx: Contexto,
    bloques: list[BloqueProgramado],
    *,
    relajar_continuidad: bool = False,
    relajar_tope_diario: bool = False,
) -> tuple[list[str], list[str]]:
    problemas: list[str] = []
    advertencias: list[str] = []
    ocupacion: dict[tuple, list[BloqueProgramado]] = defaultdict(list)
    for bloque in bloques:
        for semana in range(
            bloque.actividad.semana_inicio, bloque.actividad.semana_fin
        ):
            ocupacion[(bloque.actividad.oferta.cohorte, semana, bloque.dia)].append(
                bloque
            )

    for (cohorte, semana, dia), elementos in sorted(ocupacion.items()):
        inicio_jornada = min(bloque.inicio_min for bloque in elementos)
        fin_jornada = max(bloque.fin_min for bloque in elementos)
        jornada = fin_jornada - inicio_jornada
        if jornada > MAX_COHORT_DAILY_SPAN_MIN and not relajar_tope_diario:
            problemas.append(
                f"Cohorte {cohorte}: jornada de {jornada} min el día {dia} "
                f"de la semana {semana + 1}; máximo permitido: "
                f"{MAX_COHORT_DAILY_SPAN_MIN} min."
            )

        if (
            elementos[0].actividad.oferta.curso.semestre_num >= 3
            and inicio_jornada > MAX_COHORT_FIRST_CLASS_START_MIN
        ):
            problemas.append(
                f"Cohorte {cohorte}: la primera clase del día {dia} de la "
                f"semana {semana + 1} inicia a las "
                f"{_hora_minutos(inicio_jornada)}; para III-VI no puede "
                f"comenzar después de las "
                f"{_hora_minutos(MAX_COHORT_FIRST_CLASS_START_MIN)}."
            )

        if relajar_continuidad:
            continue
        # La continuidad 15-30 min se exige dentro de cada turno. Si el día
        # combina mañana y tarde/noche, el corte entre el último bloque de la
        # mañana y el primero de la tarde/noche no puede superar una hora.
        por_turno: dict[int, list[BloqueProgramado]] = defaultdict(list)
        for bloque in elementos:
            if bloque.actividad.modalidad not in {"TEC", "TAL"}:
                continue
            turno = 0 if _banda_horaria(bloque.inicio_min, bloque.fin_min) == 0 else 1
            por_turno[turno].append(bloque)
        for grupo in por_turno.values():
            ordenados = sorted(grupo, key=lambda b: b.inicio_min)
            for izquierda, derecha in zip(ordenados, ordenados[1:]):
                gap = derecha.inicio_min - izquierda.fin_min
                if gap > 30:
                    problemas.append(
                        f"Cohorte {cohorte}: hueco presencial de {gap} min el día "
                        f"{dia} de la semana {semana + 1}; máximo permitido: 30 min."
                    )

        manana = por_turno.get(0, [])
        tarde = por_turno.get(1, [])
        if manana and tarde:
            corte = min(b.inicio_min for b in tarde) - max(
                b.fin_min for b in manana
            )
            if corte > MAX_COHORT_CROSS_TURN_GAP_MIN:
                problemas.append(
                    f"Cohorte {cohorte}: corte de {corte} min entre mañana y "
                    f"tarde/noche el día {dia} de la semana {semana + 1}; "
                    f"máximo permitido: {MAX_COHORT_CROSS_TURN_GAP_MIN} min."
                )
    return problemas, advertencias


def _distancia_minutos_entre(
    izquierda: BloqueProgramado, derecha: BloqueProgramado
) -> int | None:
    """Distancia real entre dos bloques del mismo día; None si son días distintos."""
    if izquierda.dia != derecha.dia:
        return None
    if izquierda.fin_min <= derecha.inicio_min:
        return derecha.inicio_min - izquierda.fin_min
    if derecha.fin_min <= izquierda.inicio_min:
        return izquierda.inicio_min - derecha.fin_min
    return 0


def _validar_distribucion_modalidades(
    bloques: list[BloqueProgramado],
    *,
    relajar_bandas: bool = False,
) -> tuple[list[str], list[str]]:
    """Devuelve problemas y advertencias de convivencia de modalidades.

    Las bandas mixtas de las clases presenciales se reportan como advertencia:
    el modelo las permite con penalización alta cuando son la única forma de
    conseguir factibilidad. VIR puede ubicarse en cualquier banda sin preferir
    el turno opuesto; su única condición es no solaparse con la carga de su
    cohorte, que se controla en la validación de solapamientos. Además se
    advierte cuando una actividad virtual queda demasiado cerca de la carga
    presencial de la misma cohorte, porque el estudiante no dispone de un
    margen razonable para trasladarse o descansar.
    """
    problemas: list[str] = []
    advertencias: list[str] = []
    presenciales: dict[tuple, list[BloqueProgramado]] = defaultdict(list)
    virtuales: dict[tuple, list[BloqueProgramado]] = defaultdict(list)
    for bloque in bloques:
        actividad = bloque.actividad
        if actividad.modalidad in {"TEC", "TAL"}:
            presenciales[actividad.oferta.cohorte].append(bloque)
        elif actividad.modalidad == "VIR":
            virtuales[actividad.oferta.cohorte].append(bloque)

    if not relajar_bandas:
        for cohorte, elementos in presenciales.items():
            bandas = {
                _banda_horaria(bloque.inicio_min, bloque.fin_min)
                for bloque in elementos
            }
            if len(bandas) > 1:
                advertencias.append(
                    f"Cohorte {cohorte}: las clases presenciales combinan turnos "
                    "distintos; se acepta como excepción penalizada."
                )

        for cohorte, elementos_virtuales in virtuales.items():
            carga_presencial = presenciales.get(cohorte, [])
            for virtual in elementos_virtuales:
                distancias = [
                    distancia
                    for presencial in carga_presencial
                    if _rangos_se_solapan(
                        virtual.actividad.semana_inicio,
                        virtual.actividad.semana_fin,
                        presencial.actividad.semana_inicio,
                        presencial.actividad.semana_fin,
                    )
                    and (
                        distancia := _distancia_minutos_entre(virtual, presencial)
                    )
                    is not None
                ]
                if not distancias:
                    continue
                minima = min(distancias)
                if minima < VIR_SEPARACION_PREFERIDA_MIN:
                    advertencias.append(
                        f"{virtual.actividad.descripcion}: queda a {minima} min "
                        f"de la carga presencial de su cohorte; se prefieren al "
                        f"menos {VIR_SEPARACION_PREFERIDA_MIN} min de separación."
                    )

    return problemas, advertencias


def _validar_plantilla(bloques: list[BloqueProgramado]) -> list[str]:
    """Comprueba que la solución respeta la clonación dura de la plantilla."""
    grupos: dict[tuple[str, str], list[BloqueProgramado]] = defaultdict(list)
    for bloque in bloques:
        actividad = bloque.actividad
        if actividad.plantilla_id and actividad.plantilla_slot:
            grupos[(actividad.plantilla_id, actividad.plantilla_slot)].append(bloque)

    problemas: list[str] = []
    for (plantilla_id, slot), elementos in sorted(grupos.items()):
        if len(elementos) <= 1:
            continue
        dias = {elemento.dia for elemento in elementos}
        inicios = {elemento.inicio_min for elemento in elementos}
        if len(dias) > 1 or len(inicios) > 1:
            problemas.append(
                f"Plantilla {plantilla_id}, slot {slot}: los módulos no "
                f"comparten día/hora de inicio (días={sorted(dias)}, "
                f"inicios={sorted(inicios)})."
            )
    return problemas


def validar_solucion(
    ctx: Contexto,
    bloques: list[BloqueProgramado],
    *,
    relajar_topes: bool = False,
    modo_prueba_factibilidad: bool = False,
) -> tuple[list[str], list[str]]:
    problemas: list[str] = []
    advertencias: list[str] = []
    problema_ids = {b.actividad.uid for b in bloques}
    limite_lectivo = min(SEMANAS_LECTIVAS, max(1, int(ctx.periodo.semanas)))

    for bloque in bloques:
        if not (0 <= bloque.actividad.semana_inicio < bloque.actividad.semana_fin):
            problemas.append(
                f"{bloque.actividad.descripcion}: rango de semanas inválido."
            )
        if bloque.actividad.semana_fin > limite_lectivo:
            problemas.append(
                f"{bloque.actividad.descripcion}: excede las semanas lectivas "
                f"({limite_lectivo})."
            )
        if bloque.dia not in ctx.dias:
            problemas.append(
                f"{bloque.actividad.descripcion}: día no habilitado por la franja."
            )

    if len(problema_ids) != len(bloques):
        problemas.append("Hay actividades repetidas en la solución.")

    problemas.extend(
        _validar_solapamientos(
            bloques, relajar_ambientes=modo_prueba_factibilidad
        )
    )
    problemas.extend(_validar_plantilla(bloques))
    problemas.extend(
        _validar_docentes(
            ctx,
            bloques,
            relajar_topes=relajar_topes,
            relajar_recesos=modo_prueba_factibilidad,
        )
    )
    
    prob_mod, adv_mod = _validar_modalidades(ctx, bloques)
    problemas.extend(prob_mod)
    advertencias.extend(adv_mod)

    problemas_cohorte, adv_cohorte = _validar_cohortes(
        ctx,
        bloques,
        relajar_continuidad=modo_prueba_factibilidad,
        relajar_tope_diario=modo_prueba_factibilidad,
    )
    problemas.extend(problemas_cohorte)
    advertencias.extend(adv_cohorte)
    prob_dist, adv_dist = _validar_distribucion_modalidades(
        bloques,
        relajar_bandas=modo_prueba_factibilidad,
    )
    problemas.extend(prob_dist)
    advertencias.extend(adv_dist)
    

    return problemas, advertencias