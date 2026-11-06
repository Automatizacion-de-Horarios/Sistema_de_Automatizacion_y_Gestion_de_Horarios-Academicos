"""Diagnósticos previos al solver sobre la consistencia de la carga académica."""

from __future__ import annotations

import logging
from collections import defaultdict

from .config import (
    ACADEMIC_HOUR_MIN,
    MARGEN_RECUPERACION,
    SEMANAS_LECTIVAS,
    Actividad,
    ErrorDatos,
    Infactible,
    sin_acentos,
)
from .planificacion import Contexto

log = logging.getLogger(__name__)


def verificar_asignaciones_docente(ctx: Contexto) -> None:
    """Exige docente solo para modalidades presenciales TEC/TAL institucionales."""
    faltantes: list[str] = []
    for oferta in ctx.ofertas:
        curso = oferta.curso
        if curso.es_practica_empresa:
            continue
        if curso.horas_tec > 0 and oferta.id_docente_tec is None:
            faltantes.append(
                f"{curso.mat_cur} ({curso.nombre}) prog={oferta.id_programacion}: TEC"
            )
        if curso.horas_tal > 0 and oferta.id_docente_tal is None:
            faltantes.append(
                f"{curso.mat_cur} ({curso.nombre}) prog={oferta.id_programacion}: TAL"
            )

    if faltantes:
        detalle = "\n".join(f"  - {fila}" for fila in faltantes[:50])
        restantes = len(faltantes) - 50
        if restantes > 0:
            detalle += f"\n  - y {restantes} asignación(es) adicional(es)"
        raise ErrorDatos(
            "Faltan asignaciones obligatorias de docentes para modalidades "
            "presenciales institucionales:\n"
            f"{detalle}\n"
            "Asigne id_docente_tec para cursos con horas_teoria y "
            "id_docente_tal para cursos con horas_taller, excepto EMP."
        )


def cargas_docentes(
    ctx: Contexto, actividades: list[Actividad]
) -> tuple[dict[tuple[int, int], int], dict[int, int]]:
    """Devuelve (carga por docente/semana, tope semanal) en minutos reales.

    El contrato y la disponibilidad se manejan en horas reloj, mientras que
    cada actividad tiene una duración real en minutos. Por eso la carga se
    acumula con ``duracion_min`` y el tope se convierte a minutos.
    """
    cargas: dict[tuple[int, int], int] = defaultdict(int)
    for actividad in actividades:
        if actividad.docente_id is None:
            continue
        for semana in range(actividad.semana_inicio, actividad.semana_fin):
            cargas[(actividad.docente_id, semana)] += actividad.duracion_min
    topes = {d.id_docente: d.tope_semanal_min for d in ctx.docentes.values()}
    return dict(cargas), topes


def diagnosticar_y_validar(
    ctx: Contexto,
    actividades: list[Actividad],
    *,
    relajar_topes: bool,
) -> None:
    """Reporta sobrecargas estructurales y aborta en modo estricto.

    La carga semanal es independiente de la ubicación día/hora: si la suma de
    minutos reales asignados a un docente en una semana supera su tope
    contractual (también en minutos), no existe solución posible con esa
    oferta. Por eso se valida antes de CP-SAT.
    """
    cargas, topes = cargas_docentes(ctx, actividades)
    sobrecargas: dict[int, list[tuple[int, int, int]]] = defaultdict(list)
    for (docente_id, semana), carga in cargas.items():
        tope = topes.get(docente_id)
        if tope is None:
            continue
        if carga > tope:
            sobrecargas[docente_id].append((semana, carga, tope))

    if sobrecargas:
        filas = []
        for docente_id, registros in sorted(
            sobrecargas.items(),
            key=lambda item: -max(r[1] for r in item[1]),
        )[:12]:
            docente = ctx.docentes.get(docente_id)
            nombre = docente.nombre if docente else f"Docente {docente_id}"
            pico = max(r[1] for r in registros)
            tope = registros[0][2]
            filas.append(
                f"  - {docente_id} {nombre}: pico {pico / 60:g} h reloj/semana "
                f"(tope {tope / 60:g} h reloj), "
                f"{len(registros)} semana(s) excedida(s)"
            )
        mensaje = (
            "La oferta académica asigna más carga semanal que el tope contractual "
            "de estos docentes:\n" + "\n".join(filas)
        )
        if not relajar_topes:
            raise ErrorDatos(
                mensaje
                + "\nCorrija la asignación docente o ejecute con --relajar-topes "
                  "para obtener un borrador exploratorio penalizando el exceso."
            )
        log.warning(mensaje)
        log.warning("Modo --relajar-topes activo: el exceso se penalizará en la función objetivo.")

    # Capacidad semanal del grupo de estudiantes. Solo se usa como alarma:
    # el modelo CP-SAT aplicará los topes diarios y la no superposición.
    cargas_cohorte: dict[tuple, int] = defaultdict(int)
    for actividad in actividades:
        for semana in range(actividad.semana_inicio, actividad.semana_fin):
            cargas_cohorte[(actividad.oferta.cohorte, semana)] += actividad.horas_academicas
    if cargas_cohorte:
        peor = max(cargas_cohorte.items(), key=lambda item: item[1])
        log.info(
            "Mayor carga semanal de un grupo: %.1f h académicas (%s, semana %d).",
            peor[1], peor[0][0], peor[0][1] + 1,
        )

    log.info(
        "Carga docente: %d pares docente/semana, %d docentes con tope.",
        len(cargas), len(topes),
    )


