"""Conversión de horas curriculares a actividades semanales y ventanas válidas."""

from __future__ import annotations

import logging
from collections import defaultdict

from .config import (
    ACADEMIC_HOUR_MIN,
    BREAK_MIN,
    EMP_END_MIN,
    EMP_MAX_ACAD_HOURS,
    EMP_START_MIN,
    GRID_MIN,
    MAX_SESSION_ACAD_HOURS,
    Actividad,
    ErrorDatos,
    Oferta,
    ambiente_es_aula_comun,
    alinear_grilla,
    dia_db,
    distribuir_entero,
    distribuir_semanas,
    agrupar_semanas,
)
from .planificacion import (
    Contexto,
    PlantillaModular,
    asignar_ventanas,
    bandas_virtuales,
    bandas_cohorte,
    describir_bandas,
)

log = logging.getLogger(__name__)


def _ambientes_para(
    ctx: Contexto, oferta: Oferta, modalidad: str, permitir_generico: bool
) -> tuple[int, ...]:
    if modalidad in {"VIR", "EMP"}:
        return ()

    curso = oferta.curso
    compatibles = ctx.compatibilidad.get(curso.id_curso, ())
    if compatibles:
        candidatos = [
            id_ambiente
            for id_ambiente in compatibles
            if id_ambiente in ctx.ambientes
            and ctx.ambientes[id_ambiente].id_sede == oferta.id_sede
        ]
    else:
        candidatos = [
            id_ambiente
            for id_ambiente, ambiente in ctx.ambientes.items()
            if ambiente.id_sede == oferta.id_sede
            and ambiente_es_aula_comun(ambiente)
        ]

    if not candidatos:
        if permitir_generico:
            log.warning(
                "Curso %s sin ambiente permitido disponible en sede %s; "
                "--permitir-ambiente-generico no ignora la matriz de "
                "ambiente_cursos_permitidos.",
                curso.mat_cur,
                oferta.id_sede,
            )
        detalle = (
            "No hay ambientes especializados autorizados y operativos "
            if compatibles
            else "No hay aulas comunes operativas "
        )
        raise ErrorDatos(
            f"{detalle}disponibles para {curso.mat_cur} en la sede {oferta.id_sede}."
        )
    return tuple(sorted(set(candidatos)))


