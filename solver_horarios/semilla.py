"""Mapeo de bloques JSON a pistas suaves para las actividades CP-SAT."""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Any

from .actividades import generar_pares_permitidos
from .config import Actividad, ErrorDatos, Oferta, indice_dia, minutos_de_hora
from .planificacion import Contexto

log = logging.getLogger(__name__)

TIPOS_SEMILLA = {
    "TEC": "TEC",
    "TAL": "TAL",
    "VAE": "VIR",
    "SV-EV": "VIR",
    "VIR": "VIR",
}
TOLERANCIA_HORARIA_MINUTOS = 10


def _normalizar(valor: object) -> str:
    texto = unicodedata.normalize("NFKD", str(valor or "").upper())
    return "".join(
        caracter
        for caracter in texto
        if not unicodedata.combining(caracter) and caracter.isalnum()
    )


def _tokens_nombre(valor: object) -> frozenset[str]:
    texto = unicodedata.normalize("NFKD", str(valor or "").upper())
    texto = "".join(
        caracter
        for caracter in texto
        if not unicodedata.combining(caracter)
    )
    return frozenset(
        token
        for token in re.findall(r"[A-Z0-9]+", texto)
    )


def _coincide_docente(nombre_semilla: object, nombre_bd: object) -> bool:
    tokens_semilla = _tokens_nombre(nombre_semilla)
    tokens_bd = _tokens_nombre(nombre_bd)
    if not tokens_semilla or not tokens_bd:
        return False
    if tokens_semilla == tokens_bd:
        return True
    menor, mayor = sorted((tokens_semilla, tokens_bd), key=len)
    return menor <= mayor and all(len(token) >= 4 for token in menor)


