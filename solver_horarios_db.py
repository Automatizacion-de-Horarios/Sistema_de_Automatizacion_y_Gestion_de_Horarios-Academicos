"""Entrada principal del motor de horarios 100 % basado en MySQL.

Uso rápido:
    python solver_horarios_db.py --dry-run
    python solver_horarios_db.py --periodo 202620 --carreras PCID --semestres II --dry-run
    python solver_horarios_db.py --periodo 202620 --reemplazar-borradores

Las credenciales se leen de `.env` o de MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD,
MYSQL_DB y MYSQL_PORT. No se escribe ningún dato académico en el código.
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import sys
from dataclasses import replace
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from solver_horarios.actividades import construir_actividades
from solver_horarios.config import (
    ErrorDatos,
    Infactible,
    Periodo,
    configurar_logging,
    construir_configuracion,
    numero_semestre,
    sin_acentos,
)
from solver_horarios.db import Repositorio
from solver_horarios.modelo import (
    diagnosticar_infactibilidad,
    diagnosticar_pistas_semilla,
    resolver_horario,
)
from solver_horarios.persistencia import (
    guardar_horario,
    preparar_filas,
    resumir_persistencia,
)
from solver_horarios.planificacion import construir_contexto
from solver_horarios.semilla import (
    TOLERANCIA_HORARIA_MINUTOS,
    preparar_pistas_semilla,
)
from solver_horarios.preflight import (
    diagnosticar_y_validar,
    verificar_actividades_sin_ventana,
    verificar_asignaciones_docente,
    verificar_capacidad_docente,
    verificar_margen_lectivo,
    verificar_plantilla_modular,
)

log = logging.getLogger("solver_horarios")
TIEMPO_LIMITE_MINIMO = 300.0


def _lista_texto(valor: str | None) -> set[str] | None:
    if not valor:
        return None
    partes = {parte.strip().upper() for parte in re.split(r"[,;]", valor) if parte.strip()}
    return partes or None


def _lista_enteros(valor: str | None, etiqueta: str) -> set[int] | None:
    if not valor:
        return None
    resultado: set[int] = set()
    for parte in re.split(r"[,;]", valor):
        parte = parte.strip()
        if not parte:
            continue
        try:
            resultado.add(int(parte))
        except ValueError as exc:
            raise ErrorDatos(f"{etiqueta} inválido: {parte!r}") from exc
    return resultado or None


def _lista_semestres(valor: str | None) -> set[int] | None:
    if not valor:
        return None
    resultado: set[int] = set()
    for parte in re.split(r"[,;]", valor):
        parte = parte.strip()
        if not parte:
            continue
        numero = numero_semestre(parte)
        if numero <= 0:
            raise ErrorDatos(f"Semestre inválido: {parte!r} (use I..X o 1..10).")
        resultado.add(numero)
    return resultado or None


def _fecha(valor: str | None) -> date | None:
    if not valor:
        return None
    try:
        return date.fromisoformat(valor)
    except ValueError as exc:
        raise ErrorDatos(
            f"Fecha inválida {valor!r}; use el formato AAAA-MM-DD."
        ) from exc


def _aplicar_fechas_periodo(
    periodo: Periodo,
    fecha_inicio: str | None,
    fecha_fin: str | None,
) -> Periodo:
    inicio_indicado = _fecha(fecha_inicio)
    fin_indicado = _fecha(fecha_fin)
    if fin_indicado and not (inicio_indicado or periodo.fecha_inicio):
        raise ErrorDatos("--fecha-fin requiere una fecha de inicio del periodo.")
    if inicio_indicado and fin_indicado and fin_indicado < inicio_indicado:
        raise ErrorDatos("--fecha-fin no puede ser anterior a --fecha-inicio.")

    inicio = inicio_indicado or periodo.fecha_inicio
    fin = fin_indicado or periodo.fecha_fin
    if inicio_indicado and periodo.fecha_inicio and inicio_indicado != periodo.fecha_inicio:
        log.warning(
            "El periodo define fecha_inicio=%s; se usará la fecha indicada %s.",
            periodo.fecha_inicio,
            inicio_indicado,
        )
        if fin_indicado is None:
            fin = None
    if inicio and fin is None:
        fin = inicio + timedelta(weeks=periodo.semanas) - timedelta(days=1)
    if inicio and fin and fin < inicio:
        raise ErrorDatos("La fecha de fin del periodo no puede ser anterior al inicio.")

    return replace(periodo, fecha_inicio=inicio, fecha_fin=fin)


def construir_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Genera horarios académicos desde MySQL con OR-Tools CP-SAT y los "
            "guarda en horarios_generados con estado BORRADOR."
        )
    )
    parser.add_argument("--periodo", help="Código de periodo (por defecto el activo).")
    parser.add_argument(
        "--fecha-inicio",
        help=(
            "Lunes o fecha de inicio del periodo (AAAA-MM-DD). Necesario para "
            "mapear feriados si la tabla periodos no tiene fechas."
        ),
    )
    parser.add_argument(
        "--fecha-fin",
        help=(
            "Fecha oficial de fin del periodo (AAAA-MM-DD); requiere fecha "
            "de inicio en la tabla o mediante --fecha-inicio."
        ),
    )
    parser.add_argument(
        "--carreras",
        help="Códigos de carrera separados por coma, por ejemplo PCID,PCBD.",
    )
    parser.add_argument(
        "--semestres",
        help="Semestres separados por coma, por ejemplo II,IV o 2,4.",
    )
    parser.add_argument(
        "--turnos",
        help="IDs de turno separados por coma (por ejemplo 1,2).",
    )
    parser.add_argument(
        "--sedes",
        help="IDs de sede separados por coma.",
    )
    parser.add_argument(
        "--tiempo-limite",
        type=float,
        default=TIEMPO_LIMITE_MINIMO,
        help="Tiempo máximo de CP-SAT en segundos (mínimo 300; por defecto 300).",
    )
    parser.add_argument(
        "--trabajadores",
        type=int,
        default=max(1, min(8, os.cpu_count() or 1)),
        help="Hilos de búsqueda de CP-SAT (por defecto 8).",
    )
    parser.add_argument(
        "--semilla", type=int, default=0, help="Semilla aleatoria (por defecto 0)."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Resuelve y valida, pero no escribe en MySQL.",
    )
    parser.add_argument(
        "--reemplazar-borradores",
        action="store_true",
        help="Borra los BORRADORES del periodo antes de insertar el nuevo horario.",
    )
    parser.add_argument(
        "--reemplazar-borradores-filtrados",
        action="store_true",
        help=(
            "Reemplaza solo los borradores de las programaciones que pasan "
            "--semestres; preserva íntegramente los demás semestres."
        ),
    )
    parser.add_argument(
        "--relajar-topes",
        action="store_true",
        help=(
            "Permite excesos de carga docente penalizados en la función objetivo. "
            "Útil sólo para borradores exploratorios. No relaja la disponibilidad "
            "docente."
        ),
    )
    parser.add_argument(
        "--excepcion-tope-docente",
        help=(
            "Excepción autorizada solo para 202620: 31=24 aplica en memoria "
            "un máximo de 24 h reloj/semana a Omar Cristian Lupaca Quispe."
        ),
    )
    parser.add_argument(
        "--sin-objetivo",
        action="store_true",
        help="Busca cualquier solución factible sin minimizar la función objetivo.",
    )
    parser.add_argument(
        "--modo-prueba-factibilidad",
        action="store_true",
        help=(
            "Solo dry-run: busca una primera solución omitiendo jornada y "
            "descansos largos docentes, continuidad/bandas de cohorte y topes "
            "diarios por grupo y exclusividad de ambientes; relaja topes "
            "contractuales y desactiva el objetivo, incluidas las preferencias "
            "blandas de concentración/equilibrio TEC y orden TEC/TAL. No relaja "
            "la disponibilidad docente."
        ),
    )
    parser.add_argument(
        "--horario-semilla",
        type=Path,
        help=(
            "JSON opcional de horario base; sus bloques coincidentes se agregan "
            "como pistas CP-SAT no vinculantes."
        ),
    )
    parser.add_argument(
        "--diagnostico-semilla",
        action="store_true",
        help=(
            "Comprueba si las pistas semilla contradicen el modelo duro y "
            "termina sin generar ni guardar un horario."
        ),
    )
    parser.add_argument(
        "--diagnostico-infactibilidad",
        action="store_true",
        help=(
            "Solo dry-run: busca un núcleo suficiente de grupos de restricciones "
            "incompatibles; mantiene activas todas las reglas y no genera horario."
        ),
    )
    parser.add_argument(
        "--tiempo-diagnostico",
        type=float,
        default=60.0,
        help="Límite en segundos para cada comprobación diagnóstica (por defecto 60).",
    )
    parser.add_argument(
        "--log-semilla",
        type=Path,
        default=Path(__file__).resolve().parent / "integrar_horario_semilla.log",
        help="Archivo de log para bloques de semilla no mapeados.",
    )
    parser.add_argument(
        "--permitir-ambiente-generico",
        action="store_true",
        help="Usa aulas comunes cuando no haya ambiente especializado en la sede.",
    )
    parser.add_argument(
        "--permitir-docente-inactivo",
        action="store_true",
        help="Mantiene asignaciones de docentes con estado distinto de A.",
    )
    parser.add_argument(
        "--permitir-compresion-modular",
        action="store_true",
        help=(
            "Comprime módulos TEC cuando su suma excede el periodo. Puede elevar "
            "la carga semanal y volver el modelo infactible."
        ),
    )
    parser.add_argument(
        "--permitir-banda-alterna",
        action="store_true",
        help=(
            "Solo diagnóstico: si una actividad no cabe en la banda oficial de su "
            "turno, prueba mañana, tarde y noche. No se debe usar para un horario "
            "institucional definitivo. No relaja la disponibilidad docente."
        ),
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="Log detallado.")
    parser.add_argument("--mysql-host", help="Sobrescribe MYSQL_HOST.")
    parser.add_argument("--mysql-port", help="Sobrescribe MYSQL_PORT.")
    parser.add_argument("--mysql-user", help="Sobrescribe MYSQL_USER.")
    parser.add_argument("--mysql-password", help="Sobrescribe MYSQL_PASSWORD.")
    parser.add_argument("--mysql-db", help="Sobrescribe MYSQL_DB.")
    return parser


def _aplicar_excepcion_tope_docente(ctx, especificacion: str | None) -> None:
    if especificacion is None:
        return
    if ctx.periodo.codigo != "202620" or especificacion != "31=24":
        raise ErrorDatos(
            "La única excepción autorizada es 31=24 para el periodo 202620."
        )
    docente = ctx.docentes.get(31)
    if (
        docente is None
        or sin_acentos(docente.nombre).upper()
        != "OMAR CRISTIAN LUPACA QUISPE"
        or docente.tope_semanal != 23
    ):
        raise ErrorDatos(
            "No se aplicó la excepción 31=24: el docente, nombre o tope "
            "actual no coincide con los datos autorizados."
        )
    ctx.docentes[31] = replace(docente, tope_semanal_override=24)
    log.warning(
        "Excepción contractual autorizada aplicada solo en memoria: "
        "%s tendrá tope de 24 h reloj/semana para %s; MySQL no fue modificado.",
        docente.nombre,
        ctx.periodo.codigo,
    )


def _mostrar_resumen(
    ctx,
    actividades,
    resultado,
    filas=None,
    guardados: int | None = None,
    dry_run: bool = False,
) -> None:
    total_horas = sum(a.horas_academicas for a in actividades)
    print()
    print("=" * 78)
    print(f"Periodo: {ctx.periodo.codigo} - {ctx.periodo.descripcion}")
    print(
        f"Oferta: {len(ctx.ofertas)} secciones | "
        f"Actividades semanales: {len(actividades)} | "
        f"Carga semanal total: {total_horas} h académicas"
    )
    print(
        f"Estado CP-SAT: {resultado.estado} | "
        f"Tiempo: {resultado.tiempo_seg:.2f} s | "
        f"Ramas: {resultado.ramas} | Conflictos: {resultado.conflictos}"
    )
    if resultado.objetivo is not None:
        print(f"Objetivo: {resultado.objetivo:.0f}")
    print(f"Bloques programados: {len(resultado.bloques)}")

    if filas is not None:
        resumen = resumir_persistencia(filas, resultado.bloques)
        print(
            f"Filas para horarios_generados: {resumen.filas} | "
            f"Horas académicas en el periodo: {resumen.horas_academicas}"
        )
        if dry_run:
            print("Modo --dry-run: no se escribió nada en MySQL.")
        elif guardados is not None:
            print(f"Filas insertadas en estado BORRADOR: {guardados}")
        if filas and dry_run:
            print("Primeras filas (vista previa):")
            for fila in filas[:5]:
                print(
                    f"  prog={fila['id_programacion']} "
                    f"{fila['tipo_modalidad']} "
                    f"{fila['dia_semana']} "
                    f"{fila['hora_inicio']}-{fila['hora_fin']} "
                    f"semanas {fila['semana_inicio']}-{fila['semana_fin']}"
                )
    if resultado.advertencias:
        print(f"Advertencias de continuidad: {len(resultado.advertencias)}")
    print("=" * 78)


def _hora_desde_minutos(minutos: int) -> str:
    return f"{minutos // 60:02d}:{minutos % 60:02d}"


def _mostrar_diagnostico_semilla(reporte: dict[str, Any]) -> None:
    print()
    print("=" * 78)
    print("DIAGNÓSTICO DE PISTAS SEMILLA")
    print(
        f"Modelo sin pistas: {reporte['estado_sin_pistas']} "
        f"({reporte['tiempo_sin_pistas']:.2f} s)"
    )
    print(
        f"Modelo con pistas fijadas como supuestos: "
        f"{reporte['estado_con_pistas']} "
        f"({reporte['tiempo_con_pistas']:.2f} s)"
    )
    print(
        f"Modelo comprobado: {reporte['variables']} variables, "
        f"{reporte['restricciones']} restricciones; "
        f"{reporte['ramas']} ramas y {reporte['conflictos_solver']} "
        "conflictos de búsqueda."
    )
    print("Estadísticas CP-SAT (sin pistas):")
    for linea in reporte["estadisticas_sin_pistas"].splitlines():
        print(f"  {linea}")
    print("Estadísticas CP-SAT (pistas fijadas):")
    for linea in reporte["estadisticas_con_pistas"].splitlines():
        print(f"  {linea}")
    print(f"Pistas evaluadas: {len(reporte['pistas'])}")

    dias = ("LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM")
    for pista in reporte["pistas"]:
        dia = pista["dia"]
        etiqueta_dia = dias[dia] if 0 <= dia < len(dias) else str(dia)
        referencia = (
            f", bloque #{pista['bloque']}"
            if pista.get("bloque") is not None
            else ""
        )
        origen = (
            f", origen {pista['origen_celda']}"
            if pista.get("origen_celda")
            else ""
        )
        print(
            f"  uid={pista['uid']}{referencia}{origen}: "
            f"{pista['actividad']}, día {etiqueta_dia} "
            f"{_hora_desde_minutos(pista['inicio_min'])}-"
            f"{_hora_desde_minutos(pista['fin_min'])}, "
            f"docente={pista['docente_id']}, cohorte={pista['cohorte']}."
        )

    if reporte["conflictos_directos"]:
        print("Conflictos directos detectados:")
        for conflicto in reporte["conflictos_directos"]:
            print(f"  - {conflicto}")
    else:
        print(
            "Sin colisiones directas detectables entre las asignaciones "
            "semilla; se comprobaron recursos, bandas y topes duros."
        )
    if reporte["observaciones"]:
        print("Observaciones (no son bloqueos duros):")
        for observacion in reporte["observaciones"]:
            print(f"  - {observacion}")

    if reporte["estado_sin_pistas"] == "INFACTIBLE":
        print(
            "Conclusión: el modelo ya es infactible sin imponer la semilla; "
            "las pistas no son la causa única."
        )
    elif reporte["estado_con_pistas"] == "INFACTIBLE":
        print(
            "Núcleo suficiente de supuestos semilla que fuerza la infactibilidad:"
        )
        if reporte["nucleo"]:
            for pista in reporte["nucleo"]:
                referencia = (
                    f"bloque #{pista['bloque']}, "
                    if pista.get("bloque") is not None
                    else ""
                )
                print(
                    f"  - {referencia}uid={pista['uid']} "
                    f"{pista['actividad']}, día {pista['dia']} "
                    f"{_hora_desde_minutos(pista['inicio_min'])}-"
                    f"{_hora_desde_minutos(pista['fin_min'])}."
                )
            print(
                "El núcleo identifica las pistas suficientes para el conflicto; "
                "CP-SAT no atribuye por sí solo el núcleo a una restricción "
                "individual. Revise las colisiones directas listadas arriba."
            )
        else:
            print(
                "El solver no devolvió pistas en el núcleo; la infactibilidad "
                "puede existir independientemente de los supuestos."
            )
    elif reporte["estado_con_pistas"] in {"OPTIMO", "FACTIBLE"}:
        print(
            "Conclusión: las pistas fijadas son compatibles con una solución "
            "del modelo y sus restricciones duras."
        )
    elif reporte["conflictos_directos"]:
        print(
            f"Conclusión: hay {len(reporte['conflictos_directos'])} conflicto(s) "
            "duro(s) directo(s) entre asignaciones semilla; esos bloques no "
            "pueden coexistir en un horario válido."
        )
        if reporte["estado_con_pistas"] == "DESCONOCIDO":
            print(
                "CP-SAT agotó el límite antes de probar el estado global o "
                "de producir un núcleo de supuestos; las contradicciones "
                "directas anteriores son verificaciones independientes."
            )
    else:
        print(
            "Conclusión: diagnóstico INCONCLUSO; el límite se agotó sin probar "
            "factibilidad ni infactibilidad. UNKNOWN no demuestra que la semilla "
            "sea incompatible."
        )
    print("Modo diagnóstico: no se generó horario ni se escribió en MySQL.")
    print("=" * 78)


def main(argv: list[str] | None = None) -> int:
    parser = construir_parser()
    args = parser.parse_args(argv)
    if args.tiempo_limite < TIEMPO_LIMITE_MINIMO:
        parser.error(
            f"--tiempo-limite debe ser de al menos "
            f"{TIEMPO_LIMITE_MINIMO:.0f} segundos."
        )
    if args.tiempo_diagnostico <= 0:
        parser.error("--tiempo-diagnostico debe ser mayor que cero.")
    if args.diagnostico_semilla and not args.horario_semilla:
        parser.error("--diagnostico-semilla requiere --horario-semilla.")
    if args.diagnostico_infactibilidad and not args.dry_run:
        parser.error("--diagnostico-infactibilidad requiere --dry-run.")
    if args.diagnostico_infactibilidad and args.diagnostico_semilla:
        parser.error(
            "Ejecute --diagnostico-infactibilidad y --diagnostico-semilla "
            "en corridas separadas."
        )
    if args.diagnostico_infactibilidad and (
        args.relajar_topes or args.modo_prueba_factibilidad
    ):
        parser.error(
            "--diagnostico-infactibilidad no admite relajaciones de restricciones."
        )
    if args.modo_prueba_factibilidad and not args.dry_run:
        parser.error("--modo-prueba-factibilidad requiere --dry-run.")
    if args.reemplazar_borradores_filtrados:
        if _lista_semestres(args.semestres) != {2}:
            parser.error(
                "--reemplazar-borradores-filtrados requiere exactamente "
                "--semestres II."
            )
        if args.reemplazar_borradores:
            parser.error(
                "No combine --reemplazar-borradores-filtrados con "
                "--reemplazar-borradores."
            )
    if args.excepcion_tope_docente and (
        args.periodo != "202620" or args.excepcion_tope_docente != "31=24"
    ):
        parser.error(
            "--excepcion-tope-docente solo acepta 31=24 con --periodo 202620."
        )
    if args.modo_prueba_factibilidad:
        args.relajar_topes = True
        args.sin_objetivo = True
    configurar_logging(args.verbose)

    repo: Repositorio | None = None
    logger_semilla: logging.Logger | None = None
    handler_semilla: logging.Handler | None = None
    try:
        cfg = construir_configuracion(args)
        log.info("Conectando a MySQL: %s", cfg.resumen)
        repo = Repositorio(cfg)
        pistas_semilla = {}
        if args.horario_semilla:
            args.log_semilla.parent.mkdir(parents=True, exist_ok=True)
            logger_semilla = logging.getLogger("solver_horarios.semilla")
            handler_semilla = logging.FileHandler(
                args.log_semilla, encoding="utf-8"
            )
            handler_semilla.setFormatter(
                logging.Formatter("%(asctime)s %(levelname)s %(message)s")
            )
            logger_semilla.addHandler(handler_semilla)
            logger_semilla.setLevel(logging.WARNING)
            logger_semilla.propagate = True

        periodo = _aplicar_fechas_periodo(
            repo.obtener_periodo(args.periodo),
            args.fecha_inicio,
            args.fecha_fin,
        )

        franja = repo.obtener_franja(periodo.id_periodo, periodo)
        compatibilidad = repo.obtener_compatibilidad(periodo.id_periodo)
        feriados = repo.obtener_feriados()

        ctx = construir_contexto(
            repo,
            periodo,
            franja,
            compatibilidad,
            feriados,
            periodo.fecha_inicio,
            carreras=_lista_texto(args.carreras),
            semestres=_lista_semestres(args.semestres),
            turnos=_lista_enteros(args.turnos, "Turno"),
            sedes=_lista_enteros(args.sedes, "Sede"),
            permitir_banda_alterna=args.permitir_banda_alterna,
        )
        _aplicar_excepcion_tope_docente(ctx, args.excepcion_tope_docente)
        verificar_asignaciones_docente(ctx)

        existentes = repo.contar_borradores(periodo.id_periodo)
        if (
            existentes
            and not args.dry_run
            and not args.diagnostico_semilla
            and not args.reemplazar_borradores
            and not args.reemplazar_borradores_filtrados
        ):
            raise ErrorDatos(
                f"El periodo {periodo.codigo} ya tiene {existentes} filas en "
                "estado BORRADOR. Use --dry-run o --reemplazar-borradores."
            )

        actividades = construir_actividades(
            ctx,
            permitir_generico=args.permitir_ambiente_generico,
            permitir_docente_inactivo=args.permitir_docente_inactivo,
            permitir_compresion_modular=args.permitir_compresion_modular,
        )
        resumen_semilla = None
        if args.horario_semilla:
            asociaciones_semilla: list[dict[str, Any]] = []
            pistas_semilla, resumen_semilla = preparar_pistas_semilla(
                args.horario_semilla,
                ctx,
                actividades,
                reporte_asociaciones=asociaciones_semilla,
            )
            asociaciones_por_ids: dict[tuple[int, int | None], int] = {}
            for asociacion in asociaciones_semilla:
                clave = (
                    asociacion["id_programacion"],
                    asociacion["id_docente"],
                )
                asociaciones_por_ids[clave] = asociaciones_por_ids.get(clave, 0) + 1
            print(
                "Horario semilla: "
                f"{resumen_semilla['validados']} validados, "
                f"{resumen_semilla['traducidos']} traducidos, "
                f"{resumen_semilla['inyectados']} pistas inyectadas, "
                f"{resumen_semilla['cohorte_docente_modalidad_horario']} "
                "mapeados por cohorte/docente/modalidad/día/hora, "
                f"{resumen_semilla['tolerancia_aplicada']} con tolerancia "
                f"de hasta {TOLERANCIA_HORARIA_MINUTOS} minutos."
            )
            print(
                "Asociaciones con IDs: "
                f"{len(asociaciones_semilla)} bloques; "
                f"{len({par[0] for par in asociaciones_por_ids})} "
                "id_programacion distintos; "
                f"{len({par[1] for par in asociaciones_por_ids if par[1] is not None})} "
                "id_docente distintos."
            )
            print("Bloques asociados por (id_programacion, id_docente):")
            for (id_programacion, id_docente), cantidad in sorted(
                asociaciones_por_ids.items(),
                key=lambda elemento: (
                    elemento[0][0],
                    elemento[0][1] if elemento[0][1] is not None else -1,
                ),
            ):
                print(
                    f"  id_programacion={id_programacion}, "
                    f"id_docente={id_docente}: {cantidad} bloque(s)"
                )
        if args.diagnostico_semilla:
            reporte = diagnosticar_pistas_semilla(
                ctx,
                actividades,
                pistas_semilla,
                asociaciones_semilla,
                tiempo_limite=args.tiempo_diagnostico,
                trabajadores=args.trabajadores,
                relajar_topes=args.relajar_topes,
            )
            _mostrar_diagnostico_semilla(reporte)
            return 0
        diagnosticar_y_validar(
            ctx, actividades, relajar_topes=args.relajar_topes
        )
        verificar_actividades_sin_ventana(ctx, actividades)
        verificar_margen_lectivo(ctx, actividades)
        verificar_plantilla_modular(ctx, actividades)
        verificar_capacidad_docente(
            ctx, actividades, relajar_topes=args.relajar_topes
        )

        if args.diagnostico_infactibilidad:
            reporte = diagnosticar_infactibilidad(
                ctx,
                actividades,
                tiempo_limite=args.tiempo_diagnostico,
            )
            print(
                "Diagnóstico de infactibilidad: "
                f"{reporte['estado']} en {reporte['tiempo_seg']:.2f} s; "
                f"{reporte['variables']} variables y "
                f"{reporte['restricciones']} restricciones."
            )
            if reporte["estado"] == "INFACTIBLE":
                print(
                    "Núcleo suficiente de grupos (no necesariamente mínimo):"
                )
                if reporte["nucleo_suficiente"]:
                    for grupo in reporte["nucleo_suficiente"]:
                        print(f"  - {grupo}")
                else:
                    print(
                        "  CP-SAT no devolvió etiquetas de supuesto para el "
                        "núcleo."
                    )
            elif reporte["estado"] == "DESCONOCIDO":
                print(
                    "El límite se agotó antes de probar factibilidad o "
                    "infactibilidad; no hay núcleo concluyente."
                )
            else:
                print(
                    "Los grupos duros resultaron simultáneamente factibles; "
                    "no se extrajo ni guardó un horario."
                )
            print("Diagnóstico separado: no se generó ni guardó horario.")
            return 0

        resultado = resolver_horario(
            ctx,
            actividades,
            tiempo_limite=args.tiempo_limite,
            trabajadores=args.trabajadores,
            semilla=args.semilla,
            relajar_topes=args.relajar_topes,
            sin_objetivo=args.sin_objetivo,
            modo_prueba_factibilidad=args.modo_prueba_factibilidad,
            verbose=args.verbose,
            pistas_semilla=pistas_semilla,
        )
        if args.modo_prueba_factibilidad:
            resultado.estado = f"{resultado.estado} (PRUEBA RELAJADA)"
        filas = preparar_filas(ctx, resultado.bloques)

        guardados: int | None = None
        if not args.dry_run:
            guardados = guardar_horario(
                repo,
                filas,
                id_periodo=periodo.id_periodo,
                reemplazar_borradores=args.reemplazar_borradores,
                reemplazar_programaciones=(
                    {oferta.id_programacion for oferta in ctx.ofertas}
                    if args.reemplazar_borradores_filtrados
                    else None
                ),
            )
        _mostrar_resumen(
            ctx,
            actividades,
            resultado,
            filas=filas,
            guardados=guardados,
            dry_run=args.dry_run,
        )
        return 0
    except (ErrorDatos, Infactible) as exc:
        log.error("%s", exc)
        return 2
    except KeyboardInterrupt:
        log.error("Ejecución cancelada por el usuario.")
        return 130
    except Exception as exc:  # pragma: no cover - borde de CLI
        if args.verbose:
            log.exception("Fallo inesperado")
        else:
            log.error("Fallo inesperado: %s", exc)
        return 1
    finally:
        if logger_semilla is not None and handler_semilla is not None:
            logger_semilla.removeHandler(handler_semilla)
            handler_semilla.close()
        if repo is not None:
            repo.cerrar()


if __name__ == "__main__":
    sys.exit(main())