def _dividir_emp(horas_semanales: int) -> list[int]:
    """Prácticas en empresa: días completos de hasta 8 horas académicas."""
    if horas_semanales <= 0:
        return []
    dias = max(1, (horas_semanales + EMP_MAX_ACAD_HOURS - 1) // EMP_MAX_ACAD_HOURS)
    return distribuir_entero(horas_semanales, dias)


def _dividir_bloques(horas_semanales: int) -> list[int]:
    """Bloques equilibrados de como máximo 3 horas académicas."""
    if horas_semanales <= 0:
        return []
    cantidad = max(1, (horas_semanales + MAX_SESSION_ACAD_HOURS - 1) // MAX_SESSION_ACAD_HOURS)
    return distribuir_entero(horas_semanales, cantidad)


def _componentes(oferta: Oferta) -> list[tuple[str, int, int | None]]:
    """Modalidades programables de una oferta, con su docente declarado.

    ``horas_eval`` no se incluye nunca: la evaluación semestral es externa a la
    grilla regular y no consume bloques TEC/TAL ni carga docente.
    """
    curso = oferta.curso
    componentes: list[tuple[str, int, int | None]] = []
    if curso.horas_tec > 0:
        componentes.append(("TEC", curso.horas_tec, oferta.id_docente_tec))
    if curso.horas_tal > 0:
        modalidad_tal = "EMP" if curso.es_practica_empresa else "TAL"
        componentes.append((modalidad_tal, curso.horas_tal, oferta.id_docente_tal))
    if curso.horas_vir > 0:
        componentes.append(("VIR", curso.horas_vir, None))
    return componentes


def _patron_semanal(oferta: Oferta) -> dict[tuple[str, str], tuple[int, ...]]:
    """Catálogo de slots TEC/TAL del módulo de referencia.

    Se toma el primer grupo semanal (el patrón que debe repetirse todos los
    lunes a sábado del módulo). VIR y EMP no entran en la plantilla rígida.

    Los slots no llevan etiqueta de día: CP-SAT decide qué día usar dentro de
    los pares candidatos permitidos por turno y disponibilidad.
    """
    patron: dict[tuple[str, str], tuple[int, ...]] = {}
    largo_ventana = max(0, oferta.ventana_fin - oferta.ventana_inicio)
    if largo_ventana <= 0:
        return patron

    for modalidad, total_horas, _ in _componentes(oferta):
        if modalidad not in {"TEC", "TAL"}:
            continue

        horas_semanales = distribuir_semanas(total_horas, largo_ventana)
        grupos = agrupar_semanas(horas_semanales)
        if not grupos:
            continue

        _, _, horas_semana = grupos[0]
        trozos = _dividir_bloques(horas_semana)
        por_etiqueta: dict[str, list[int]] = defaultdict(list)
        for horas_bloque in trozos:
            if horas_bloque > 0:
                por_etiqueta["_"].append(int(horas_bloque))
        for etiqueta, duraciones in por_etiqueta.items():
            patron[(modalidad, etiqueta)] = tuple(duraciones)
    return patron


def _registrar_plantillas(ctx: Contexto) -> None:
    """Construye el catálogo canónico de cada línea modular de la corrida."""
    ctx.plantillas.clear()
    referencias: dict[str, Oferta] = {}
    for oferta in ctx.ofertas:
        if oferta.plantilla_id and oferta.modulo_orden == 0:
            referencias[oferta.plantilla_id] = oferta
    for linea, referencia in sorted(referencias.items()):
        ctx.plantillas[linea] = PlantillaModular(
            id=linea,
            referencia=referencia,
            slots=_patron_semanal(referencia),
        )


def max_horas_para_ventana(disponible_min: int) -> int:
    """Máximo de horas académicas que caben en una ventana real.

    Considera bloques de hasta 3 h académicas y el receso de 15 min entre
    bloques. El receso posterior al último bloque no se descuenta porque puede
    quedar fuera de la ventana de disponibilidad.
    """
    mejor = 0
    horas = 1
    while horas <= 24:
        bloques = (horas + MAX_SESSION_ACAD_HOURS - 1) // MAX_SESSION_ACAD_HOURS
        necesario = horas * ACADEMIC_HOUR_MIN + (bloques - 1) * BREAK_MIN
        if necesario > disponible_min:
            break
        mejor = horas
        horas += 1
    return mejor


def _tiene_disponibilidad(docente) -> bool:
    """True si hay una restricción activa con franjas registradas."""
    return bool(
        docente
        and docente.usa_restriccion
        and any(docente.disponibilidad.values())
    )


def _franjas_docente_dia(
    ctx: Contexto, docente, dia: int
) -> list[tuple[int, int]]:
    """Franjas de disponibilidad del docente, recortadas a la franja activa."""
    if not _tiene_disponibilidad(docente):
        return []
    resultado: list[tuple[int, int]] = []
    for inicio, fin in docente.disponibilidad.get(dia, ()):
        inicio = max(int(inicio), ctx.franja.inicio_min)
        fin = min(int(fin), ctx.franja.cierre_min)
        if fin > inicio:
            resultado.append((inicio, fin))
    return resultado


def ventanas_docente_dia(
    ctx: Contexto, oferta: Oferta, docente, dia: int
) -> list[tuple[int, int]]:
    """Ventanas disponibles del docente, limitadas por la banda de la cohorte."""
    bandas = bandas_cohorte(ctx, oferta)
    if docente is None or not docente.usa_restriccion:
        return list(bandas)
    if not _tiene_disponibilidad(docente):
        return list(bandas)

    # La disponibilidad dura y la banda oficial deben cumplirse a la vez. La
    # intersección evita que el preflight de capacidad cuente horas de una
    # franja que el modelo nunca podrá usar por estar fuera del turno.
    resultado: list[tuple[int, int]] = []
    for inicio_franja, fin_franja in _franjas_docente_dia(ctx, docente, dia):
        for inicio_banda, fin_banda in bandas:
            inicio = max(inicio_franja, inicio_banda)
            fin = min(fin_franja, fin_banda)
            if fin > inicio:
                resultado.append((inicio, fin))
    return resultado


def construir_actividades(
    ctx: Contexto,
    *,
    permitir_generico: bool = False,
    permitir_docente_inactivo: bool = False,
    permitir_compresion_modular: bool = False,
) -> list[Actividad]:
    """Genera todas las actividades semanales que el solver debe ubicar."""
    asignar_ventanas(ctx, permitir_compresion=permitir_compresion_modular)
    _registrar_plantillas(ctx)
    actividades: list[Actividad] = []
    uid = 0

    for oferta in ctx.ofertas:
        curso = oferta.curso
        # TEC, TAL y VIR de una misma oferta comparten la ventana asignada a la
        # oferta. En un curso de carrera modular esa ventana es el bloque de
        # semanas de su TEC, así que su TAL se dicta junto al TEC (en las mismas
        # semanas del módulo), no en otro bloque ni repartido por todo el
        # periodo. Las horas semanales de cada modalidad se calculan de forma
        # independiente dentro de esa ventana.
        largo_ventana = max(0, oferta.ventana_fin - oferta.ventana_inicio)
        if largo_ventana <= 0:
            log.warning("Oferta %s sin ventana de semanas; se omite.", oferta.id_programacion)
            continue

        componentes = _componentes(oferta)
        if not componentes:
            log.warning("Oferta %s sin horas programables; se omite.", oferta.id_programacion)
            continue

        for modalidad, total_horas, docente_declarado in componentes:
            # VIR y EMP no consumen docente institucional (regla 1.2).
            docente_id = None if modalidad in {"VIR", "EMP"} else docente_declarado
            docente = None
            if docente_id is not None:
                docente = ctx.docentes.get(docente_id)
                if docente is None:
                    log.warning(
                        "Docente %s no existe; %s quedará sin docente.",
                        docente_id, curso.mat_cur,
                    )
                    docente_id = None
                elif docente.estado.upper() != "A":
                    if not permitir_docente_inactivo:
                        raise ErrorDatos(
                            f"El docente {docente_id} ({docente.nombre}) está inactivo y "
                            f"tiene asignado {curso.mat_cur}. Corrija la oferta o use "
                            f"--permitir-docente-inactivo."
                        )
                    log.warning(
                        "Docente %s inactivo asignado a %s; se mantiene por solicitud.",
                        docente_id, curso.mat_cur,
                    )

            ambientes = _ambientes_para(ctx, oferta, modalidad, permitir_generico)
            horas_semanales = distribuir_semanas(total_horas, largo_ventana)
            grupos = agrupar_semanas(horas_semanales)

            for inicio_rel, fin_rel, horas_semana in grupos:
                if modalidad == "EMP":
                    trozos = _dividir_emp(horas_semana)
                else:
                    trozos = _dividir_bloques(horas_semana)

                # No se etiquetan bloques por día: la disponibilidad es una
                # referencia flexible y CP-SAT decide la ubicación real. Los
                # slots de plantilla sólo identifican el bloque dentro de la
                # rutina semanal, no un día fijo.
                contadores: dict[str, int] = defaultdict(int)
                for horas_bloque in trozos:
                    if horas_bloque <= 0:
                        continue
                    uid += 1
                    semana_inicio = oferta.ventana_inicio + inicio_rel
                    semana_fin = oferta.ventana_inicio + fin_rel

                    plantilla_slot = None
                    if oferta.plantilla_id and modalidad in {"TEC", "TAL"}:
                        indice_slot = contadores["_"]
                        contadores["_"] += 1
                        plantilla_slot = f"{modalidad}:_:{indice_slot}"

                    actividades.append(
                        Actividad(
                            uid=uid,
                            oferta=oferta,
                            modalidad=modalidad,
                            semana_inicio=semana_inicio,
                            semana_fin=semana_fin,
                            horas_academicas=int(horas_bloque),
                            duracion_min=int(horas_bloque) * ACADEMIC_HOUR_MIN,
                            docente_id=docente_id,
                            ambientes=ambientes,
                            plantilla_id=(
                                oferta.plantilla_id if plantilla_slot else None
                            ),
                            plantilla_slot=plantilla_slot,
                        )
                    )

    if not actividades:
        raise ErrorDatos("La oferta activa no produjo actividades programables.")
    _validar_emp(actividades)
    log.info("Actividades semanales construidas: %d", len(actividades))
    return actividades


def _validar_emp(actividades: list[Actividad]) -> None:
    for actividad in actividades:
        if actividad.modalidad != "EMP":
            continue
        if actividad.duracion_min > (EMP_END_MIN - EMP_START_MIN):
            raise ErrorDatos(
                f"El bloque EMP {actividad.descripcion} dura {actividad.duracion_min} min "
                f"y excede la ventana 08:00-14:00 ({EMP_END_MIN - EMP_START_MIN} min)."
            )


def _semana_no_utilizable(ctx: Contexto, actividad: Actividad, semana: int, dia: int) -> bool:
    """True si la fecha de esa semana/día es feriado o cae fuera del periodo."""
    calendario = ctx.calendario
    return calendario.es_feriado(semana, dia) or calendario.fuera_de_periodo(semana, dia)


def _dia_con_al_menos_una_semana(ctx: Contexto, actividad: Actividad, dia: int) -> bool:
    """Evita elegir un día en el que todas las semanas del bloque son feriado.

    Sin este filtro el solver podría ubicar un bloque en un día que nunca se
    dicta; la persistencia lo omitiría y el curso perdería esas horas.
    """
    if not ctx.calendario.disponible:
        return True
    return any(
        not _semana_no_utilizable(ctx, actividad, semana, dia)
        for semana in range(actividad.semana_inicio, actividad.semana_fin)
    )


def _texto_disponibilidad(ctx: Contexto, docente) -> str:
    if docente is None:
        return "sin docente asignado"
    if not docente.usa_restriccion:
        return "sin restricción horaria"
    if not docente.disponibilidad:
        return "restricción activa sin franjas registradas"
    partes = []
    for dia in ctx.dias:
        franjas = docente.disponibilidad.get(dia, ())
        if not franjas:
            continue
        rangos = ", ".join(
            f"{inicio // 60:02d}:{inicio % 60:02d}-{fin // 60:02d}:{fin % 60:02d}"
            for inicio, fin in franjas
        )
        partes.append(f"{dia_db(dia)} {rangos}")
    return "; ".join(partes) or "sin franjas en los días habilitados"


def generar_pares_permitidos(ctx: Contexto, actividad: Actividad) -> list[tuple[int, int]]:
    """Pares (día, minuto_inicio) que cumplen turno y restricciones de calendario.

    Se unen los pares de todas las bandas permitidas. El orden de
    ``bandas_cohorte`` expresa la preferencia: la función objetivo penaliza las
    bandas no preferidas. Si el docente tiene una restricción horaria activa con
    franjas registradas, el dominio se reduce además a las ubicaciones donde la
    clase completa cabe dentro de una de sus franjas. La disponibilidad es una
    restricción dura: no se genera ningún par fuera de ella.
    """
    oferta = actividad.oferta
    duracion = actividad.duracion_min

    if actividad.modalidad == "EMP":
        inicio = max(EMP_START_MIN, ctx.franja.inicio_min)
        fin = min(EMP_END_MIN, ctx.franja.cierre_min)
        if inicio + duracion > fin:
            raise ErrorDatos(
                f"El bloque EMP {actividad.descripcion} no cabe en la ventana "
                f"{inicio // 60:02d}:{inicio % 60:02d}-{fin // 60:02d}:{fin % 60:02d}."
            )
        pares_emp = [
            (dia, alinear_grilla(inicio))
            for dia in ctx.dias
            if _dia_con_al_menos_una_semana(ctx, actividad, dia)
        ]
        if not pares_emp:
            raise ErrorDatos(
                f"No existe día/hora válido para {actividad.descripcion}: "
                "todas las fechas posibles son feriado o caen fuera del periodo."
            )
        return pares_emp

    docente = ctx.docentes.get(actividad.docente_id) if actividad.docente_id else None
    bandas = (
        bandas_virtuales(ctx, oferta)
        if actividad.modalidad == "VIR"
        else bandas_cohorte(ctx, oferta)
    )

    def inicios_en_ventana(
        dia: int, inicio_v: int, fin_v: int
    ) -> set[tuple[int, int]]:
        encontrados: set[tuple[int, int]] = set()
        primer_inicio = alinear_grilla(inicio_v)
        ultimo_inicio = fin_v - duracion
        if ultimo_inicio < primer_inicio:
            return encontrados
        inicio = primer_inicio
        while inicio <= ultimo_inicio:
            encontrados.add((dia, inicio))
            inicio += GRID_MIN
        return encontrados

    pares: set[tuple[int, int]] = set()
    union = (
        (min(inicio for inicio, _ in bandas), max(fin for _, fin in bandas))
        if len(bandas) > 1 else None
    )
    for dia in ctx.dias:
        if not _dia_con_al_menos_una_semana(ctx, actividad, dia):
            continue
        pares_dia: set[tuple[int, int]] = set()
        for banda in bandas:
            inicio_v, fin_v = banda
            pares_dia.update(inicios_en_ventana(dia, inicio_v, fin_v))
        pares.update(pares_dia)

        # Diagnóstico exploratorio: probar la unión continua de bandas para
        # permitir bloques que cruzan 12:45 o 18:00.
        if ctx.permitir_banda_alterna and union is not None and not pares_dia:
            inicio_v, fin_v = union
            pares.update(inicios_en_ventana(dia, inicio_v, fin_v))

    if not pares:
        nombre_docente = docente.nombre if docente else "sin docente"
        raise ErrorDatos(
            f"No existe día/hora válido para {actividad.descripcion} "
            f"({nombre_docente}). Duración {duracion} min; bandas evaluadas: "
            f"{describir_bandas(ctx, oferta)}; disponibilidad: "
            f"{_texto_disponibilidad(ctx, docente)}. Revise turno, franja y "
            "disponibilidad_docentes."
        )

    # La disponibilidad docente es una restricción dura: si el docente tiene
    # una restricción activa con franjas, la clase completa debe caber dentro
    # de una de ellas. El receso posterior puede quedar fuera de la franja;
    # solo se valida la duración real de la clase.
    if _tiene_disponibilidad(docente):
        pares_disponibles = {
            (dia, inicio)
            for dia, inicio in pares
            if any(
                inicio >= inicio_franja
                and inicio + duracion <= fin_franja
                for inicio_franja, fin_franja in _franjas_docente_dia(
                    ctx, docente, dia
                )
            )
        }
        if not pares_disponibles:
            raise ErrorDatos(
                f"No hay intersección entre la banda oficial y la "
                f"disponibilidad de {docente.nombre} para "
                f"{actividad.descripcion}. Duración {duracion} min; bandas "
                f"evaluadas: {describir_bandas(ctx, oferta)}; disponibilidad "
                f"activa: {_texto_disponibilidad(ctx, docente)}. Ajuste la "
                "disponibilidad del docente, reasigne el curso o revise el "
                "turno. La disponibilidad docente no se relaja automáticamente."
            )
        pares = pares_disponibles

    return sorted(pares)


def resumen_pares(ctx: Contexto, actividades: list[Actividad]) -> dict[str, int]:
    """Diagnóstico rápido de actividades sin ventana viable."""
    resultado = defaultdict(int)
    for actividad in actividades:
        try:
            pares = generar_pares_permitidos(ctx, actividad)
        except ErrorDatos:
            resultado["sin_ventana"] += 1
        else:
            resultado["ok"] += 1
            resultado["pares_totales"] += len(pares)
    return dict(resultado)
