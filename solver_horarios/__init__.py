"""Motor de horarios académicos basado en MySQL + OR-Tools CP-SAT."""

from .actividades import construir_actividades
from .config import (
    ACADEMIC_HOUR_MIN,
    ErrorDatos,
    Infactible,
    construir_configuracion,
)
from .modelo import ResultadoHorario, resolver_horario, validar_solucion
from .persistencia import guardar_horario, preparar_filas
from .planificacion import Contexto, construir_contexto

__all__ = [
    "ACADEMIC_HOUR_MIN",
    "Contexto",
    "ErrorDatos",
    "Infactible",
    "ResultadoHorario",
    "construir_actividades",
    "construir_configuracion",
    "construir_contexto",
    "guardar_horario",
    "preparar_filas",
    "resolver_horario",
    "validar_solucion",
]
