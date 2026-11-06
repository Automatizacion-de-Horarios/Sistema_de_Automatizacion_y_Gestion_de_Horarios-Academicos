"""Transformación de la solución CP-SAT en filas de `horarios_generados`.

Una actividad del modelo es un bloque semanal recurrente (por ejemplo,
"martes 10:15 a 12:30 desde la semana 1 hasta la 18"). La tabla de persistencia
guarda rangos de semanas; por eso un feriado que cae en el día elegido obliga a
partir el rango en dos filas, dejando fuera la semana feriada.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from .config import BloqueProgramado, Calendario, ErrorDatos, dia_db, formatear_hora
from .db import Repositorio
from .planificacion import Contexto

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class ResumenPersistencia:
    filas: int
    bloques: int
    horas_academicas: int
    rangos_omitidos: int = 0


def preparar_filas(
    ctx: Contexto,
    bloques: list[BloqueProgramado],
    *,
    id_periodo: int | None = None,
) -> list[dict[str, Any]]:
    """Convierte bloques semanales en filas listas para insertar.

    `semana_inicio` y `semana_fin` se persisten con numeración 1-based e
    inclusiva: un bloque activo en las semanas internas 0..3 se guarda como
    semanas 1..4.
    """
    periodo_id = int(id_periodo if id_periodo is not None else ctx.periodo.id_periodo)
    calendario: Calendario = ctx.calendario
    filas: list[dict[str, Any]] = []
    rangos_omitidos = 0

    for bloque in bloques:
        actividad = bloque.actividad
        if not (0 <= bloque.dia < len(ctx.dias)):
            raise ErrorDatos(
                f"Día inválido en el bloque {actividad.descripcion}: {bloque.dia}."
            )
        if bloque.fin_min <= bloque.inicio_min:
            raise ErrorDatos(
                f"Rango horario inválido en el bloque {actividad.descripcion}."
            )
        if actividad.semana_fin <= actividad.semana_inicio:
            raise ErrorDatos(
                f"Rango de semanas inválido en el bloque {actividad.descripcion}."
            )

        tramos = calendario.dividir_rango(
            actividad.semana_inicio, actividad.semana_fin, bloque.dia
        )
        if not tramos:
            rangos_omitidos += 1
            log.warning(
                "El bloque %s cae completamente en feriados para el día %s; "
                "no se persistirá.",
                actividad.descripcion, dia_db(bloque.dia),
            )
            continue

        ambiente = bloque.id_ambiente
        if actividad.modalidad in {"VIR", "EMP"}:
            ambiente = None

        for inicio, fin in tramos:
            if fin <= inicio:
                continue
            if inicio < 0 or fin > ctx.periodo.semanas:
                raise ErrorDatos(
                    f"El bloque {actividad.descripcion} excede las semanas del periodo."
                )
            filas.append(
                {
                    "id_periodo": periodo_id,
                    "id_programacion": actividad.oferta.id_programacion,
                    "id_ambiente": ambiente,
                    "id_docente": actividad.docente_id,
                    "tipo_modalidad": actividad.modalidad,
                    "dia_semana": dia_db(bloque.dia),
                    "hora_inicio": formatear_hora(bloque.inicio_min),
                    "hora_fin": formatear_hora(bloque.fin_min),
                    "semana_inicio": inicio + 1,
                    "semana_fin": fin,
                }
            )

    if rangos_omitidos:
        log.warning(
            "Se omitieron %d bloques por coincidir completamente con feriados.",
            rangos_omitidos,
        )
    return filas


def _horas_de_bloques(bloques: list[BloqueProgramado]) -> int:
    return sum(
        bloque.actividad.horas_academicas
        * max(0, bloque.actividad.semana_fin - bloque.actividad.semana_inicio)
        for bloque in bloques
    )


def resumir_persistencia(
    filas: list[dict[str, Any]], bloques: list[BloqueProgramado]
) -> ResumenPersistencia:
    return ResumenPersistencia(
        filas=len(filas),
        bloques=len(bloques),
        horas_academicas=_horas_de_bloques(bloques),
    )


def guardar_horario(
    repo: Repositorio,
    filas: list[dict[str, Any]],
    *,
    id_periodo: int,
    reemplazar_borradores: bool = False,
    reemplazar_programaciones: set[int] | None = None,
) -> int:
    """Inserta las filas en estado BORRADOR.

    Por seguridad, si ya existen borradores del periodo se aborta salvo que se
    solicite explícitamente reemplazarlos. El borrado y la inserción comparten
    la misma transacción de MySQL.
    """
    if not filas:
        raise ErrorDatos("No hay filas de horario para guardar.")

    if reemplazar_borradores and reemplazar_programaciones is not None:
        raise ErrorDatos(
            "No se puede combinar el reemplazo global de borradores con el "
            "reemplazo limitado a programaciones."
        )

    existentes = repo.contar_borradores(id_periodo)
    if (
        existentes
        and not reemplazar_borradores
        and reemplazar_programaciones is None
    ):
        raise ErrorDatos(
            f"El periodo {id_periodo} ya tiene {existentes} bloques en estado "
            "BORRADOR. Ejecute con --reemplazar-borradores para sustituirlos."
        )
    if reemplazar_programaciones is not None and not reemplazar_programaciones:
        raise ErrorDatos(
            "No se recibieron programaciones para reemplazar borradores filtrados."
        )

    try:
        if reemplazar_borradores and existentes:
            eliminados = repo.borrar_borradores(id_periodo)
            log.info("Borradores reemplazados: %d filas.", eliminados)
            insertados = repo.insertar_horarios(filas, confirmar=False)
            repo.conn.commit()
        elif reemplazar_programaciones is not None:
            eliminados = repo.borrar_borradores_programaciones(
                id_periodo, reemplazar_programaciones
            )
            log.info(
                "Borradores de %d programaciones filtradas reemplazados: %d filas; "
                "los demás semestres no fueron afectados.",
                len(reemplazar_programaciones),
                eliminados,
            )
            insertados = repo.insertar_horarios(filas, confirmar=False)
            repo.conn.commit()
        else:
            insertados = repo.insertar_horarios(filas)
    except Exception:
        try:
            repo.conn.rollback()
        except Exception:  # pragma: no cover - cierre defensivo
            pass
        raise
    log.info("Horario guardado: %d filas en estado BORRADOR.", insertados)
    return insertados
