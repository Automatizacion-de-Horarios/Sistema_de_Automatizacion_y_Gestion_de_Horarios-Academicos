"""Construcción del contexto académico y asignación de ventanas semanales."""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date

from .config import (
    ACADEMIC_HOUR_MIN,
    AFTERNOON_START_MIN,
    EMP_END_MIN,
    EMP_START_MIN,
    MORNING_START_MIN,
    MORNING_END_MIN,
    MAX_SESSION_ACAD_HOURS,
    NIGHT_START_MIN,
    MARGEN_RECUPERACION,
    SEMANAS_CURSO_PARALELO,
    SEMANAS_LECTIVAS,
    TURNO_2_NIGHT_END_MIN,
    Ambiente,
    Calendario,
    Docente,
    ErrorDatos,
    FranjaInstitucional,
    Oferta,
    Periodo,
    distribuir_entero,
    distribuir_semanas,
    clave_natural_codigo,
    sin_acentos,
)
from .db import Repositorio

log = logging.getLogger(__name__)


@dataclass
class PlantillaModular:
    """Catálogo canónico de slots TEC/TAL de una línea modular.

    ``slots`` relaciona (modalidad, etiqueta_día) con la secuencia de
    duraciones semanales del módulo de referencia. El día y la hora concretos
    no viven aquí: los decide CP-SAT una sola vez y se clonan entre módulos.
    """

    id: str
    referencia: Oferta
    slots: dict[tuple[str, str], tuple[int, ...]] = field(default_factory=dict)


@dataclass
class Contexto:
    periodo: Periodo
    franja: FranjaInstitucional
    ofertas: list[Oferta]
    docentes: dict[int, Docente]
    ambientes: dict[int, Ambiente]
    compatibilidad: dict[int, tuple[int, ...]]
    turnos: dict[int, int]
    dias: tuple[int, ...]
    calendario: Calendario
    turnos_por_cohorte: dict[tuple, set[int]] = field(default_factory=dict)
    ambientes_por_sede: dict[int, tuple[int, ...]] = field(default_factory=dict)
    # Catálogo de plantillas modulares, construido por `construir_actividades`.
    plantillas: dict[str, PlantillaModular] = field(default_factory=dict)
    # Solo para diagnósticos: si no hay ventana en la banda oficial, permite
    # probar las demás bandas del día. Nunca se activa por defecto.
    permitir_banda_alterna: bool = False


def _dias_habilitados(franja: FranjaInstitucional) -> tuple[int, ...]:
    # 0=LUNES ... 5=SÁBADO, 6=DOMINGO
    return tuple(range(7)) if franja.incluir_domingo else tuple(range(6))


def _exigir_fechas_para_feriados(
    periodo: Periodo, calendario: Calendario, feriados: list[date]
) -> None:
    if feriados and not calendario.disponible:
        raise ErrorDatos(
            f"El periodo {periodo.codigo} tiene {len(feriados)} feriados activos "
            "pero no tiene fecha de inicio. No es posible garantizar la "
            "exclusión absoluta de clases en esos días; indique --fecha-inicio."
        )


def _filtrar_ofertas(
    ofertas: list[Oferta],
    *,
    carreras: set[str] | None = None,
    semestres: set[int] | None = None,
    turnos: set[int] | None = None,
    sedes: set[int] | None = None,
) -> list[Oferta]:
    """Aplica filtros de ejecución sin alterar los datos maestros."""
    resultado = []
    for oferta in ofertas:
        if carreras and sin_acentos(oferta.curso.codigo_carrera) not in carreras:
            continue
        if semestres and oferta.curso.semestre_num not in semestres:
            continue
        if turnos and oferta.id_turno not in turnos:
            continue
        if sedes and oferta.id_sede not in sedes:
            continue
        resultado.append(oferta)
    return resultado


