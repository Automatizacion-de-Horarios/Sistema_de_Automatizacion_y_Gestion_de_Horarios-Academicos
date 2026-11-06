"""Diagnóstico detallado para corridas CP-SAT infactibles.

El reporte combina dos niveles:

1. Comprobaciones de datos sin resolver: carga docente frente a disponibilidad,
   carga de cohorte frente a sus bandas, actividades sin ubicación compatible
   con las ocupaciones externas y programaciones externas que comparten
   recursos escasos.
2. Aislamiento CP-SAT: si el modelo de factibilidad con todas las ocupaciones
   externas es infactible, prueba a retirar una programación externa a la vez
   para identificar la que bloquea al grupo.

No modifica la base de datos ni relaja reglas. Solo produce texto para el log.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass

from ortools.sat.python import cp_model

from solver_horarios.actividades import generar_pares_permitidos
from solver_horarios.config import BREAK_MIN, Actividad
from solver_horarios.modelo_variables import Construccion
from solver_horarios.planificacion import Contexto, bandas_cohorte

from .ocupaciones import (
    OcupacionExterna,
    agregar_restricciones_externas,
)


@dataclass(frozen=True)
class ProgramacionExterna:
    id_programacion: int
    ocupaciones: tuple[OcupacionExterna, ...]
    puntaje: int
    ambientes_compartidos: int
    ambientes_exclusivos: int
    docentes_compartidos: int
    pares_bloqueados: int


def _hora(minutos: int) -> str:
    return f"{minutos // 60:02d}:{minutos % 60:02d}"


def _minutos_disponibilidad(ctx: Contexto, docente) -> int:
    if docente is None or not docente.usa_restriccion:
        return 10**9
    total = 0
    for dia in ctx.dias:
        for inicio, fin in docente.disponibilidad.get(dia, ()):
            inicio = max(int(inicio), ctx.franja.inicio_min)
            fin = min(int(fin), ctx.franja.cierre_min)
            if fin > inicio:
                total += fin - inicio
    return total


def _reservas_por_recurso(
    ocupaciones: Iterable[OcupacionExterna],
) -> tuple[
    dict[int, list[OcupacionExterna]],
    dict[int, list[OcupacionExterna]],
]:
    por_docente: dict[int, list[OcupacionExterna]] = defaultdict(list)
    por_ambiente: dict[int, list[OcupacionExterna]] = defaultdict(list)
    for ocupacion in ocupaciones:
        if ocupacion.id_docente is not None:
            por_docente[ocupacion.id_docente].append(ocupacion)
        if ocupacion.id_ambiente is not None:
            por_ambiente[ocupacion.id_ambiente].append(ocupacion)
    return por_docente, por_ambiente


def _se_solapan_semanas(
    actividad: Actividad, ocupacion: OcupacionExterna
) -> bool:
    return (
        actividad.semana_inicio < ocupacion.semana_fin
        and ocupacion.semana_inicio_interna < actividad.semana_fin
    )


def _conflicto_docente(
    actividad: Actividad,
    inicio: int,
    ocupacion: OcupacionExterna,
) -> bool:
    if not _se_solapan_semanas(actividad, ocupacion):
        return False
    receso_actividad = 0 if actividad.modalidad == "EMP" else BREAK_MIN
    receso_reserva = 0 if ocupacion.modalidad == "EMP" else BREAK_MIN
    fin = inicio + actividad.duracion_min + receso_actividad
    return not (
        fin <= ocupacion.inicio_min
        or inicio >= ocupacion.fin_min + receso_reserva
    )


def _conflicto_ambiente(
    actividad: Actividad,
    dia: int,
    inicio: int,
    ocupacion: OcupacionExterna,
) -> bool:
    if dia != ocupacion.dia or not _se_solapan_semanas(actividad, ocupacion):
        return False
    fin = inicio + actividad.duracion_min
    return not (
        fin <= ocupacion.inicio_min
        or inicio >= ocupacion.fin_min
    )


def _compatible_con_reservas(
    actividad: Actividad,
    pares: Iterable[tuple[int, int]],
    reservas_docente: Iterable[OcupacionExterna],
    por_ambiente: dict[int, list[OcupacionExterna]],
) -> int:
    """Cuenta pares compatibles con un conjunto concreto de reservas."""
    reservas_docente = list(reservas_docente)
    compatibles = 0
    for dia, inicio in pares:
        if any(
            _conflicto_docente(actividad, inicio, reserva)
            for reserva in reservas_docente
            if reserva.dia == dia
        ):
            continue
        if actividad.ambientes:
            libre = False
            for id_ambiente in actividad.ambientes:
                if not any(
                    _conflicto_ambiente(actividad, dia, inicio, reserva)
                    for reserva in por_ambiente.get(id_ambiente, [])
                ):
                    libre = True
                    break
            if not libre:
                continue
        compatibles += 1
    return compatibles


def _pares_compatibles_externos(
    ctx: Contexto,
    actividad: Actividad,
    ocupaciones: Iterable[OcupacionExterna],
) -> int:
    """Cuenta pares día/hora que no chocan con docente ni ambientes externos."""
    por_docente, por_ambiente = _reservas_por_recurso(ocupaciones)
    reservas_docente = (
        por_docente.get(actividad.docente_id, [])
        if actividad.docente_id is not None
        else []
    )
    return _compatible_con_reservas(
        actividad,
        generar_pares_permitidos(ctx, actividad),
        reservas_docente,
        por_ambiente,
    )


def _programaciones_externas(
    ctx: Contexto,
    actividades: list[Actividad],
    ocupaciones: list[OcupacionExterna],
) -> list[ProgramacionExterna]:
    """Ordena las programaciones externas por presión real sobre el grupo.

    No basta con compartir un aula común: casi todas las actividades usan
    alguna CLAS. Se prioriza la presión sobre ambientes exclusivos (por ejemplo,
    un laboratorio que es la única opción de un curso) y la cantidad de pares
    día/hora que la programación externa elimina.
    """
    por_programacion: dict[int, list[OcupacionExterna]] = defaultdict(list)
    for ocupacion in ocupaciones:
        por_programacion[ocupacion.id_programacion].append(ocupacion)

    pares_por_actividad = {
        actividad.uid: generar_pares_permitidos(ctx, actividad)
        for actividad in actividades
    }
    ambientes_exclusivos: dict[int, int] = defaultdict(int)
    for actividad in actividades:
        if len(actividad.ambientes) == 1:
            ambientes_exclusivos[actividad.ambientes[0]] += 1

    resultado: list[ProgramacionExterna] = []
    for id_programacion, filas in por_programacion.items():
        ambientes = {
            fila.id_ambiente
            for fila in filas
            if fila.id_ambiente is not None
        }
        docentes = {
            fila.id_docente
            for fila in filas
            if fila.id_docente is not None
        }
        actividades_ambiente = sum(
            1
            for actividad in actividades
            if ambientes.intersection(actividad.ambientes)
        )
        actividades_docente = sum(
            1
            for actividad in actividades
            if actividad.docente_id is not None
            and actividad.docente_id in docentes
        )
        ambientes_exclusivos_compartidos = sum(
            ambientes_exclusivos[id_ambiente] for id_ambiente in ambientes
        )
        if not (
            actividades_ambiente
            or actividades_docente
            or ambientes_exclusivos_compartidos
        ):
            continue

        por_docente, por_ambiente = _reservas_por_recurso(filas)
        pares_bloqueados = 0
        for actividad in actividades:
            if actividad.docente_id is not None:
                reservas_docente = por_docente.get(actividad.docente_id, [])
            else:
                reservas_docente = []
            if not (
                reservas_docente
                or ambientes.intersection(actividad.ambientes)
            ):
                continue
            pares = pares_por_actividad[actividad.uid]
            compatibles = _compatible_con_reservas(
                actividad, pares, reservas_docente, por_ambiente
            )
            pares_bloqueados += max(0, len(pares) - compatibles)

        puntaje = (
            ambientes_exclusivos_compartidos * 50
            + pares_bloqueados
            + actividades_docente * 10
        )
        resultado.append(
            ProgramacionExterna(
                id_programacion=id_programacion,
                ocupaciones=tuple(filas),
                puntaje=puntaje,
                ambientes_compartidos=actividades_ambiente,
                ambientes_exclusivos=ambientes_exclusivos_compartidos,
                docentes_compartidos=actividades_docente,
                pares_bloqueados=pares_bloqueados,
            )
        )
    resultado.sort(key=lambda item: (-item.puntaje, item.id_programacion))
    return resultado


def _buscar_programacion_bloqueante(
    ctx: Contexto,
    actividades: list[Actividad],
    ocupaciones: list[OcupacionExterna],
    *,
    limite_segundos: float,
) -> tuple[int, tuple[OcupacionExterna, ...], float] | None:
    """Aísla por búsqueda binaria una programación externa que vuelve infactible.

    Se usa el modelo de factibilidad (sin objetivo y sin exclusividad de aulas)
    para que cada prueba sea rápida. Si un subconjunto de programaciones es
    infactible por sí solo, se sigue dividiendo hasta encontrar una sola. Si
    ambas mitades son factibles por separado pero juntas no, se reporta que el
    bloqueo requiere combinación.
    """
    por_programacion: dict[int, list[OcupacionExterna]] = defaultdict(list)
    for ocupacion in ocupaciones:
        por_programacion[ocupacion.id_programacion].append(ocupacion)
    programas = sorted(por_programacion)

    def resolver(seleccion: list[int]) -> tuple[int, float]:
        filas = [
            ocupacion
            for id_programacion in seleccion
            for ocupacion in por_programacion[id_programacion]
        ]
        construccion = Construccion(
            ctx=ctx,
            actividades=actividades,
            modo_prueba_factibilidad=True,
            sin_objetivo=True,
        )
        modelo = construccion.construir()
        agregar_restricciones_externas(construccion, filas)
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = max(1.0, min(20.0, limite_segundos))
        solver.parameters.num_search_workers = 8
        estado = solver.Solve(modelo)
        return estado, float(solver.WallTime())

    restante = limite_segundos
    estado, tiempo = resolver(programas)
    restante -= tiempo
    if estado not in (cp_model.INFEASIBLE, cp_model.MODEL_INVALID):
        return None
    actual = programas
    while len(actual) > 1 and restante > 0:
        mitad = len(actual) // 2
        izquierda = actual[:mitad]
        derecha = actual[mitad:]
        estado_izq, tiempo_izq = resolver(izquierda)
        restante -= tiempo_izq
        if estado_izq == cp_model.INFEASIBLE:
            actual = izquierda
            continue
        if restante <= 0:
            break
        estado_der, tiempo_der = resolver(derecha)
        restante -= tiempo_der
        if estado_der == cp_model.INFEASIBLE:
            actual = derecha
            continue
        # Ambas mitades factibles por separado: el bloqueo requiere combinación.
        return None
    if len(actual) == 1 and restante > 0:
        estado_uno, _ = resolver(actual)
        if estado_uno == cp_model.INFEASIBLE:
            return actual[0], tuple(por_programacion[actual[0]]), limite_segundos - restante
    return None


def _lineas_docentes(ctx: Contexto, actividades: list[Actividad]) -> list[str]:
    cargas: dict[int, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    for actividad in actividades:
        if actividad.docente_id is None:
            continue
        for semana in range(actividad.semana_inicio, actividad.semana_fin):
            cargas[actividad.docente_id][semana] += actividad.duracion_min

    filas: list[tuple[float, int, int, int, str]] = []
    for id_docente, por_semana in cargas.items():
        docente = ctx.docentes.get(id_docente)
        if docente is None:
            continue
        disponible = _minutos_disponibilidad(ctx, docente)
        pico = max(por_semana.values()) if por_semana else 0
        if disponible >= 10**9:
            continue
        ratio = pico / disponible if disponible else float("inf")
        if ratio >= 0.75 or pico > disponible:
            filas.append(
                (ratio, pico, disponible, id_docente, docente.nombre)
            )
    filas.sort(reverse=True)
    if not filas:
        return ["Docentes: no se detectaron cargas semanales cerca de su disponibilidad."]
    lineas = ["Docentes con disponibilidad más ajustada:"]
    for ratio, pico, disponible, id_docente, nombre in filas[:8]:
        lineas.append(
            f"  - {id_docente} {nombre}: pico {pico / 60:.2f} h reloj "
            f"frente a {disponible / 60:.2f} h disponibles "
            f"(ocupación {ratio * 100:.1f}%)."
        )
    return lineas


def _lineas_cohortes(ctx: Contexto, actividades: list[Actividad]) -> list[str]:
    cargas: dict[tuple, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    referencia: dict[tuple, Actividad] = {}
    for actividad in actividades:
        referencia.setdefault(actividad.oferta.cohorte, actividad)
        for semana in range(actividad.semana_inicio, actividad.semana_fin):
            cargas[actividad.oferta.cohorte][semana] += actividad.duracion_min

    filas: list[tuple[float, int, int, tuple]] = []
    for cohorte, por_semana in cargas.items():
        actividad = referencia[cohorte]
        bandas = bandas_cohorte(ctx, actividad.oferta)
        capacidad = sum(
            fin - inicio for inicio, fin in bandas
        ) * len(ctx.dias)
        pico = max(por_semana.values()) if por_semana else 0
        ratio = pico / capacidad if capacidad else float("inf")
        if ratio >= 0.70 or pico > capacidad:
            filas.append((ratio, pico, capacidad, cohorte))
    filas.sort(reverse=True)
    if not filas:
        return ["Cohortes: no se detectaron cargas semanales cerca de sus bandas."]
    lineas = ["Cohortes con mayor ocupación de sus bandas:"]
    for ratio, pico, capacidad, cohorte in filas[:8]:
        lineas.append(
            f"  - Cohorte {cohorte}: pico {pico / 60:.2f} h reloj "
            f"frente a {capacidad / 60:.2f} h de banda "
            f"(ocupación {ratio * 100:.1f}%)."
        )
    return lineas


def diagnosticar_infactibilidad(
    ctx: Contexto,
    actividades: list[Actividad],
    ocupaciones: Iterable[OcupacionExterna],
    *,
    limite_segundos: float = 60.0,
) -> list[str]:
    """Genera un reporte detallado y acotado para una corrida infactible."""
    lista_ocupaciones = list(ocupaciones)
    lineas = ["Diagnóstico detallado de infactibilidad:"]

    sin_ubicacion: list[tuple[Actividad, int]] = []
    pocas: list[tuple[Actividad, int]] = []
    for actividad in actividades:
        compatibles = _pares_compatibles_externos(
            ctx, actividad, lista_ocupaciones
        )
        if compatibles == 0:
            sin_ubicacion.append((actividad, compatibles))
        elif compatibles <= 2:
            pocas.append((actividad, compatibles))

    if sin_ubicacion:
        lineas.append(
            "Actividades sin ninguna ubicación compatible con las ocupaciones externas:"
        )
        for actividad, _ in sin_ubicacion[:12]:
            lineas.append(
                f"  - uid={actividad.uid} {actividad.descripcion}: "
                f"semanas {actividad.semana_inicio + 1}-{actividad.semana_fin}, "
                f"docente {actividad.docente_id}, ambientes {actividad.ambientes}."
            )
    elif pocas:
        lineas.append(
            "Actividades con muy pocas ubicaciones compatibles con las ocupaciones externas:"
        )
        for actividad, compatibles in pocas[:12]:
            lineas.append(
                f"  - uid={actividad.uid} {actividad.descripcion}: "
                f"{compatibles} par(es) día/hora compatible(s)."
            )
    else:
        lineas.append(
            "Todas las actividades conservan al menos una ubicación compatible "
            "con las ocupaciones externas; el choque requiere combinación de recursos."
        )

    lineas.extend(_lineas_docentes(ctx, actividades))
    lineas.extend(_lineas_cohortes(ctx, actividades))

    candidatos = _programaciones_externas(ctx, actividades, lista_ocupaciones)
    if candidatos:
        lineas.append(
            "Programaciones externas con mayor presión superficial "
            "(heurística; la causa exacta se calcula con el aislamiento CP-SAT):"
        )
        for candidato in candidatos[:5]:
            lineas.append(
                f"  - prog={candidato.id_programacion}: "
                f"{candidato.ambientes_exclusivos} cupo(s) de ambiente exclusivo, "
                f"{candidato.pares_bloqueados} par(es) día/hora bloqueados, "
                f"{candidato.docentes_compartidos} docente(s) compartido(s) "
                f"(puntaje {candidato.puntaje}, {len(candidato.ocupaciones)} filas)."
            )
    else:
        lineas.append(
            "No se detectaron programaciones externas que compartan docentes o "
            "ambientes con el grupo."
        )

    if limite_segundos > 0 and lista_ocupaciones:
        bloqueante = _buscar_programacion_bloqueante(
            ctx,
            actividades,
            lista_ocupaciones,
            limite_segundos=limite_segundos,
        )
        if bloqueante is not None:
            id_programacion, filas, usado = bloqueante
            detalle = ", ".join(
                f"{fila.dia}/{_hora(fila.inicio_min)}-{_hora(fila.fin_min)} "
                f"semanas {fila.semana_inicio}-{fila.semana_fin}"
                for fila in filas[:6]
            )
            lineas.append(
                f"Aislamiento CP-SAT: al retirar la programación externa "
                f"{id_programacion} el grupo vuelve a ser factible "
                f"(prueba acumulada {usado:.1f} s). Filas: {detalle}."
            )
            lineas.append(
                "Acción sugerida: revisar esa programación del otro grupo, "
                "reasignar su ambiente/docente o regenerar los grupos en orden "
                "coordinado. No se relajó ninguna disponibilidad."
            )
        else:
            lineas.append(
                "Aislamiento CP-SAT: no se encontró una única programación externa "
                "cuya remoción vuelva factible el grupo dentro del presupuesto de "
                "diagnóstico. Puede requerir combinar varias programaciones o "
                "regenerar los grupos juntos."
            )
    return lineas
