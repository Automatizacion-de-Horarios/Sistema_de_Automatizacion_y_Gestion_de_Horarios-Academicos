"""CLI independiente para generar horarios por grupos de semestres."""

from __future__ import annotations

import argparse
import logging
import os
import sys

from solver_horarios.actividades import construir_actividades
from solver_horarios.config import (
    ErrorDatos,
    configurar_logging,
    construir_configuracion,
    numero_semestre,
)
from solver_horarios.db import Repositorio
from solver_horarios.persistencia import preparar_filas, resumir_persistencia
from solver_horarios.planificacion import construir_contexto
from solver_horarios.preflight import (
    diagnosticar_y_validar,
    verificar_actividades_sin_ventana,
    verificar_asignaciones_docente,
    verificar_capacidad_docente,
    verificar_margen_lectivo,
    verificar_plantilla_modular,
)
from solver_horarios_db import (
    _aplicar_excepcion_tope_docente,
    _lista_enteros,
    _lista_texto,
)

from .ocupaciones import (
    cargar_filas_periodo,
    cargar_ocupaciones_externas,
    detectar_conflictos_cruzados,
    detectar_conflictos_externos,
    ocupacion_desde_fila,
)
from .persistencia import guardar_grupo
from .resolver import resolver_grupo

log = logging.getLogger("solver_horarios_grupos")