def construir_contexto(
    repo: Repositorio,
    periodo: Periodo,
    franja: FranjaInstitucional,
    compatibilidad: dict[int, tuple[int, ...]],
    feriados: list,
    fecha_inicio,
    *,
    carreras: set[str] | None = None,
    semestres: set[int] | None = None,
    turnos: set[int] | None = None,
    sedes: set[int] | None = None,
    permitir_banda_alterna: bool = False,
) -> Contexto:
    todas_las_ofertas = repo.obtener_ofertas(
        periodo.id_periodo, semestres=semestres
    )

    # Los turnos de una cohorte se calculan sobre la oferta completa, antes de
    # aplicar filtros. Si se ejecuta solo el turno 2 de un segundo semestre, la
    # cohorte sigue teniendo dos turnos y no debe forzarse a la mañana.
    turnos_por_cohorte: dict[tuple, set[int]] = defaultdict(set)
    for oferta in todas_las_ofertas:
        turnos_por_cohorte[oferta.cohorte_turnos].add(oferta.id_turno)

    ofertas = _filtrar_ofertas(
        todas_las_ofertas,
        carreras={sin_acentos(c) for c in carreras} if carreras else None,
        semestres=semestres,
        turnos=turnos,
        sedes=sedes,
    )
    if not ofertas:
        raise ErrorDatos(
            "Los filtros --carreras/--semestres/--turnos/--sedes no dejaron "
            "ninguna oferta académica activa."
        )
    docentes = repo.obtener_docentes()
    ambientes_lista = repo.obtener_ambientes()
    turnos_db = repo.obtener_turnos()

    # Solo se consideran ambientes operativos. El estado se lee de la BD.
    ambientes: dict[int, Ambiente] = {}
    for ambiente in ambientes_lista:
        estado = ambiente.estado.upper().strip()
        if estado in {"DISPONIBLE", "ACTIVO", "OPERATIVO"}:
            ambientes[ambiente.id_ambiente] = ambiente
        else:
            log.warning("Ambiente %s omitido por estado %r.", ambiente.codigo, ambiente.estado)

    ambientes_por_sede: dict[int, list[int]] = defaultdict(list)
    for ambiente in ambientes.values():
        ambientes_por_sede[ambiente.id_sede].append(ambiente.id_ambiente)

    # La tabla de feriados se consulta siempre. Si el periodo no tiene fechas,
    # el calendario queda sin mapeo y se advierte; no se inventan fechas.
    if fecha_inicio is not None:
        inicio = fecha_inicio
    else:
        inicio = periodo.fecha_inicio
    fin = periodo.fecha_fin
    if inicio is not None and fin is None:
        from datetime import timedelta
        fin = inicio + timedelta(weeks=periodo.semanas) - timedelta(days=1)
    calendario = Calendario(
        inicio=inicio,
        fin=fin,
        semanas=periodo.semanas,
        feriados=frozenset(feriados),
    )
    _exigir_fechas_para_feriados(periodo, calendario, feriados)

    ctx = Contexto(
        periodo=periodo,
        franja=franja,
        ofertas=ofertas,
        docentes=docentes,
        ambientes=ambientes,
        compatibilidad=compatibilidad,
        turnos=turnos_db,
        dias=_dias_habilitados(franja),
        calendario=calendario,
        turnos_por_cohorte=dict(turnos_por_cohorte),
        ambientes_por_sede={sede: tuple(sorted(ids)) for sede, ids in ambientes_por_sede.items()},
        permitir_banda_alterna=permitir_banda_alterna,
    )
    _advertir_docentes_inconsistentes(ctx)
    return ctx


def _advertir_docentes_inconsistentes(ctx: Contexto) -> None:
    asignados = set()
    for oferta in ctx.ofertas:
        if oferta.id_docente_tec:
            asignados.add(oferta.id_docente_tec)
        if oferta.id_docente_tal:
            asignados.add(oferta.id_docente_tal)
    faltantes = sorted(d for d in asignados if d not in ctx.docentes)
    if faltantes:
        log.warning("Docentes asignados que no existen en la tabla docentes: %s", faltantes)
    inactivos = sorted(
        d for d in asignados
        if d in ctx.docentes and ctx.docentes[d].estado.upper() != "A"
    )
    if inactivos:
        log.warning("Docentes asignados con estado distinto de A: %s", inactivos)

    sin_franjas = sorted(
        d for d in asignados
        if d in ctx.docentes
        and ctx.docentes[d].usa_restriccion
        and not any(ctx.docentes[d].disponibilidad.values())
    )
    if sin_franjas:
        log.warning(
            "Docentes con usa_restriccion_horaria activa pero sin franjas de "
            "disponibilidad: %s. No se aplicará una restricción de "
            "disponibilidad hasta que registren sus franjas.",
            sin_franjas,
        )

    franjas_ignoradas = sorted(
        d for d in asignados
        if d in ctx.docentes
        and not ctx.docentes[d].usa_restriccion
        and any(ctx.docentes[d].disponibilidad.values())
    )
    if franjas_ignoradas:
        log.warning(
            "Docentes con franjas de disponibilidad registradas pero "
            "usa_restriccion_horaria desactivada: %s. Esas franjas no se "
            "aplicarán.",
            franjas_ignoradas,
        )


