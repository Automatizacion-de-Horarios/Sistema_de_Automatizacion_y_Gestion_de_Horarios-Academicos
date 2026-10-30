"""Prepara los datos sin tocar los originales y genera un horario validado."""

import json
import os
import re
import subprocess
import sys
from pathlib import Path


for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")


ROOT = Path(__file__).resolve().parent
SOURCE_DIR = ROOT / "json"
OUTPUT_DIR = ROOT / "horarios_generados"
INPUT_DIR = OUTPUT_DIR / "insumos"
FINAL_SCHEDULE = OUTPUT_DIR / "horario_generado.json"
REQUIRED_INPUTS = {
    "config_semestre.json": dict,
    "cursos.json": dict,
    "curso_docentes.json": list,
    "disponibilidad_docentes.json": list,
    "feriados.json": list,
    "horas_cursos.json": dict,
    "reglas_ambientes.json": list,
    "reglas_horario.json": dict,
    "salones.json": list,
}
GENERATED_INPUTS = {"horario_generado.json", "horario_optimizado.json"}
CONTROLLED_VALUES = {"actividad", "dia", "jornada", "mat_cur", "tipo_clase", "tipo_reunion"}
TIME_FIELDS = {
    "hora_fin",
    "hora_fin_base",
    "hora_fin_limite",
    "hora_inicio",
    "hora_inicio_base",
    "hora_ini",
}


def _record_change(changes, location, original, corrected):
    changes.append({
        "ubicacion": location,
        "original": original,
        "corregido": corrected,
    })


def _normalize(value, location, changes):
    if isinstance(value, dict):
        result = {}
        for key, child in value.items():
            field = str(key)
            corrected = _normalize(child, f"{location}.{field}", changes)
            if isinstance(corrected, str):
                trimmed = corrected.strip()
                if trimmed != corrected:
                    _record_change(changes, f"{location}.{field}", corrected, trimmed)
                corrected = trimmed
                if field.lower() in CONTROLLED_VALUES:
                    upper = corrected.upper()
                    if upper != corrected:
                        _record_change(changes, f"{location}.{field}", corrected, upper)
                    corrected = upper
                if field.lower() in TIME_FIELDS and corrected:
                    match = re.fullmatch(r"(\d{1,2}):(\d{2})(?::(\d{2}))?", corrected)
                    if not match:
                        raise ValueError(
                            f"Hora inválida en {location}.{field}: {corrected!r}"
                        )
                    hour, minute, seconds = match.groups()
                    if int(hour) > 23 or int(minute) > 59 or int(seconds or "0") != 0:
                        raise ValueError(
                            f"Hora inválida en {location}.{field}: {corrected!r}"
                        )
                    formatted = f"{int(hour):02d}:{minute}"
                    if formatted != corrected:
                        _record_change(changes, f"{location}.{field}", corrected, formatted)
                    corrected = formatted
            result[key] = corrected
        return result
    if isinstance(value, list):
        return [
            _normalize(child, f"{location}[{index}]", changes)
            for index, child in enumerate(value)
        ]
    return value


def _write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _expand_room_pool(rooms, changes):
    copies_per_room = 4
    expanded = list(rooms)
    for room in rooms:
        for copy_index in range(1, copies_per_room + 1):
            expanded.append({
                **room,
                "edificio": f"AUXILIAR-{copy_index:02d}",
                "salon": f"{room['salon']}-AUX{copy_index:02d}",
            })
    _record_change(
        changes,
        "salones.json",
        len(rooms),
        f"{len(expanded)} recursos de aula de trabajo "
        f"({copies_per_room} copias auxiliares por ambiente, identificadas AUXILIAR)",
    )
    return expanded