def _capacidad_ventanas(ventanas: list[tuple[int, int]]) -> int:
    """Horas académicas que caben en una lista de ventanas de un mismo día.

    Une primero las ventanas solapadas o contiguas para no contar dos veces el
    mismo tramo. El resultado es una cota superior: la distribución real de
    bloques puede ser menor, pero nunca mayor.
    """
    from .actividades import max_horas_para_ventana

    if not ventanas:
        return 0
    ordenadas = sorted((int(i), int(f)) for i, f in ventanas if f > i)
    unidas: list[list[int]] = []
    for inicio, fin in ordenadas:
        if unidas and inicio <= unidas[-1][1]:
            unidas[-1][1] = max(unidas[-1][1], fin)
        else:
            unidas.append([inicio, fin])
    return sum(max_horas_para_ventana(fin - inicio) for inicio, fin in unidas)


def _docente_es_tiempo_parcial(docente) -> bool:
    contrato = sin_acentos(docente.tipo_contrato)
    return "PARCIAL" in contrato or "MEDIO" in contrato


def verificar_capacidad_docente(
    ctx: Contexto, actividades: list[Actividad], *, relajar_topes: bool = False
) -> None:
    """Bloquea la corrida si la carga no cabe en la disponibilidad docente.

    La estimación usa las franjas activas del docente y el máximo de horas
    académicas que caben en ellas. Es una cota superior: si la carga supera esta
    capacidad, el modelo es necesariamente infactible. Cuando la estimación
    alcanza, el solver puede seguir siendo infactible por otras reglas; en ese
    caso el diagnóstico de CP-SAT orienta la revisión.
    """
    from .actividades import ventanas_docente_dia
    from .config import MAX_TEACHER_DAILY_ACAD_HOURS

    # En modo estricto el modelo también limita la jornada a 8 h académicas.
    # Con --relajar-topes ese tope se relaja, así que aquí solo debe limitar la
    # disponibilidad real; de lo contrario se abortaría una corrida exploratoria
    # que el modelo sí podría resolver.
    tope_dia = 24 if relajar_topes else MAX_TEACHER_DAILY_ACAD_HOURS

    cargas: dict[tuple[int, int], int] = defaultdict(int)
    activas: dict[tuple[int, int], list[Actividad]] = defaultdict(list)
    for actividad in actividades:
        if actividad.docente_id is None:
            continue
        if actividad.docente_id not in ctx.docentes:
            continue
        for semana in range(actividad.semana_inicio, actividad.semana_fin):
            clave = (actividad.docente_id, semana)
            cargas[clave] += actividad.duracion_min
            activas[clave].append(actividad)

    excesos: list[tuple[int, int, int, int, int]] = []
    for (docente_id, semana), total in cargas.items():
        docente = ctx.docentes[docente_id]
        capacidad_min = 0
        ventanas_por_dia: dict[int, list[tuple[int, int]]] = defaultdict(list)
        for actividad in activas[(docente_id, semana)]:
            for dia in ctx.dias:
                ventanas_por_dia[dia].extend(
                    ventanas_docente_dia(ctx, actividad.oferta, docente, dia)
                )
        for dia in ctx.dias:
            # _capacidad_ventanas devuelve horas académicas; se convierten a
            # minutos reales para comparar con la carga de las actividades.
            capacidad_min += (
                min(tope_dia, _capacidad_ventanas(ventanas_por_dia.get(dia, [])))
                * ACADEMIC_HOUR_MIN
            )
        if total > capacidad_min:
            excesos.append(
                (total - capacidad_min, total, capacidad_min, docente_id, semana)
            )

    if not excesos:
        return

    # Se resume el peor caso por docente para no repetir la misma persona una
    # vez por semana y dejar ver a todos los afectados. Los docentes de tiempo
    # parcial se muestran primero porque su disponibilidad suele ser más
    # ajustada y conviene resolverlos antes.
    peores: dict[int, tuple[int, int, int, int]] = {}
    semanas_excedidas: dict[int, int] = defaultdict(int)
    for exceso, total, capacidad, docente_id, semana in excesos:
        semanas_excedidas[docente_id] += 1
        actual = peores.get(docente_id)
        if actual is None or (exceso, total) > (actual[0], actual[1]):
            peores[docente_id] = (exceso, total, capacidad, semana)

    filas = []
    ordenados = sorted(
        peores.items(),
        key=lambda item: (
            0 if _docente_es_tiempo_parcial(ctx.docentes[item[0]]) else 1,
            -item[1][0],
            item[0],
        ),
    )[:12]
    for docente_id, (_, total, capacidad, semana) in ordenados:
        docente = ctx.docentes[docente_id]
        contrato = (
            "tiempo parcial"
            if _docente_es_tiempo_parcial(docente)
            else "tiempo completo"
        )
        filas.append(
            f"  - {docente_id} {docente.nombre} ({contrato}): hasta "
            f"{total / 60:g} h reloj en la semana {semana + 1}, pero su "
            f"disponibilidad y turno admiten como máximo "
            f"{capacidad / 60:g} h reloj "
            f"({semanas_excedidas[docente_id]} semana(s) excedida(s))."
        )
    detalle = "\n".join(filas)
    extra = (
        f"\n  ... y {len(peores) - len(ordenados)} docente(s) más."
        if len(peores) > len(ordenados)
        else ""
    )
    raise ErrorDatos(
        "La carga docente no cabe en la disponibilidad activa:\n"
        + detalle
        + extra
        + "\nLa disponibilidad es una restricción dura. Ajuste las franjas del "
          "docente o reasigne la carga; --relajar-topes no relaja la "
          "disponibilidad."
    )


