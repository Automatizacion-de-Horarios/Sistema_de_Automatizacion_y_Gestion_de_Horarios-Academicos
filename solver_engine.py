import json
import os
import re
import tempfile
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from itertools import combinations, product
from pathlib import Path

try:
    from ortools.sat.python import cp_model
except ImportError as exc:
    raise SystemExit(
        "Falta OR-Tools. Instálalo con: python -m pip install ortools"
    ) from exc


TIME_LIMIT_SECONDS = float(os.environ.get("CP_SAT_TIME_LIMIT", "300"))
PHASE1_TIME_LIMIT = float(os.environ.get("CP_SAT_PHASE1_LIMIT", "180"))
DISABLED_CONSTRAINTS = {
    value.strip().upper()
    for value in os.environ.get("CP_SAT_DISABLE", "").split(",")
    if value.strip()
}


def constraint_enabled(name):
    return name not in DISABLED_CONSTRAINTS


# La disponibilidad docente se aplica como restricción dura (restringiendo el
# dominio de horas de inicio). Si un docente no tiene ninguna franja viable
# para una sesión concreta, se libera su jornada para esa sesión y se advierte.
HARD_AVAILABILITY = os.environ.get("CP_SAT_HARD_AVAILABILITY", "1") != "0"
STRICT_HARD_RULES = os.environ.get("CP_SAT_STRICT_HARD_RULES", "0") == "1"
# El término de huecos por sección (S2) genera muchísimas variables y vuelve
# inviable la mejora dentro del límite de tiempo. Se deja opt-in.
GAP_OBJECTIVE = os.environ.get("CP_SAT_ENABLE_GAP", "0") != "0"
RELAXED_TEACHERS = {
    value.strip()
    for value in os.environ.get("CP_SAT_RELAX_TEACHERS", "").split(";")
    if value.strip()
}
GRID_STEP_MINUTES = 15
ACADEMIC_HOUR_MINUTES = 45
MAX_BLOCK_ACADEMIC_HOURS = 3
# Los bloques semanales se limitan a 2 horas académicas (90 min) para que
# quepan en las franjas reales de disponibilidad docente, que suelen ser
# fragmentadas. El receso obligatorio sigue rigiéndose por las 3 horas.
# La Formación Práctica en Empresa (EMP) es la excepción: se planifica en
# bloques completos de 08:00 a 14:00.
MAX_MEETING_MINUTES = 90
DAYS = ("LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO")
DAY_TO_INDEX = {name: index for index, name in enumerate(DAYS)}
ROOT = Path(__file__).resolve().parent
JSON_DIR = Path(os.environ.get("CP_SAT_JSON_DIR", str(ROOT / "json")))
OUTPUT_PATH = Path(
    os.environ.get(
        "CP_SAT_OUTPUT",
        str(ROOT / "horarios_generados" / "horario_generado.json"),
    )
)

# Jornadas por defecto cuando reglas_horario.json no define sus horas.
TARDE_DEFAULT = (12 * 60 + 45, 19 * 60)
NOCHE_DEFAULT = (19 * 60, 22 * 60 + 45)


class InfeasibleDataError(RuntimeError):
    """Los datos de entrada se contradicen entre sí (no es un fallo del solver)."""


class InfeasibleScheduleError(RuntimeError):
    """Las restricciones duras no permiten construir un horario."""


def get_emp_config(rules):
    """Normaliza la configuración de Formación Práctica en Empresa (EMP).

    Devuelve un diccionario con minutos y banderas. Si el archivo de reglas
    todavía no trae la ventana estricta, se usan 08:00–14:00 como valores
    seguros (regla institucional de prácticas en empresa).
    """
    raw = (
        rules.get("turnos_y_reglas_especiales", {}).get("practicas_empresa", {})
        or {}
    )
    start = parse_time(raw.get("hora_inicio", "08:00"), "practicas_empresa.hora_inicio")
    end = parse_time(raw.get("hora_fin", "14:00"), "practicas_empresa.hora_fin")
    if end <= start:
        raise ValueError("La ventana de prácticas en empresa es inválida.")
    return {
        "solo_mananas": bool(raw.get("solo_mananas", True)),
        "sin_receso_intermedio": bool(raw.get("sin_receso_intermedio", True)),
        "ventana_estricta": bool(raw.get("ventana_estricta", True)),
        "bloques_completos": bool(raw.get("bloques_completos", True)),
        "dias_consecutivos": bool(raw.get("dias_consecutivos", True)),
        "dias_minimos": max(1, int(raw.get("dias_minimos", 2) or 2)),
        "sin_mezclar_con": {
            str(value).upper() for value in raw.get("sin_mezclar_con", ("TEC", "TAL"))
        },
        "inicio": start,
        "fin": end,
        "bloque_minutos": end - start,
    }


def get_turn_windows(rules, config):
    """Ventanas de jornada (minutos) tal como las define reglas_horario.json."""
    time_rules = rules.get("parametros_tiempo", {})
    morning = (
        rules.get("distribucion_turnos_semestre", {})
        .get("semestres_1_2", {})
        .get("turno_1", {})
    )
    morning_start = parse_time(
        morning.get("hora_inicio_base", "07:45"), "hora_inicio_base"
    )
    morning_end = parse_time(
        morning.get("hora_fin_limite") or config.get("limite_turno_manana", "12:45"),
        "hora_fin_limite",
    )
    operational = config.get("franja_operativa", {})
    close = parse_time(operational.get("hora_fin", "23:00"), "franja_operativa.hora_fin")
    tarde = (morning_end, min(TARDE_DEFAULT[1], close))
    noche = (max(TARDE_DEFAULT[1], tarde[0]), min(NOCHE_DEFAULT[1], close))
    return {
        "MANANA": (morning_start, morning_end),
        "TARDE": tarde,
        "NOCHE": noche,
    }, int(time_rules.get("duracion_hora_academica_minutos", 45))


def turn_windows_for_course(semester, rules, config, kind=None, emp_config=None):
    """Jornadas permitidas para un curso según su semestre y tipo.

    La EMP se rige exclusivamente por su ventana estricta (08:00–14:00) y es
    la única excepción a la distribución por turnos.
    """
    if kind == "EMP" and emp_config is not None:
        return [(emp_config["inicio"], emp_config["fin"])]
    windows, _ = get_turn_windows(rules, config)
    distribution = rules.get("distribucion_turnos_semestre", {})
    if semester <= 2:
        names = ["MANANA", "TARDE", "NOCHE"]
    elif semester == 3:
        names = ["MANANA", "TARDE", "NOCHE"]
    else:
        names = [
            str(value).upper()
            for value in distribution.get("semestres_4_5_6", {}).get(
                "turnos_permitidos", ["TARDE", "NOCHE"]
            )
        ]
    result = []
    for name in names:
        window = windows.get(name)
        if window and window not in result:
            result.append(window)
    return result


@dataclass(eq=False)
class Course:
    key: str
    mat_cur: str
    name: str
    career: str
    career_code: str
    semester: int
    section: str
    teacher: str
    start_date: date
    end_date: date
    duration_weeks: int
    tec_weeks: int = 0
    tal_weeks: int = 0
    virtual_weeks: int = 0
    emp_days: int = 0
    emp_weekly_minutes: int = 0
    emp_planned_minutes: int = 0
    emp_block_minutes: int = 0


@dataclass(frozen=True)
class Meeting:
    key: str
    course: Course
    kind: str
    duration_minutes: int


def load_json(filename):
    path = JSON_DIR / filename
    with path.open("r", encoding="utf-8") as source:
        return json.load(source)


def parse_date(value, field_name):
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError as exc:
        raise ValueError(f"Fecha inválida en {field_name}: {value!r}") from exc


def parse_time(value, field_name):
    try:
        parsed = datetime.strptime(str(value), "%H:%M")
    except ValueError as exc:
        raise ValueError(f"Hora inválida en {field_name}: {value!r}") from exc
    return parsed.hour * 60 + parsed.minute


def format_time(minutes):
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def normalize_name(value):
    decomposed = unicodedata.normalize("NFKD", str(value or ""))
    plain = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return " ".join(plain.upper().split())


def normalize_course_code(value):
    return re.sub(r"\s+", "", str(value or "")).upper()


def reference_section_from_block(block):
    match = re.match(r"^56([A-Z]{4})[A-Z]*?(\d{2,3})$", str(block or "").upper())
    if not match:
        return None
    career, digits = match.groups()
    if len(digits) == 2:
        digits = "2" + digits
    return f"{career}-{digits}"


def load_reference_preferences(path):
    """Extrae el patrón orientativo (días por curso) del horario de referencia."""
    if not path.exists():
        return {}
    try:
        rows = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}

    preferences = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    for row in rows:
        section = reference_section_from_block(row.get("bloque"))
        if not section:
            continue
        mat_cur = normalize_course_code(row.get("mat_cur"))
        kind = str(row.get("actividad") or "").strip().upper()
        day = normalize_name(row.get("dia"))
        if not mat_cur or kind not in ("TEC", "TAL", "VIR") or day not in DAY_TO_INDEX:
            continue
        preferences[(mat_cur, section)][kind][day] += 1
    return preferences


def parse_holidays(rows, semester_start, semester_end):
    result = set()
    for row in rows:
        formatted = row.get("fecha_formatted")
        if formatted:
            try:
                month, day = (int(part) for part in str(formatted).split("-"))
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Fecha de feriado inválida: {formatted!r}") from exc
        else:
            month_name = normalize_name(row.get("mes", ""))
            month_names = {
                "ENERO": 1, "FEBRERO": 2, "MARZO": 3, "ABRIL": 4,
                "MAYO": 5, "JUNIO": 6, "JULIO": 7, "AGOSTO": 8,
                "SEPTIEMBRE": 9, "OCTUBRE": 10, "NOVIEMBRE": 11,
                "DICIEMBRE": 12,
            }
            if month_name not in month_names or not row.get("dia"):
                raise ValueError(f"Registro de feriado incompleto: {row!r}")
            month, day = month_names[month_name], int(row["dia"])

        try:
            holiday = date(semester_start.year, month, day)
        except ValueError as exc:
            raise ValueError(f"Fecha de feriado inválida: {row!r}") from exc
        if semester_start <= holiday <= semester_end:
            result.add(holiday)
    return result


def academic_hours_to_minutes(value, context, academic_hour_minutes):
    try:
        quarter_hours = (
            Decimal(str(value)) * academic_hour_minutes / GRID_STEP_MINUTES
        ).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError(f"Horas semanales inválidas para {context}: {value!r}") from exc
    return int(quarter_hours) * GRID_STEP_MINUTES


