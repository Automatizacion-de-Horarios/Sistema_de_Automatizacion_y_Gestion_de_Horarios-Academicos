"""Validador independiente del horario generado.

Comprueba cruces de docentes, secciones y ambientes, recesos mínimos entre
cursos del mismo grupo, disponibilidad docente, compatibilidad de ambientes y
que la carga semanal coincida con la esperada por horas_cursos.json.
"""

import json
import os
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
JSON_DIR = Path(os.environ.get("CP_SAT_JSON_DIR", str(ROOT / "json")))
SCHEDULE_PATH = Path(os.environ.get(
    "CP_SAT_OUTPUT", str(JSON_DIR / "horario_generado.json")
))
sys.path.insert(0, str(ROOT))

import solver_engine as engine  # noqa: E402


def load(name):
    with (JSON_DIR / name).open("r", encoding="utf-8") as source:
        return json.load(source)


def to_minutes(value):
    hour, minute = str(value).split(":")
    return int(hour) * 60 + int(minute)


def overlap(left, right):
    return left["inicio"] < right["fin"] and right["inicio"] < left["fin"]


def coexist(left, right):
    """Dos sesiones sólo pueden chocar si coinciden en alguna fecha real."""
    left_dates = left.get("fechas")
    right_dates = right.get("fechas")
    if left_dates is None or right_dates is None:
        return True
    return bool(left_dates & right_dates)