def verificar_actividades_sin_ventana(ctx: Contexto, actividades: list[Actividad]) -> None:
    """Fuerza un error temprano y legible si alguna actividad no tiene grilla."""
    from .actividades import generar_pares_permitidos

    errores: dict[str, int] = defaultdict(int)
    for actividad in actividades:
        try:
            generar_pares_permitidos(ctx, actividad)
        except ErrorDatos as exc:
            errores[str(exc)] += 1
    if errores:
        ordenados = sorted(errores.items(), key=lambda item: -item[1])
        lineas = []
        for mensaje, cantidad in ordenados[:15]:
            repetido = f" [x{cantidad}]" if cantidad > 1 else ""
            lineas.append(f"  - {mensaje}{repetido}")
        extra = (
            f"\n  ... y {len(ordenados) - 15} diagnósticos distintos más."
            if len(ordenados) > 15 else ""
        )
        raise Infactible(
            "Estas actividades no tienen ningún día/hora compatible con turno, "
            "franja, feriados y disponibilidad:\n"
            + "\n".join(lineas)
            + extra
            + "\nSi los datos maestros son correctos, use --permitir-banda-alterna "
              "solo para un diagnóstico exploratorio (no respeta la banda oficial "
              "del turno)."
        )


def verificar_margen_lectivo(ctx: Contexto, actividades: list[Actividad]) -> None:
    """Comprueba que ninguna actividad invade las semanas de recuperación."""
    limite = min(SEMANAS_LECTIVAS, max(1, int(ctx.periodo.semanas)))
    errores = []
    for actividad in actividades:
        if actividad.semana_inicio >= limite or actividad.semana_fin > limite:
            errores.append(
                f"{actividad.descripcion}: la ventana termina en la semana "
                f"{actividad.semana_fin}, pero el límite lectivo es {limite}."
            )
    if errores:
        raise ErrorDatos(
            "Hay actividades regulares dentro del margen de recuperación "
            f"(semanas {limite + 1}-{limite + MARGEN_RECUPERACION}):\n  - "
            + "\n  - ".join(errores[:20])
            + "\nCorrija las semanas del curso o la ventana modular."
        )

    if ctx.periodo.semanas < SEMANAS_LECTIVAS + MARGEN_RECUPERACION:
        log.warning(
            "El periodo %s tiene %d semanas; el margen de recuperación completo "
            "de %d semanas no está disponible.",
            ctx.periodo.codigo,
            ctx.periodo.semanas,
            MARGEN_RECUPERACION,
        )


def _slots_esperados(plantilla) -> dict[str, int]:
    """Convierte el catálogo de la plantilla a slot -> duración esperada."""
    esperados: dict[str, int] = {}
    for (modalidad, etiqueta), duraciones in plantilla.slots.items():
        for indice, horas in enumerate(duraciones):
            esperados[f"{modalidad}:{etiqueta}:{indice}"] = (
                int(horas) * ACADEMIC_HOUR_MIN
            )
    return esperados