def _semestres(valor: str) -> set[int]:
    resultado: set[int] = set()
    for parte in valor.replace(";", ",").split(","):
        parte = parte.strip()
        if not parte:
            continue
        numero = numero_semestre(parte)
        if numero < 1 or numero > 10:
            raise argparse.ArgumentTypeError(
                f"Semestre inválido: {parte!r}; use I..X o 1..10."
            )
        resultado.add(numero)
    if not resultado:
        raise argparse.ArgumentTypeError("Indique al menos un semestre.")
    return resultado


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Genera un grupo de semestres reservando los docentes y ambientes "
            "ocupados por horarios BORRADOR/CONFIRMADO del mismo periodo."
        )
    )
    parser.add_argument("--periodo", required=True, help="Código de periodo.")
    parser.add_argument(
        "--semestres",
        type=_semestres,
        help="Semestres separados por coma, por ejemplo II,IV o 2,4.",
    )
    parser.add_argument(
        "--auditar",
        action="store_true",
        help="Audita choques existentes entre programaciones del periodo y termina.",
    )
    parser.add_argument("--carreras", help="Códigos separados por coma.")
    parser.add_argument("--turnos", help="IDs de turno separados por coma.")
    parser.add_argument("--sedes", help="IDs de sede separados por coma.")
    parser.add_argument("--tiempo-limite", type=float, default=300.0)
    parser.add_argument(
        "--tiempo-diagnostico",
        type=float,
        default=120.0,
        help=(
            "Presupuesto en segundos para el aislamiento CP-SAT cuando el "
            "grupo es INFACTIBLE. Use 0 para desactivarlo."
        ),
    )
    parser.add_argument(
        "--trabajadores",
        type=int,
        default=max(1, min(8, os.cpu_count() or 1)),
    )
    parser.add_argument("--semilla", type=int, default=0)
    parser.add_argument(
        "--relajar-topes",
        action="store_true",
        help="Permite excesos de carga penalizados; no relaja la disponibilidad.",
    )
    parser.add_argument("--sin-objetivo", action="store_true")
    parser.add_argument("--permitir-ambiente-generico", action="store_true")
    parser.add_argument("--permitir-docente-inactivo", action="store_true")
    parser.add_argument("--permitir-compresion-modular", action="store_true")
    parser.add_argument(
        "--permitir-banda-alterna",
        action="store_true",
        help="Solo diagnóstico de banda; no relaja la disponibilidad docente.",
    )
    parser.add_argument("--excepcion-tope-docente")
    parser.add_argument(
        "--guardar",
        action="store_true",
        help=(
            "Guarda explícitamente y reemplaza solo los BORRADORES de las "
            "programaciones de este grupo. Sin esta opción, solo hace dry-run."
        ),
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    parser.add_argument("--mysql-host")
    parser.add_argument("--mysql-port")
    parser.add_argument("--mysql-user")
    parser.add_argument("--mysql-password")
    parser.add_argument("--mysql-db")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    if args.tiempo_limite <= 0:
        parser.error("--tiempo-limite debe ser mayor que cero.")
    if args.tiempo_diagnostico < 0:
        parser.error("--tiempo-diagnostico no puede ser negativo.")
    if args.trabajadores <= 0:
        parser.error("--trabajadores debe ser mayor que cero.")
    configurar_logging(args.verbose)
    repo: Repositorio | None = None
    try:
        repo = Repositorio(construir_configuracion(args))
        periodo = repo.obtener_periodo(args.periodo)
        if args.auditar:
            filas_actuales = cargar_filas_periodo(repo, periodo.id_periodo)
            ocupaciones_actuales = [
                ocupacion_desde_fila(fila) for fila in filas_actuales
            ]
            conflictos = detectar_conflictos_cruzados(ocupaciones_actuales)
            print(
                f"Auditoría del periodo {periodo.codigo}: "
                f"{len(ocupaciones_actuales)} bloques BORRADOR/CONFIRMADO."
            )
            if conflictos:
                print(f"Conflictos cruzados: {len(conflictos)}")
                for conflicto in conflictos:
                    print(f"  - {conflicto}")
                return 1
            print("No se encontraron choques cruzados de docente o ambiente.")
            return 0
        if args.semestres is None:
            parser.error("--semestres es obligatorio salvo que use --auditar.")

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
            semestres=args.semestres,
            turnos=_lista_enteros(args.turnos, "Turno"),
            sedes=_lista_enteros(args.sedes, "Sede"),
            permitir_banda_alterna=args.permitir_banda_alterna,
        )
        _aplicar_excepcion_tope_docente(ctx, args.excepcion_tope_docente)
        verificar_asignaciones_docente(ctx)
        actividades = construir_actividades(
            ctx,
            permitir_generico=args.permitir_ambiente_generico,
            permitir_docente_inactivo=args.permitir_docente_inactivo,
            permitir_compresion_modular=args.permitir_compresion_modular,
        )
        diagnosticar_y_validar(
            ctx, actividades, relajar_topes=args.relajar_topes
        )
        verificar_actividades_sin_ventana(ctx, actividades)
        verificar_margen_lectivo(ctx, actividades)
        verificar_plantilla_modular(ctx, actividades)
        verificar_capacidad_docente(
            ctx, actividades, relajar_topes=args.relajar_topes
        )

        id_programaciones = {oferta.id_programacion for oferta in ctx.ofertas}
        ocupaciones = cargar_ocupaciones_externas(
            repo, periodo.id_periodo, id_programaciones
        )
        resultado = resolver_grupo(
            ctx,
            actividades,
            ocupaciones,
            tiempo_limite=args.tiempo_limite,
            trabajadores=args.trabajadores,
            semilla=args.semilla,
            relajar_topes=args.relajar_topes,
            sin_objetivo=args.sin_objetivo,
            verbose=args.verbose,
            tiempo_diagnostico=args.tiempo_diagnostico,
        )
        filas = preparar_filas(ctx, resultado.bloques)
        conflictos = detectar_conflictos_externos(filas, ocupaciones)
        if conflictos:
            raise ErrorDatos(
                "La auditoría posterior encontró conflictos externos:\n"
                + "\n".join(f"  - {item}" for item in conflictos[:25])
            )

        guardados = None
        if args.guardar:
            guardados = guardar_grupo(
                repo,
                filas,
                id_periodo=periodo.id_periodo,
                id_programaciones=id_programaciones,
            )
        resumen = resumir_persistencia(filas, resultado.bloques)
        print(
            f"Periodo {periodo.codigo} | semestres "
            f"{','.join(map(str, sorted(args.semestres)))} | "
            f"{len(ctx.ofertas)} ofertas | {len(actividades)} actividades"
        )
        print(
            f"Estado {resultado.estado} en {resultado.tiempo_seg:.2f} s | "
            f"{len(ocupaciones)} bloques externos verificados | "
            f"{resumen.filas} filas propuestas"
        )
        print("Sin choques de docente/aula contra otros horarios del periodo.")
        if args.guardar:
            print(
                f"Guardadas {guardados} filas BORRADOR; solo se reemplazaron "
                "borradores de las programaciones seleccionadas."
            )
        else:
            print("Dry-run: no se modificó MySQL. Use --guardar para persistir.")
        for advertencia in resultado.advertencias:
            print(f"Advertencia: {advertencia}")
        return 0
    except RuntimeError as exc:
        log.error("%s", exc)
        return 2
    except KeyboardInterrupt:
        log.error("Ejecución cancelada.")
        return 130
    except Exception:
        log.exception("Fallo inesperado en el flujo por grupos.")
        return 1
    finally:
        if repo is not None:
            repo.cerrar()


if __name__ == "__main__":
    sys.exit(main())