def main():
    with SCHEDULE_PATH.open("r", encoding="utf-8") as source:
        rows = json.load(source)
    config = load("config_semestre.json")
    rules = load("reglas_horario.json")
    rooms = load("salones.json")
    environment_rows = load("reglas_ambientes.json")
    availability = load("disponibilidad_docentes.json")
    holidays = load("feriados.json")
    assignments = load("curso_docentes.json")

    semester_start = engine.parse_date(config["fecha_inicio_semestre"], "inicio")
    semester_end = engine.parse_date(config["fecha_fin_semestre"], "fin")
    holiday_dates = {
        value.isoformat()
        for value in engine.parse_holidays(holidays, semester_start, semester_end)
    }
    expected_teachers = {
        (
            engine.normalize_course_code(row.get("mat_cur")),
            str(row.get("seccion") or ""),
        ): engine.normalize_name(row.get("docente") or "")
        for row in assignments
    }
    academic_hour = int(
        rules.get("parametros_tiempo", {}).get("duracion_hora_academica_minutos", 45)
    )
    required_break = int(
        rules.get("parametros_tiempo", {}).get("receso_transicion_curso_minutos_min", 15)
    )
    max_block = int(
        rules.get("parametros_tiempo", {}).get(
            "frecuencia_receso_bloque_horas_academicas", 3
        )
    )
    hard = rules.get("restricciones_duras_inviolables", {})
    h6 = set(hard.get("H6_laboratorio_obligatorio_carreras_tecnicas", []))
    emp_config = engine.get_emp_config(rules)

    errors = []
    warnings = []

    # Normalización de filas
    normalized = []
    for index, row in enumerate(rows):
        try:
            normalized.append({
                "index": index,
                "dia": engine.normalize_name(row["dia"]),
                "inicio": to_minutes(row["hora_inicio"]),
                "fin": to_minutes(row["hora_fin"]),
                "docente": engine.normalize_name(row.get("docente", "")),
                "seccion": str(row.get("seccion") or row.get("grupo") or ""),
                "mat_cur": engine.normalize_course_code(row.get("mat_cur")),
                "tipo": str(row.get("tipo_clase", "")).upper(),
                "aula": str(row.get("aula") or ""),
                "carrera": str(row.get("carrera", "")),
                "semestre": int(row.get("semestre") or 0),
                "inicio_fecha": engine.parse_date(row.get("fecha_inicio"), "fecha_inicio"),
                "fin_fecha": engine.parse_date(row.get("fecha_fin"), "fecha_fin"),
                "raw": row,
            })
        except (KeyError, TypeError, ValueError) as exc:
            errors.append(f"Fila {index}: estructura inválida ({exc}).")
            continue

    if not normalized:
        errors.append("El horario está vacío.")
        return print_report(errors, warnings)

    for item in normalized:
        if (
            item["inicio_fecha"]
            and item["fin_fecha"]
            and item["dia"] in engine.DAY_TO_INDEX
        ):
            day_index = engine.DAY_TO_INDEX[item["dia"]]
            item["fechas"] = frozenset(
                current
                for current in engine.date_range(item["inicio_fecha"], item["fin_fecha"])
                if current.weekday() == day_index
                and current.isoformat() not in holiday_dates
            )
        else:
            item["fechas"] = None

    for item in normalized:
        if item["dia"] not in engine.DAY_TO_INDEX:
            errors.append(f"Fila {item['index']}: día inválido {item['dia']}.")
        if item["fin"] <= item["inicio"]:
            errors.append(f"Fila {item['index']}: rango horario inválido.")
        if (
            item["tipo"] != "EMP"
            and item["fin"] - item["inicio"] > max_block * academic_hour
        ):
            warnings.append(
                f"Fila {item['index']}: bloque mayor a {max_block} h académicas."
            )
        if item["inicio_fecha"] and not (
            semester_start <= item["inicio_fecha"] <= semester_end
        ):
            errors.append(f"Fila {item['index']}: fecha_inicio fuera del semestre.")
        if item["fin_fecha"] and not (
            semester_start <= item["fin_fecha"] <= semester_end
        ):
            errors.append(f"Fila {item['index']}: fecha_fin fuera del semestre.")
        if item["tipo"] != "EMP":
            allowed_windows = engine.turn_windows_for_course(
                item["semestre"], rules, config, item["tipo"], emp_config
            )
            if not any(
                start <= item["inicio"] and item["fin"] <= end
                for start, end in allowed_windows
            ):
                errors.append(
                    f"Fila {item['index']}: horario fuera del turno permitido "
                    f"para semestre {item['semestre']}."
                )

    # Cruces por docente
    by_teacher = defaultdict(list)
    for item in normalized:
        if item["docente"] and item["tipo"] not in ("EMP", "VIR"):
            by_teacher[(item["docente"], item["dia"])].append(item)
    teacher_overlaps = 0
    for (teacher, day), items in by_teacher.items():
        for index, left in enumerate(items):
            for right in items[index + 1:]:
                if not coexist(left, right) or not overlap(left, right):
                    continue
                teacher_overlaps += 1
                errors.append(
                    f"Cruce docente {teacher} {day}: "
                    f"{left['raw'].get('mat_cur')} y {right['raw'].get('mat_cur')}."
                )

    # Cruces de sección y recesos
    by_section = defaultdict(list)
    for item in normalized:
        by_section[(item["seccion"], item["dia"])].append(item)
    section_overlaps = 0
    short_transitions = 0
    for (section, day), items in by_section.items():
        items.sort(key=lambda value: value["inicio"])
        for index, left in enumerate(items):
            for right in items[index + 1:]:
                if coexist(left, right) and overlap(left, right):
                    section_overlaps += 1
                    errors.append(
                        f"Cruce de sección {section} {day}: "
                        f"{left['mat_cur']} y {right['mat_cur']}."
                    )
            following = [
                value for value in items[index + 1:]
                if coexist(left, value) and value["inicio"] >= left["fin"]
            ]
            if not following:
                continue
            right = min(following, key=lambda value: value["inicio"])
            gap = right["inicio"] - left["fin"]
            if left["mat_cur"] != right["mat_cur"] and gap < required_break:
                short_transitions += 1
                errors.append(
                    f"Sección {section} {day}: transición de {gap} min entre "
                    f"{left['mat_cur']} y {right['mat_cur']} (mínimo {required_break})."
                )

    # Cruces de ambientes
    by_room = defaultdict(list)
    for item in normalized:
        if item["aula"]:
            by_room[(item["aula"], item["dia"])].append(item)
    room_overlaps = 0
    for (room, day), items in by_room.items():
        for index, left in enumerate(items):
            for right in items[index + 1:]:
                if not coexist(left, right) or not overlap(left, right):
                    continue
                room_overlaps += 1
                errors.append(
                    f"Cruce de ambiente {room} {day}: "
                    f"{left['seccion']} y {right['seccion']}."
                )

    # Disponibilidad docente
    availability_map = {}
    for row in availability:
        key = engine.normalize_name(row["docente"])
        availability_map[key] = {
            day: [] for day in engine.DAY_TO_INDEX
        }
        for span in row.get("franjas_disponibles", []):
            availability_map[key][engine.normalize_name(span["dia"])].append(
                (to_minutes(span["hora_inicio"]), to_minutes(span["hora_fin"]))
            )
        for day, spans in availability_map[key].items():
            merged = []
            for start, end in sorted(spans):
                if merged and start <= merged[-1][1]:
                    merged[-1] = (merged[-1][0], max(merged[-1][1], end))
                else:
                    merged.append((start, end))
            availability_map[key][day] = merged

    availability_violations = 0
    hard_availability = hard.get("H2_respetar_disponibilidad_docente", True)
    for item in normalized:
        if item["tipo"] in ("EMP", "VIR") or not item["docente"]:
            continue
        spans = availability_map.get(item["docente"], {}).get(item["dia"], [])
        if not spans:
            availability_violations += 1
            (errors if hard_availability else warnings).append(
                f"Fila {item['index']}: {item['docente']} sin franja el {item['dia']}."
            )
            continue
        if not any(
            start <= item["inicio"] and item["fin"] <= end for start, end in spans
        ):
            availability_violations += 1
            (errors if hard_availability else warnings).append(
                f"Fila {item['index']}: {item['docente']} fuera de disponibilidad "
                f"{item['dia']} {item['raw'].get('hora_inicio')}-"
                f"{item['raw'].get('hora_fin')}."
            )

    # Compatibilidad de ambientes
    environment_map = {
        str(row["area"]): row for row in environment_rows
    }
    room_by_label = {
        f"{row['edificio']} · {row['salon']}": row for row in rooms
    }
    room_violations = 0
    for item in normalized:
        if item["tipo"] in ("EMP", "VIR"):
            continue
        room = room_by_label.get(item["aula"])
        if room is None:
            room_violations += 1
            errors.append(f"Fila {item['index']}: ambiente inexistente {item['aula']}.")
            continue
        area = str(room.get("area", ""))
        is_lab = area.upper().startswith("LABORATORIO")
        career_code = item["seccion"].split("-", 1)[0].upper()
        if hard.get("H6_laboratorio_obligatorio_carreras_tecnicas") and career_code in h6 and not is_lab:
            room_violations += 1
            errors.append(
                f"Fila {item['index']}: {career_code} requiere laboratorio y está "
                f"en {area}."
            )
        rule = environment_map.get(area)
        if not rule:
            room_violations += 1
            errors.append(f"Fila {item['index']}: área sin regla {area}.")
            continue
        careers = {str(value).upper() for value in rule.get("carreras_permitidas", [])}
        kinds = {str(value).upper() for value in rule.get("tipo_clase", [])}
        course_match = item["mat_cur"] in set(rule.get("cursos_codigos", []))
        career_match = "TODAS" in careers or career_code in careers
        if not (course_match or (career_match and item["tipo"] in kinds)):
            room_violations += 1
            errors.append(
                f"Fila {item['index']}: {item['mat_cur']} ({item['tipo']}) no es "
                f"compatible con {area}."
            )

    # H3/H8: conservar el docente asignado y mantener lo virtual sin recursos
    # presenciales.
    if hard.get("H3_asignacion_competencia_docente", True):
        for item in normalized:
            expected_teacher = expected_teachers.get(
                (item["mat_cur"], item["seccion"]), ""
            )
            actual_teacher = item["docente"]
            if item["tipo"] in ("EMP", "VIR"):
                expected_teacher = ""
            if actual_teacher != expected_teacher:
                errors.append(
                    f"Fila {item['index']}: docente asignado incorrectamente "
                    f"para {item['mat_cur']} / {item['seccion']}."
                )
    if hard.get("H8_clases_virtuales_sin_aula_ni_docente_presencial", True):
        for item in normalized:
            if item["tipo"] == "VIR" and (item["aula"] or item["docente"]):
                errors.append(
                    f"Fila {item['index']}: clase virtual con aula o docente "
                    "presencial asignado."
                )

    # Carga esperada vs generada
    catalog = load("cursos.json")
    hours = load("horas_cursos.json")
    rules_config = load("config_semestre.json")
    holidays_parsed = engine.parse_holidays(
        holidays, semester_start, semester_end
    )
    weeks = engine.semester_teaching_weeks(semester_start, semester_end)
    _, expected_meetings = engine.build_courses_and_meetings(
        assignments,
        catalog,
        hours,
        semester_start,
        semester_end,
        academic_hour,
        max_block,
        int(rules.get("modos_dictado", {}).get("taller_tal", {}).get("fragmentacion_dias_minima", 2)),
        semester_weeks=weeks,
        emp_config=emp_config,
    )
    expected = defaultdict(lambda: defaultdict(int))
    for meeting in expected_meetings:
        expected[(meeting.course.mat_cur, meeting.course.section)][meeting.kind] += (
            meeting.duration_minutes
        )
    generated = defaultdict(lambda: defaultdict(int))
    for item in normalized:
        generated[(item["mat_cur"], item["seccion"])][item["tipo"]] += (
            item["fin"] - item["inicio"]
        )
    missing = 0
    for key, kinds in expected.items():
        for kind, minutes in kinds.items():
            if generated.get(key, {}).get(kind, 0) != minutes:
                missing += 1
                errors.append(
                    f"Carga no coincide para {key[0]} / {key[1]} / {kind}: "
                    f"esperado {minutes} min, generado "
                    f"{generated.get(key, {}).get(kind, 0)} min."
                )
    for key, kinds in generated.items():
        for kind, minutes in kinds.items():
            if expected.get(key, {}).get(kind, 0) == 0:
                missing += 1
                errors.append(
                    f"Sesión inesperada {key[0]} / {key[1]} / {kind} ({minutes} min)."
                )

    # Feriados: ninguna clase debe declarar una fecha excluida que no sea feriado
    holiday_dates = {value.isoformat() for value in holidays_parsed}
    for item in normalized:
        declared_exclusions = set(item["raw"].get("fechas_excluidas", []) or [])
        for value in declared_exclusions:
            if value not in holiday_dates:
                errors.append(
                    f"Fila {item['index']}: fecha excluida no feriada {value}."
                )
        if (
            hard.get("H7_respeto_estricto_feriados", True)
            and item["inicio_fecha"]
            and item["fin_fecha"]
            and item["dia"] in engine.DAY_TO_INDEX
        ):
            expected_exclusions = {
                current.isoformat()
                for current in engine.date_range(
                    item["inicio_fecha"], item["fin_fecha"]
                )
                if current.weekday() == engine.DAY_TO_INDEX[item["dia"]]
                and current.isoformat() in holiday_dates
            }
            if declared_exclusions != expected_exclusions:
                errors.append(
                    f"Fila {item['index']}: las exclusiones de feriados no "
                    "coinciden con el rango de la sesión."
                )

    # ---- Reglas adicionales (turnos_y_reglas_especiales) ----
    # EMP ocupa un bloque completo diario, con días consecutivos y sin
    # TEC/TAL de la misma sección durante esos días.
    emp_fuera = 0
    emp_by_course = defaultdict(list)
    for item in normalized:
        if item["tipo"] != "EMP":
            continue
        emp_by_course[(item["mat_cur"], item["seccion"])].append(item)
        if (
            item["inicio"] != emp_config["inicio"]
            or item["fin"] != emp_config["fin"]
            or item["fin"] - item["inicio"] != emp_config["bloque_minutos"]
        ):
            emp_fuera += 1
            errors.append(
                f"Fila {item['index']}: EMP debe ocupar "
                f"{engine.format_time(emp_config['inicio'])}-"
                f"{engine.format_time(emp_config['fin'])} sin cortes."
            )
    for (mat_cur, section), items in emp_by_course.items():
        days = sorted({
            engine.DAY_TO_INDEX[item["dia"]]
            for item in items if item["dia"] in engine.DAY_TO_INDEX
        })
        if len(days) < emp_config["dias_minimos"]:
            errors.append(
                f"EMP {mat_cur} / {section}: requiere al menos "
                f"{emp_config['dias_minimos']} días."
            )
        if days and days != list(range(days[0], days[-1] + 1)):
            errors.append(
                f"EMP {mat_cur} / {section}: los días no son consecutivos."
            )
        for day in days:
            day_name = engine.DAYS[day]
            mixed = [
                item for item in normalized
                if item["seccion"] == section
                and item["dia"] == day_name
                and item["tipo"] in emp_config["sin_mezclar_con"]
            ]
            if mixed:
                errors.append(
                    f"EMP {mat_cur} / {section}: no puede compartir "
                    f"{day_name} con TEC/TAL."
                )

    # R2: el TEC de un curso se dicta en un solo día de la semana
    tec_days = defaultdict(set)
    for item in normalized:
        if item["tipo"] == "TEC":
            tec_days[(item["mat_cur"], item["seccion"])].add(item["dia"])
    tec_multidia = 0
    for (mat_cur, section), days in sorted(tec_days.items()):
        if len(days) > 1:
            tec_multidia += 1
            errors.append(
                f"TEC en varios días: {mat_cur} / {section} usa {sorted(days)}."
            )

    minimum_tal_days = int(
        rules.get("modos_dictado", {})
        .get("taller_tal", {})
        .get("fragmentacion_dias_minima", 2)
    )
    expected_tal_blocks = defaultdict(int)
    for meeting in expected_meetings:
        if meeting.kind == "TAL":
            expected_tal_blocks[
                (meeting.course.mat_cur, meeting.course.section)
            ] += 1
    tal_days_by_course = defaultdict(set)
    for item in normalized:
        if item["tipo"] == "TAL":
            tal_days_by_course[(item["mat_cur"], item["seccion"])].add(item["dia"])
    for (mat_cur, section), days in sorted(tal_days_by_course.items()):
        if (
            expected_tal_blocks[(mat_cur, section)] >= minimum_tal_days
            and len(days) < minimum_tal_days
        ):
            errors.append(
                f"TAL {mat_cur} / {section}: requiere al menos "
                f"{minimum_tal_days} días."
            )

    # R3: módulos de carrera con TEC secuenciales y en orden ascendente
    career_modules = defaultdict(list)
    comunes = {
        str(prefix).upper()
        for prefix in rules.get("modos_dictado", {})
        .get("modular_tec_carrera", {})
        .get("prefijos_comunes_excluidos", ())
    }
    for item in normalized:
        if item["tipo"] != "TEC":
            continue
        if item["mat_cur"].split("-")[0] in comunes:
            continue
        career_modules[item["seccion"]].append(
            (item["mat_cur"], item["inicio_fecha"], item["fin_fecha"])
        )
    modulo_superpuesto = 0
    for section, modules in career_modules.items():
        uniq = {}
        for mat_cur, start, end in modules:
            if mat_cur not in uniq:
                uniq[mat_cur] = (start, end)
        ordered = sorted(uniq.items(), key=lambda pair: engine.sort_key_curso(pair[0]))
        # Los núcleos de duración completa (ventana que cubre la mayor parte
        # del semestre, p. ej. NCCU-239, NSID-220) se excluyen de la secuencia
        # modular: por construcción no pueden no-solapar con módulos cortos.
        semestre_dias = (semester_end - semester_start).days

        def cubre_semestre(rango):
            start, end = rango
            if start is None or end is None:
                return False
            return (end - start).days * 2 >= semestre_dias

        for (left_code, left_range), (right_code, right_range) in zip(
            ordered, ordered[1:]
        ):
            left_end, right_start = left_range[1], right_range[0]
            if left_end is None or right_start is None:
                continue
            if cubre_semestre(left_range) or cubre_semestre(right_range):
                continue
            if right_start <= left_end:
                modulo_superpuesto += 1
                errors.append(
                    f"Módulos de carrera solapados en {section}: {left_code} "
                    f"(hasta {left_end}) y {right_code} (desde {right_start})."
                )

    # R4 (preferente): días del taller consecutivos
    tal_days = defaultdict(set)
    for item in normalized:
        if item["tipo"] == "TAL":
            tal_days[(item["mat_cur"], item["seccion"])].add(
                engine.DAY_TO_INDEX[item["dia"]]
            )
    tal_no_consecutivos = 0
    for (mat_cur, section), days in sorted(tal_days.items()):
        ordered = sorted(days)
        skipped = ordered[-1] - ordered[0] - (len(ordered) - 1)
        if skipped > 0:
            tal_no_consecutivos += 1
            warnings.append(
                f"Taller no consecutivo: {mat_cur} / {section} usa "
                f"{[engine.DAYS[d] for d in ordered]}."
            )

    # R5 (preferente): bloques de una misma clase de corrido en el día
    clase_bloques = defaultdict(list)
    for item in normalized:
        clase_bloques[(item["seccion"], item["mat_cur"], item["tipo"], item["dia"])].append(item)
    corridos_rotos = 0
    for (section, mat_cur, kind, day), items in sorted(clase_bloques.items()):
        if len(items) < 2:
            continue
        items.sort(key=lambda value: value["inicio"])
        for left, right in zip(items, items[1:]):
            if not coexist(left, right):
                continue
            gap = right["inicio"] - left["fin"]
            allowed = 0 if kind == "EMP" else required_break
            if gap > allowed:
                corridos_rotos += 1
                warnings.append(
                    f"Clase no corrida {section} {day}: {mat_cur} ({kind}) con "
                    f"{gap} min de hueco entre bloques."
                )

    print_report(
        errors,
        warnings,
        extra={
            "filas": len(normalized),
            "docentes": len(by_teacher),
            "secciones": len({item["seccion"] for item in normalized}),
            "cruces_docente": teacher_overlaps,
            "cruces_seccion": section_overlaps,
            "cruces_ambiente": room_overlaps,
            "transiciones_cortas": short_transitions,
            "fuera_disponibilidad": availability_violations,
            "incompatibilidades_ambiente": room_violations,
            "cargas_no_coincidentes": missing,
            "emp_fuera_de_ventana": emp_fuera,
            "tec_en_varios_dias": tec_multidia,
            "modulos_carrera_solapados": modulo_superpuesto,
            "tal_no_consecutivo": tal_no_consecutivos,
            "clases_no_corridas": corridos_rotos,
        },
    )


def print_report(errors, warnings, extra=None):
    print("=== VALIDACIÓN DEL HORARIO ===")
    if extra:
        for key, value in extra.items():
            print(f"{key}: {value}")
    print(f"errores: {len(errors)} | advertencias: {len(warnings)}")
    for message in errors[:50]:
        print("ERROR:", message)
    for message in warnings[:30]:
        print("ADVERTENCIA:", message)
    if len(errors) > 50:
        print(f"... y {len(errors) - 50} errores más.")
    if len(warnings) > 30:
        print(f"... y {len(warnings) - 30} advertencias más.")
    if errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