# ---------------------------------------------------------------------------
# Ventanas de semanas
# ---------------------------------------------------------------------------


def _semanas_lectivas(periodo: Periodo) -> int:
    """Semanas regulares del periodo, sin invadir el margen de recuperación."""
    return min(SEMANAS_LECTIVAS, max(1, int(periodo.semanas)))


def _semanas_curso(oferta: Oferta, max_semanas: int) -> int:
    """Duración efectiva del curso, acotada al máximo lectivo."""
    semanas = oferta.curso.semanas_db
    if semanas is None or semanas <= 0:
        return max_semanas
    return max(1, min(int(semanas), max_semanas))


def _reducir_longitudes(longitudes: list[int], objetivo: int) -> list[int]:
    """Reduce proporcionalmente para que la suma no supere `objetivo`."""
    total = sum(longitudes)
    if total <= objetivo:
        return list(longitudes)
    if len(longitudes) > objetivo:
        # Caso extremo: más módulos que semanas. Se permite solapamiento
        # controlado asignando una semana a cada uno; el modelo de recursos
        # seguirá impidiendo choques.
        return [1] * len(longitudes)
    crudas = [largo * objetivo / total for largo in longitudes]
    reducidas = [max(1, int(valor)) for valor in crudas]
    while sum(reducidas) > objetivo:
        indice = max(range(len(reducidas)), key=lambda i: reducidas[i] - crudas[i])
        if reducidas[indice] <= 1:
            break
        reducidas[indice] -= 1
    while sum(reducidas) < objetivo:
        indice = max(range(len(reducidas)), key=lambda i: crudas[i] - reducidas[i])
        reducidas[indice] += 1
    return reducidas


def _es_seminario_tal(curso) -> bool:
    """Seminario de 4.º a 6.º: su TAL se reparte en las semanas lectivas.

    Solo aplica a cursos que son únicamente TAL (los seminarios reales no
    tienen TEC). Si un curso tuviera TEC y además se llamara "Seminario", su
    TEC debe seguir la secuencia modular y su TAL debe acompañarlo dentro de
    la misma ventana; por eso se exige ``horas_tec == 0``.
    """
    return (
        curso.semestre_num >= 4
        and curso.horas_tal > 0
        and curso.horas_tec == 0
        and "SEMINARIO" in sin_acentos(curso.nombre)
    )