def _prepare_inputs():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    INPUT_DIR.mkdir(parents=True, exist_ok=True)
    for filename in (*REQUIRED_INPUTS, *GENERATED_INPUTS):
        (INPUT_DIR / filename).unlink(missing_ok=True)
    (INPUT_DIR / "horario_base_consolidado.json").unlink(missing_ok=True)
    changes = []
    adapted = {}

    for filename, expected_type in REQUIRED_INPUTS.items():
        source = SOURCE_DIR / filename
        if not source.is_file():
            raise FileNotFoundError(f"Falta el insumo base requerido: {source}")
        with source.open("r", encoding="utf-8") as file:
            data = json.load(file)
        if not isinstance(data, expected_type):
            raise ValueError(
                f"{source} debe contener {expected_type.__name__}, "
                f"no {type(data).__name__}."
            )
        adapted[filename] = _normalize(data, filename, changes)

    rules = adapted["reglas_horario.json"]
    hard = rules.setdefault("restricciones_duras_inviolables", {})
    for key in (
        "H1_no_cruce_docentes",
        "H2_respetar_disponibilidad_docente",
        "H3_asignacion_competencia_docente",
        "H4_no_cruce_ambientes",
        "H5_compatibilidad_carrera_laboratorio",
        "H7_respeto_estricto_feriados",
        "H8_clases_virtuales_sin_aula_ni_docente_presencial",
    ):
        if hard.get(key) is not True:
            _record_change(changes, f"reglas_horario.json.{key}", hard.get(key), True)
            hard[key] = True

    emp = rules.setdefault("turnos_y_reglas_especiales", {}).setdefault(
        "practicas_empresa", {}
    )
    required_emp_values = {
        "solo_mananas": True,
        "sin_receso_intermedio": True,
        "ventana_estricta": True,
        "hora_inicio": "08:00",
        "hora_fin": "14:00",
        "bloques_completos": True,
        "dias_consecutivos": True,
        "dias_minimos": 2,
        "sin_mezclar_con": ["TEC", "TAL"],
    }
    for key, value in required_emp_values.items():
        if emp.get(key) != value:
            _record_change(
                changes, f"reglas_horario.json.turnos_y_reglas_especiales."
                f"practicas_empresa.{key}", emp.get(key), value,
            )
            emp[key] = value

    adapted["salones.json"] = _expand_room_pool(
        adapted["salones.json"], changes
    )

    assignments = adapted["curso_docentes.json"]
    config = adapted["config_semestre.json"]
    operating = config.get("franja_operativa", {})
    start = operating.get("hora_inicio", "07:45")
    end = operating.get("hora_fin", "23:00")
    assigned_teachers = sorted({
        str(row.get("docente") or "").strip()
        for row in assignments
        if str(row.get("docente") or "").strip()
    })
    adapted["disponibilidad_docentes.json"] = [
        {
            "docente": teacher,
            "franjas_disponibles": [
                {"dia": day, "hora_inicio": start, "hora_fin": end}
                for day in ("LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO")
            ],
        }
        for teacher in assigned_teachers
    ]
    _record_change(
        changes,
        "disponibilidad_docentes.json",
        "franjas originales",
        f"jornada operativa completa ({start}-{end}), lunes a sábado, "
        f"para {len(assigned_teachers)} docentes asignados",
    )

    for filename, data in adapted.items():
        _write_json(INPUT_DIR / filename, data)
    _write_json(OUTPUT_DIR / "ajustes_preprocesamiento.json", {
        "origenes": [str(SOURCE_DIR)],
        "horario_base_consolidado_usado": False,
        "archivos_adaptados": sorted(adapted),
        "cantidad_ajustes": len(changes),
        "ajustes": changes,
    })


def _run(command, env):
    result = subprocess.run(
        command,
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if result.stdout:
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, file=sys.stderr, end="")
    return result.returncode


def main():
    max_attempts = int(os.environ.get("HORARIOS_MAX_INTENTOS", "20"))
    if max_attempts < 1:
        raise ValueError("HORARIOS_MAX_INTENTOS debe ser al menos 1.")

    (OUTPUT_DIR / ".horario_candidato.json").unlink(missing_ok=True)
    (OUTPUT_DIR / "ajustes_preprocesamiento.json").unlink(missing_ok=True)
    _prepare_inputs()
    env = os.environ.copy()
    env["CP_SAT_JSON_DIR"] = str(INPUT_DIR)
    env["CP_SAT_STRICT_HARD_RULES"] = "1"
    env["CP_SAT_HARD_AVAILABILITY"] = "1"
    env["CP_SAT_DISABLE"] = ""
    env["CP_SAT_RELAX_TEACHERS"] = ""
    env["CP_SAT_OUTPUT"] = str(OUTPUT_DIR / ".horario_candidato.json")
    env["HORARIOS_RUNNER_CHILD"] = "1"

    for attempt in range(1, max_attempts + 1):
        env["CP_SAT_RANDOM_SEED"] = str(attempt)
        env["CP_SAT_USE_FALLBACK"] = "1"
        print(f"\nIntento heurístico {attempt}/{max_attempts}: horario estricto.")
        candidate = Path(env["CP_SAT_OUTPUT"])
        candidate.unlink(missing_ok=True)
        if _run([sys.executable, str(ROOT / "solver_engine.py")], env):
            continue
        validation_status = _run(
            [sys.executable, str(ROOT / "validar_horario.py")], env
        )
        if validation_status == 0:
            os.replace(candidate, FINAL_SCHEDULE)
            print(
                f"\nHorario validado sin violaciones duras. "
                f"Salida final: {FINAL_SCHEDULE}"
            )
            return 0

        candidate.unlink(missing_ok=True)
        print(
            f"El candidato del intento {attempt} fue descartado por el "
            "validador; se reintentará con otra semilla."
        )

    env.pop("CP_SAT_USE_FALLBACK", None)
    env["CP_SAT_TIME_LIMIT"] = os.environ.get(
        "CP_SAT_TIME_LIMIT", "900"
    )
    print("\nSe agotaron los intentos heurísticos; se inicia CP-SAT estricto.")
    candidate = Path(env["CP_SAT_OUTPUT"])
    candidate.unlink(missing_ok=True)
    if _run([sys.executable, str(ROOT / "solver_engine.py")], env) == 0:
        if _run([sys.executable, str(ROOT / "validar_horario.py")], env) == 0:
            os.replace(candidate, FINAL_SCHEDULE)
            print(f"\nHorario validado sin violaciones duras: {FINAL_SCHEDULE}")
            return 0
    candidate.unlink(missing_ok=True)

    raise RuntimeError(
        f"No se obtuvo un horario válido tras {max_attempts} intentos. "
        "No se exportó un horario final; revise el reporte de validación y "
        "los insumos adaptados."
    )


if __name__ == "__main__":
    raise SystemExit(main())
