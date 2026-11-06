"""Persistencia transaccional y acotada al grupo seleccionado."""

from __future__ import annotations

from typing import Any

from solver_horarios.config import ErrorDatos

from .ocupaciones import (
    detectar_conflictos_externos,
    ocupacion_desde_fila,
)


def guardar_grupo(
    repo: Any,
    filas: list[dict[str, Any]],
    *,
    id_periodo: int,
    id_programaciones: set[int],
) -> int:
    """Revalida reservas bajo bloqueo y sustituye solo borradores del grupo."""
    if not filas:
        raise ErrorDatos("No hay filas de horario para guardar.")
    if not id_programaciones:
        raise ErrorDatos("No hay programaciones del grupo para reemplazar.")

    try:
        with repo.conn.cursor() as cur:
            cur.execute(
                """
                SELECT id_horario, id_programacion, id_ambiente, id_docente,
                       tipo_modalidad, dia_semana, hora_inicio, hora_fin,
                       semana_inicio, semana_fin, estado
                  FROM horarios_generados
                 WHERE id_periodo = %s
                   AND estado IN ('BORRADOR', 'CONFIRMADO')
                 ORDER BY id_horario
                 FOR UPDATE
                """,
                (id_periodo,),
            )
            existentes = cur.fetchall()

        confirmados_del_grupo = [
            int(fila["id_programacion"])
            for fila in existentes
            if int(fila["id_programacion"]) in id_programaciones
            and str(fila.get("estado", "")).upper() == "CONFIRMADO"
        ]
        if confirmados_del_grupo:
            raise ErrorDatos(
                "No se pueden regenerar programaciones con horarios confirmados: "
                + ", ".join(map(str, sorted(set(confirmados_del_grupo))))
            )

        reservas_externas = [
            ocupacion_desde_fila(fila)
            for fila in existentes
            if int(fila["id_programacion"]) not in id_programaciones
        ]
        conflictos = detectar_conflictos_externos(filas, reservas_externas)
        if conflictos:
            detalle = "\n".join(f"  - {conflicto}" for conflicto in conflictos[:25])
            raise ErrorDatos(
                "El horario propuesto ahora choca con ocupaciones externas; "
                "no se guardó ningún cambio:\n" + detalle
            )

        repo.borrar_borradores_programaciones(id_periodo, id_programaciones)
        insertados = repo.insertar_horarios(filas, confirmar=False)
        repo.conn.commit()
        return insertados
    except Exception:
        repo.conn.rollback()
        raise