def asignar_ventanas(ctx: Contexto, *, permitir_compresion: bool = False) -> None:
    """Asigna a cada oferta su ventana de semanas (0-based, fin exclusivo).

    - Cursos de carrera con TEC y duración modular: secuencia por código.
    - Cursos de larga duración (16 semanas, como Inglés Técnico) o que ocupan
      casi todo el periodo: se dictan en paralelo y **no** se suman a la cadena
      secuencial, porque comprimirlos destruiría su carga curricular.
    - Seminarios TAL de 4.º a 6.º: se distribuyen en las 16 semanas lectivas.
    - Cursos complementarios/EMP: ventana propia desde la semana 1.

    Las semanas 17 y 18 del periodo quedan reservadas exclusivamente para
    recuperación de clases perdidas por feriados. Ninguna ventana regular puede
    terminar después de la semana lectiva 16.

    Si la suma de módulos TEC cortos de una cohorte supera el límite lectivo,
    la secuencialidad estricta es imposible. Por defecto se aborta con un
    diagnóstico; ``permitir_compresion`` conserva el comportamiento
    exploratorio de comprimir proporcionalmente (puede elevar mucho la carga
    semanal y volver el modelo infactible).
    """
    semanas_periodo = ctx.periodo.semanas
    semanas_lectivas = _semanas_lectivas(ctx.periodo)
    log.info(
        "Calendario lectivo: %d semanas; margen de recuperación: %d semana(s).",
        semanas_lectivas,
        max(0, semanas_periodo - semanas_lectivas),
    )
    if semanas_periodo < SEMANAS_LECTIVAS + MARGEN_RECUPERACION:
        log.warning(
            "El periodo %s tiene %d semanas; se usarán %d lectivas y el margen "
            "de recuperación queda reducido a %d semana(s).",
            ctx.periodo.codigo,
            semanas_periodo,
            semanas_lectivas,
            max(0, semanas_periodo - semanas_lectivas),
        )

    # La plantilla se reconstruye en cada ejecución; no se arrastran metadatos
    # de una corrida anterior.
    ctx.plantillas.clear()
    for oferta in ctx.ofertas:
        oferta.plantilla_id = None
        oferta.modulo_orden = 0

    por_cohorte: dict[tuple, list[Oferta]] = defaultdict(list)
    for oferta in ctx.ofertas:
        por_cohorte[oferta.cohorte].append(oferta)

    total_modulares = 0
    total_paralelos = 0
    conflictos: list[str] = []
    for cohorte, ofertas in por_cohorte.items():
        modulares: list[Oferta] = []
        for oferta in ofertas:
            curso = oferta.curso
            duracion = _semanas_curso(oferta, semanas_lectivas)
            # Un curso de carrera con TEC de larga duración (16 semanas, como
            # Inglés Técnico) o que ocupa casi todo el periodo lectivo no forma
            # parte de la cadena secuencial: se dicta en paralelo con los
            # módulos cortos y no se suma a la compresión modular.
            es_modular = (
                curso.is_carrera
                and curso.horas_tec > 0
                and not _es_seminario_tal(curso)
                and 0 < duracion < SEMANAS_CURSO_PARALELO
                and duracion < semanas_lectivas - 1
            )
            if es_modular:
                modulares.append(oferta)
            else:
                oferta.ventana_inicio = 0
                oferta.ventana_fin = (
                    semanas_lectivas if _es_seminario_tal(curso) else duracion
                )
                if curso.is_carrera and curso.horas_tec > 0:
                    total_paralelos += 1

        modulares.sort(key=lambda o: clave_natural_codigo(o.curso.mat_cur))
        longitudes_originales = [_semanas_curso(o, semanas_lectivas) for o in modulares]
        suma = sum(longitudes_originales)
        if suma > semanas_lectivas:
            detalle = ", ".join(
                f"{o.curso.mat_cur}={largo}" for o, largo in zip(modulares, longitudes_originales)
            )
            mensaje = (
                f"Cohorte {cohorte}: los módulos TEC cortos de carrera suman "
                f"{suma} semanas y el límite lectivo es {semanas_lectivas}. No es "
                f"posible dictarlos secuencialmente sin incumplir su duración: "
                f"{detalle}."
            )
            if not permitir_compresion:
                conflictos.append(mensaje)
                longitudes = longitudes_originales
            else:
                log.warning(
                    "%s Se comprimirán proporcionalmente porque se indicó "
                    "--permitir-compresion-modular.", mensaje,
                )
                longitudes = _reducir_longitudes(longitudes_originales, semanas_lectivas)
        else:
            longitudes = longitudes_originales

        desplazamiento = 0
        for oferta, largo in zip(modulares, longitudes):
            oferta.ventana_inicio = desplazamiento
            oferta.ventana_fin = min(semanas_lectivas, desplazamiento + largo)
            desplazamiento = oferta.ventana_fin
            total_modulares += 1

        # Toda la cohorte comparte una misma plantilla modular. El orden natural
        # del código define el módulo de referencia (orden 0) y los sucesores.
        linea = f"PLANTILLA:{cohorte}"
        for orden, oferta in enumerate(modulares):
            oferta.plantilla_id = linea
            oferta.modulo_orden = orden

    if conflictos:
        raise ErrorDatos(
            "La secuenciación modular TEC no cabe en el periodo:\n  - "
            + "\n  - ".join(conflictos)
            + "\nCorrija las semanas de los cursos o ejecute con "
              "--permitir-compresion-modular para un borrador exploratorio."
        )

    if total_paralelos:
        log.warning(
            "%d cursos de carrera con TEC son de larga duración (16 semanas o "
            "casi todo el periodo) y se programarán en paralelo con los módulos "
            "secuenciales, sin sumarse a su cadena.",
            total_paralelos,
        )
    log.info(
        "Ventanas asignadas: %d módulos secuenciales, %d cursos paralelos.",
        total_modulares, total_paralelos,
    )


# ---------------------------------------------------------------------------
# Turnos
# ---------------------------------------------------------------------------