def _cargar_bloques(ruta: Path) -> list[dict[str, Any]]:
    try:
        documento = json.loads(ruta.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ErrorDatos(f"No se pudo leer el JSON semilla {ruta}: {exc}") from exc
    if not isinstance(documento, dict) or not isinstance(
        documento.get("bloques"), list
    ):
        raise ErrorDatos(
            f"El JSON semilla {ruta} debe contener una lista en la clave 'bloques'."
        )
    return documento["bloques"]


def preparar_pistas_semilla(
    ruta: Path,
    ctx: Contexto,
    actividades: list[Actividad],
    reporte_asociaciones: list[dict[str, Any]] | None = None,
) -> tuple[dict[int, tuple[int, int]], Counter[str]]:
    """Valida, mapea e inyecta como hints los bloques que encajan sin ambigüedad.

    El resultado asocia ``uid actividad -> (día interno, minuto de inicio)``.
    No se crean restricciones duras a partir del horario de semilla.
    """
    bloques = _cargar_bloques(ruta)
    resumen: Counter[str] = Counter(total=len(bloques))
    pistas: dict[int, tuple[int, int]] = {}
    por_oferta_modalidad: dict[tuple[int, str], list[Actividad]] = {}
    pares_permitidos: dict[int, set[tuple[int, int]]] = {}
    for actividad in actividades:
        por_oferta_modalidad.setdefault(
            (actividad.oferta.id_programacion, actividad.modalidad), []
        ).append(actividad)
        pares_permitidos[actividad.uid] = set(
            generar_pares_permitidos(ctx, actividad)
        )

    ofertas = ctx.ofertas
    for indice, bloque in enumerate(bloques, start=1):
        etiqueta = f"bloque #{indice}"
        if not isinstance(bloque, dict):
            resumen["no_validado"] += 1
            log.warning("%s omitido: el registro no es un objeto JSON.", etiqueta)
            continue

        carrera = _normalizar(bloque.get("carrera"))
        semestre = bloque.get("semestre")
        grupo = str(bloque.get("grupo") or "").strip()
        tipo_origen = str(bloque.get("tipo_sesion") or "").strip().upper()
        modalidad = TIPOS_SEMILLA.get(tipo_origen)
        dia = indice_dia(bloque.get("dia"))
        inicio = minutos_de_hora(bloque.get("hora_inicio"))
        fin = minutos_de_hora(bloque.get("hora_fin"))
        try:
            semestre_num = int(semestre) if semestre is not None else None
        except (TypeError, ValueError):
            semestre_num = None
        if (
            not carrera
            or semestre_num is None
            or not grupo
            or modalidad is None
            or dia is None
            or inicio is None
            or fin is None
            or fin <= inicio
        ):
            resumen["no_validado"] += 1
            log.warning(
                "%s omitido: datos requeridos inválidos (carrera=%r, semestre=%r, "
                "grupo=%r, tipo=%r, día=%r, hora=%r-%r).",
                etiqueta,
                bloque.get("carrera"),
                semestre,
                grupo,
                tipo_origen,
                bloque.get("dia"),
                bloque.get("hora_inicio"),
                bloque.get("hora_fin"),
            )
            continue

        ofertas_cohorte = [
            oferta
            for oferta in ofertas
            if _normalizar(oferta.curso.codigo_carrera) == carrera
            and oferta.curso.semestre_num == semestre_num
            and str(oferta.grupo).strip().zfill(2) == grupo.zfill(2)
        ]
        candidatos = ofertas_cohorte
        docente_bloque = bloque.get("docente")
        if not docente_bloque:
            resumen["no_validado"] += 1
            log.warning(
                "%s omitido: falta docente para modalidad %s en carrera=%r, "
                "semestre=%r, grupo=%r.",
                etiqueta,
                modalidad,
                bloque.get("carrera"),
                semestre,
                grupo,
            )
            continue

        docente_por_oferta: dict[int, int] = {}
        ofertas_con_docente = []
        for oferta in candidatos:
            if modalidad in {"TEC", "TAL"}:
                campos_docente = (
                    ("id_docente_tec",)
                    if modalidad == "TEC"
                    else ("id_docente_tal",)
                )
            else:
                campos_docente = ("id_docente_tec", "id_docente_tal")
            ids_coincidentes = {
                id_docente
                for campo in campos_docente
                if (id_docente := getattr(oferta, campo)) is not None
                and (docente := ctx.docentes.get(id_docente)) is not None
                and _coincide_docente(docente_bloque, docente.nombre)
            }
            if len(ids_coincidentes) == 1:
                ofertas_con_docente.append(oferta)
                docente_por_oferta[oferta.id_programacion] = ids_coincidentes.pop()
        candidatos = ofertas_con_docente

        if not candidatos:
            resumen["no_validado"] += 1
            log.warning(
                "%s omitido: no hay oferta en MySQL para carrera=%r, "
                "semestre=%r, grupo=%r, docente=%r, modalidad=%s.",
                etiqueta,
                bloque.get("carrera"),
                semestre,
                grupo,
                docente_bloque,
                modalidad,
            )
            continue

        actividades_por_oferta: dict[
            int, tuple[Oferta, list[tuple[Actividad, int, int, int]]]
        ] = {}
        for oferta in candidatos:
            coincidencias: list[tuple[Actividad, int, int, int]] = []
            for actividad in por_oferta_modalidad.get(
                (oferta.id_programacion, modalidad), ()
            ):
                if actividad.uid in pistas:
                    continue
                for dia_permitido, inicio_permitido in pares_permitidos[
                    actividad.uid
                ]:
                    fin_permitido = inicio_permitido + actividad.duracion_min
                    delta_inicio = abs(inicio_permitido - inicio)
                    delta_fin = abs(fin_permitido - fin)
                    if (
                        dia_permitido == dia
                        and delta_inicio <= TOLERANCIA_HORARIA_MINUTOS
                        and delta_fin <= TOLERANCIA_HORARIA_MINUTOS
                    ):
                        coincidencias.append(
                            (
                                actividad,
                                inicio_permitido,
                                delta_inicio,
                                delta_fin,
                            )
                        )
            if coincidencias:
                actividades_por_oferta[oferta.id_programacion] = (
                    oferta,
                    coincidencias,
                )
        ofertas_compatibles = list(actividades_por_oferta.values())
        if len(ofertas_compatibles) != 1:
            resumen["no_inyectados"] += 1
            motivo = (
                "sin actividad compatible"
                if not ofertas_compatibles
                else "mapeo ambiguo entre ofertas"
            )
            log.warning(
                "%s omitido: %s para carrera=%r, semestre=%r, grupo=%r, "
                "docente=%r, modalidad=%s, día=%s, hora=%s-%s.",
                etiqueta,
                motivo,
                bloque.get("carrera"),
                semestre,
                grupo,
                docente_bloque,
                modalidad,
                bloque.get("dia"),
                bloque.get("hora_inicio"),
                bloque.get("hora_fin"),
            )
            continue

        oferta, actividades_candidatas = ofertas_compatibles[0]
        actividad, inicio_pista, delta_inicio, delta_fin = min(
            actividades_candidatas,
            key=lambda coincidencia: (
                coincidencia[2] + coincidencia[3],
                max(coincidencia[2], coincidencia[3]),
                coincidencia[0].uid,
                coincidencia[1],
            ),
        )
        pistas[actividad.uid] = (dia, inicio_pista)
        resumen["validados"] += 1
        resumen["traducidos"] += int(modalidad != tipo_origen)
        resumen["inyectados"] += 1
        resumen["cohorte_docente_modalidad_horario"] += 1
        if delta_inicio or delta_fin:
            resumen["tolerancia_aplicada"] += 1
        if reporte_asociaciones is not None:
            reporte_asociaciones.append(
                {
                    "bloque": indice,
                    "uid": actividad.uid,
                    "id_programacion": oferta.id_programacion,
                    "id_docente": docente_por_oferta[oferta.id_programacion],
                    "modalidad": modalidad,
                    "carrera": bloque.get("carrera"),
                    "semestre": semestre_num,
                    "grupo": grupo,
                    "docente": docente_bloque,
                    "dia": dia,
                    "inicio_min": inicio_pista,
                    "fin_min": inicio_pista + actividad.duracion_min,
                    "origen_celda": bloque.get("origen_celda"),
                    "delta_inicio_minutos": delta_inicio,
                    "delta_fin_minutos": delta_fin,
                }
            )

    log.info(
        "Semilla %s: %d bloques, %d validados, %d traducidos, %d pistas "
        "inyectadas, %d no validados, %d sin actividad compatible.",
        ruta,
        resumen["total"],
        resumen["validados"],
        resumen["traducidos"],
        resumen["inyectados"],
        resumen["no_validado"],
        resumen["no_inyectados"],
    )
    return pistas, resumen