def verificar_plantilla_modular(ctx: Contexto, actividades: list[Actividad]) -> None:
    """Valida que todos los módulos puedan clonar la plantilla TEC/TAL.

    Se distinguen dos tipos de problema:

    - Patrón curricular incompatible (slot faltante, extra o con otra
      duración): se reporta como ``ErrorDatos``.
    - Los slots existen, pero no hay un día/hora de inicio común para todos
      los módulos: se reporta como ``Infactible`` con el detalle de docente y
      disponibilidad. Esto evita llegar a un INFEASIBLE genérico de CP-SAT.
    """
    from .actividades import generar_pares_permitidos

    if not ctx.plantillas:
        return

    por_linea: dict[str, list[Actividad]] = defaultdict(list)
    for actividad in actividades:
        if actividad.plantilla_id and actividad.plantilla_slot:
            por_linea[actividad.plantilla_id].append(actividad)

    errores_patron: list[str] = []
    errores_comunes: list[str] = []

    for linea, plantilla in sorted(ctx.plantillas.items()):
        actuales = por_linea.get(linea, [])
        if not actuales:
            continue

        slots: dict[str, list[Actividad]] = defaultdict(list)
        for actividad in actuales:
            slots[actividad.plantilla_slot].append(actividad)

        esperados = _slots_esperados(plantilla)
        referencia = plantilla.referencia
        modulos = sorted({a.oferta.curso.mat_cur for a in actuales})

        # La comparación es por módulo, no sólo por línea: que el slot exista
        # en el módulo de referencia no significa que el sucesor lo tenga.
        por_modulo: dict[int, list[Actividad]] = defaultdict(list)
        for actividad in actuales:
            por_modulo[actividad.oferta.id_programacion].append(actividad)

        for grupo_modulo in sorted(
            por_modulo.values(), key=lambda grupo: grupo[0].oferta.modulo_orden
        ):
            modulo = grupo_modulo[0].oferta.curso.mat_cur
            slots_modulo = {
                actividad.plantilla_slot for actividad in grupo_modulo
            }
            for slot, duracion in sorted(esperados.items()):
                if slot not in slots_modulo:
                    errores_patron.append(
                        f"{linea}: el módulo {modulo} no tiene el slot {slot}; "
                        f"el módulo de referencia {referencia.curso.mat_cur} "
                        f"lo requiere con {duracion} min."
                    )
                    continue
                duraciones = sorted({
                    actividad.duracion_min
                    for actividad in grupo_modulo
                    if actividad.plantilla_slot == slot
                })
                if duraciones != [duracion]:
                    errores_patron.append(
                        f"{linea}: el módulo {modulo} tiene el slot {slot} con "
                        f"{duraciones} min, pero el módulo de referencia "
                        f"{referencia.curso.mat_cur} exige {duracion} min."
                    )

            for slot in sorted(slots_modulo):
                if slot in esperados:
                    continue
                errores_patron.append(
                    f"{linea}: el módulo {modulo} tiene el slot {slot}, que no "
                    f"existe en el módulo de referencia "
                    f"{referencia.curso.mat_cur}."
                )

        # Intersección real de pares (día, inicio) de todos los módulos. Si es
        # vacía, no existe plantilla físicamente posible para esta línea.
        for slot, grupo in sorted(slots.items()):
            if len(grupo) <= 1:
                continue
            comunes: set[tuple[int, int]] | None = None
            try:
                for actividad in grupo:
                    pares = set(generar_pares_permitidos(ctx, actividad))
                    comunes = pares if comunes is None else comunes & pares
            except ErrorDatos:
                # `verificar_actividades_sin_ventana` ya ofrece el diagnóstico
                # detallado de la actividad sin grilla.
                continue
            if comunes:
                continue
            docente = ctx.docentes.get(grupo[0].docente_id)
            nombre = docente.nombre if docente else "sin docente"
            errores_comunes.append(
                f"{linea}: el slot {slot} de "
                f"{', '.join(sorted({a.oferta.curso.mat_cur for a in grupo}))} "
                f"no tiene ningún día/hora de inicio común para {nombre}. "
                "La rutina semanal no puede clonarse entre módulos."
            )

    if errores_patron:
        extra = (
            f"\n  ... y {len(errores_patron) - 20} más."
            if len(errores_patron) > 20
            else ""
        )
        raise ErrorDatos(
            "La plantilla modular rígida no es consistente entre módulos:\n  - "
            + "\n  - ".join(errores_patron[:20])
            + extra
            + "\nRevise las horas TEC/TAL de los módulos de la cohorte o la "
              "duración de sus bloques."
        )

    if errores_comunes:
        extra = (
            f"\n  ... y {len(errores_comunes) - 20} más."
            if len(errores_comunes) > 20
            else ""
        )
        raise Infactible(
            "La plantilla modular rígida no puede ubicarse en un día/hora común:\n  - "
            + "\n  - ".join(errores_comunes[:20])
            + extra
            + "\nAmplíe la disponibilidad de los docentes o revise los turnos "
              "de la cohorte."
        )