def _ventana_banda(ctx: Contexto, banda: str) -> tuple[int, int] | None:
    """Traduce una banda lógica a minutos dentro de la franja institucional."""
    inicio_franja = ctx.franja.inicio_min
    cierre_franja = ctx.franja.cierre_min
    if banda == "MANANA":
        inicio = max(inicio_franja, MORNING_START_MIN)
        fin = min(MORNING_END_MIN, cierre_franja)
    elif banda == "TARDE":
        inicio = max(inicio_franja, AFTERNOON_START_MIN)
        fin = min(NIGHT_START_MIN, cierre_franja)
    elif banda == "NOCHE":
        inicio = max(inicio_franja, NIGHT_START_MIN)
        fin = cierre_franja
    else:  # pragma: no cover - defensa ante un valor inesperado
        return None
    return (inicio, fin) if fin > inicio else None


def _ventana_banda_turno(
    ctx: Contexto, banda: str, turno: int
) -> tuple[int, int] | None:
    """Ventana de banda con el tope de cierre propio del turno.

    El segundo turno no puede extenderse más allá de las 21:00, incluso si la
    franja institucional cierra más tarde. El tope se aplica también a VIR,
    porque la restricción es del turno y no de la modalidad.
    """
    ventana = _ventana_banda(ctx, banda)
    if ventana is None:
        return None
    if banda == "NOCHE" and turno == 2:
        ventana = (ventana[0], min(ventana[1], TURNO_2_NIGHT_END_MIN))
    return ventana if ventana[0] < ventana[1] else None


def _docente_parcial_habilita_tarde(ctx: Contexto, oferta: Oferta) -> bool:
    """True si un TP de la cohorte necesita la tarde como alternativa."""
    manana = _ventana_banda(ctx, "MANANA")
    tarde = _ventana_banda(ctx, "TARDE")
    if manana is None or tarde is None:
        return False

    for candidata in ctx.ofertas:
        if candidata.cohorte != oferta.cohorte:
            continue
        curso = candidata.curso
        componentes = []
        if curso.horas_tec > 0:
            componentes.append((curso.horas_tec, candidata.id_docente_tec))
        if curso.horas_tal > 0 and not curso.es_practica_empresa:
            componentes.append((curso.horas_tal, candidata.id_docente_tal))

        semanas = (
            candidata.ventana_fin - candidata.ventana_inicio
            if candidata.ventana_fin > candidata.ventana_inicio
            else curso.semanas_db or SEMANAS_LECTIVAS
        )
        for total_horas, docente_id in componentes:
            docente = ctx.docentes.get(docente_id) if docente_id is not None else None
            if (
                docente is None
                or not docente.usa_restriccion
                or not any(
                    indicador in sin_acentos(docente.tipo_contrato)
                    for indicador in ("PARCIAL", "MEDIO")
                )
            ):
                continue

            horas_semanales = max(distribuir_semanas(total_horas, semanas), default=0)
            cantidad_bloques = max(
                1,
                (horas_semanales + MAX_SESSION_ACAD_HOURS - 1)
                // MAX_SESSION_ACAD_HOURS,
            )
            horas_bloque = max(
                distribuir_entero(horas_semanales, cantidad_bloques),
                default=0,
            )
            duracion = horas_bloque * ACADEMIC_HOUR_MIN
            franjas = [
                franja
                for dia, disponibilidad in docente.disponibilidad.items()
                if dia in ctx.dias
                for franja in disponibilidad
            ]
            tiene_manana = any(
                max(inicio, manana[0]) + duracion <= min(fin, manana[1])
                for inicio, fin in franjas
            )
            tiene_tarde = any(
                max(inicio, tarde[0]) + duracion <= min(fin, tarde[1])
                for inicio, fin in franjas
            )
            if not tiene_manana and tiene_tarde:
                return True
    return False