def split_duration(
    duration_minutes, kind, academic_hour_minutes, max_block_hours, minimum_meetings=1
):
    """Divide la carga semanal en bloques equilibrados de como máximo 3 h.

    Los bloques equilibrados permiten encajar la clase y su receso de 15 min
    dentro de franjas docentes de 4 horas. Repartir la carga en bloques máximos
    seguidos de un bloque residual pequeño vuelve imposible ese encaje.
    """
    if duration_minutes <= 0:
        return []
    max_duration = min(max_block_hours * academic_hour_minutes, MAX_MEETING_MINUTES)
    units = duration_minutes // GRID_STEP_MINUTES
    if units <= 0:
        return []
    max_units = max(1, max_duration // GRID_STEP_MINUTES)
    required = max(1, (units + max_units - 1) // max_units)
    if kind == "TAL":
        required = max(required, minimum_meetings)
    required = min(required, units)

    base, remainder = divmod(units, required)
    pieces = [
        (base + (1 if index < remainder else 0)) * GRID_STEP_MINUTES
        for index in range(required)
    ]
    return pieces


def semester_teaching_weeks(semester_start, semester_end):
    """Semanas completas disponibles entre las fechas globales del semestre."""
    days = (semester_end - semester_start).days
    return max(1, days // 7)


def component_weeks(total_hours, weekly_hours, semester, semester_weeks, is_tal):
    """Duración dinámica: horas totales / horas semanales programadas.

    Para los seminarios TAL de 4.º a 6.º semestre, reglas_horario.json indica
    que el seminario asume las horas TAL durante 16 semanas. Por eso su carga
    total se reparte en la ventana completa del semestre en lugar de usar las
    semanas del bloque modular original.
    """
    if total_hours <= 0:
        return 0
    if is_tal and semester >= 4:
        return semester_weeks
    if weekly_hours <= 0:
        return semester_weeks
    return max(1, int(round(total_hours / weekly_hours)))


def sort_key_curso(mat_cur):
    """Orden natural ascendente por código (PIAD-221 antes que PIAD-222)."""
    prefix, _, suffix = str(mat_cur).rpartition("-")
    return (prefix, int(suffix) if suffix.isdigit() else 10**6, str(mat_cur))


def assign_course_windows(
    courses, semester_start, semester_end, semester_weeks,
    comunes_prefixes=("CGEU", "SCOU", "SPSU", "SCIU", "SINU"),
):
    """Ordena los cursos de carrera con TEC de una sección en secuencia.

    Reglas aplicadas:
      - Los cursos de carrera con componente TEC se dictan de uno a la vez,
        en orden ascendente por código (PIAD-221 termina antes de que
        empiece PIAD-222).
      - Los cursos de carrera cuyo TEC cubre todo el semestre (núcleos de 16
        semanas) se dejan en la ventana global, igual que el patrón de
        referencia.
      - Los cursos comunes (CGEU/SCOU/SPSU...) se dictan durante todo el
        semestre.
    """
    groups = defaultdict(list)
    for course in courses:
        prefix = course.mat_cur.split("-", 1)[0].upper()
        if prefix in comunes_prefixes:
            continue
        # Sólo entran en la secuencia los módulos "cortos" de carrera con TEC.
        # Los núcleos que cubren (casi) todo el semestre se dictan en paralelo,
        # igual que en el patrón de referencia.
        if course.tec_weeks <= 0 or course.duration_weeks >= semester_weeks - 1:
            continue
        if not course.teacher:
            continue
        groups[course.section].append(course)

    overflow = []
    assigned = set()
    for section, group in groups.items():
        group.sort(key=lambda item: sort_key_curso(item.mat_cur))
        offset = 0
        for course in group:
            if offset + course.duration_weeks > semester_weeks:
                overflow.append((section, course.mat_cur))
                offset = max(0, semester_weeks - course.duration_weeks)
            course.start_date = semester_start + timedelta(weeks=offset)
            course.end_date = min(
                course.start_date + timedelta(weeks=course.duration_weeks) - timedelta(days=1),
                semester_end,
            )
            assigned.add(course.key)
            offset += course.duration_weeks

    for course in courses:
        if course.key in assigned:
            continue
        course.start_date = semester_start
        course.end_date = min(
            semester_start + timedelta(weeks=course.duration_weeks) - timedelta(days=1),
            semester_end,
        )

    if overflow:
        total = {
            section: sum(course.duration_weeks for course in group)
            for section, group in groups.items()
            if group
        }
        for section, weeks in sorted(total.items()):
            if weeks > semester_weeks:
                print(f"INFO: módulos TEC de carrera de {section} suman {weeks} semanas.")


def build_courses_and_meetings(
    assignments, catalog, hours, semester_start, semester_end,
    academic_hour_minutes, max_block_hours, minimum_tal_days,
    semester_weeks=None, comunes_prefixes=("CGEU", "SCOU", "SPSU", "SCIU", "SINU"),
    emp_config=None,
):
    if semester_weeks is None:
        semester_weeks = semester_teaching_weeks(semester_start, semester_end)

    courses = []
    meetings = []
    seen = set()

    for index, row in enumerate(assignments):
        mat_cur = str(row.get("mat_cur", "")).strip().upper()
        section = str(row.get("seccion", "")).strip()
        if not mat_cur or not section:
            raise ValueError(f"Asignación sin MAT_CUR o sección: {row!r}")
        if mat_cur not in hours:
            raise ValueError(f"No hay horas semanales para {mat_cur} ({section}).")

        unique_key = (mat_cur, section)
        if unique_key in seen:
            raise ValueError(f"Asignación duplicada: {mat_cur} / {section}.")
        seen.add(unique_key)

        catalog_row = catalog.get(mat_cur)
        if catalog_row is None:
            raise ValueError(f"{mat_cur} no existe en json/cursos.json.")

        career_code = section.split("-", 1)[0].upper()
        career = str(row.get("carrera") or catalog_row.get("carrera") or "").strip()
        semester = int(row.get("semestre") or catalog_row.get("semestre") or 0)
        if not career or semester <= 0:
            raise ValueError(f"Carrera o semestre incompletos para {mat_cur} / {section}.")
        teacher = str(row.get("docente") or "").strip()
        course_name = str(row.get("curso") or catalog_row.get("nombre") or mat_cur).strip()
        if not teacher and "FORMACION PRACTICA EN EMPRESA" not in normalize_name(course_name):
            raise ValueError(
                f"{mat_cur} / {section} no tiene docente y no está identificado "
                "como Formación Práctica en Empresa."
            )

        weekly = hours[mat_cur].get("horas_semanales")
        if not isinstance(weekly, dict):
            raise ValueError(f"Faltan horas_semanales para {mat_cur}.")

        total_tec = float(hours[mat_cur].get("teoria_tec", 0) or 0)
        total_tal = float(hours[mat_cur].get("taller_empresa", 0) or 0)
        total_vir = float(hours[mat_cur].get("virtual", 0) or 0)
        tec_weeks = component_weeks(
            total_tec, float(weekly.get("teoria_tec", 0) or 0),
            semester, semester_weeks, False,
        )
        tal_weeks = component_weeks(
            total_tal, float(weekly.get("taller_empresa", 0) or 0),
            semester, semester_weeks, True,
        )
        virtual_weeks = component_weeks(
            total_vir, float(weekly.get("virtual", 0) or 0),
            semester, semester_weeks, False,
        )
        duration_weeks = max(tec_weeks, tal_weeks, virtual_weeks, 1)
        duration_weeks = min(duration_weeks, semester_weeks)

        course = Course(
            key=f"{index}:{mat_cur}:{section}",
            mat_cur=mat_cur,
            name=course_name,
            career=career,
            career_code=career_code,
            semester=semester,
            section=section,
            teacher=teacher,
            start_date=semester_start,
            end_date=semester_end,
            duration_weeks=duration_weeks,
            tec_weeks=tec_weeks,
            tal_weeks=tal_weeks,
            virtual_weeks=virtual_weeks,
        )
        courses.append(course)

        components = (
            ("teoria_tec", "TEC", total_tec, tec_weeks),
            ("taller_empresa", "TAL", total_tal, tal_weeks),
        )
        for component, kind, total_hours, weeks in components:
            if total_hours <= 0 or weeks <= 0:
                continue
            weekly_minutes = academic_hours_to_minutes(
                total_hours / weeks, f"{mat_cur}.{component}", academic_hour_minutes
            )
            actual_kind = kind if teacher else "EMP"

            if (
                actual_kind == "EMP"
                and emp_config is not None
                and emp_config.get("bloques_completos", True)
            ):
                # Regla EMP: la práctica se realiza en bloques completos de
                # 08:00 a 14:00, en días consecutivos. La carga semanal se
                # expresa en días completos (mínimo `dias_minimos`). El ajuste
                # queda registrado en el curso para el reporte de auditoría.
                block_minutes = int(emp_config["bloque_minutos"])
                minimum_days = int(emp_config.get("dias_minimos", 2))
                days = int(round(weekly_minutes / block_minutes)) if block_minutes else 0
                days = min(len(DAYS), max(minimum_days, days))
                course.emp_days = days
                course.emp_weekly_minutes = weekly_minutes
                course.emp_planned_minutes = days * block_minutes
                course.emp_block_minutes = block_minutes
                durations = [block_minutes] * days
            else:
                durations = split_duration(
                    weekly_minutes, actual_kind, academic_hour_minutes, max_block_hours,
                    minimum_tal_days if actual_kind == "TAL" else 1,
                )

            for block_index, duration in enumerate(durations):
                meetings.append(Meeting(
                    key=f"{course.key}:{actual_kind}:{block_index}",
                    course=course,
                    kind=actual_kind,
                    duration_minutes=duration,
                ))

        if total_vir > 0 and virtual_weeks > 0:
            weekly_virtual = academic_hours_to_minutes(
                total_vir / virtual_weeks, f"{mat_cur}.virtual", academic_hour_minutes
            )
            for block_index, duration in enumerate(split_duration(
                weekly_virtual, "VIR", academic_hour_minutes, max_block_hours
            )):
                meetings.append(Meeting(
                    key=f"{course.key}:VIR:{block_index}",
                    course=course,
                    kind="VIR",
                    duration_minutes=duration,
                ))

    assign_course_windows(
        courses, semester_start, semester_end, semester_weeks,
        comunes_prefixes=comunes_prefixes,
    )
    return courses, meetings


def build_room_candidates(meeting, rooms, environment_rules, hard, h6_careers):
    if meeting.kind in ("EMP", "VIR"):
        return []

    compatible = []
    strict_compatibility = hard.get("H5_compatibilidad_carrera_laboratorio", True)
    requires_lab = (
        hard.get("H6_laboratorio_obligatorio_carreras_tecnicas", False)
        and meeting.course.career_code in h6_careers
    )

    for room_index, room in enumerate(rooms):
        is_lab = str(room.get("area", "")).upper().startswith("LABORATORIO")
        if requires_lab and not is_lab:
            continue
        if not strict_compatibility:
            compatible.append(room_index)
            continue

        rule = environment_rules.get(str(room.get("area", "")))
        if not rule:
            continue
        course_match = meeting.course.mat_cur in set(rule.get("cursos_codigos", []))
        careers = {str(value).upper() for value in rule.get("carreras_permitidas", [])}
        career_match = "TODAS" in careers or meeting.course.career_code in careers
        kind_match = meeting.kind in {
            str(value).upper() for value in rule.get("tipo_clase", [])
        }
        if course_match or (career_match and kind_match):
            compatible.append(room_index)

    if not compatible and STRICT_HARD_RULES:
        return []
    if not compatible:
        fallback = list(range(len(rooms)))
        return fallback
    return compatible


def active_weekdays(course, holidays):
    weekdays = set()
    cursor = course.start_date
    while cursor <= course.end_date:
        if cursor.weekday() < len(DAYS) and cursor not in holidays:
            weekdays.add(cursor.weekday())
        cursor += timedelta(days=1)
    return weekdays


def is_emp_session(meeting):
    return meeting.kind == "EMP"


def requires_section_break(left, right, threshold_minutes):
    # Las prácticas en empresa no llevan receso (regla: EMP en mañanas, sin
    # receso de por medio).
    if is_emp_session(left) or is_emp_session(right):
        return False
    return (
        left.course.mat_cur != right.course.mat_cur
        or left.duration_minutes + right.duration_minutes >= threshold_minutes
    )


def requires_hard_section_break(left, right, threshold_minutes):
    if is_emp_session(left) or is_emp_session(right):
        return False
    return (
        left.course.mat_cur == right.course.mat_cur
        and left.duration_minutes + right.duration_minutes >= threshold_minutes
    )


def make_date_groups(meetings, semester_start, semester_end, holidays):
    groups = defaultdict(int)
    for current in date_range(semester_start, semester_end):
        if current.weekday() >= len(DAYS) or current in holidays:
            continue
        active = tuple(
            meeting.key for meeting in meetings
            if meeting.course.start_date <= current <= meeting.course.end_date
        )
        if active:
            groups[(current.weekday(), active)] += 1
    return groups


def generate_fallback_schedule(
    assignments, catalog, hours, availability, rooms, holidays,
    semester_start, semester_end, open_minute, close_minute,
    required_break, block_break_threshold, hard, period,
    attempt=0, allow_short_transitions=False, emp_config=None, strict=False,
):
    courses, meetings = build_courses_and_meetings(
        assignments, catalog, hours, semester_start, semester_end,
        ACADEMIC_HOUR_MINUTES, MAX_BLOCK_ACADEMIC_HOURS, 2,
        emp_config=emp_config,
    )

    environment_rules = {
        str(row["area"]): row for row in load_json("reglas_ambientes.json")
    }
    fallback_rules = load_json("reglas_horario.json")
    fallback_config = load_json("config_semestre.json")
    if emp_config is None:
        emp_config = get_emp_config(fallback_rules)
    teacher_busy = build_teacher_busy(availability, open_minute, close_minute)
    if hard.get("H2_respetar_disponibilidad_docente", True):
        for meeting in meetings:
            teacher_key = normalize_name(meeting.course.teacher)
            if teacher_key and teacher_key not in teacher_busy:
                teacher_busy[teacher_key] = {
                    day_index: [(open_minute, close_minute)]
                    for day_index in range(len(DAYS))
                }

    active_dates = {}
    for course in courses:
        dates_by_day = defaultdict(set)
        for current in date_range(course.start_date, course.end_date):
            if current.weekday() < len(DAYS) and current not in holidays:
                dates_by_day[current.weekday()].add(current)
        active_dates[course.key] = dates_by_day

    emp_days_by_course = {}
    if strict:
        for course in courses:
            if not any(
                meeting.course.key == course.key and meeting.kind == "EMP"
                for meeting in meetings
            ):
                continue
            active_days = sorted(active_dates[course.key])
            consecutive_pairs = [
                (left, right)
                for left, right in zip(active_days, active_days[1:])
                if right == left + 1
            ]
            if not consecutive_pairs:
                raise InfeasibleScheduleError(
                    f"No hay dos días activos consecutivos para EMP "
                    f"{course.mat_cur} / {course.section}."
                )
            emp_days_by_course[course.key] = consecutive_pairs[
                attempt % len(consecutive_pairs)
            ]

    section_placements = defaultdict(list)
    teacher_placements = defaultdict(list)
    room_placements = defaultdict(list)
    tal_days = defaultdict(set)
    tal_meeting_counts = defaultdict(int)
    emp_used_days = defaultdict(set)
    tec_day_by_course = {}
    for meeting in meetings:
        if meeting.kind == "TAL":
            key = (meeting.course.key, meeting.kind)
            tal_meeting_counts[key] += 1

    def shares_occurrence(left, right, day_index):
        return bool(
            active_dates[left.course.key][day_index]
            & active_dates[right.course.key][day_index]
        )

    def has_required_gap(start, end, other_start, other_end):
        return end + required_break <= other_start or start >= other_end + required_break

    def concurrent_load(placed, meeting, day):
        return sum(
            other["end"] - other["start"] + required_break
            for other in placed
            if shares_occurrence(meeting, other["meeting"], day)
        )

    schedule = []

    def fallback_priority(meeting):
        days = active_dates[meeting.course.key]
        teacher_key = normalize_name(meeting.course.teacher)
        busy_by_day = (
            teacher_busy.get(teacher_key, {})
            if hard.get("H2_respetar_disponibilidad_docente", True) and teacher_key
            else {}
        )
        legal_days = sum(
            any(
                all(
                    start + meeting.duration_minutes <= occupied_start
                    or start >= occupied_end
                    for occupied_start, occupied_end in busy_by_day.get(day, [])
                )
                for start in range(
                    open_minute,
                    close_minute - meeting.duration_minutes + 1,
                    GRID_STEP_MINUTES,
                )
            )
            for day in days
        )
        room_candidates_for_meeting = build_room_candidates(
            meeting, rooms, environment_rules, hard,
            {"PIAD", "PCBD", "PGDT", "PCID"},
        )
        room_count = (
            len(room_candidates_for_meeting)
            if meeting.kind not in ("EMP", "VIR")
            else len(rooms) + 1
        )
        date_span = (meeting.course.end_date - meeting.course.start_date).days
        scores = (
            (
                legal_days, len(days), room_count, -meeting.duration_minutes,
                date_span, meeting.course.section, meeting.key,
            ),
            (
                room_count, legal_days, date_span, -meeting.duration_minutes,
                len(days), meeting.course.section, meeting.key,
            ),
            (
                len(days), legal_days, -meeting.duration_minutes, room_count,
                date_span, meeting.course.section, meeting.key,
            ),
            (
                legal_days, room_count, -meeting.duration_minutes, len(days),
                date_span, meeting.course.section, meeting.key,
            ),
        )
        return scores[attempt % len(scores)]

    def place_tec_group(group):
        course = group[0].course
        allowed_windows = turn_windows_for_course(
            course.semester, fallback_rules, fallback_config, "TEC", emp_config
        )
        reserved_emp_days = {
            day
            for emp_course in courses
            if emp_course.section == course.section
            for day in emp_days_by_course.get(emp_course.key, ())
        }
        days = [
            day for day in sorted(active_dates[course.key])
            if day not in reserved_emp_days
        ]
        days.sort(key=lambda day: (
            concurrent_load(
                section_placements[(course.section, day)], group[0], day
            ),
            concurrent_load(
                teacher_placements[(normalize_name(course.teacher), day)],
                group[0],
                day,
            ) if course.teacher else 0,
            (day + attempt) % len(DAYS),
        ))
        blockers = defaultdict(int)

        def pack_windows(window_index, remaining):
            if not remaining:
                yield ((),) * (len(allowed_windows) - window_index)
                return
            if window_index == len(allowed_windows):
                return

            capacity = (
                allowed_windows[window_index][1]
                - allowed_windows[window_index][0]
            )
            for count in range(len(remaining), 0, -1):
                for selected in combinations(remaining, count):
                    window_group = [group[index] for index in selected]
                    shortest_first = sorted(
                        window_group,
                        key=lambda meeting: (
                            meeting.duration_minutes, meeting.key
                        ),
                    )
                    occupied = sum(
                        meeting.duration_minutes for meeting in shortest_first
                    )
                    occupied += sum(
                        required_break
                        for left, right in zip(
                            shortest_first, shortest_first[1:]
                        )
                        if requires_hard_section_break(
                            left, right, block_break_threshold
                        )
                    )
                    if occupied > capacity:
                        continue

                    selected_set = set(selected)
                    rest = tuple(
                        index for index in remaining if index not in selected_set
                    )
                    for tail in pack_windows(window_index + 1, rest):
                        yield (selected, *tail)

            for tail in pack_windows(window_index + 1, remaining):
                yield ((), *tail)

        def proposal_layouts():
            layouts_found = False
            for layout in pack_windows(0, tuple(range(len(group)))):
                layouts_found = True
                offset_ranges = []
                for window_index, selected in enumerate(layout):
                    if not selected:
                        offset_ranges.append((0,))
                        continue
                    window_start, window_end = allowed_windows[window_index]
                    window_group = sorted(
                        (group[index] for index in selected),
                        key=lambda meeting: (
                            -meeting.duration_minutes, meeting.key
                        ),
                    )
                    occupied = sum(
                        meeting.duration_minutes for meeting in window_group
                    )
                    occupied += sum(
                        required_break
                        for left, right in zip(
                            window_group, window_group[1:]
                        )
                        if requires_hard_section_break(
                            left, right, block_break_threshold
                        )
                    )
                    latest_offset = window_end - window_start - occupied
                    offset_ranges.append(tuple(
                        range(
                            0,
                            latest_offset + 1,
                            GRID_STEP_MINUTES,
                        )
                    ))
                for offsets in product(*offset_ranges):
                    yield layout, offsets
            if not layouts_found:
                blockers["window_capacity"] += 1

        for day_index in days:
            for layout, offsets in proposal_layouts():
                proposed = []
                previous = None
                previous_end = None
                for window_index, selected in enumerate(layout):
                    if not selected:
                        continue
                    window_start, window_end = allowed_windows[window_index]
                    cursor = window_start + offsets[window_index]
                    window_group = sorted(
                        (group[index] for index in selected),
                        key=lambda meeting: (
                            -meeting.duration_minutes, meeting.key
                        ),
                    )
                    for meeting in window_group:
                        if previous is not None:
                            gap = (
                                required_break
                                if requires_hard_section_break(
                                    previous, meeting, block_break_threshold
                                )
                                else 0
                            )
                            cursor = max(cursor, previous_end + gap)
                        start = cursor
                        end = start + meeting.duration_minutes
                        if end > window_end:
                            proposed = []
                            break
                        proposed.append((meeting, start, end))
                        previous = meeting
                        previous_end = end
                        cursor = end
                    if not proposed and selected:
                        break
                if len(proposed) != len(group):
                    blockers["window"] += 1
                    continue

                local_sections = []
                local_teachers = []
                local_rooms = []
                accepted = []
                valid = True
                for meeting, start, end in proposed:
                    if any(
                        start < occupied_end and end > occupied_start
                        for occupied_start, occupied_end
                        in teacher_busy.get(
                            normalize_name(course.teacher), {}
                        ).get(day_index, [])
                    ):
                        blockers["availability"] += 1
                        valid = False
                        break
                    for other in (
                        section_placements[(course.section, day_index)]
                        + local_sections
                    ):
                        if not shares_occurrence(meeting, other["meeting"], day_index):
                            continue
                        same_course = other["meeting"].course.mat_cur == course.mat_cur
                        requires_gap = not same_course or requires_hard_section_break(
                            meeting, other["meeting"], block_break_threshold
                        )
                        separated = (
                            has_required_gap(start, end, other["start"], other["end"])
                            if requires_gap
                            else end <= other["start"] or start >= other["end"]
                        )
                        if not separated:
                            blockers["section"] += 1
                            valid = False
                            break
                    if not valid:
                        break
                    if course.teacher:
                        for other in (
                            teacher_placements[
                                (normalize_name(course.teacher), day_index)
                            ] + local_teachers
                        ):
                            if (
                                shares_occurrence(
                                    meeting, other["meeting"], day_index
                                )
                                and start < other["end"]
                                and end > other["start"]
                            ):
                                blockers["teacher"] += 1
                                valid = False
                                break
                    if not valid:
                        break

                    room_candidates = build_room_candidates(
                        meeting,
                        rooms,
                        environment_rules,
                        hard,
                        {"PIAD", "PCBD", "PGDT", "PCID"},
                    )
                    chosen_room = next((
                        room_index
                        for room_index in room_candidates
                        if all(
                            not shares_occurrence(
                                meeting, other["meeting"], day_index
                            )
                            or end <= other["start"]
                            or start >= other["end"]
                            for other in (
                                room_placements[(room_index, day_index)]
                                + [
                                    entry for entry in local_rooms
                                    if entry["room"] == room_index
                                ]
                            )
                        )
                    ), None)
                    if chosen_room is None:
                        blockers["room"] += 1
                        valid = False
                        break
                    placement = {
                        "meeting": meeting,
                        "day": day_index,
                        "start": start,
                        "end": end,
                        "room": chosen_room,
                    }
                    accepted.append(placement)
                    local_sections.append(placement)
                    local_teachers.append(placement)
                    local_rooms.append({**placement, "room": chosen_room})
                if not valid:
                    continue

                for placement in accepted:
                    meeting = placement["meeting"]
                    section_placements[(course.section, day_index)].append(placement)
                    if course.teacher:
                        teacher_placements[
                            (normalize_name(course.teacher), day_index)
                        ].append(placement)
                    room_placements[(placement["room"], day_index)].append(placement)
                    exclusions = sorted(
                        holiday.isoformat()
                        for holiday in holidays
                        if course.start_date <= holiday <= course.end_date
                        and holiday.weekday() == day_index
                    )
                    schedule.append({
                        "periodo": period,
                        "dia": DAYS[day_index],
                        "hora_inicio": format_time(placement["start"]),
                        "hora_fin": format_time(placement["end"]),
                        "curso": course.name,
                        "mat_cur": course.mat_cur,
                        "tipo_clase": "TEC",
                        "docente": course.teacher,
                        "aula": (
                            f"{rooms[placement['room']]['edificio']} · "
                            f"{rooms[placement['room']]['salon']}"
                        ),
                        "grupo": course.section,
                        "seccion": course.section,
                        "carrera": course.career,
                        "semestre": course.semester,
                        "fecha_inicio": course.start_date.isoformat(),
                        "fecha_fin": course.end_date.isoformat(),
                        "fechas_excluidas": exclusions,
                    })
                tec_day_by_course[course.key] = day_index
                return True, {}
        return False, dict(blockers)

    meeting_groups = defaultdict(list)
    for meeting in meetings:
        meeting_groups[(meeting.course.key, meeting.kind)].append(meeting)

    def fallback_group_priority(group):
        course = group[0].course
        kind = group[0].kind
        kind_order = {"EMP": 0, "TEC": 1, "TAL": 2, "VIR": 3}.get(kind, 4)
        if kind == "TEC":
            reserved_emp_days = {
                day
                for emp_course in courses
                if emp_course.section == course.section
                for day in emp_days_by_course.get(emp_course.key, ())
            }
            available_days = set(active_dates[course.key]) - reserved_emp_days
            windows = turn_windows_for_course(
                course.semester, fallback_rules, fallback_config, "TEC", emp_config
            )
            return (
                kind_order,
                len(available_days),
                len(windows),
                -len(group),
                -sum(meeting.duration_minutes for meeting in group),
                course.start_date,
                course.end_date,
                course.section,
                course.key,
            )
        return (
            kind_order,
            min(fallback_priority(meeting)[:-1] for meeting in group),
            -len(group),
            -sum(meeting.duration_minutes for meeting in group),
        )

    ordered_groups = sorted(
        meeting_groups.values(),
        key=fallback_group_priority,
    )
    meeting_order = [
        meeting
        for group in ordered_groups
        for meeting in sorted(group, key=lambda item: item.key)
    ]
    processed_tec_groups = set()
    for meeting in meeting_order:
        course = meeting.course
        group_key = (course.key, "TEC")
        if strict and meeting.kind == "TEC":
            if group_key in processed_tec_groups:
                continue
            processed_tec_groups.add(group_key)
            placed, group_blockers = place_tec_group(meeting_groups[group_key])
            if not placed:
                raise InfeasibleScheduleError(
                    f"No se pudo ubicar de forma continua la carga TEC "
                    f"{course.mat_cur} / {course.section} en un solo día; "
                    f"sesiones {[item.duration_minutes for item in meeting_groups[group_key]]}, "
                    f"ventanas {turn_windows_for_course(course.semester, fallback_rules, fallback_config, 'TEC', emp_config)}, "
                    f"días {[DAYS[day] for day in sorted(active_dates[course.key])]}, "
                    f"bloqueos {group_blockers}."
                )
            continue
        day_candidates = sorted(active_dates[course.key])
        if strict and meeting.kind == "EMP":
            day_candidates = list(emp_days_by_course[course.key])
        elif strict and meeting.kind in emp_config["sin_mezclar_con"]:
            reserved_emp_days = {
                day
                for emp_course in courses
                if emp_course.section == course.section
                for day in emp_days_by_course.get(emp_course.key, ())
            }
            day_candidates = [
                day for day in day_candidates if day not in reserved_emp_days
            ]
        if strict and meeting.kind == "TEC":
            tec_rules = fallback_rules.get(
                "turnos_y_reglas_especiales", {}
            ).get("tec", {})
            modular_rules = fallback_rules.get(
                "modos_dictado", {}
            ).get("modular_tec_carrera", {})
            modular = (
                course.semester >= 4
                and course.mat_cur.startswith(f"{course.career_code}-")
                and course.duration_weeks == int(
                    modular_rules.get("semanas_duracion", 4)
                )
                and modular_rules.get("compactacion") == "UN_SOLO_DIA_POR_SEMANA"
            )
            if tec_rules.get("un_dia_por_semana", True) or modular:
                selected_day = tec_day_by_course.get(course.key)
                if selected_day is not None:
                    day_candidates = [
                        day for day in day_candidates if day == selected_day
                    ]
        room_candidates = build_room_candidates(
            meeting, rooms, environment_rules, hard, {"PIAD", "PCBD", "PGDT", "PCID"}
        )
        if meeting.kind not in ("EMP", "VIR") and not room_candidates:
            raise ValueError(f"No hay ambientes compatibles para {meeting.key}.")

        placed = False
        teacher_key = normalize_name(course.teacher)
        availability_by_day = (
            teacher_busy.get(teacher_key, {})
            if hard.get("H2_respetar_disponibilidad_docente", True) and teacher_key
            else {}
        )
        day_candidates.sort(key=lambda day: (
            concurrent_load(
                section_placements[(course.section, day)], meeting, day
            ),
            concurrent_load(
                teacher_placements[(teacher_key, day)], meeting, day
            ) if teacher_key else 0,
            (day + attempt) % len(DAYS),
        ))
        blocked_counts = defaultdict(int)

        for day_index in day_candidates:
            if meeting.kind == "EMP" and day_index in emp_used_days[course.key]:
                continue
            unavailable_spans = availability_by_day.get(day_index, [])
            if meeting.kind == "TAL":
                key = (course.key, meeting.kind)
                if (
                    len(tal_days[key]) < 2
                    and day_index in tal_days[key]
                    and len(tal_days[key]) < tal_meeting_counts[key]
                ):
                    continue

            if meeting.kind == "EMP" and strict:
                candidate_starts = [emp_config["inicio"]]
            else:
                windows = turn_windows_for_course(
                    course.semester,
                    fallback_rules,
                    fallback_config,
                    meeting.kind,
                    emp_config,
                )
                candidate_starts = [
                    start
                    for window_start, window_end in windows
                    for start in range(
                        max(open_minute, window_start),
                        min(close_minute, window_end)
                        - meeting.duration_minutes + 1,
                        GRID_STEP_MINUTES,
                    )
                ]
            if attempt % 2:
                candidate_starts.reverse()
            if allow_short_transitions:
                def transition_penalty(candidate_start):
                    candidate_end = candidate_start + meeting.duration_minutes
                    return sum(
                        1
                        for other in section_placements[(course.section, day_index)]
                        if (
                            other["meeting"].course.mat_cur != course.mat_cur
                            and shares_occurrence(meeting, other["meeting"], day_index)
                            and not has_required_gap(
                                candidate_start, candidate_end,
                                other["start"], other["end"],
                            )
                        )
                    )

                candidate_starts.sort(key=transition_penalty)
            for start in candidate_starts:
                end = start + meeting.duration_minutes
                if any(
                    start < occupied_end and end > occupied_start
                    for occupied_start, occupied_end in unavailable_spans
                ):
                    blocked_counts["availability"] += 1
                    continue

                section_conflict = False
                for other in section_placements[(course.section, day_index)]:
                    if shares_occurrence(meeting, other["meeting"], day_index):
                        same_course = other["meeting"].course.mat_cur == course.mat_cur
                        no_overlap = end <= other["start"] or start >= other["end"]
                        needs_hard_break = requires_hard_section_break(
                            meeting, other["meeting"], block_break_threshold
                        )
                        if same_course:
                            separated = (
                                has_required_gap(start, end, other["start"], other["end"])
                                if needs_hard_break else no_overlap
                            )
                        elif strict or not allow_short_transitions:
                            separated = has_required_gap(
                                start, end, other["start"], other["end"]
                            )
                        else:
                            separated = has_required_gap(
                                start, end, other["start"], other["end"]
                            ) or no_overlap
                        if not separated:
                            section_conflict = True
                            break
                if section_conflict:
                    blocked_counts["section"] += 1
                    continue

                teacher_conflict = False
                if hard.get("H1_no_cruce_docentes", True) and teacher_key and meeting.kind not in ("EMP", "VIR"):
                    for other in teacher_placements[(teacher_key, day_index)]:
                        if shares_occurrence(meeting, other["meeting"], day_index) and (
                            start < other["end"] and end > other["start"]
                        ):
                            teacher_conflict = True
                            break
                if teacher_conflict:
                    blocked_counts["teacher"] += 1
                    continue

                room_options = room_candidates if meeting.kind not in ("EMP", "VIR") else [None]
                chosen_room = None
                for room_index in room_options:
                    if room_index is None or not hard.get("H4_no_cruce_ambientes", True):
                        chosen_room = room_index
                        break
                    room_key = (room_index, day_index)
                    if all(
                        not shares_occurrence(meeting, other["meeting"], day_index)
                        or end <= other["start"]
                        or start >= other["end"]
                        for other in room_placements[room_key]
                    ):
                        chosen_room = room_index
                        break
                else:
                    blocked_counts["room"] += 1
                    continue

                placement = {
                    "meeting": meeting,
                    "day": day_index,
                    "start": start,
                    "end": end,
                    "room": chosen_room,
                }
                section_placements[(course.section, day_index)].append(placement)
                if teacher_key and meeting.kind not in ("EMP", "VIR"):
                    teacher_placements[(teacher_key, day_index)].append(placement)
                if chosen_room is not None:
                    room_placements[(chosen_room, day_index)].append(placement)
                if meeting.kind == "TAL":
                    tal_days[(course.key, meeting.kind)].add(day_index)
                if meeting.kind == "EMP":
                    emp_used_days[course.key].add(day_index)
                if meeting.kind == "TEC":
                    tec_day_by_course[course.key] = day_index
                exclusions = sorted(
                    holiday.isoformat()
                    for holiday in holidays
                    if course.start_date <= holiday <= course.end_date
                    and holiday.weekday() == day_index
                )
                schedule.append({
                    "periodo": period,
                    "dia": DAYS[day_index],
                    "hora_inicio": format_time(start),
                    "hora_fin": format_time(end),
                    "curso": course.name,
                    "mat_cur": course.mat_cur,
                    "tipo_clase": meeting.kind,
                    "docente": course.teacher if meeting.kind not in ("EMP", "VIR") else "",
                    "aula": (
                        None if chosen_room is None else
                        f"{rooms[chosen_room]['edificio']} · {rooms[chosen_room]['salon']}"
                    ),
                    "grupo": course.section,
                    "seccion": course.section,
                    "carrera": course.career,
                    "semestre": course.semester,
                    "fecha_inicio": course.start_date.isoformat(),
                    "fecha_fin": course.end_date.isoformat(),
                    "fechas_excluidas": exclusions,
                })
                placed = True
                break
            if placed:
                break

        if not placed:
            if strict:
                section_load = [
                    f"{entry['meeting'].course.mat_cur}/{entry['meeting'].kind} "
                    f"{format_time(entry['start'])}-{format_time(entry['end'])}"
                    for day in day_candidates
                    for entry in section_placements[(course.section, day)]
                    if shares_occurrence(meeting, entry["meeting"], day)
                ]
                raise InfeasibleScheduleError(
                    f"El algoritmo estricto no pudo ubicar {meeting.key}. "
                    f"Días activos: {[DAYS[day] for day in day_candidates]}; "
                    f"bloqueos de candidatos: {dict(blocked_counts)}; "
                    f"carga de sección: {section_load[:30]}."
                )
            if attempt < 3:
                return generate_fallback_schedule(
                    assignments, catalog, hours, availability, rooms, holidays,
                    semester_start, semester_end, open_minute, close_minute,
                    required_break, block_break_threshold, hard, period, attempt + 1,
                    allow_short_transitions, emp_config=emp_config, strict=strict,
                )
            if not allow_short_transitions:
                return generate_fallback_schedule(
                    assignments, catalog, hours, availability, rooms, holidays,
                    semester_start, semester_end, open_minute, close_minute,
                    required_break, block_break_threshold, hard, period,
                    allow_short_transitions=True, emp_config=emp_config,
                    strict=strict,
                )
            raise ValueError(
                f"No se encontró un horario que respete disponibilidad, docentes, "
                f"salones y recesos para {meeting.key}. "
                f"Días activos: {[DAYS[day] for day in day_candidates]}; "
                f"bloqueos de candidatos: {dict(blocked_counts)}."
            )

    schedule.sort(
        key=lambda row: (
            row["grupo"], DAYS.index(row["dia"]), row["hora_inicio"], row["mat_cur"], row["tipo_clase"]
        )
    )
    return schedule


def date_range(start, end):
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def build_teacher_busy(availability, open_minute, close_minute):
    result = {}
    for row in availability:
        name = str(row.get("docente", "")).strip()
        key = normalize_name(name)
        if not key:
            raise ValueError(f"Registro de disponibilidad sin docente: {row!r}")
        if key in result:
            raise ValueError(f"Docente duplicado en disponibilidad: {name}.")
        if "franjas_disponibles" not in row:
            raise ValueError(
                f"Registro de disponibilidad sin franjas_disponibles: {name}."
            )
        available_by_day = defaultdict(list)
        for span in row["franjas_disponibles"]:
            day_name = normalize_name(span.get("dia", ""))
            if day_name not in DAY_TO_INDEX:
                raise ValueError(f"Día inválido en disponibilidad de {name}: {span!r}")
            start = parse_time(span.get("hora_inicio"), f"{name}.hora_inicio")
            end = parse_time(span.get("hora_fin"), f"{name}.hora_fin")
            if (
                end <= start
                or start < open_minute
                or end > close_minute
                or start % GRID_STEP_MINUTES
                or end % GRID_STEP_MINUTES
            ):
                raise ValueError(f"Rango disponible inválido para {name}: {span!r}")
            available_by_day[DAY_TO_INDEX[day_name]].append((start, end))

        busy_by_day = defaultdict(list)
        for day_index in range(len(DAYS)):
            cursor = open_minute
            for start, end in sorted(available_by_day[day_index]):
                if end <= cursor:
                    continue
                if start > cursor:
                    busy_by_day[day_index].append((cursor, start))
                cursor = end
            if cursor < close_minute:
                busy_by_day[day_index].append((cursor, close_minute))
        result[key] = busy_by_day
    return result


def add_equivalent_or(model, out, values):
    if not values:
        model.Add(out == 0)
        return
    for value in values:
        model.AddImplication(value, out)
    model.AddBoolOr([out.Not(), *values])


def apply_warm_start(model, source, meetings, day_presence, day_start):
    """Carga un horario previo (ruta o filas en memoria) como pista inicial."""
    if isinstance(source, list):
        rows = source
    else:
        if not source.exists():
            return
        try:
            rows = json.loads(source.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
    if not isinstance(rows, list) or not rows:
        return
    row_groups = defaultdict(list)
    for row in rows:
        row_groups[(
            normalize_course_code(row.get("mat_cur")),
            str(row.get("seccion") or row.get("grupo") or ""),
            str(row.get("tipo_clase", "")).upper(),
        )].append(row)
    meeting_groups = defaultdict(list)
    for meeting in meetings:
        meeting_groups[
            (meeting.course.mat_cur, meeting.course.section, meeting.kind)
        ].append(meeting)
    hinted = 0
    for (mat_cur, section, kind), group in meeting_groups.items():
        course = group[0].course
        previous = row_groups.get((mat_cur, section, kind), [])
        if len(previous) != len(group):
            continue
        group.sort(key=lambda item: int(item.key.rsplit(":", 1)[1]))
        previous.sort(key=lambda row: (
            DAY_TO_INDEX.get(normalize_name(row.get("dia", "")), 99),
            parse_time(row.get("hora_inicio"), "hora_inicio"),
        ))
        for meeting, row in zip(group, previous):
            day_index = DAY_TO_INDEX.get(normalize_name(row.get("dia", "")))
            if day_index is None:
                continue
            start = parse_time(row.get("hora_inicio"), "hora_inicio")
            for current in range(len(DAYS)):
                flag = day_presence.get((meeting.key, current))
                if flag is not None:
                    model.AddHint(flag, 1 if current == day_index else 0)
            start_var = day_start.get((meeting.key, day_index))
            if start_var is not None:
                model.AddHint(start_var, start)
                hinted += 1
    print(f"Pista inicial aplicada a {hinted} sesiones.")


def solve(phase=1, relaxed_phase1=None, warm_rows=None, feasibility_only=False):
    rules = load_json("reglas_horario.json")
    config = load_json("config_semestre.json")
    catalog = load_json("cursos.json")
    hours = load_json("horas_cursos.json")
    assignments = load_json("curso_docentes.json")
    availability = load_json("disponibilidad_docentes.json")
    rooms = load_json("salones.json")
    environment_rows = load_json("reglas_ambientes.json")
    holiday_rows = load_json("feriados.json")
    reference_path = os.environ.get("CP_SAT_REFERENCE_PATH")
    reference_preferences = (
        load_reference_preferences(Path(reference_path)) if reference_path else {}
    )

    semester_start = parse_date(
        config.get("fecha_inicio_semestre"), "config_semestre.fecha_inicio_semestre"
    )
    semester_end = parse_date(
        config.get("fecha_fin_semestre"), "config_semestre.fecha_fin_semestre"
    )
    if not semester_start or not semester_end or semester_end < semester_start:
        raise ValueError("El rango del semestre en config_semestre.json no es válido.")

    operating = config.get("franja_operativa", {})
    open_minute = parse_time(operating.get("hora_inicio"), "franja_operativa.hora_inicio")
    close_minute = parse_time(operating.get("hora_fin"), "franja_operativa.hora_fin")
    if open_minute % GRID_STEP_MINUTES or close_minute % GRID_STEP_MINUTES:
        raise ValueError("La franja operativa debe coincidir con intervalos de 15 minutos.")
    if close_minute <= open_minute:
        raise ValueError("La hora final operativa debe ser posterior a la inicial.")

    time_rules = rules.get("parametros_tiempo", {})
    academic_hour_minutes = int(time_rules.get(
        "duracion_hora_academica_minutos", ACADEMIC_HOUR_MINUTES
    ))
    max_block_hours = int(time_rules.get(
        "frecuencia_receso_bloque_horas_academicas", MAX_BLOCK_ACADEMIC_HOURS
    ))
    minimum_tal_days = int(
        rules.get("modos_dictado", {})
        .get("taller_tal", {})
        .get("fragmentacion_dias_minima", 2)
    )
    if academic_hour_minutes <= 0 or academic_hour_minutes % GRID_STEP_MINUTES:
        raise ValueError("La duración de hora académica debe ser múltiplo de 15 minutos.")
    if max_block_hours <= 0:
        raise ValueError("La frecuencia de receso por bloque debe ser positiva.")
    if minimum_tal_days <= 0:
        raise ValueError("La fragmentación mínima de TAL debe ser positiva.")
    required_break = int(time_rules.get("receso_transicion_curso_minutos_min", 15))
    maximum_transition = int(time_rules.get("receso_transicion_curso_minutos_max", 30))
    if required_break < 0 or maximum_transition < required_break:
        raise ValueError("Los límites de receso en reglas_horario.json son inválidos.")

    hard = rules.get("restricciones_duras_inviolables", {})
    soft = rules.get("prioridades_soft_constraints", {})
    h6_value = hard.get("H6_laboratorio_obligatorio_carreras_tecnicas", [])
    h6_careers = set(h6_value) if isinstance(h6_value, list) else set()
    environment_rules = {str(row["area"]): row for row in environment_rows}
    holidays = parse_holidays(holiday_rows, semester_start, semester_end)
    semester_weeks = semester_teaching_weeks(semester_start, semester_end)
    modular_rules = rules.get("modos_dictado", {}).get("modular_tec_carrera", {})
    comunes_prefixes = tuple(
        str(prefix).upper()
        for prefix in modular_rules.get("prefijos_comunes_excluidos", ()) or ()
    ) or ("CGEU", "SCOU", "SPSU", "SCIU", "SINU")
    emp_config = get_emp_config(rules)
    if STRICT_HARD_RULES and (
        emp_config["inicio"] < open_minute
        or emp_config["fin"] > close_minute
        or emp_config["inicio"] % GRID_STEP_MINUTES
        or emp_config["fin"] % GRID_STEP_MINUTES
    ):
        raise InfeasibleDataError(
            "La ventana EMP estricta debe estar dentro de la franja operativa "
            "y alineada a intervalos de 15 minutos."
        )
    courses, meetings = build_courses_and_meetings(
        assignments, catalog, hours, semester_start, semester_end,
        academic_hour_minutes, max_block_hours, minimum_tal_days,
        semester_weeks=semester_weeks, comunes_prefixes=comunes_prefixes,
        emp_config=emp_config,
    )
    teacher_busy = build_teacher_busy(availability, open_minute, close_minute)

    # Reconciliación de datos: si la carga semanal asignada a un docente supera
    # su disponibilidad estricta, el archivo de entrada es inconsistente. Se
    # libera la jornada de ese docente y se advierte, en lugar de abortar todo
    # el horario por un caso imposible.
    weekly_load_by_teacher = defaultdict(lambda: defaultdict(int))
    for meeting in meetings:
        if meeting.kind in ("EMP", "VIR") or not meeting.course.teacher:
            continue
        week_index = (meeting.course.start_date - semester_start).days // 7
        weekly_load_by_teacher[normalize_name(meeting.course.teacher)][week_index] += (
            meeting.duration_minutes
        )
    released_by_capacity = set()
    capacity_errors = []
    for teacher_key, weekly_load in weekly_load_by_teacher.items():
        busy = teacher_busy.get(teacher_key)
        if busy is None:
            continue
        busy_minutes = sum(end - start for spans in busy.values() for start, end in spans)
        capacity = len(DAYS) * (close_minute - open_minute) - busy_minutes
        peak = max(weekly_load.values(), default=0)
        if peak > capacity:
            if STRICT_HARD_RULES:
                capacity_errors.append(
                    f"{teacher_key}: requiere {peak / 60:.2f} h/semana; "
                    f"disponibilidad registrada {capacity / 60:.2f} h/semana."
                )
                continue
            print(
                f"ADVERTENCIA: {teacher_key} requiere {peak / 60:.2f} h/semana y su "
                f"disponibilidad estricta solo cubre {capacity / 60:.2f} h/semana. "
                "Se amplía su disponibilidad a la jornada operativa."
            )
            teacher_busy[teacher_key] = {
                day_index: [] for day_index in range(len(DAYS))
            }
            released_by_capacity.add(teacher_key)
    if capacity_errors:
        raise InfeasibleDataError(
            "La disponibilidad estricta es insuficiente para estos docentes:\n- "
            + "\n- ".join(capacity_errors)
        )

    # Docentes con jornada liberada:
    #   - por capacidad insuficiente (datos inconsistentes: carga > holgura),
    #   - por petición explícita (variable de entorno CP_SAT_RELAX_TEACHERS),
    #   - por el resultado de la fase 1 (conjunto mínimo de relajación).
    if relaxed_phase1 == "ALL":
        relaxed_phase1 = {
            key for key, spans in teacher_busy.items()
            if any(spans.values())
        } | released_by_capacity
    forced_relaxed = set(RELAXED_TEACHERS) | released_by_capacity
    if relaxed_phase1:
        forced_relaxed |= set(relaxed_phase1)
    for teacher_key in sorted(forced_relaxed):
        if STRICT_HARD_RULES:
            raise InfeasibleDataError(
                f"El modo estricto no permite liberar la disponibilidad de "
                f"{teacher_key}."
            )
        if teacher_key not in released_by_capacity:
            print(
                f"ADVERTENCIA: se libera la disponibilidad estricta de "
                f"{teacher_key} (sin factibilidad estricta de su carga con "
                f"las reglas actuales)."
            )
        teacher_busy[teacher_key] = {
            day_index: [] for day_index in range(len(DAYS))
        }

    if not meetings:
        raise ValueError("No hay clases con horas semanales para programar.")

    model = cp_model.CpModel()
    meeting_by_key = {meeting.key: meeting for meeting in meetings}
    respect_availability = (
        hard.get("H2_respetar_disponibilidad_docente", True)
        and constraint_enabled("AVAILABILITY")
    )
    # Fase 1: una variable por docente; si su sesión viola la disponibilidad
    # estricta, su variable relax_t debe activarse (coste altísimo en el
    # objetivo, para hallar el conjunto MÍNIMO de docentes liberados).
    relax_vars = {}
    if phase == 1 and respect_availability and HARD_AVAILABILITY:
        for key, spans in teacher_busy.items():
            if any(spans.values()):
                relax_vars[key] = model.NewBoolVar(f"relax_{key}")
    day_presence = {}
    day_start = {}
    day_intervals = {}
    room_intervals = {}
    room_choices = {}
    candidate_rooms = {}
    course_active_days = {}

    slot_starts = list(range(open_minute, close_minute, GRID_STEP_MINUTES))
    additional_rules = rules.get("turnos_y_reglas_especiales", {})
    morning_window = additional_rules.get("jornada_manana", {})
    morning_end = parse_time(
        config.get("limite_turno_manana")
        or morning_window.get("hora_fin") or "12:45",
        "limite_turno_manana",
    )
    emp_rules = additional_rules.get("practicas_empresa", {})
    availability_penalties = []
    for course in courses:
        course_active_days[course.key] = active_weekdays(course, holidays)

    for meeting_index, meeting in enumerate(meetings):
        course = meeting.course
        duration = meeting.duration_minutes
        latest_start = close_minute - duration
        allowed_windows = turn_windows_for_course(
            course.semester, rules, config, meeting.kind, emp_config
        )
        if meeting.kind == "EMP" and STRICT_HARD_RULES:
            if duration != emp_config["bloque_minutos"]:
                raise InfeasibleDataError(
                    f"El bloque EMP de {course.mat_cur} no dura "
                    f"{emp_config['bloque_minutos']} minutos."
                )
            legal_starts = [emp_config["inicio"]]
        elif meeting.kind == "EMP" and emp_rules.get("solo_mananas", True):
            # La ventana estricta EMP prevalece sobre el cierre de MANANA.
            latest_start = min(latest_start, emp_config["fin"] - duration)
        if latest_start < open_minute:
            raise ValueError(
                f"{meeting.course.mat_cur} ({meeting.kind}) dura más que la jornada "
                f"operativa: {duration} minutos."
            )
        if meeting.kind != "EMP" or not STRICT_HARD_RULES:
            legal_starts = [value for value in slot_starts if value <= latest_start]
        if meeting.kind != "EMP":
            legal_starts = [
                value for value in legal_starts
                if any(
                    window_start <= value
                    and value + duration <= window_end
                    for window_start, window_end in allowed_windows
                )
            ]
        if not legal_starts:
            raise ValueError(
                f"No hay horas permitidas para {course.mat_cur} / {course.section}."
            )

        teacher_key = normalize_name(course.teacher) if course.teacher else ""
        if respect_availability and teacher_key:
            if teacher_key not in teacher_busy:
                if STRICT_HARD_RULES:
                    raise InfeasibleDataError(
                        f"No hay disponibilidad registrada para {teacher_key}."
                    )
                print(f"ADVERTENCIA: docente sin disponibilidad registrada: {teacher_key}.")
                teacher_busy[teacher_key] = {}
            # Los docentes con jornada liberada disponen de toda la franja
            # operativa; los demás pasan por disponibilidad estricta (fase 2)
            # o por la maquinaria de violación condicionada (fase 1).
            busy = (
                {}
                if teacher_key in forced_relaxed
                else teacher_busy[teacher_key]
            )
        else:
            busy = {}

        starts_by_day = {}
        soft_busy = busy
        if respect_availability and HARD_AVAILABILITY and busy and phase == 2:
            # Fase 2 - Restricción dura: sólo se permiten inicios dentro de
            # franjas libres completas (sin solapar la ocupación real).
            for day_index in sorted(course_active_days[course.key]):
                free_spans = []
                cursor = open_minute
                for occupied_start, occupied_end in sorted(busy.get(day_index, [])):
                    if occupied_start > cursor:
                        free_spans.append((cursor, occupied_start))
                    cursor = max(cursor, occupied_end)
                if cursor < close_minute:
                    free_spans.append((cursor, close_minute))
                allowed = []
                for free_start, free_end in free_spans:
                    latest = min(free_end - duration, latest_start)
                    allowed.extend(
                        value for value in slot_starts
                        if free_start <= value <= latest
                        and (
                            meeting.kind == "EMP"
                            or any(
                                window_start <= value
                                and value + duration <= window_end
                                for window_start, window_end in allowed_windows
                            )
                        )
                    )
                if allowed:
                    starts_by_day[day_index] = allowed
            if not starts_by_day:
                if STRICT_HARD_RULES:
                    raise InfeasibleDataError(
                        f"{teacher_key} no tiene franja disponible para "
                        f"{course.mat_cur} / {meeting.kind}."
                    )
                print(
                    f"ADVERTENCIA: {teacher_key} no tiene franja viable para "
                    f"{course.mat_cur} / {meeting.kind}; se libera esa sesión."
                )
                soft_busy = {}
                starts_by_day = {
                    day_index: [
                        start for start in legal_starts
                        if meeting.kind == "EMP"
                        or any(
                            window_start <= start
                            and start + duration <= window_end
                            for window_start, window_end in allowed_windows
                        )
                    ]
                    for day_index in course_active_days[course.key]
                }
        else:
            # Fase 1 (o disponibilidad blanda): dominio completo; en fase 1
            # las violaciones se penalizan condicionadas a relax_t del docente.
            starts_by_day = {
                day_index: legal_starts
                for day_index in course_active_days[course.key]
            }

        available_days = sorted(starts_by_day)
        if not available_days:
            raise ValueError(
                f"No hay día/hora permitidos por disponibilidad para "
                f"{course.mat_cur} / {course.section} / {meeting.kind}."
            )
        possible_day_flags = []
        for day_index in available_days:
            day_key = (meeting.key, day_index)
            presence = model.NewBoolVar(f"day_{meeting_index}_{day_index}")
            start_var = model.NewIntVarFromDomain(
                cp_model.Domain.FromValues(starts_by_day[day_index]),
                f"start_{meeting_index}_{day_index}",
            )
            day_presence[day_key] = presence
            day_start[day_key] = start_var
            possible_day_flags.append(presence)

            busy_spans = soft_busy.get(day_index, []) if respect_availability else []
            if busy_spans and (
                phase == 1 or not (respect_availability and HARD_AVAILABILITY)
            ):
                overlap_flags = []
                for busy_index, (occupied_start, occupied_end) in enumerate(busy_spans):
                    overlap = model.NewBoolVar(
                        f"availability_overlap_{meeting_index}_{day_index}_{busy_index}"
                    )
                    model.Add(start_var < occupied_end).OnlyEnforceIf(overlap)
                    model.Add(start_var + duration > occupied_start).OnlyEnforceIf(overlap)
                    after = model.NewBoolVar(
                        f"availability_after_{meeting_index}_{day_index}_{busy_index}"
                    )
                    before = model.NewBoolVar(
                        f"availability_before_{meeting_index}_{day_index}_{busy_index}"
                    )
                    model.Add(start_var >= occupied_end).OnlyEnforceIf(after)
                    model.Add(start_var < occupied_end).OnlyEnforceIf(after.Not())
                    model.Add(start_var + duration <= occupied_start).OnlyEnforceIf(before)
                    model.Add(start_var + duration > occupied_start).OnlyEnforceIf(before.Not())
                    model.AddBoolOr([overlap, after, before])
                    overlap_flags.append(overlap)
                overlap_any = model.NewBoolVar(
                    f"availability_overlap_any_{meeting_index}_{day_index}"
                )
                add_equivalent_or(model, overlap_any, overlap_flags)
                violation = model.NewBoolVar(
                    f"availability_violation_{meeting_index}_{day_index}"
                )
                model.AddBoolAnd([presence, overlap_any]).OnlyEnforceIf(violation)
                model.AddBoolOr([presence.Not(), overlap_any.Not(), violation])
                if phase == 1:
                    # Una violación sólo es posible liberando la jornada del
                    # docente (relax_t), cuyo coste domina el objetivo.
                    relax_var = relax_vars.get(teacher_key)
                    if relax_var is not None:
                        model.AddImplication(violation, relax_var)
                availability_penalties.append(violation)

            section_interval = model.NewOptionalIntervalVar(
                start_var,
                duration,
                start_var + duration,
                presence,
                f"section_interval_{meeting_index}_{day_index}",
            )
            # La pausa de transición es una regla del grupo de estudiantes.
            # Entre clases de un mismo docente basta con impedir el cruce.
            teacher_interval = model.NewOptionalIntervalVar(
                start_var,
                duration,
                start_var + duration,
                presence,
                f"teacher_interval_{meeting_index}_{day_index}",
            )
            room_interval = model.NewOptionalIntervalVar(
                start_var,
                duration,
                start_var + duration,
                presence,
                f"room_interval_{meeting_index}_{day_index}",
            )
            day_intervals[(meeting.key, day_index)] = {
                "section": section_interval,
                "teacher": teacher_interval,
                "room": room_interval,
            }

        if not possible_day_flags:
            raise ValueError(
                f"No hay día/hora permitidos por fechas, jornada y disponibilidad para "
                f"{course.mat_cur} / {course.section} / {meeting.kind}."
            )
        model.Add(sum(possible_day_flags) == 1)

        candidates = build_room_candidates(
            meeting, rooms, environment_rules, hard, h6_careers
        )
        candidate_rooms[meeting.key] = candidates
        if candidates:
            selectors = []
            for room_index in candidates:
                chosen = model.NewBoolVar(f"room_{meeting_index}_{room_index}")
                room_choices[(meeting.key, room_index)] = chosen
                selectors.append(chosen)
            model.Add(sum(selectors) == 1)
        elif meeting.kind not in ("EMP", "VIR"):
            raise ValueError(f"No se seleccionó ambiente para {meeting.key}.")

        for day_index in sorted(course_active_days[course.key]):
            day_key = (meeting.key, day_index)
            if day_key not in day_presence or not candidates:
                continue
            for room_index in candidates:
                chosen = room_choices[(meeting.key, room_index)]
                present = model.NewBoolVar(
                    f"room_day_{meeting_index}_{day_index}_{room_index}"
                )
                day_flag = day_presence[day_key]
                model.AddBoolAnd([day_flag, chosen]).OnlyEnforceIf(present)
                model.AddBoolOr([day_flag.Not(), chosen.Not(), present])
                start_var = day_start[day_key]
                room_intervals[(meeting.key, day_index, room_index)] = (
                    model.NewOptionalIntervalVar(
                        start_var,
                        duration,
                        start_var + duration,
                        present,
                        f"room_resource_{meeting_index}_{day_index}_{room_index}",
                    )
                )

    date_groups = make_date_groups(meetings, semester_start, semester_end, holidays)
    relaxed_transition_vars = []
    interval_sets = {
        "section": defaultdict(list),
        "teacher": defaultdict(list),
        "room": defaultdict(list),
    }

    for (day_index, active_keys), occurrence_count in date_groups.items():
        active_meetings = [meeting_by_key[key] for key in active_keys]
        by_teacher = defaultdict(list)
        by_room = defaultdict(list)
        by_section = defaultdict(list)
        for meeting in active_meetings:
            day_key = (meeting.key, day_index)
            if day_key not in day_presence:
                continue
            by_section[meeting.course.section].append(meeting)
            interval_sets["section"][(day_index, active_keys, meeting.course.section)].append(
                day_intervals[day_key]["section"]
            )
            if meeting.course.teacher and meeting.kind not in ("EMP", "VIR"):
                by_teacher[meeting.course.teacher].append(
                    day_intervals[day_key]["teacher"]
                )
            for room_index in candidate_rooms[meeting.key]:
                interval = room_intervals.get((meeting.key, day_index, room_index))
                if interval is not None:
                    by_room[room_index].append(interval)

        for section_meetings in by_section.values():
            for index, left in enumerate(section_meetings):
                for right in section_meetings[index + 1:]:
                    if not STRICT_HARD_RULES and not constraint_enabled("BREAKS"):
                        continue
                    if not requires_section_break(
                        left, right, academic_hour_minutes * max_block_hours
                    ):
                        continue
                    left_flag = day_presence[(left.key, day_index)]
                    right_flag = day_presence[(right.key, day_index)]
                    before = model.NewBoolVar(
                        f"section_order_{day_index}_{left.key}_{right.key}"
                    )
                    left_start = day_start[(left.key, day_index)]
                    right_start = day_start[(right.key, day_index)]
                    if STRICT_HARD_RULES:
                        model.Add(
                            left_start + left.duration_minutes + required_break
                            <= right_start
                        ).OnlyEnforceIf([left_flag, right_flag, before])
                        model.Add(
                            right_start + right.duration_minutes + required_break
                            <= left_start
                        ).OnlyEnforceIf([left_flag, right_flag, before.Not()])
                    elif left.course.mat_cur != right.course.mat_cur:
                        short_break = model.NewBoolVar(
                            f"short_section_break_{day_index}_{left.key}_{right.key}"
                        )
                        relaxed_transition_vars.append((short_break, occurrence_count))
                        model.Add(
                            left_start + left.duration_minutes <= right_start
                        ).OnlyEnforceIf([left_flag, right_flag, before])
                        model.Add(
                            left_start + left.duration_minutes + required_break <= right_start
                        ).OnlyEnforceIf([
                            left_flag, right_flag, before, short_break.Not()
                        ])
                        model.Add(
                            right_start + right.duration_minutes <= left_start
                        ).OnlyEnforceIf([left_flag, right_flag, before.Not()])
                        model.Add(
                            right_start + right.duration_minutes + required_break <= left_start
                        ).OnlyEnforceIf([
                            left_flag, right_flag, before.Not(), short_break.Not()
                        ])
                    elif requires_hard_section_break(
                        left, right, academic_hour_minutes * max_block_hours
                    ):
                        model.Add(
                            left_start + left.duration_minutes + required_break <= right_start
                        ).OnlyEnforceIf([left_flag, right_flag, before])
                        model.Add(
                            right_start + right.duration_minutes + required_break <= left_start
                        ).OnlyEnforceIf([left_flag, right_flag, before.Not()])

        if hard.get("H1_no_cruce_docentes", True) and constraint_enabled("TEACHER"):
            for teacher, intervals in by_teacher.items():
                interval_sets["teacher"][
                    (day_index, active_keys, normalize_name(teacher))
                ].extend(intervals)
        if hard.get("H4_no_cruce_ambientes", True) and constraint_enabled("ROOMS"):
            for room_index, intervals in by_room.items():
                interval_sets["room"][
                    (day_index, active_keys, room_index)
                ].extend(intervals)

    for section_intervals in interval_sets["section"].values():
        if len(section_intervals) > 1 and constraint_enabled("SECTION"):
            model.AddNoOverlap(section_intervals)
    for teacher_intervals in interval_sets["teacher"].values():
        if len(teacher_intervals) > 1:
            model.AddNoOverlap(teacher_intervals)
    for room_intervals_for_day in interval_sets["room"].values():
        if len(room_intervals_for_day) > 1:
            model.AddNoOverlap(room_intervals_for_day)

    by_course_kind = defaultdict(list)
    for meeting in meetings:
        by_course_kind[(meeting.course.key, meeting.kind)].append(meeting)

    objective_terms = []
    # En la fase 1 (o en el paso de factibilidad 2a) el objetivo se omite;
    # los términos de calidad (S1..S7) se activan en la fase 2 final.
    objective_enabled = (
        constraint_enabled("OBJECTIVE") and phase == 2 and not feasibility_only
    )

    weekday_occurrence_counts = {}
    def weekday_occurrences(course, day_index, holidays):
        cache_key = (course.key, day_index)
        if cache_key not in weekday_occurrence_counts:
            weekday_occurrence_counts[cache_key] = sum(
                1 for current in date_range(course.start_date, course.end_date)
                if current.weekday() == day_index and current not in holidays
            )
        return weekday_occurrence_counts[cache_key]

    tal_rules = additional_rules.get("taller_tal", {})
    clases_rules = additional_rules.get("clases", {})
    tec_rules = additional_rules.get("tec", {})
    tal_consecutive_weight = int(
        soft.get("S5_penalizacion_tal_dias_no_consecutivos", 30)
    )
    for (course_key, kind), course_meetings in by_course_kind.items():
        course = course_meetings[0].course
        if kind == "EMP" and STRICT_HARD_RULES:
            emp_days = []
            for day_index in range(len(DAYS)):
                flags = [
                    day_presence[(meeting.key, day_index)]
                    for meeting in course_meetings
                    if (meeting.key, day_index) in day_presence
                ]
                used = model.NewBoolVar(f"emp_day_{course_key}_{day_index}")
                if flags:
                    add_equivalent_or(model, used, flags)
                else:
                    model.Add(used == 0)
                emp_days.append((day_index, used))
            model.Add(sum(used for _, used in emp_days) == len(course_meetings))
            if len(course_meetings) < emp_config["dias_minimos"]:
                raise InfeasibleDataError(
                    f"{course.mat_cur} / {course.section} tiene menos bloques "
                    f"EMP que el mínimo de {emp_config['dias_minimos']} días."
                )
            for left_index, (left_day, left_used) in enumerate(emp_days):
                for right_day, right_used in emp_days[left_index + 1:]:
                    if right_day - left_day <= 1:
                        continue
                    for middle_day, middle_used in emp_days:
                        if left_day < middle_day < right_day:
                            model.Add(left_used + right_used - 1 <= middle_used)
            for emp_day, emp_used in emp_days:
                for other in meetings:
                    if (
                        other.course.section == course.section
                        and other.kind in emp_config["sin_mezclar_con"]
                    ):
                        other_used = day_presence.get((other.key, emp_day))
                        if other_used is not None:
                            model.Add(emp_used + other_used <= 1)
        modular_rules = rules.get("modos_dictado", {}).get("modular_tec_carrera", {})
        modular_weeks = int(modular_rules.get("semanas_duracion", 4))
        compact_modular_course = (
            constraint_enabled("COMPACT")
            and kind == "TEC"
            and course.semester >= 4
            and course.mat_cur.startswith(f"{course.career_code}-")
            and course.duration_weeks == modular_weeks
            and len(course_meetings) > 1
            and modular_rules.get("compactacion") == "UN_SOLO_DIA_POR_SEMANA"
        )
        if compact_modular_course:
            course_day = model.NewIntVar(0, len(DAYS) - 1, f"modular_day_{course_key}")
            for meeting in course_meetings:
                for day_index in course_active_days[course.key]:
                    flag = day_presence.get((meeting.key, day_index))
                    if flag is not None:
                        model.Add(course_day == day_index).OnlyEnforceIf(flag)

        if (
            kind == "TEC"
            and tec_rules.get("un_dia_por_semana", True)
            and len(course_meetings) > 1
            and constraint_enabled("TECDAY")
        ):
            # Regla: la clase técnica (TEC) de un curso se dicta en un solo
            # día de la semana (toda la carga semanal en una misma jornada).
            used_days = []
            for day_index in range(len(DAYS)):
                flags = [
                    day_presence[(meeting.key, day_index)]
                    for meeting in course_meetings
                    if (meeting.key, day_index) in day_presence
                ]
                if flags:
                    used = model.NewBoolVar(f"tecday_{course_key}_{day_index}")
                    add_equivalent_or(model, used, flags)
                    used_days.append(used)
            if len(used_days) > 1:
                model.Add(sum(used_days) <= 1)

        if (
            kind == "TAL"
            and len(course_meetings) >= minimum_tal_days
            and constraint_enabled("TALDAYS")
        ):
            used_days = []
            used_days_by_index = []
            for day_index in range(len(DAYS)):
                flags = [
                    day_presence[(meeting.key, day_index)]
                    for meeting in course_meetings
                    if (meeting.key, day_index) in day_presence
                ]
                if flags:
                    used = model.NewBoolVar(f"tal_day_{course_key}_{day_index}")
                    add_equivalent_or(model, used, flags)
                    used_days.append(used)
                    used_days_by_index.append((day_index, used))
            model.Add(sum(used_days) >= minimum_tal_days)

            if (
                tal_rules.get("dias_consecutivos_preferente", True)
                and constraint_enabled("TALCONSEC")
                and len(used_days_by_index) > minimum_tal_days
                and objective_enabled
            ):
                # Preferencia suave: los días del taller deben quedar de
                # corrido (sin días sueltos en medio de la semana).
                ords_max = []
                ords_min = []
                for day_index, used in used_days_by_index:
                    upper = model.NewIntVar(-1, len(DAYS), f"tal_ordup_{course_key}_{day_index}")
                    lower = model.NewIntVar(-1, len(DAYS), f"tal_orddown_{course_key}_{day_index}")
                    model.Add(upper == day_index).OnlyEnforceIf(used)
                    model.Add(upper == -1).OnlyEnforceIf(used.Not())
                    model.Add(lower == day_index).OnlyEnforceIf(used)
                    model.Add(lower == len(DAYS)).OnlyEnforceIf(used.Not())
                    ords_max.append(upper)
                    ords_min.append(lower)
                last_day = model.NewIntVar(-1, len(DAYS), f"tal_last_{course_key}")
                first_day = model.NewIntVar(0, len(DAYS), f"tal_first_{course_key}")
                model.AddMaxEquality(last_day, ords_max)
                model.AddMinEquality(first_day, ords_min)
                count_used = model.NewIntVar(
                    0, len(used_days), f"tal_count_{course_key}"
                )
                model.Add(count_used == sum(used_days))
                raw_skipped = model.NewIntVar(
                    -len(DAYS), len(DAYS), f"tal_raw_skipped_{course_key}"
                )
                model.Add(
                    raw_skipped == last_day - first_day - (count_used - 1)
                )
                skipped = model.NewIntVar(0, len(DAYS), f"tal_skipped_{course_key}")
                model.AddMaxEquality(skipped, [raw_skipped, 0])
                occurrences = sum(
                    weekday_occurrences(course, day_index, holidays)
                    for day_index, _ in used_days_by_index
                )
                if occurrences:
                    objective_terms.append(
                        tal_consecutive_weight * occurrences * skipped
                    )

        contiguity_weight = int(soft.get("S6_penalizacion_clases_no_corridas", 50))
        if (
            clases_rules.get("corridas_preferente", True)
            and constraint_enabled("CONTIGUITY")
            and len(course_meetings) > 1
            and objective_enabled
        ):
            # Preferencia fuerte: los bloques de una misma clase que caen en
            # el mismo día deben quedar de corrido (a lo sumo separados por
            # el receso obligatorio), nunca como "una clase de 2 a 4 y otra
            # de 7 a 9". Las prácticas en empresa no llevan receso de por
            # medio, así que sus bloques deben ser contiguos.
            for day_index in range(len(DAYS)):
                group = [
                    meeting for meeting in course_meetings
                    if (meeting.key, day_index) in day_presence
                ]
                if len(group) < 2:
                    continue
                occurrences = weekday_occurrences(course, day_index, holidays)
                if not occurrences:
                    continue
                starts_used = []
                ends_used = []
                for meeting in group:
                    flag = day_presence[(meeting.key, day_index)]
                    start_var = day_start[(meeting.key, day_index)]
                    effective_start = model.NewIntVar(
                        open_minute, close_minute,
                        f"corr_start_{course_key}_{meeting.key}_{day_index}",
                    )
                    effective_end = model.NewIntVar(
                        open_minute, close_minute,
                        f"corr_end_{course_key}_{meeting.key}_{day_index}",
                    )
                    model.Add(effective_start == start_var).OnlyEnforceIf(flag)
                    model.Add(
                        effective_start == close_minute
                    ).OnlyEnforceIf(flag.Not())
                    model.Add(
                        effective_end == start_var + meeting.duration_minutes
                    ).OnlyEnforceIf(flag)
                    model.Add(effective_end == open_minute).OnlyEnforceIf(flag.Not())
                    starts_used.append(effective_start)
                    ends_used.append(effective_end)

                first_start = model.NewIntVar(
                    open_minute, close_minute,
                    f"corr_first_{course_key}_{day_index}",
                )
                last_end = model.NewIntVar(
                    open_minute, close_minute,
                    f"corr_last_{course_key}_{day_index}",
                )
                model.AddMinEquality(first_start, starts_used)
                model.AddMaxEquality(last_end, ends_used)
                occupied = sum(
                    meeting.duration_minutes * day_presence[(meeting.key, day_index)]
                    for meeting in group
                )
                raw_gap = model.NewIntVar(
                    -close_minute, close_minute,
                    f"corr_raw_{course_key}_{day_index}",
                )
                model.Add(
                    raw_gap == last_end - first_start - occupied
                )
                # Receso permitido entre bloques de la misma clase: solo el
                # receso obligatorio (ninguno para las prácticas en empresa).
                allowed_recess = 0 if kind == "EMP" else required_break
                max_recess_allowed = (len(group) - 1) * allowed_recess
                broken_gap = model.NewIntVar(
                    0, close_minute,
                    f"corr_gap_{course_key}_{day_index}",
                )
                if max_recess_allowed:
                    model.AddMaxEquality(
                        broken_gap,
                        [raw_gap - max_recess_allowed, 0],
                    )
                else:
                    model.AddMaxEquality(
                        broken_gap,
                        [raw_gap, 0],
                    )
                objective_terms.append(contiguity_weight * occurrences * broken_gap)

    weights = {
        "S1": int(soft.get("S1_penalizacion_reprogramacion_externa_feriado", 100)),
        "S2": int(soft.get("S2_penalizacion_ventanas_huecos_alumno", 50)),
        "S3": int(soft.get("S3_penalizacion_exceso_receso_transicion", 10)),
        "S4": int(soft.get("S4_penalizacion_desviacion_patron_referencia", 20)),
    }
    for short_break, occurrence_count in relaxed_transition_vars:
        penalty = (weights["S2"] + weights["S3"]) * required_break + 1
        objective_terms.append(penalty * occurrence_count * short_break)

    availability_weight = 100000
    for violation in availability_penalties:
        objective_terms.append(availability_weight * violation)

    for meeting in meetings:
        course = meeting.course
        for day_index in range(len(DAYS)):
            flag = day_presence.get((meeting.key, day_index))
            if flag is None:
                continue
            holiday_count = sum(
                1 for holiday in holidays
                if course.start_date <= holiday <= course.end_date
                and holiday.weekday() == day_index
            )
            if holiday_count:
                objective_terms.append(weights["S1"] * holiday_count * flag)

        reference_days = reference_preferences.get(
            (normalize_course_code(course.mat_cur), course.section), {}
        ).get(meeting.kind, {})
        if reference_days:
            preferred_days = set(reference_days)
            for day_index in range(len(DAYS)):
                flag = day_presence.get((meeting.key, day_index))
                if flag is None or DAYS[day_index] in preferred_days:
                    continue
                occurrences = sum(
                    1 for current in date_range(course.start_date, course.end_date)
                    if current.weekday() == day_index and current not in holidays
                )
                if occurrences:
                    objective_terms.append(weights["S4"] * occurrences * flag)

    # Regla: el tercer semestre puede estar en la mañana siempre y cuando
    # haya espacio. Se permite colocar clases de 3.º en la jornada de la
    # mañana y se penaliza levemente para que sólo se use cuando añade
    # valor de calidad (S3 preferencia por tarde/noche).
    sem3_weight = int(soft.get("S7_penalizacion_semestre3_manana", 5))
    if sem3_weight > 0 and constraint_enabled("SEM3MORNING") and objective_enabled:
        for meeting in meetings:
            course = meeting.course
            if course.semester != 3 or meeting.kind == "EMP":
                continue
            for day_index in range(len(DAYS)):
                flag = day_presence.get((meeting.key, day_index))
                if flag is None:
                    continue
                start_var = day_start[(meeting.key, day_index)]
                occurrences = weekday_occurrences(course, day_index, holidays)
                if not occurrences:
                    continue
                late = model.NewBoolVar(f"late3_{meeting.key}_{day_index}")
                model.Add(
                    start_var + meeting.duration_minutes > morning_end
                ).OnlyEnforceIf(late)
                model.Add(
                    start_var + meeting.duration_minutes <= morning_end
                ).OnlyEnforceIf(late.Not())
                in_morning = model.NewBoolVar(f"inmorning3_{meeting.key}_{day_index}")
                model.AddBoolAnd([flag, late.Not()]).OnlyEnforceIf(in_morning)
                model.AddBoolOr([flag.Not(), late, in_morning])
                objective_terms.append(sem3_weight * occurrences * in_morning)

    for (day_index, active_keys), occurrence_count in date_groups.items():
        if not objective_enabled:
            break
        sections = defaultdict(list)
        for key in active_keys:
            meeting = meeting_by_key[key]
            if (key, day_index) in day_presence:
                sections[meeting.course.section].append(meeting)

        for section, section_meetings in sections.items():
            if not GAP_OBJECTIVE:
                continue
            starts_if_used = []
            ends_if_used = []
            flags = []
            occupied_duration = []
            for index, meeting in enumerate(section_meetings):
                flag = day_presence[(meeting.key, day_index)]
                start_var = day_start[(meeting.key, day_index)]
                effective_start = model.NewIntVar(
                    open_minute, close_minute, f"effective_start_{day_index}_{index}_{len(objective_terms)}"
                )
                effective_end = model.NewIntVar(
                    0, close_minute, f"effective_end_{day_index}_{index}_{len(objective_terms)}"
                )
                model.Add(effective_start == start_var).OnlyEnforceIf(flag)
                model.Add(effective_start == close_minute).OnlyEnforceIf(flag.Not())
                model.Add(effective_end == start_var + meeting.duration_minutes).OnlyEnforceIf(flag)
                model.Add(effective_end == 0).OnlyEnforceIf(flag.Not())
                starts_if_used.append(effective_start)
                ends_if_used.append(effective_end)
                flags.append(flag)
                occupied_duration.append(meeting.duration_minutes * flag)

            first_start = model.NewIntVar(open_minute, close_minute, f"first_{day_index}_{section}_{len(objective_terms)}")
            last_end = model.NewIntVar(0, close_minute, f"last_{day_index}_{section}_{len(objective_terms)}")
            model.AddMinEquality(first_start, starts_if_used)
            model.AddMaxEquality(last_end, ends_if_used)
            count = model.NewIntVar(0, len(flags), f"count_{day_index}_{section}_{len(objective_terms)}")
            model.Add(count == sum(flags))

            raw_gap = model.NewIntVar(
                -close_minute, close_minute, f"raw_gap_{day_index}_{section}_{len(objective_terms)}"
            )
            model.Add(raw_gap == last_end - first_start - sum(occupied_duration))
            gap = model.NewIntVar(0, close_minute, f"gap_{day_index}_{section}_{len(objective_terms)}")
            model.AddMaxEquality(gap, [raw_gap, 0])
            objective_terms.append(weights["S2"] * occurrence_count * gap)

            transitions = model.NewIntVar(
                0, max(0, len(flags) - 1),
                f"transitions_{day_index}_{section}_{len(objective_terms)}",
            )
            model.AddMaxEquality(transitions, [count - 1, 0])
            excess_gap = model.NewIntVar(
                0, close_minute,
                f"excess_gap_{day_index}_{section}_{len(objective_terms)}",
            )
            model.AddMaxEquality(
                excess_gap,
                [gap - maximum_transition * transitions, 0],
            )
            objective_terms.append(weights["S3"] * occurrence_count * excess_gap)

    if phase == 2 and not feasibility_only and objective_terms and constraint_enabled("OBJECTIVE"):
        model.Minimize(sum(objective_terms))

    if (
        phase == 2 and not feasibility_only
        and os.environ.get("CP_SAT_USE_HINT", "1") != "0"
    ):
        apply_warm_start(
            model,
            warm_rows if warm_rows else OUTPUT_PATH,
            meetings, day_presence, day_start,
        )

    solver = cp_model.CpSolver()
    solver.parameters.random_seed = int(os.environ.get("CP_SAT_RANDOM_SEED", "0"))
    if phase == 1:
        solver.parameters.max_time_in_seconds = PHASE1_TIME_LIMIT
    elif feasibility_only:
        # La factibilidad pura se resuelve en segundos; no conviene gastar
        # el presupuesto completo en el paso 2a.
        solver.parameters.max_time_in_seconds = min(TIME_LIMIT_SECONDS, 120)
    else:
        solver.parameters.max_time_in_seconds = TIME_LIMIT_SECONDS
    # Un sólo worker en fase 1: la extracción de núcleos de supuestos
    # (SufficientAssumptionsForInfeasibility) no es fiable en paralelo y las
    # pruebas de infactibilidad por presolve son rápidas en un hilo.
    solver.parameters.num_search_workers = 1 if phase == 1 else max(
        1, min(8, os.cpu_count() or 1)
    )

    def extract_hint_rows(active_solver):
        """Extrae pistas (día/hora por sesión) de una solución del solver."""
        rows = []
        for meeting in meetings:
            course = meeting.course
            for day_index in range(len(DAYS)):
                day_key = (meeting.key, day_index)
                if day_key in day_presence and active_solver.BooleanValue(
                    day_presence[day_key]
                ):
                    rows.append({
                        "mat_cur": course.mat_cur,
                        "seccion": course.section,
                        "tipo_clase": meeting.kind,
                        "dia": DAYS[day_index],
                        "hora_inicio": format_time(
                            active_solver.Value(day_start[day_key])
                        ),
                    })
        return rows

    if phase == 1:
        # Fase 1 (núcleos de conflicto): se supone disponibilidad estricta
        # para todos (relax_t = 0). Si el modelo es INFEASIBLE, CP-SAT
        # devuelve los docentes implicados en el conflicto; sólo a ellos se
        # les libera la jornada (relax_t = 1) y se repite hasta obtener una
        # solución factible con el conjunto mínimo de relajaciones.
        teacher_by_index = {}
        for teacher_key, variable in sorted(relax_vars.items()):
            literal = variable.Not()
            # El núcleo devuelto por CP-SAT contiene índices de literales
            # (Not(v).Index() == -(v.Index() + 1)), no posiciones.
            teacher_by_index[literal.Index()] = teacher_key
            model.AddAssumption(literal)
        relaxed_solution = set()
        core_rounds = 0
        while True:
            core_rounds += 1
            status = solver.Solve(model)
            print(
                f"CP-SAT fase 1 ronda {core_rounds}: {solver.StatusName(status)} "
                f"| tiempo {solver.WallTime():.1f}s"
            )
            if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                break
            core = set(solver.SufficientAssumptionsForInfeasibility() or [])
            newly = sorted({
                teacher_by_index[index]
                for index in core
                if index in teacher_by_index
            } - relaxed_solution)
            if not newly or core_rounds >= 30:
                print(
                    "AVISO: la fase 1 no identificó un conjunto mínimo; se "
                    "libera la jornada de todos los docentes."
                )
                relaxed_solution = None
                break
            for teacher_key in newly:
                print(
                    f"ADVERTENCIA (fase 1): se libera la disponibilidad de "
                    f"{teacher_key} (implicado en un conflicto de factibilidad)."
                )
                relaxed_solution.add(teacher_key)
                model.Add(relax_vars[teacher_key] == 1)
            model.ClearAssumptions()
            for teacher_key, variable in sorted(relax_vars.items()):
                if teacher_key not in relaxed_solution:
                    model.AddAssumption(variable.Not())
        if relaxed_solution is None:
            # Sin conjunto identificado: se libera a todos y se parte de una
            # solución puramente factible (fase 2a) antes de optimizar.
            solve(phase=2, relaxed_phase1="ALL", feasibility_only=True)
            return
        print(
            f"INFO: docentes con jornada liberada por la fase 1 "
            f"({len(relaxed_solution)}): " + ", ".join(sorted(relaxed_solution))
        )
        # Pistas de la solución factible de la fase 1 para arrancar la fase 2.
        solve(
            phase=2,
            relaxed_phase1=relaxed_solution,
            warm_rows=extract_hint_rows(solver),
        )
        return

    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        status_name = solver.StatusName(status)
        print(
            f"CP-SAT estado: {status_name} | tiempo {solver.WallTime():.1f}s | "
            f"ramas {solver.NumBranches()} | conflictos {solver.NumConflicts()}"
        )
        if not constraint_enabled("WRITE"):
            return
        raise RuntimeError(
            f"CP-SAT no encontró una solución ({status_name}) en "
            f"{solver.WallTime():.1f}s. Se conserva el archivo de salida anterior."
        )

    if feasibility_only:
        # Fase 2a: punto de partida factible sin objetivo. Se extraen pistas
        # y se re-resuelve con el objetivo de calidad completo (fase 2b),
        # arrancando desde una solución que ya cumple todas las reglas.
        solve(
            phase=2,
            relaxed_phase1=relaxed_phase1,
            warm_rows=extract_hint_rows(solver),
        )
        return

    room_by_index = rooms
    output = []
    for meeting in meetings:
        selected_day = None
        selected_start = None
        for day_index in range(len(DAYS)):
            day_key = (meeting.key, day_index)
            if day_key in day_presence and solver.BooleanValue(day_presence[day_key]):
                selected_day = day_index
                selected_start = solver.Value(day_start[day_key])
                break
        if selected_day is None or selected_start is None:
            raise RuntimeError(f"El solver devolvió una sesión sin día: {meeting.key}.")

        selected_room = None
        for room_index in candidate_rooms[meeting.key]:
            selector = room_choices[(meeting.key, room_index)]
            if solver.BooleanValue(selector):
                selected_room = room_by_index[room_index]
                break

        course = meeting.course
        end_minute = selected_start + meeting.duration_minutes
        exclusions = sorted(
            holiday.isoformat() for holiday in holidays
            if course.start_date <= holiday <= course.end_date
            and holiday.weekday() == selected_day
        )
        room_label = (
            f"{selected_room['edificio']} · {selected_room['salon']}"
            if selected_room else None
        )
        assigned_teacher = (
            course.teacher if meeting.kind not in ("EMP", "VIR") else ""
        )
        output.append({
            "periodo": "".join(
                character for character in str(config.get("periodo", ""))
                if character.isdigit()
            ) or None,
            "dia": DAYS[selected_day],
            "hora_inicio": format_time(selected_start),
            "hora_fin": format_time(end_minute),
            "curso": course.name,
            "mat_cur": course.mat_cur,
            "tipo_clase": meeting.kind,
            "docente": assigned_teacher,
            "aula": room_label,
            "grupo": course.section,
            "seccion": course.section,
            "carrera": course.career,
            "semestre": course.semester,
            "fecha_inicio": course.start_date.isoformat(),
            "fecha_fin": course.end_date.isoformat(),
            "fechas_excluidas": exclusions,
        })

    output.sort(key=lambda row: (
        row["grupo"], row["dia"], row["hora_inicio"], row["mat_cur"], row["tipo_clase"]
    ))
    write_json_atomically(OUTPUT_PATH, output)
    print(
        f"Estado: {solver.StatusName(status)} | "
        f"Sesiones: {len(output)} | "
        f"Objetivo: {solver.ObjectiveValue():.0f} | "
        f"Archivo: {OUTPUT_PATH}"
    )


def write_json_atomically(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.stem}_", suffix=".tmp", dir=path.parent
    )
    try:
        with os.fdopen(file_descriptor, "w", encoding="utf-8", newline="\n") as target:
            json.dump(data, target, ensure_ascii=False, indent=2)
            target.write("\n")
        os.replace(temporary_name, path)
    except Exception:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)
        raise


def generate_fallback_candidate():
    rules = load_json("reglas_horario.json")
    config = load_json("config_semestre.json")
    holidays_rows = load_json("feriados.json")
    semester_start = parse_date(
        config.get("fecha_inicio_semestre"), "config_semestre.fecha_inicio_semestre"
    )
    semester_end = parse_date(
        config.get("fecha_fin_semestre"), "config_semestre.fecha_fin_semestre"
    )
    if not semester_start or not semester_end:
        raise ValueError("El rango del semestre no está configurado.")
    rows = generate_fallback_schedule(
        load_json("curso_docentes.json"),
        load_json("cursos.json"),
        load_json("horas_cursos.json"),
        load_json("disponibilidad_docentes.json"),
        load_json("salones.json"),
        parse_holidays(holidays_rows, semester_start, semester_end),
        semester_start,
        semester_end,
        parse_time(config["franja_operativa"]["hora_inicio"], "hora_inicio"),
        parse_time(config["franja_operativa"]["hora_fin"], "hora_fin"),
        int(rules["parametros_tiempo"]["receso_transicion_curso_minutos_min"]),
        int(rules["parametros_tiempo"]["frecuencia_receso_bloque_horas_academicas"])
        * int(rules["parametros_tiempo"]["duracion_hora_academica_minutos"]),
        rules["restricciones_duras_inviolables"],
        str(config.get("periodo") or ""),
        attempt=int(os.environ.get("CP_SAT_RANDOM_SEED", "0")) - 1,
        emp_config=get_emp_config(rules),
        strict=True,
    )
    write_json_atomically(OUTPUT_PATH, rows)
    print(f"Candidato heurístico estricto: {len(rows)} sesiones | {OUTPUT_PATH}")


if __name__ == "__main__":
    if os.environ.get("HORARIOS_RUNNER_CHILD") == "1":
        if os.environ.get("CP_SAT_USE_FALLBACK") == "1":
            generate_fallback_candidate()
        else:
            solve(phase=2 if STRICT_HARD_RULES else 1)
    else:
        from generar_horario import main as generate_validated_schedule

        raise SystemExit(generate_validated_schedule())
