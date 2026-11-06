"""Constantes institucionales, modelos de datos y utilidades comunes.

Ningún dato académico (cursos, docentes, turnos, feriados, ambientes) se
declara aquí: todo eso se consulta en MySQL. Las constantes de este módulo son
reglas de negocio documentadas en `docs/reglas_de_negocio_detalladas.md`.
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Iterable

# ---------------------------------------------------------------------------
# Reglas institucionales
# ---------------------------------------------------------------------------

ACADEMIC_HOUR_MIN = 45          # 1 hora académica = 45 minutos reales
GRID_MIN = 15                   # granularidad de la grilla
MAX_SESSION_ACAD_HOURS = 3      # receso obligatorio cada 3 horas académicas
BREAK_MIN = 15                  # receso estándar
LONG_BREAK_MIN = 45             # descanso mayor del docente
LONG_BREAK_THRESHOLD = 5        # se activa tras 5 horas académicas en el día
MAX_TEACHER_DAILY_ACAD_HOURS = 8  # tope diario en horas académicas
MAX_TEACHER_DAILY_SPAN_MIN = 9 * 60  # 9 h reloj entre la primera y última clase
MAX_COHORT_DAILY_ACAD_HOURS = 10  # capacidad diaria estimada para la preferencia TEC
MAX_COHORT_DAILY_SPAN_MIN = 8 * 60  # jornada máxima real de estudiantes por día
MAX_COHORT_CROSS_TURN_GAP_MIN = 30  # holgura máxima entre clases consecutivas de una cohorte
# En los semestres superiores (III-VI) la primera clase del día puede ser en
# mañana, tarde o noche, pero no puede iniciar después de las 20:00.
MAX_COHORT_FIRST_CLASS_START_MIN = 20 * 60
SEMANAS_LECTIVAS = 16            # semanas regulares de docencia
MARGEN_RECUPERACION = 2          # semanas 17-18: sólo recuperación de feriados
SEMANAS_CURSO_PARALELO = SEMANAS_LECTIVAS  # cursos largos van en paralelo

MORNING_START_MIN = 7 * 60 + 45  # Inicio permitido de la banda mañana
MORNING_END_MIN = 12 * 60 + 45  # 12:45, límite del turno mañana
AFTERNOON_START_MIN = 12 * 60 + 45
NIGHT_START_MIN = 18 * 60
TURNO_2_NIGHT_END_MIN = 21 * 60  # el segundo turno no puede cerrar después de 21:00

EMP_START_MIN = 8 * 60          # prácticas en empresa: 08:00
EMP_END_MIN = 14 * 60           # prácticas en empresa: 14:00
EMP_MAX_ACAD_HOURS = 8          # 08:00-14:00 = 6 h reales = 8 h académicas

# Peso de la función objetivo para la preferencia de banda. No se aplica a
# docentes concretos: cualquier actividad se compara con la banda primaria de su
# cohorte. La disponibilidad docente es una restricción dura y no se penaliza:
# simplemente queda fuera del dominio de pares candidatos. El peso es
# deliberadamente alto para que las demás preferencias blandas (orden TEC/TAL,
# concentración por días, inicios tempranos) no desplacen bloques completos a
# una banda secundaria por conveniencia matemática.
PENALIZACION_DESVIACION_FRANJA = 200_000   # banda secundaria

# Preferencia de recesos cortos. La continuidad de cohorte permite 15 o 30
# minutos entre bloques del mismo turno; 15 es el valor normal y 30 solo debe
# aparecer cuando no exista otra combinación razonable. Es una preferencia
# blanda: nunca vuelve infactible el horario.
PENALIZACION_RECESO_30 = 300_000

# Continuidad de aula común. Si dos bloques consecutivos de la misma cohorte,
# separados solo por 15 minutos, son del mismo docente o del mismo curso, deben
# permanecer en la misma aula CLAS cuando exista una alternativa común. Las
# aulas CLAS son equivalentes; cambiar de salón tras un receso solo agrega
# traslados innecesarios. Es una preferencia fuerte, no una restricción dura,
# para no volver infactible un horario cuando la disponibilidad de aulas obliga
# a moverse. No aplica a laboratorios especializados.
PENALIZACION_CAMBIO_AULA_CLAS = 1_500_000

# Control de turno único. Un día "partido" combina mañana (clase 0) con
# tarde/noche (clases 1 y 2) para el mismo docente o la misma cohorte. La
# penalización del docente es la más severa: solo debe aceptarse cuando no
# exista otra combinación factible. La de cohorte evita que los estudiantes
# queden repartidos entre turnos el mismo día.
PENALIZACION_DOBLE_TURNO_DIARIO = 5_000_000
PENALIZACION_DOBLE_TURNO_COHORTE = 1_000_000

# Cuando un grupo TEC de carrera cabe en un solo día (pocas horas semanales),
# cada día adicional usado paga esta penalización. Es menor que la de día
# partido para que, si concentrar todo exige mañana y tarde, el modelo siga
# prefiriendo la alternativa de un solo turno antes que partir la jornada.
PENALIZACION_TEC_DIA_ADICIONAL = 2_000_000

# Las horas virtuales no deben quedar pegadas a la carga presencial de la misma
# cohorte: un margen corto obliga al estudiante a permanecer en la sede o a
# trasladarse sin tiempo suficiente. El modelo prefiere al menos 90 minutos de
# separación; si no puede lograrlo, paga una penalización alta. La separación es
# una preferencia fuerte, no una restricción dura, para no volver infactible un
# horario con la presencialidad muy concentrada.
VIR_SEPARACION_PREFERIDA_MIN = 90
PENALIZACION_VIR_CERCANIA = 500_000

DIAS_INTERNOS = ("LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO", "DOMINGO")
DIAS_DB = ("LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO", "DOMINGO")

ROMANOS = {
    "I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6,
    "VII": 7, "VIII": 8, "IX": 9, "X": 10,
}


class ErrorDatos(RuntimeError):
    """Los datos maestros son inconsistentes o insuficientes."""


class Infactible(RuntimeError):
    """CP-SAT demuestra que no existe solución con las restricciones dadas."""


# ---------------------------------------------------------------------------
# Utilidades de normalización
# ---------------------------------------------------------------------------


def sin_acentos(texto: object) -> str:
    """Mayúsculas sin tildes, útil para comparar días y descripciones."""
    normal = unicodedata.normalize("NFKD", str(texto or ""))
    return "".join(c for c in normal if not unicodedata.combining(c)).upper().strip()


def normalizar_dia(valor: object) -> str:
    """Devuelve un día interno (LUNES..DOMINGO) o cadena vacía."""
    dia = sin_acentos(valor).replace(".", "")
    equivalencias = {
        "LUN": "LUNES", "MAR": "MARTES", "MIE": "MIERCOLES",
        "JUE": "JUEVES", "VIE": "VIERNES", "SAB": "SABADO", "DOM": "DOMINGO",
    }
    if dia in DIAS_INTERNOS:
        return dia
    return equivalencias.get(dia, "")


def indice_dia(valor: object) -> int | None:
    dia = normalizar_dia(valor)
    if not dia:
        return None
    return DIAS_INTERNOS.index(dia)


def dia_db(indice: int) -> str:
    return DIAS_DB[indice]


def minutos_de_hora(valor: object) -> int | None:
    """Convierte TIME de MySQL (timedelta), time, datetime o texto a minutos."""
    if valor is None:
        return None
    if isinstance(valor, timedelta):
        return int(valor.total_seconds() // 60)
    if isinstance(valor, datetime):
        return valor.hour * 60 + valor.minute
    if isinstance(valor, time):
        return valor.hour * 60 + valor.minute
    texto = str(valor).strip()
    if not texto:
        return None
    coincidencia = re.fullmatch(r"(\d{1,2}):(\d{2})(?::(\d{2}))?", texto)
    if not coincidencia:
        raise ErrorDatos(f"Hora inválida en la base de datos: {valor!r}")
    horas, minutos, segundos = coincidencia.groups()
    if int(horas) > 23 or int(minutos) > 59 or int(segundos or 0) > 59:
        raise ErrorDatos(f"Hora inválida en la base de datos: {valor!r}")
    return int(horas) * 60 + int(minutos)


def alinear_grilla(minuto: int) -> int:
    """Redondea hacia arriba al siguiente múltiplo de 15 minutos."""
    return ((int(minuto) + GRID_MIN - 1) // GRID_MIN) * GRID_MIN


def formatear_hora(minuto: int) -> str:
    minuto = int(minuto) % (24 * 60)
    return f"{minuto // 60:02d}:{minuto % 60:02d}:00"


def a_time(minuto: int) -> time:
    minuto = int(minuto) % (24 * 60)
    return time(minuto // 60, minuto % 60)


def numero_semestre(valor: object) -> int:
    """Convierte 'II', '2', 'VI' al número de ciclo; 0 si no se reconoce."""
    texto = sin_acentos(valor)
    if texto in ROMANOS:
        return ROMANOS[texto]
    if texto.isdigit():
        return int(texto)
    coincidencia = re.search(r"(I{1,3}|IV|V|VI{0,3}|IX|X|\d+)$", texto)
    if coincidencia:
        token = coincidencia.group(1)
        if token.isdigit():
            return int(token)
        return ROMANOS.get(token, 0)
    return 0


def clave_natural_codigo(mat_cur: object) -> tuple:
    """Orden natural por código: PIAD-221 antes que PIAD-222."""
    texto = str(mat_cur or "").strip().upper()
    prefijo, _, sufijo = texto.rpartition("-")
    if sufijo.isdigit():
        return (prefijo, int(sufijo), texto)
    numeros = re.findall(r"\d+", texto)
    return (texto, int(numeros[0]) if numeros else 10**9, texto)


def distribuir_entero(total: int, partes: int) -> list[int]:
    """Reparte `total` en `partes` bloques equilibrados (diferencia máxima 1)."""
    if partes <= 0:
        return []
    base, residuo = divmod(max(0, int(total)), int(partes))
    return [base + (1 if i < residuo else 0) for i in range(partes)]


def distribuir_semanas(total_horas: int, semanas: int) -> list[int]:
    """Horas semanales: parte entera y residuo en las primeras semanas.

    Ejemplo: 50 horas en 18 semanas -> 2 horas durante 14 semanas y 3 horas
    durante las primeras 4. La suma siempre es exactamente `total_horas`.
    """
    if total_horas <= 0 or semanas <= 0:
        return []
    base, residuo = divmod(int(total_horas), int(semanas))
    return [base + (1 if semana < residuo else 0) for semana in range(semanas)]


def agrupar_semanas(horas_semanales: Iterable[int]) -> list[tuple[int, int, int]]:
    """Agrupa semanas consecutivas con la misma carga.

    Devuelve (inicio, fin_exclusivo, horas_semanales) para emitir un bloque
    `semana_inicio..semana_fin` en lugar de una fila por semana.
    """
    grupos: list[tuple[int, int, int]] = []
    inicio = 0
    actual: int | None = None
    horas_lista = list(horas_semanales)
    for indice, horas in enumerate(horas_lista):
        if horas <= 0:
            if actual is not None:
                grupos.append((inicio, indice, actual))
                actual = None
            continue
        if actual is None:
            inicio, actual = indice, horas
        elif horas != actual:
            grupos.append((inicio, indice, actual))
            inicio, actual = indice, horas
    if actual is not None:
        grupos.append((inicio, len(horas_lista), actual))
    return grupos


# ---------------------------------------------------------------------------
# Modelos de datos
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ConfiguracionDb:
    host: str
    puerto: int
    usuario: str
    password: str
    base_datos: str

    @property
    def resumen(self) -> str:
        return f"{self.usuario}@{self.host}:{self.puerto}/{self.base_datos}"


@dataclass(frozen=True)
class Periodo:
    id_periodo: int
    codigo: str
    descripcion: str
    semanas: int
    fecha_inicio: date | None = None
    fecha_fin: date | None = None


@dataclass(frozen=True)
class FranjaInstitucional:
    inicio_min: int
    cierre_min: int
    incluir_domingo: bool


@dataclass(frozen=True)
class Docente:
    id_docente: int
    nombre: str
    tipo_contrato: str
    horas_meta: int
    usa_restriccion: bool
    estado: str
    # día interno -> tuplas (inicio_min, fin_min)
    disponibilidad: dict[int, tuple[tuple[int, int], ...]] = field(default_factory=dict)
    tope_semanal_override: int | None = None

    @property
    def tope_semanal(self) -> int:
        """Tope semanal según contrato, en horas reloj (no académicas)."""
        if self.tope_semanal_override is not None:
            return self.tope_semanal_override
        contrato = sin_acentos(self.tipo_contrato)
        if "COMPLETO" in contrato:
            return 36
        if "PARCIAL" in contrato:
            # 19 h (lunes-viernes) o 23 h (lunes-sábado). La BD guarda la meta;
            # si no es válida se usa el tope institucional más alto.
            return self.horas_meta if self.horas_meta in (19, 23) else 23
        return self.horas_meta if self.horas_meta > 0 else 23

    @property
    def tope_semanal_min(self) -> int:
        """Tope semanal expresado en minutos reales para comparar con la grilla.

        Las actividades miden su duración real en ``duracion_min`` (una hora
        académica son 45 minutos). El contrato, en cambio, se expresa en horas
        reloj, igual que la disponibilidad que captura el frontend.
        """
        return self.tope_semanal * 60


@dataclass(frozen=True)
class Curso:
    id_curso: int
    id_semestre: int
    id_carrera: int
    codigo_carrera: str
    semestre_romano: str
    semestre_num: int
    mat_cur: str
    nombre: str
    semanas_db: int | None
    horas_tec: int
    horas_tal: int
    horas_vir: int
    horas_eval: int
    total_horas: int
    is_carrera: bool
    horario_sinfo: str

    @property
    def es_practica_empresa(self) -> bool:
        return sin_acentos(self.horario_sinfo) == "EMP" or "PRACTICA EN EMPRESA" in sin_acentos(self.nombre)


@dataclass
class Oferta:
    id_programacion: int
    id_periodo: int
    id_sede: int
    id_turno: int
    grupo: str
    id_docente_tec: int | None
    id_docente_tal: int | None
    curso: Curso
    # Ventana de semanas asignada (0-based, fin exclusivo)
    ventana_inicio: int = 0
    ventana_fin: int = 0
    # Plantilla modular compartida por los módulos de una misma cohorte.
    # Sólo se asigna a cursos modulares TEC/TAL; VIR queda flexible.
    plantilla_id: str | None = None
    modulo_orden: int = 0

    @property
    def cohorte(self) -> tuple:
        return (
            self.id_sede,
            self.curso.id_carrera,
            self.curso.semestre_num,
            self.id_turno,
            str(self.grupo),
        )

    @property
    def cohorte_turnos(self) -> tuple:
        """Identifica el grupo de estudiantes independientemente del turno."""
        return (
            self.id_sede,
            self.curso.id_carrera,
            self.curso.semestre_num,
            str(self.grupo),
        )


@dataclass(frozen=True)
class Ambiente:
    id_ambiente: int
    codigo: str
    id_tipo: int
    tipo: str
    aforo: int
    estado: str
    id_sede: int


def ambiente_es_aula_comun(ambiente: Ambiente) -> bool:
    return sin_acentos(ambiente.tipo) in {
        "AULA",
        "AULA COMUN",
        "AULA GENERAL",
    }


@dataclass
class Actividad:
    """Bloque semanal recurrente que se convertirá en filas de horario."""
    uid: int
    oferta: Oferta
    modalidad: str                 # TEC | TAL | VIR | EMP
    semana_inicio: int             # 0-based, inclusivo
    semana_fin: int                # 0-based, exclusivo
    horas_academicas: int
    duracion_min: int
    docente_id: int | None
    ambientes: tuple[int, ...]
    enlace_dia: str | None = None
    # Identifican el slot de la plantilla modular (sólo TEC/TAL).
    plantilla_id: str | None = None
    plantilla_slot: str | None = None

    @property
    def descripcion(self) -> str:
        return (
            f"{self.oferta.curso.mat_cur} [{self.modalidad}] "
            f"prog={self.oferta.id_programacion} "
            f"semanas={self.semana_inicio + 1}-{self.semana_fin}"
        )


@dataclass
class BloqueProgramado:
    actividad: Actividad
    dia: int
    inicio_min: int
    fin_min: int
    id_ambiente: int | None


@dataclass
class Calendario:
    """Mapeo opcional de semanas a fechas reales para aplicar feriados."""
    inicio: date | None
    fin: date | None
    semanas: int
    feriados: frozenset[date]

    @property
    def disponible(self) -> bool:
        return self.inicio is not None

    def _lunes_base(self) -> date | None:
        if self.inicio is None:
            return None
        return self.inicio - timedelta(days=self.inicio.weekday())

    def fecha(self, semana: int, dia: int) -> date | None:
        lunes = self._lunes_base()
        if lunes is None:
            return None
        return lunes + timedelta(weeks=semana, days=dia)

    def es_feriado(self, semana: int, dia: int) -> bool:
        fecha = self.fecha(semana, dia)
        return fecha is not None and fecha in self.feriados

    def fuera_de_periodo(self, semana: int, dia: int) -> bool:
        fecha = self.fecha(semana, dia)
        if fecha is None:
            return False
        if self.inicio is not None and fecha < self.inicio:
            return True
        if self.fin is not None and fecha > self.fin:
            return True
        return False

    def dividir_rango(self, inicio: int, fin: int, dia: int) -> list[tuple[int, int]]:
        """Divide un rango de semanas alrededor de feriados del día elegido."""
        if not self.disponible:
            return [(inicio, fin)]
        resultado: list[tuple[int, int]] = []
        tramo_inicio: int | None = None
        for semana in range(inicio, fin):
            bloqueada = self.es_feriado(semana, dia) or self.fuera_de_periodo(semana, dia)
            if bloqueada:
                if tramo_inicio is not None:
                    resultado.append((tramo_inicio, semana))
                    tramo_inicio = None
            elif tramo_inicio is None:
                tramo_inicio = semana
        if tramo_inicio is not None:
            resultado.append((tramo_inicio, fin))
        return resultado


# ---------------------------------------------------------------------------
# Configuración de ejecución
# ---------------------------------------------------------------------------


def _leer_env(ruta: Path) -> dict[str, str]:
    valores: dict[str, str] = {}
    if not ruta.is_file():
        return valores
    for linea in ruta.read_text(encoding="utf-8", errors="replace").splitlines():
        linea = linea.strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        clave, valor = linea.split("=", 1)
        valores[clave.strip()] = valor.strip().strip('"').strip("'")
    return valores


def construir_configuracion(args: argparse.Namespace) -> ConfiguracionDb:
    """Lee credenciales del entorno y/o del .env del proyecto."""
    raiz = Path(__file__).resolve().parent.parent
    env = _leer_env(raiz / ".env")
    host = args.mysql_host or os.environ.get("MYSQL_HOST") or env.get("MYSQL_HOST", "")
    usuario = args.mysql_user or os.environ.get("MYSQL_USER") or env.get("MYSQL_USER", "")
    password = (
        args.mysql_password
        if args.mysql_password is not None
        else os.environ.get("MYSQL_PASSWORD", env.get("MYSQL_PASSWORD", ""))
    )
    base = args.mysql_db or os.environ.get("MYSQL_DB") or env.get("MYSQL_DB", "")
    puerto_txt = args.mysql_port or os.environ.get("MYSQL_PORT") or env.get("MYSQL_PORT", "3306")
    try:
        puerto = int(puerto_txt)
    except (TypeError, ValueError) as exc:
        raise ErrorDatos(f"MYSQL_PORT inválido: {puerto_txt!r}") from exc
    faltantes = [
        nombre for nombre, valor in (
            ("MYSQL_HOST", host), ("MYSQL_USER", usuario),
            ("MYSQL_DB", base), ("MYSQL_PASSWORD", password),
        ) if not valor
    ]
    if faltantes:
        raise ErrorDatos(
            "Faltan variables de conexión: " + ", ".join(faltantes)
            + ". Defínalas en .env o pase --mysql-host/--mysql-user/--mysql-password/--mysql-db."
        )
    return ConfiguracionDb(
        host=host, puerto=puerto, usuario=usuario, password=password, base_datos=base,
    )


def configurar_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s | %(levelname)-8s | %(message)s",
        datefmt="%H:%M:%S",
    )