def bandas_cohorte(ctx: Contexto, oferta: Oferta) -> list[tuple[int, int]]:
    """Bandas horarias permitidas para una oferta, en orden de preferencia.

    Segundo semestre/turno 1 usa la mañana como banda principal, desde las
    07:45 hasta las 12:45; no requiere iniciar al comienzo de esa ventana. La
    tarde se agrega como alternativa solo cuando un docente TP la necesita.
    Segundo semestre/turno 2 prefiere tarde/noche, con mañana como alternativa,
    y cierra la noche como máximo a las 21:00.

    El tercer semestre conserva la mañana como banda principal del turno 1 y
    puede usar tarde/noche como alternativa. A partir del cuarto semestre (IV,
    V, VI...) **la mañana queda prohibida**: solo se exponen tarde y noche,
    ordenadas según el turno (turno 1 y 2 prefieren tarde/noche; turno 3
    prefiere noche/tarde). La tarde empieza desde el límite institucional, pero
    sus clases no tienen que iniciar allí. El tope de primera clase de III-VI se
    aplica en el modelo, no en la generación de bandas.
    """
    if oferta.curso.es_practica_empresa:
        inicio = max(EMP_START_MIN, ctx.franja.inicio_min)
        fin = min(EMP_END_MIN, ctx.franja.cierre_min)
        return [(inicio, fin)] if fin > inicio else []

    semestre = oferta.curso.semestre_num
    turno = ctx.turnos.get(oferta.id_turno, oferta.id_turno)

    if semestre == 2 and turno == 1:
        # La mañana sigue siendo la banda primaria. Si un docente a tiempo
        # parcial no tiene disponibilidad matutina suficiente, la tarde se
        # habilita como alternativa penalizada, no como preferencia de toda la
        # cohorte.
        nombres = (
            ["MANANA", "TARDE"]
            if _docente_parcial_habilita_tarde(ctx, oferta)
            else ["MANANA"]
        )
    elif semestre == 2 and turno == 2:
        nombres = ["TARDE", "NOCHE", "MANANA"]
    elif semestre == 3:
        if turno == 3:
            nombres = ["NOCHE", "TARDE", "MANANA"]
        elif turno == 2:
            nombres = ["TARDE", "NOCHE", "MANANA"]
        else:
            nombres = ["MANANA", "TARDE", "NOCHE"]
    elif semestre >= 4:
        # A partir de IV no hay turno mañana: solo tarde y noche.
        nombres = ["NOCHE", "TARDE"] if turno == 3 else ["TARDE", "NOCHE"]
    else:
        nombres = ["NOCHE", "TARDE"] if turno == 3 else ["TARDE", "NOCHE"]

    if ctx.permitir_banda_alterna and semestre != 2:
        alternativas = ("TARDE", "NOCHE") if semestre >= 4 else (
            "MANANA", "TARDE", "NOCHE"
        )
        for alterna in alternativas:
            if alterna not in nombres:
                nombres.append(alterna)

    ventanas: list[tuple[int, int]] = []
    for nombre in nombres:
        ventana = _ventana_banda_turno(ctx, nombre, turno)
        if ventana is not None and ventana not in ventanas:
            ventanas.append(ventana)
    if not ventanas:
        raise ErrorDatos(
            f"La banda del turno {turno} no tiene horas dentro de la franja "
            f"institucional ({ctx.franja.inicio_min}-{ctx.franja.cierre_min})."
        )
    return ventanas


def bandas_virtuales(ctx: Contexto, oferta: Oferta) -> list[tuple[int, int]]:
    """Bandas institucionales disponibles para actividades VIR.

    Las horas virtuales pueden ubicarse en cualquier banda (mañana, tarde o
    noche), sin preferencia por el turno opuesto. La única condición es que no
    se solapen con las clases de su cohorte, lo cual se controla con la
    restricción de no-solapamiento. A partir del cuarto semestre tampoco pueden
    usar la mañana, igual que el resto de sesiones de la cohorte. Para el
    segundo turno se respeta el cierre máximo de las 21:00.
    """
    turno = ctx.turnos.get(oferta.id_turno, oferta.id_turno)
    nombres = (
        ("TARDE", "NOCHE")
        if oferta.curso.semestre_num >= 4
        else ("MANANA", "TARDE", "NOCHE")
    )
    bandas: list[tuple[int, int]] = []
    for nombre in nombres:
        ventana = _ventana_banda_turno(ctx, nombre, turno)
        if ventana is not None and ventana not in bandas:
            bandas.append(ventana)
    if not bandas:
        raise ErrorDatos(
            f"No hay bandas institucionales disponibles para {oferta.curso.mat_cur}."
        )
    return bandas


def banda_cohorte(ctx: Contexto, oferta: Oferta) -> tuple[int, int]:
    """Banda principal de la oferta (la que exige el documento de reglas)."""
    return bandas_cohorte(ctx, oferta)[0]


def describir_bandas(ctx: Contexto, oferta: Oferta) -> str:
    """Texto legible de las bandas evaluadas, para diagnósticos."""
    etiquetas = []
    for inicio, fin in bandas_cohorte(ctx, oferta):
        etiquetas.append(f"{inicio // 60:02d}:{inicio % 60:02d}-{fin // 60:02d}:{fin % 60:02d}")
    return ", ".join(etiquetas)
