"""Carga y modelado de ocupaciones externas al grupo que se va a generar."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

from solver_horarios.config import (
    BREAK_MIN,
    ErrorDatos,
    indice_dia,
    minutos_de_hora,
)


@dataclass(frozen=True)
class OcupacionExterna:
    id_horario: int
    id_programacion: int
    id_docente: int | None
    id_ambiente: int | None
    modalidad: str
    dia: int
    inicio_min: int
    fin_min: int
    semana_inicio: int
    semana_fin: int
    estado: str

    @property
    def semana_inicio_interna(self) -> int:
        return self.semana_inicio - 1


def ocupacion_desde_fila(fila: dict[str, Any]) -> OcupacionExterna:
    dia = indice_dia(fila.get("dia_semana"))
    inicio = minutos_de_hora(fila.get("hora_inicio"))
    fin = minutos_de_hora(fila.get("hora_fin"))
    semana_inicio = int(fila.get("semana_inicio") or 0)
    semana_fin = int(fila.get("semana_fin") or 0)
    if dia is None:
        raise ErrorDatos(
            f"Día inválido en horarios_generados.id_horario="
            f"{fila.get('id_horario')}: {fila.get('dia_semana')!r}."
        )
    if inicio is None or fin is None or fin <= inicio:
        raise ErrorDatos(
            f"Rango horario inválido en horarios_generados.id_horario="
            f"{fila.get('id_horario')}."
        )
    if semana_inicio < 1 or semana_fin < semana_inicio:
        raise ErrorDatos(
            f"Rango de semanas inválido en horarios_generados.id_horario="
            f"{fila.get('id_horario')}."
        )
    return OcupacionExterna(
        id_horario=int(fila["id_horario"]),
        id_programacion=int(fila["id_programacion"]),
        id_docente=(
            int(fila["id_docente"]) if fila.get("id_docente") is not None else None
        ),
        id_ambiente=(
            int(fila["id_ambiente"]) if fila.get("id_ambiente") is not None else None
        ),
        modalidad=str(fila.get("tipo_modalidad") or "").upper(),
        dia=dia,
        inicio_min=inicio,
        fin_min=fin,
        semana_inicio=semana_inicio,
        semana_fin=semana_fin,
        estado=str(fila.get("estado") or "").upper(),
    )


def cargar_ocupaciones_externas(
    repo: Any,
    id_periodo: int,
    id_programaciones_grupo: set[int],
) -> list[OcupacionExterna]:
    """Carga borradores/confirmados que no serán regenerados en esta corrida."""
    if not id_programaciones_grupo:
        raise ErrorDatos("El grupo no contiene programaciones para excluir.")
    filas = cargar_filas_periodo(repo, id_periodo, solo_activos=True)

    externas: list[OcupacionExterna] = []
    for fila in filas:
        programacion = int(fila["id_programacion"])
        if programacion in id_programaciones_grupo:
            if str(fila.get("estado", "")).upper() == "CONFIRMADO":
                raise ErrorDatos(
                    "El grupo incluye programaciones con horarios CONFIRMADOS; "
                    "no se regenerarán para preservar esos bloques. "
                    f"id_programacion={programacion}."
                )
            continue
        externas.append(ocupacion_desde_fila(fila))
    return externas


def cargar_filas_periodo(
    repo: Any,
    id_periodo: int,
    *,
    solo_activos: bool = False,
) -> list[dict[str, Any]]:
    """Devuelve las filas del periodo para restricción o auditoría.

    Con ``solo_activos=True`` se excluyen los horarios de programaciones o
    cursos inactivos. Esos bloques no deben reservar docentes ni ambientes en
    una corrida que no los va a regenerar. La auditoría usa el valor por
    defecto para poder revisar todo el periodo, incluidos los datos obsoletos.
    """
    consulta = """
        SELECT id_horario, id_programacion, id_ambiente, id_docente,
               tipo_modalidad, dia_semana, hora_inicio, hora_fin,
               semana_inicio, semana_fin, estado
          FROM horarios_generados
         WHERE id_periodo = %s
           AND estado IN ('BORRADOR', 'CONFIRMADO')
         ORDER BY id_horario
    """
    if solo_activos:
        consulta = """
            SELECT h.id_horario, h.id_programacion, h.id_ambiente, h.id_docente,
                   h.tipo_modalidad, h.dia_semana, h.hora_inicio, h.hora_fin,
                   h.semana_inicio, h.semana_fin, h.estado
              FROM horarios_generados h
              JOIN programacion_academica pa
                ON pa.id_programacion = h.id_programacion
              JOIN cursos c
                ON c.id_curso = pa.id_curso
             WHERE h.id_periodo = %s
               AND h.estado IN ('BORRADOR', 'CONFIRMADO')
               AND pa.estado = 'A'
               AND c.estado = 'A'
             ORDER BY h.id_horario
        """
    with repo.conn.cursor() as cur:
        cur.execute(consulta, (id_periodo,))
        return list(cur.fetchall())


def agregar_restricciones_externas(
    construccion: Any,
    ocupaciones: Iterable[OcupacionExterna],
) -> int:
    """Evita choques por docente/aula contra ocupaciones de otros grupos."""
    por_docente: dict[int, list[OcupacionExterna]] = {}
    por_ambiente: dict[int, list[OcupacionExterna]] = {}
    for ocupacion in ocupaciones:
        if ocupacion.id_docente is not None:
            por_docente.setdefault(ocupacion.id_docente, []).append(ocupacion)
        if ocupacion.id_ambiente is not None:
            por_ambiente.setdefault(ocupacion.id_ambiente, []).append(ocupacion)

    agregadas = 0
    for actividad in construccion.actividades:
        uid = actividad.uid
        candidatos: dict[tuple[str, int, int], tuple[OcupacionExterna, Any | None]] = {}
        if actividad.docente_id is not None:
            for reserva in por_docente.get(actividad.docente_id, []):
                if actividad.semana_inicio < reserva.semana_fin and (
                    reserva.semana_inicio_interna < actividad.semana_fin
                ):
                    candidatos[("docente", reserva.id_horario, 0)] = (reserva, None)

        for id_ambiente, selector in construccion.selector_ambiente.get(uid, []):
            for reserva in por_ambiente.get(id_ambiente, []):
                if actividad.semana_inicio < reserva.semana_fin and (
                    reserva.semana_inicio_interna < actividad.semana_fin
                ):
                    candidatos[("ambiente", reserva.id_horario, id_ambiente)] = (
                        reserva,
                        selector,
                    )

        for (tipo_recurso, id_reserva, id_ambiente), (reserva, selector) in (
            candidatos.items()
        ):
            misma_fecha = construccion.model.NewBoolVar(
                f"ext_dia_{tipo_recurso}_{uid}_{id_reserva}_{id_ambiente}"
            )
            antes = construccion.model.NewBoolVar(
                f"ext_antes_{tipo_recurso}_{uid}_{id_reserva}_{id_ambiente}"
            )
            despues = construccion.model.NewBoolVar(
                f"ext_despues_{tipo_recurso}_{uid}_{id_reserva}_{id_ambiente}"
            )
            construccion.model.Add(
                construccion.dia[uid] == reserva.dia
            ).OnlyEnforceIf(misma_fecha)
            construccion.model.Add(
                construccion.dia[uid] != reserva.dia
            ).OnlyEnforceIf(misma_fecha.Not())

            if tipo_recurso == "docente":
                receso_actividad = BREAK_MIN if actividad.modalidad != "EMP" else 0
                receso_reserva = BREAK_MIN if reserva.modalidad != "EMP" else 0
            else:
                receso_actividad = 0
                receso_reserva = 0

            construccion.model.Add(
                construccion.inicio[uid]
                + actividad.duracion_min
                + receso_actividad
                <= reserva.inicio_min
            ).OnlyEnforceIf(antes)
            construccion.model.Add(
                construccion.inicio[uid] >= reserva.fin_min + receso_reserva
            ).OnlyEnforceIf(despues)
            opciones = [misma_fecha.Not(), antes, despues]
            if selector is not None:
                opciones.append(selector.Not())
            construccion.model.AddBoolOr(opciones)
            agregadas += 1

    return agregadas


def detectar_conflictos_externos(
    filas: list[dict[str, Any]],
    ocupaciones: Iterable[OcupacionExterna],
) -> list[str]:
    """Audita los bloques propuestos contra reservas en semanas inclusivas."""
    conflictos: list[str] = []
    reservas = list(ocupaciones)
    for fila in filas:
        dia = indice_dia(fila.get("dia_semana"))
        inicio = minutos_de_hora(fila.get("hora_inicio"))
        fin = minutos_de_hora(fila.get("hora_fin"))
        semana_inicio = int(fila["semana_inicio"]) - 1
        semana_fin = int(fila["semana_fin"])
        modalidad = str(fila.get("tipo_modalidad") or "").upper()
        docente = fila.get("id_docente")
        ambiente = fila.get("id_ambiente")
        if dia is None or inicio is None or fin is None:
            raise ErrorDatos("La fila propuesta tiene día u hora inválidos.")

        for reserva in reservas:
            if dia != reserva.dia or not (
                semana_inicio < reserva.semana_fin
                and reserva.semana_inicio_interna < semana_fin
            ):
                continue
            recursos: list[str] = []
            if docente is not None and int(docente) == reserva.id_docente:
                pausa_nueva = BREAK_MIN if modalidad != "EMP" else 0
                pausa_existente = BREAK_MIN if reserva.modalidad != "EMP" else 0
                if inicio < reserva.fin_min + pausa_existente and (
                    reserva.inicio_min < fin + pausa_nueva
                ):
                    recursos.append(f"docente {docente}")
            if ambiente is not None and int(ambiente) == reserva.id_ambiente:
                if inicio < reserva.fin_min and reserva.inicio_min < fin:
                    recursos.append(f"ambiente {ambiente}")
            if recursos:
                conflictos.append(
                    f"programación {fila.get('id_programacion')} choca con "
                    f"horario {reserva.id_horario} ({', '.join(recursos)}), "
                    f"semana(s) {max(semana_inicio + 1, reserva.semana_inicio)}"
                    f"-{min(semana_fin, reserva.semana_fin)}."
                )
    return conflictos


def detectar_conflictos_cruzados(
    ocupaciones: Iterable[OcupacionExterna],
) -> list[str]:
    """Encuentra choques existentes entre programaciones del mismo periodo."""
    reservas = list(ocupaciones)
    por_recurso: dict[tuple[str, int, int], list[OcupacionExterna]] = {}
    for reserva in reservas:
        if reserva.id_docente is not None:
            por_recurso.setdefault(
                ("docente", reserva.id_docente, reserva.dia), []
            ).append(reserva)
        if reserva.id_ambiente is not None:
            por_recurso.setdefault(
                ("ambiente", reserva.id_ambiente, reserva.dia), []
            ).append(reserva)

    pares: dict[tuple[int, int], set[str]] = {}
    por_id = {reserva.id_horario: reserva for reserva in reservas}
    for (tipo, id_recurso, _), grupo in por_recurso.items():
        for indice, primera in enumerate(grupo):
            for segunda in grupo[indice + 1 :]:
                if primera.id_programacion == segunda.id_programacion:
                    continue
                if not (
                    primera.semana_inicio <= segunda.semana_fin
                    and segunda.semana_inicio <= primera.semana_fin
                ):
                    continue
                if tipo == "docente":
                    pausa_primera = BREAK_MIN if primera.modalidad != "EMP" else 0
                    pausa_segunda = BREAK_MIN if segunda.modalidad != "EMP" else 0
                    se_solapan = (
                        primera.inicio_min < segunda.fin_min + pausa_segunda
                        and segunda.inicio_min < primera.fin_min + pausa_primera
                    )
                else:
                    se_solapan = (
                        primera.inicio_min < segunda.fin_min
                        and segunda.inicio_min < primera.fin_min
                    )
                if se_solapan:
                    clave = tuple(sorted((primera.id_horario, segunda.id_horario)))
                    etiqueta = f"{tipo} {id_recurso}"
                    pares.setdefault(clave, set()).add(etiqueta)

    conflictos: list[str] = []
    for (id_a, id_b), recursos in sorted(pares.items()):
        primera = por_id[id_a]
        segunda = por_id[id_b]
        inicio_semana = max(primera.semana_inicio, segunda.semana_inicio)
        fin_semana = min(primera.semana_fin, segunda.semana_fin)
        conflictos.append(
            f"horarios {id_a} (prog. {primera.id_programacion}) y {id_b} "
            f"(prog. {segunda.id_programacion}) se cruzan en {', '.join(sorted(recursos))}, "
            f"semana(s) {inicio_semana}-{fin_semana}."
        )
    return conflictos
