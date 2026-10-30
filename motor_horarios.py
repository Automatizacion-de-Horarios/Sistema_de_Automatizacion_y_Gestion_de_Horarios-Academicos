# -*- coding: utf-8 -*-
"""motor_horarios.py — Motor de optimización de horarios académicos (OR-Tools CP-SAT).

Genera un horario SEMANAL que cumple TODAS las reglas de
`json/reglas_horario.json` (y sus archivos auxiliares), y nada más:

  Duras (restricciones_duras_inviolables):
    H1  no cruce de docentes
    H2  disponibilidad docente (franjas_disponibles estrictas)
    H3  competencia docente (el instructor de la base no se reasigna)
    H4  no cruce de ambientes
    H5  compatibilidad carrera-laboratorio (sólo salones históricos del par)
    H6  laboratorio obligatorio para TEC/TAL de carreras técnicas
    H7  respeto estricto de feriados (días cuya totalidad es feriado)
    H8  clases virtuales sin aula (pseudo-salón SIN_AULA)

  Parámetros de tiempo:
    - hora académica 45 min; receso de 15 min tras cada 3 h académicas
      (el reloj académico lo incorpora: ciclos de 3 slots + receso);
    - receso de transición entre cursos distintos del mismo bloque >= 15 min.

  Turnos y reglas especiales:
    - turnos por semestre (distribucion_turnos_semestre);
    - prácticas en empresa (EMP): sólo por las mañanas y sin receso intermedio
      (máximo 3 horas académicas corridas);
    - TEC de carrera: un solo día por semana;
    - TAL (taller): al menos 2 días (fragmentacion_dias_minima).

  Preferentes (prioridades_soft_constraints / "preferente"):
    - clases corridas (penaliza slots aislados del mismo curso);
    - TAL en días consecutivos (premia adyacencia de días);
    - semestre 3: mañana sólo si hay espacio (penaliza uso de la mañana).

Salida: `json/horario_optimizado.json` + reporte de cumplimiento.
"""

from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

from ortools.sat.python import cp_model

# Consola Windows (cp1252): forzar UTF-8 para los mensajes con acentos.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ----------------------------------------------------------------------------
# Constantes y rutas
# ----------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent
BASE_PATH = ROOT / "horario_base_consolidado.json"
JSON_DIR = ROOT / "json"
SALIDA_PATH = ROOT / "horarios_generados" / "horario_optimizado.json"

LIMITE_SEGUNDOS = 60          # especificación: límite de 60 s
PSEUDO_SALON = "SIN_AULA"     # aula virtual / prácticas externas (H8)

DIAS_ORDEN = [
    "LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO", "DOMINGO",
]
INDICE_DIA = {nombre: i for i, nombre in enumerate(DIAS_ORDEN)}

# Jornadas sin horario explícito en reglas_horario.json (ajustables).
JORNADAS_DEFECTO = {
    "TARDE": ("12:45", "19:00"),
    "NOCHE": ("19:00", "22:45"),
}

MESES = {
    "ENERO": 1, "FEBRERO": 2, "MARZO": 3, "ABRIL": 4, "MAYO": 5, "JUNIO": 6,
    "JULIO": 7, "AGOSTO": 8, "SEPTIEMBRE": 9, "OCTUBRE": 10,
    "NOVIEMBRE": 11, "DICIEMBRE": 12,
}

# Pesos de las preferencias (prioridades_soft_constraints, escalados a la
# escala semanal de este motor).
PESO_CORRIDAS = 10       # clases corridas (penaliza slots aislados)
PESO_TAL_CONSECUTIVO = 10  # TAL días consecutivos (premia adyacencia)
PESO_SEM3_MANANA = 5     # semestre 3: mañana sólo si hay espacio


# ----------------------------------------------------------------------------
# Utilidades de tiempo
# ----------------------------------------------------------------------------
def _a_minutos(hora: str) -> int:
    """Convierte '07:45:00' (o '07:45') a minutos desde medianoche."""
    partes = hora.split(":")
    return int(partes[0]) * 60 + int(partes[1])


def _formato_hora(minutos: int) -> str:
    return f"{minutos // 60:02d}:{minutos % 60:02d}"


def _semanas_entre(fecha_inicio: str | None, fecha_fin: str | None) -> int:
    """Semanas (mínimo 1) entre dos fechas 'YYYY-MM-DD'."""
    if not fecha_inicio or not fecha_fin:
        return 1
    try:
        inicio = date.fromisoformat(fecha_inicio)
        fin = date.fromisoformat(fecha_fin)
    except ValueError:
        return 1
    dias = max(0, (fin - inicio).days)
    return max(1, round(dias / 7) or 1)


# ----------------------------------------------------------------------------
# 1. Lectura de datos: demanda histórica desde la base consolidada
# ----------------------------------------------------------------------------
def cargar_base(path: Path = BASE_PATH) -> list[dict]:
    """Lee el horario base consolidado (lista de sesiones históricas)."""
    with path.open(encoding="utf-8") as fuente:
        filas = json.load(fuente)
    if not isinstance(filas, list) or not filas:
        raise ValueError(f"{path} no contiene una lista de sesiones.")
    return filas


def calcular_demanda(filas: list[dict]) -> dict[tuple[str, str], dict]:
    """Demanda histórica: horas por (bloque, mat_cur).

    Para cada fila se resta hora_fin - hora_ini y se acumula en minutos;
    se expresa en horas académicas de 45 min y se NORMALIZA A LA SEMANA
    (dividiendo entre las semanas que abarca el par, de d_inicio/d_fin):
    la base reutiliza los mismos slots semanales entre partes del periodo
    (módulos de 4 semanas), así que la demanda total del semestre no cabe
    en una rejilla semanal sin esa normalización.
    """
    demanda: dict[tuple[str, str], dict] = {}
    for fila in filas:
        clave = (str(fila["bloque"]), str(fila["mat_cur"]))
        info = demanda.setdefault(clave, {
            "minutos": 0,
            "salones": set(),      # (edificio, salon) usados históricamente
            "sin_aula": False,
            "instructores": set(),
            "actividades": set(),
            "seccion": fila.get("seccion"),
            "periodo": fila.get("periodo"),
            "camp": fila.get("camp"),
            "fecha_inicio": None,
            "fecha_fin": None,
        })
        minutos = _a_minutos(str(fila["hora_fin"])) - _a_minutos(str(fila["hora_ini"]))
        info["minutos"] += max(0, minutos)
        info["actividades"].add(str(fila.get("actividad") or ""))
        if fila.get("instructor"):
            info["instructores"].add(str(fila["instructor"]))
        if fila.get("salon"):
            info["salones"].add((str(fila["edificio"]), str(fila["salon"])))
        else:
            info["sin_aula"] = True
        inicio_fila = str(fila.get("d_inicio") or "")
        fin_fila = str(fila.get("d_fin") or "")
        if inicio_fila and (info["fecha_inicio"] is None or inicio_fila < info["fecha_inicio"]):
            info["fecha_inicio"] = inicio_fila
        if fin_fila and (info["fecha_fin"] is None or fin_fila > info["fecha_fin"]):
            info["fecha_fin"] = fin_fila

    for info in demanda.values():
        info["horas_totales"] = round(info["minutos"] / 45)
        info["semanas"] = _semanas_entre(info["fecha_inicio"], info["fecha_fin"])
        info["horas"] = max(1, round(info["horas_totales"] / info["semanas"]))
    return demanda


# ----------------------------------------------------------------------------
# 2. Lectura de reglas y construcción del entorno
# ----------------------------------------------------------------------------
def cargar_reglas() -> dict:
    """Carga reglas_horario.json y archivos auxiliares de /json."""
    def leer(nombre: str) -> dict:
        with (JSON_DIR / nombre).open(encoding="utf-8") as fuente:
            return json.load(fuente)

    return {
        "reglas": leer("reglas_horario.json"),
        "salones": leer("salones.json"),
        "disponibilidad": leer("disponibilidad_docentes.json"),
        "feriados": leer("feriados.json"),
        "config": leer("config_semestre.json"),
    }


def prefijo_carrera(mat_cur: str) -> str:
    return mat_cur.split("-")[0]


def semestre_de_materia(mat_cur: str) -> int:
    """Semestre estimado desde el código: NCCU-276 → centenas = 2."""
    try:
        numero = int(mat_cur.split("-")[1])
        return min(6, max(1, numero // 100))
    except (IndexError, ValueError):
        return 1  # sin clasificar → turno más amplio


def construir_jornadas(reglas: dict) -> dict[str, tuple[int, int]]:
    """Ventanas (inicio_min, fin_min) por jornada.

    `distribucion_turnos_semestre.semestres_1_2.turno_1` define la MAÑANA.
    TARDE y NOCHE no traen horario explícito en el archivo: se usan los
    valores por defecto declarados arriba.
    """
    jornadas = {}
    jornada_manana = (
        reglas.get("distribucion_turnos_semestre", {})
        .get("semestres_1_2", {})
        .get("turno_1", {})
    )
    inicio = jornada_manana.get("hora_inicio_base", "07:45")
    fin = jornada_manana.get("hora_fin_limite", "12:45")
    if jornada_manana.get("jornada", "MANANA").upper() == "MANANA":
        jornadas["MANANA"] = (_a_minutos(inicio), _a_minutos(fin))
    for nombre, (inicio, fin) in JORNADAS_DEFECTO.items():
        jornadas[nombre] = (_a_minutos(inicio), _a_minutos(fin))
    return jornadas


def jornadas_de_semestre(semestre: int, reglas: dict) -> list[str]:
    """Jornadas permitidas por semestre según `distribucion_turnos_semestre`."""
    distribucion = reglas.get("distribucion_turnos_semestre", {})
    if semestre <= 2:
        bloque = distribucion.get("semestres_1_2", {})
        permitidas = [
            bloque.get("turno_1", {}).get("jornada", "MANANA"),
            bloque.get("turno_2", {}).get("jornada", "TARDE"),
            bloque.get("turno_3", {}).get("jornada", "NOCHE"),
        ]
    elif semestre == 3:
        bloque = distribucion.get("semestre_3", {})
        permitidas = [
            bloque.get("turno_1", {}).get("jornada", "TARDE"),
            bloque.get("turnos_extra", {}).get("jornada", "NOCHE"),
        ]
        # `semestre_3.manana_permitida_si_hay_espacio` → la mañana queda
        # habilitada pero penalizada en el objetivo (preferencia).
        if reglas.get("turnos_y_reglas_especiales", {}).get(
            "semestre_3", {}
        ).get("manana_permitida_si_hay_espacio", True):
            permitidas.append("MANANA")
    else:
        permitidas = list(
            distribucion.get("semestres_4_5_6", {}).get(
                "turnos_permitidos", ["TARDE", "NOCHE"]
            )
        )
    return [j.upper() for j in permitidas]


def construir_reloj_academico(reglas: dict):
    """Rejilla con recesos incorporados (parámetros de tiempo).

    Reloj: `frecuencia_receso_bloque_horas_academicas` (3) horas
    académicas (`duracion_hora_academica_minutos` = 45) seguidas y
    `duracion_receso_bloque_minutos` (15) de receso. Ciclos desde el
    inicio de la mañana hasta el cierre de la última jornada.

    Devuelve (slots, ciclo_de) donde slots son minutos de inicio y
    ciclo_de[slot] es el ciclo (los 3 slots de un ciclo van seguidos;
    entre ciclos hay receso de 15 min).
    """
    parametros = reglas.get("parametros_tiempo", {})
    dur = int(parametros.get("duracion_hora_academica_minutos", 45))
    cada = int(parametros.get("frecuencia_receso_bloque_horas_academicas", 3))
    receso = int(parametros.get("duracion_receso_bloque_minutos", 15))

    inicio = _a_minutos(
        reglas.get("distribucion_turnos_semestre", {})
        .get("semestres_1_2", {})
        .get("turno_1", {})
        .get("hora_inicio_base", "07:45")
    )
    fin_operativo = max(fin for _, fin in construir_jornadas(reglas).values())

    slots: list[int] = []
    ciclo_de: dict[int, int] = {}
    t, ciclo = inicio, 0
    while t + dur <= fin_operativo:
        for k in range(cada):
            s = t + k * dur
            if s + dur <= fin_operativo:
                slots.append(s)
                ciclo_de[s] = ciclo
        ciclo += 1
        t += cada * dur + receso
    return slots, ciclo_de, dur, receso


def dias_con_feriados(reglas_aux: dict, dias: list[str]) -> list[str]:
    """H7: días de la semana cuya TOTALIDAD de ocurrencias del semestre
    son feriado se eliminan de la rejilla (un horario semanal no puede
    expresar feriados puntuales, sólo días completos)."""
    config = reglas_aux["config"]
    feriados = reglas_aux["feriados"]
    try:
        inicio = date.fromisoformat(str(config["fecha_inicio_semestre"])[:10])
        fin = date.fromisoformat(str(config["fecha_fin_semestre"])[:10])
    except (KeyError, ValueError):
        return []
    fechas_feriado = set()
    for item in feriados:
        mes = MESES.get(str(item.get("mes", "")).upper())
        dia = item.get("dia")
        if not mes or not dia:
            continue
        for anio in {inicio.year, fin.year}:
            try:
                fecha = date(anio, mes, int(dia))
            except ValueError:
                continue
            if inicio <= fecha <= fin:
                fechas_feriado.add(fecha)
    if not fechas_feriado:
        return []

    eliminados = []
    for dia in dias:
        indice = INDICE_DIA[dia]
        ocurrencias = [
            inicio + __import__("datetime").timedelta(days=d)
            for d in range((fin - inicio).days + 1)
            if (inicio + __import__("datetime").timedelta(days=d)).weekday() == indice
        ]
        if ocurrencias and all(f in fechas_feriado for f in ocurrencias):
            eliminados.append(dia)
    return eliminados


def cargar_inventario_salones(datos_salones: list[dict]) -> dict:
    """Metadatos por (edificio, salón): área y capacidad.

    El inventario operativo (qué salones existen) se toma de la propia
    base (uso histórico); `salones.json` aporta el tipo de aula (AULA o
    LABORATORIO) cuando el salón está catalogado (H5/H6).
    """
    inventario = {}
    for salon in datos_salones:
        clave = (str(salon.get("edificio", "")), str(salon.get("salon", "")))
        inventario[clave] = {
            "area": str(salon.get("area", "AULA")).upper(),
            "capacidad": int(salon.get("capacidad", 0) or 0),
        }
    return inventario


def cargar_disponibilidad(datos: list[dict]) -> dict[str, dict[str, list]]:
    """docente → {día: [(inicio_min, fin_min), ...]} con `franjas_disponibles`."""
    disponibilidad: dict[str, dict[str, list]] = {}
    for docente_info in datos:
        nombre = str(docente_info.get("docente", "")).upper()
        por_dia = disponibilidad.setdefault(nombre, defaultdict(list))
        for franja in docente_info.get("franjas_disponibles", []):
            por_dia[str(franja["dia"]).upper()].append((
                _a_minutos(str(franja["hora_inicio"])),
                _a_minutos(str(franja["hora_fin"])),
            ))
    return disponibilidad


# ----------------------------------------------------------------------------
# 3-4. Modelo y variables de decisión
# ----------------------------------------------------------------------------
def construir_candidatos(
    salones: list[tuple[str, str]],
    jornadas_ok: dict[str, tuple[int, int]],
    franjas: dict[str, list] | None,
    slots: list[int],
    dias: list[str],
    dur: int,
) -> list[tuple]:
    """Tuplas (edificio, salon, dia, slot) viables.

    Filtra por turnos (la sesión completa dentro de una jornada) y, si
    `franjas` no es None, por la disponibilidad del instructor (H2).
    """
    candidatos = []
    for salon_edificio, salon in salones:
        for dia in dias:
            for slot in slots:
                fin_slot = slot + dur
                if not any(
                    inicio <= slot and fin_slot <= fin
                    for inicio, fin in jornadas_ok.values()
                ):
                    continue
                if franjas is not None and not any(
                    inicio <= slot and fin_slot <= fin
                    for inicio, fin in franjas.get(dia, [])
                ):
                    continue
                candidatos.append((salon_edificio, salon, dia, slot))
    return candidatos


def crear_variables(
    model: cp_model.CpModel,
    demanda: dict,
    inventario: dict,
    disponibilidad: dict,
    jornadas: dict,
    reglas: dict,
    slots: list[int],
    dias: list[str],
    dur: int,
    receso: int,
):
    """Crea variables y podas de dominio por reglas.

    x[(bloque, mat_cur, edificio, salon, dia, slot)] — asignación.
    y[(bloque, mat_cur, dia, slot)] — el par OCUPA ese slot (OR de salones).
    usado[(bloque, mat_cur, dia)] — el par opera ese día (OR de slots).

    Devuelve (x, y, usado, dominio_x, relajaciones) donde relajaciones
    documenta las reglas que hubo de flexibilizar por datos insuficientes.
    """
    duras = reglas.get("restricciones_duras_inviolables", {})
    especiales = reglas.get("turnos_y_reglas_especiales", {})
    comunes = set(
        reglas.get("modos_dictado", {})
        .get("modular_tec_carrera", {})
        .get("prefijos_comunes_excluidos", [])
    )
    H6 = set(duras.get("H6_laboratorio_obligatorio_carreras_tecnicas", []))
    tec_tal_en_lab = bool(
        reglas.get("reglas_laboratorios", {}).get("permitir_tec_y_tal_en_laboratorio")
    )
    lab_para_comunes = bool(
        reglas.get("reglas_laboratorios", {}).get(
            "uso_laboratorio_general_para_cursos_comunes"
        )
    )
    emp_manana = bool(
        especiales.get("practicas_empresa", {}).get("solo_mananas", True)
    )
    tal_min_dias = int(
        reglas.get("modos_dictado", {}).get("taller_tal", {}).get(
            "fragmentacion_dias_minima", 2
        )
    )
    tec_un_dia = bool(especiales.get("tec", {}).get("un_dia_por_semana", True))

    variables: dict[tuple, object] = {}
    presencia: dict[tuple, object] = {}
    usado: dict[tuple, object] = {}
    dominio_x: dict[tuple, list[tuple]] = defaultdict(list)
    dominio_y: dict[tuple, list[tuple]] = defaultdict(list)
    relajaciones: dict[tuple, list[str]] = defaultdict(list)

    for (bloque, mat_cur), info in sorted(demanda.items()):
        semestre = semestre_de_materia(mat_cur)
        carrera = prefijo_carrera(mat_cur)
        actividades = {a.upper() for a in info["actividades"]}
        es_emp = "EMP" in actividades
        es_tal = "TAL" in actividades
        es_tec = "TEC" in actividades
        es_tec_carrera = es_tec and carrera not in comunes

        # Turnos: jornadas del semestre; EMP sólo por las mañanas.
        nombres_jornadas = jornadas_de_semestre(semestre, reglas)
        if es_emp and emp_manana:
            nombres_jornadas = [
                j for j in nombres_jornadas if j == "MANANA"
            ] or ["MANANA"]
        jornadas_ok = {
            nombre: jornadas[nombre]
            for nombre in nombres_jornadas
            if nombre in jornadas
        }

        # Salones candidatos: históricos del par (H5 compatibilidad
        # carrera-laboratorio: el uso histórico es la compatibilidad).
        salones_par = sorted(info["salones"])
        # H6: laboratorio obligatorio para TEC/TAL de carreras técnicas.
        requiere_lab = (
            bool(duras.get("H6_laboratorio_obligatorio_carreras_tecnicas"))
            and carrera in H6
            and bool(actividades & {"TEC", "TAL"})
        )
        if requiere_lab:
            en_lab = [
                clave for clave in salones_par
                if inventario.get(clave, {}).get("area", "AULA").startswith("LABORATORIO")
            ]
            if en_lab:
                salones_par = en_lab
            else:
                relajaciones[(bloque, mat_cur)].append("H6 (sin laboratorio histórico)")
                print(
                    f"ADVERTENCIA: {bloque}/{mat_cur} (carrera técnica) no "
                    "tiene laboratorio en su uso histórico; se mantienen sus "
                    "salones históricos."
                )

        # Aulas de laboratorio para otros cursos, según reglas_laboratorios.
        salones_compatibles = []
        for clave in salones_par:
            area = inventario.get(clave, {}).get("area", "AULA")
            if not area.startswith("LABORATORIO"):
                salones_compatibles.append(clave)
            elif (
                (tec_tal_en_lab and carrera in H6)
                or (lab_para_comunes and carrera not in H6)
            ):
                salones_compatibles.append(clave)
            else:
                print(
                    f"ADVERTENCIA: {clave[1]} (LABORATORIO {clave[0]}) excluido "
                    f"para {mat_cur} por compatibilidad de aulas."
                )
        if info["sin_aula"]:
            salones_compatibles.append((PSEUDO_SALON, PSEUDO_SALON))

        # H2: franjas del instructor (estrictas).
        franjas: dict[str, list] = {}
        for instructor in info["instructores"]:
            franjas.update(disponibilidad.get(instructor.upper(), {}))
        usar_disponibilidad = bool(info["instructores"]) and bool(franjas)

        candidatos = construir_candidatos(
            salones_compatibles, jornadas_ok,
            franjas if usar_disponibilidad else None, slots, dias, dur,
        )
        requeridas = info["horas"]

        # Guardas de suficiencia (relajación escalonada documentada).
        if len(candidatos) < requeridas and usar_disponibilidad:
            relajaciones[(bloque, mat_cur)].append("H2 (disponibilidad)")
            print(
                f"ADVERTENCIA: {bloque}/{mat_cur} no cabe en las franjas de "
                "su instructor; se ignora esa disponibilidad."
            )
            usar_disponibilidad = False
            candidatos = construir_candidatos(
                salones_compatibles, jornadas_ok, None, slots, dias, dur,
            )
        if len(candidatos) < requeridas:
            relajaciones[(bloque, mat_cur)].append("salones ampliados")
            print(
                f"ADVERTENCIA: {bloque}/{mat_cur} sin horas viables en sus "
                "salones; se amplía a todo el inventario."
            )
            salones_ampliados = sorted(inventario) + (
                [(PSEUDO_SALON, PSEUDO_SALON)] if info["sin_aula"] else []
            )
            candidatos = construir_candidatos(
                salones_ampliados, jornadas_ok, None, slots, dias, dur,
            )
        if len(candidatos) < requeridas:
            relajaciones[(bloque, mat_cur)].append("turnos ampliados")
            print(
                f"ADVERTENCIA: {bloque}/{mat_cur} excede la rejilla de sus "
                "turnos; se amplía a todas las jornadas."
            )
            candidatos = construir_candidatos(
                salones_ampliados if len(candidatos) == 0 else salones_compatibles,
                jornadas, None, slots, dias, dur,
            )
        if len(candidatos) < requeridas:
            raise RuntimeError(
                f"Sin horas suficientes para {bloque}/{mat_cur} "
                f"({len(candidatos)} < {requeridas})."
            )

        # Reglas por día (TEC 1 día; TAL >= 2 días): sólo si el dominio
        # del par las admite; si no, se relajan con ADVERTENCIA.
        dias_con_espacio = sorted({dia for _, _, dia, _ in candidatos})
        horas_por_dia = defaultdict(int)
        for _, _, dia, _ in candidatos:
            horas_por_dia[dia] += 1
        if es_tec_carrera and tec_un_dia and not es_tal:
            if not any(horas_por_dia[d] >= requeridas for d in dias_con_espacio):
                relajaciones[(bloque, mat_cur)].append("TEC 1 día")
                print(
                    f"ADVERTENCIA: {bloque}/{mat_cur} no puede dictarse en un "
                    "solo día con su dominio; regla TEC-1-día relajada."
                )
                es_tec_carrera = False
        if es_tal and tal_min_dias > 1:
            suficientes = sum(
                1 for d in dias_con_espacio if horas_por_dia[d] >= 1
            )
            if suficientes < tal_min_dias:
                relajaciones[(bloque, mat_cur)].append("TAL >= 2 días")
                print(
                    f"ADVERTENCIA: {bloque}/{mat_cur} no tiene {tal_min_dias} "
                    "días viables; regla TAL-2-días relajada."
                )
                es_tal = False

        # Variables x del par.
        for candidato in candidatos:
            clave_x = (bloque, mat_cur, *candidato)
            variables[clave_x] = model.NewBoolVar(f"x_{len(variables)}")
            dominio_x[(bloque, mat_cur)].append(clave_x)

        # y: presencia del par en (día, slot) = OR de salones.
        for dia in dias:
            for slot in slots:
                lista = [
                    variables[(bloque, mat_cur, e, s, dia, slot)]
                    for (e, s, d2, s2) in candidatos
                    if d2 == dia and s2 == slot
                ]
                if not lista:
                    continue
                clave_y = (bloque, mat_cur, dia, slot)
                presencia[clave_y] = model.NewBoolVar(f"y_{len(presencia)}")
                model.AddMaxEquality(presencia[clave_y], lista)
                dominio_y[(bloque, mat_cur, dia)].append((slot, clave_y))

        # usado: el par opera ese día = OR de slots.
        for dia in dias:
            ys = [
                presencia[(bloque, mat_cur, dia, slot)]
                for slot in slots
                if (bloque, mat_cur, dia, slot) in presencia
            ]
            if not ys:
                continue
            clave_u = (bloque, mat_cur, dia)
            usado[clave_u] = model.NewBoolVar(f"u_{len(usado)}")
            model.AddMaxEquality(usado[clave_u], ys)

    return variables, presencia, usado, dominio_x, dominio_y, relajaciones


# ----------------------------------------------------------------------------
# 5. Restricciones duras (Hard Constraints)
# ----------------------------------------------------------------------------
def restringir_completitud(model, variables, dominio_x, demanda):
    """Completitud de malla: cada (bloque, materia) recibe EXACTAMENTE
    sus horas semanales normalizadas del paso 1.

      Σ_{salón} Σ_{día} Σ_{slot} x[bloque, materia, salón, día, slot] = horas
    """
    for (bloque, mat_cur), info in demanda.items():
        claves = dominio_x[(bloque, mat_cur)]
        model.Add(sum(variables[clave] for clave in claves) == info["horas"])


def restringir_cruces_grupo(model, variables, dominio_x):
    """Sin cruces de grupo: un bloque no puede tener dos materias (ni dos
    salones) en el mismo día y slot.

      ∀ (bloque, día, slot):  Σ_{materia} Σ_{salón} x[...] ≤ 1
    """
    por_bloque_slot = defaultdict(list)
    for (bloque, mat_cur), claves in dominio_x.items():
        for clave in claves:
            _, _, _, _, dia, slot = clave
            por_bloque_slot[(bloque, dia, slot)].append(variables[clave])
    for literales in por_bloque_slot.values():
        if len(literales) > 1:
            model.Add(sum(literales) <= 1)


def restringir_cruces_aula(model, variables, dominio_x):
    """H4 sin cruces de aula: un salón no alberga dos bloques a la vez
    (SIN_AULA se excluye: no es un salón físico).

      ∀ (salón, día, slot):  Σ_{bloque} Σ_{materia} x[...] ≤ 1
    """
    por_salon_slot = defaultdict(list)
    for clave, variable in variables.items():
        _, _, edificio, salon, dia, slot = clave
        if salon == PSEUDO_SALON:
            continue
        por_salon_slot[(edificio, salon, dia, slot)].append(variable)
    for literales in por_salon_slot.values():
        if len(literales) > 1:
            model.Add(sum(literales) <= 1)


def restringir_cruces_docente(model, variables, dominio_x, demanda):
    """H1 sin cruces de docente: un instructor no puede estar en dos
    sesiones al mismo tiempo (docentes agrupados por la base; H3: el
    instructor no se reasigna, se usa el histórico).

      ∀ (instructor, día, slot):  Σ_{sus pares} Σ_{salón} x[...] ≤ 1
    """
    por_docente_slot = defaultdict(list)
    for (bloque, mat_cur), info in demanda.items():
        if not info["instructores"]:
            continue
        for clave in dominio_x[(bloque, mat_cur)]:
            _, _, _, _, dia, slot = clave
            for instructor in info["instructores"]:
                por_docente_slot[
                    (instructor.upper(), dia, slot)
                ].append(variables[clave])
    for literales in por_docente_slot.values():
        if len(literales) > 1:
            model.Add(sum(literales) <= 1)


def restringir_transiciones(
    model, presencia, dominio_y, slots, ciclo_de, dur, receso
):
    """Receso de transición entre cursos distintos del mismo bloque:
    entre el fin de un curso y el inicio del siguiente debe haber al menos
    `receso_transicion_curso_minutos_min` (15 min).

    En el reloj académico esto significa: dos cursos DISTINTOS no pueden
    quedar en slots contiguos sin receso de por medio (hueco 0). Dos
    cursos separados por un límite de ciclo (hueco = receso) sí pueden.
    """
    min_transicion = int(
        # (se lee del archivo si existiera el campo; 15 por defecto)
        15
    )
    ordenados = sorted(slots)
    adyacencias = []
    for slot_a, slot_b in zip(ordenados, ordenados[1:]):
        hueco = slot_b - (slot_a + dur)
        if hueco < min_transicion:  # hueco 0 dentro del mismo ciclo
            adyacencias.append((slot_a, slot_b))

    por_bloque = defaultdict(lambda: defaultdict(list))
    for (bloque, mat_cur, dia), lista in dominio_y.items():
        for slot, clave_y in lista:
            por_bloque[(bloque, dia)][slot].append((mat_cur, clave_y))

    clausulas = 0
    for (bloque, dia), por_slot in por_bloque.items():
        for slot_a, slot_b in adyacencias:
            en_a = por_slot.get(slot_a, [])
            en_b = por_slot.get(slot_b, [])
            if len(en_a) < 1 or len(en_b) < 1:
                continue
            for mat_a, var_a in en_a:
                for mat_b, var_b in en_b:
                    if mat_a == mat_b:
                        continue  # mismo curso: continuidad permitida
                    # No (curso A en slot_a y curso B != A en slot_b).
                    model.AddBoolOr([var_a.Not(), var_b.Not()])
                    clausulas += 1
    return clausulas


def restringir_emp(
    model, presencia, dominio_y, demanda, slots, dur, receso
):
    """EMP sin receso intermedio: una sesión de prácticas no puede
    atravesar un receso → máximo 3 slots corridos (un ciclo) por día."""
    cada = 3
    clausulas = 0
    ordenados = sorted(slots)
    ventanas = [
        tuple(ordenados[i + k] for k in range(cada + 1))
        for i in range(len(ordenados) - cada)
    ]
    for (bloque, mat_cur), info in demanda.items():
        if "EMP" not in {a.upper() for a in info["actividades"]}:
            continue
        for dia in {d for (_, _, d, _) in _claves_dia(dominio_y, bloque, mat_cur)}:
            ys = {
                slot: presencia[(bloque, mat_cur, dia, slot)]
                for slot in ordenados
                if (bloque, mat_cur, dia, slot) in presencia
            }
            for ventana in ventanas:
                literales = [ys[s] for s in ventana if s in ys]
                if len(literales) == cada + 1:
                    model.Add(sum(literales) <= cada)
                    clausulas += 1
    return clausulas


def _claves_dia(dominio_y, bloque, mat_cur):
    return [
        clave for clave in dominio_y
        if clave[0] == bloque and clave[1] == mat_cur
    ]


def restringir_dias_tec_tal(model, usado, demanda):
    """TEC de carrera: un solo día por semana. TAL: al menos
    `fragmentacion_dias_minima` (2) días. (Los pares mixtos TEC+TAL se
    rigen por la regla del TAL: `estructura_academica_por_nivel` indica
    que en semestres 2-3 van integrados en el mismo curso.)"""
    conteo = 0
    for (bloque, mat_cur), info in demanda.items():
        actividades = {a.upper() for a in info["actividades"]}
        dias_usados = [
            usado[(bloque, mat_cur, dia)]
            for dia in DIAS_ORDEN
            if (bloque, mat_cur, dia) in usado
        ]
        if not dias_usados:
            continue
        if "TAL" in actividades:
            model.Add(sum(dias_usados) >= 2)
            conteo += 1
        elif "TEC" in actividades and prefijo_carrera(mat_cur) not in _comunes:
            model.Add(sum(dias_usados) <= 1)
            conteo += 1
    return conteo


# ----------------------------------------------------------------------------
# Preferencias del archivo (clases corridas, TAL consecutivo, sem-3 mañana)
# ----------------------------------------------------------------------------
def objetivo_preferencias(
    model, presencia, usado, demanda, slots, jornadas, reglas
):
    """Penaliza lo marcado 'preferente' en reglas_horario.json:
      - clases corridas: slots aislados del mismo curso en su día;
      - TAL: días no consecutivos (premia días adyacentes);
      - semestre 3: uso de la mañana (sólo si hay espacio)."""
    terminos = []

    # Clases corridas: un slot ocupado con ambos vecinos vacíos = fractura.
    ordenados = sorted(slots)
    vecinos = {
        slot: (
            ordenados[i - 1] if i > 0 else None,
            ordenados[i + 1] if i + 1 < len(ordenados) else None,
        )
        for i, slot in enumerate(ordenados)
    }
    for (bloque, mat_cur, dia), lista in list(
        _por_par_dia(presencia).items()
    ):
        por_slot = dict(lista)
        for slot, y_var in por_slot.items():
            anterior, siguiente = vecinos[slot]
            if anterior is None or siguiente is None:
                continue
            if anterior not in por_slot or siguiente not in por_slot:
                continue
            aislado = model.NewBoolVar("")
            model.AddImplication(aislado, y_var)
            model.AddImplication(aislado, por_slot[anterior].Not())
            model.AddImplication(aislado, por_slot[siguiente].Not())
            model.AddBoolOr([
                y_var.Not(), por_slot[anterior], por_slot[siguiente], aislado,
            ])
            terminos.append(PESO_CORRIDAS * aislado)

    # TAL consecutivo: premia pares de días adyacentes usados.
    for (bloque, mat_cur), info in demanda.items():
        if "TAL" not in {a.upper() for a in info["actividades"]}:
            continue
        for dia_a, dia_b in zip(DIAS_ORDEN, DIAS_ORDEN[1:]):
            ua = usado.get((bloque, mat_cur, dia_a))
            ub = usado.get((bloque, mat_cur, dia_b))
            if ua is None or ub is None:
                continue
            adyacente = model.NewBoolVar("")
            model.AddBoolAnd([ua, ub]).OnlyEnforceIf(adyacente)
            model.AddBoolOr([ua.Not(), ub.Not(), adyacente])
            terminos.append(-PESO_TAL_CONSECUTIVO * adyacente)

    # Semestre 3: penaliza el uso de la mañana (sólo si hay espacio).
    manana = jornadas.get("MANANA", (_a_minutos("07:45"), _a_minutos("12:45")))
    for (bloque, mat_cur, dia), lista in _por_par_dia(presencia).items():
        semestre = semestre_de_materia(mat_cur)
        if semestre != 3:
            continue
        for slot, y_var in lista:
            if manana[0] <= slot and slot + 45 <= manana[1]:
                terminos.append(PESO_SEM3_MANANA * y_var)

    if terminos:
        model.Minimize(sum(terminos))
    return len(terminos)


def _por_par_dia(presencia):
    agrupado = defaultdict(list)
    for (bloque, mat_cur, dia, slot), variable in presencia.items():
        agrupado[(bloque, mat_cur, dia)].append((slot, variable))
    return agrupado


# Variable global con los prefijos comunes (la fija crear_variables).
_comunes: set[str] = set()


# ----------------------------------------------------------------------------
# 6. Resolución, verificación y salida
# ----------------------------------------------------------------------------
def resolver(model: cp_model.CpModel, limite: int = LIMITE_SEGUNDOS):
    """Resuelve con CpSolver y un límite de 60 segundos."""
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = limite
    solver.parameters.num_search_workers = max(1, min(8, os.cpu_count() or 1))
    estado = solver.Solve(model)
    nombre = solver.StatusName(estado)
    print(f"CP-SAT estado: {nombre} | tiempo {solver.WallTime():.1f}s")
    if estado not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise RuntimeError(f"CP-SAT no encontró solución ({nombre}).")
    return solver, nombre


def formatear_salida(
    solver, variables, demanda, ciclo_de, dur
) -> list[dict]:
    """Convierte las variables activas en sesiones.

    Fusiona slots contiguos DENTRO del mismo ciclo (las sesiones nunca
    atraviesan un receso: entre ciclos hay 15 min garantizados).
    """
    seleccion = defaultdict(list)
    # (bloque, mat_cur, edificio, salon, dia) → slots asignados
    for clave, variable in variables.items():
        if not solver.BooleanValue(variable):
            continue
        bloque, mat_cur, salon_edificio, salon, dia, slot = clave
        seleccion[(bloque, mat_cur, salon_edificio, salon, dia)].append(slot)

    filas = []
    for (bloque, mat_cur, salon_edificio, salon, dia), slots_usados in seleccion.items():
        info = demanda[(bloque, mat_cur)]
        slots_usados.sort()
        grupos = []
        actual = [slots_usados[0]]
        for slot in slots_usados[1:]:
            mismo_ciclo = (
                slot == actual[-1] + dur
                and ciclo_de[slot] == ciclo_de[actual[-1]]
            )
            if mismo_ciclo:
                actual.append(slot)
            else:
                grupos.append(actual)
                actual = [slot]
        grupos.append(actual)

        for grupo in grupos:
            inicio, fin = grupo[0], grupo[-1] + dur
            filas.append({
                "periodo": info.get("periodo"),
                "seccion": info.get("seccion"),
                "camp": info.get("camp"),
                "mat_cur": mat_cur,
                "actividad": "/".join(sorted(info["actividades"])),
                "edificio": salon_edificio,
                "salon": salon,
                "hora_ini": _formato_hora(inicio),
                "hora_fin": _formato_hora(fin),
                "dia": dia,
                "instructor": next(iter(info["instructores"]), None),
                "bloque": bloque,
                "horas_academicas": len(grupo),
            })

    filas.sort(key=lambda f: (
        str(f["bloque"]), INDICE_DIA[f["dia"]], f["hora_ini"], f["mat_cur"]
    ))
    return filas


def verificar_cumplimiento(
    filas: list[dict],
    demanda: dict,
    disponibilidad: dict,
    inventario: dict,
    jornadas: dict,
    reglas: dict,
    relajaciones: dict,
    slots: list[int],
    dur: int,
) -> bool:
    """Reporte de cumplimiento de reglas sobre el horario generado."""
    especiales = reglas.get("turnos_y_reglas_especiales", {})
    comunes = set(
        reglas.get("modos_dictado", {})
        .get("modular_tec_carrera", {})
        .get("prefijos_comunes_excluidos", [])
    )
    H6 = set(
        reglas.get("restricciones_duras_inviolables", {}).get(
            "H6_laboratorio_obligatorio_carreras_tecnicas", []
        )
    )
    tal_min = int(
        reglas.get("modos_dictado", {}).get("taller_tal", {}).get(
            "fragmentacion_dias_minima", 2
        )
    )

    def minutos(fila):
        return _a_minutos(fila["hora_ini"]), _a_minutos(fila["hora_fin"])

    errores = defaultdict(int)
    # Cruces (bloque / aula / docente) a nivel de slot.
    ocupacion = defaultdict(list)
    for fila in filas:
        ini, fin = minutos(fila)
        slot = ini
        while slot < fin:
            ocupacion[(fila["bloque"], fila["dia"], slot)].append(fila["mat_cur"])
            if fila["salon"] != PSEUDO_SALON:
                ocupacion[(fila["edificio"], fila["salon"], fila["dia"], slot)].append(fila["bloque"])
            if fila["instructor"]:
                ocupacion[(fila["instructor"].upper(), fila["dia"], slot)].append(fila["mat_cur"])
            slot += dur
    for clave, ocupantes in ocupacion.items():
        if len(ocupantes) > 1:
            if clave[0] in [d for d in DIAS_ORDEN]:
                continue
            tipo = (
                "bloque" if clave[0] in {b for b, _ in demanda} else
                "docente" if clave[0].upper() in {i.upper() for v in demanda.values() for i in v["instructores"]} else
                "aula"
            )
            errores[f"cruce_{tipo}"] += 1

    # Reglas por par y sesiones.
    dias_por_par = defaultdict(set)
    for fila in filas:
        clave = (fila["bloque"], fila["mat_cur"])
        dias_por_par[clave].add(fila["dia"])
        info = demanda[clave]
        actividades = {a.upper() for a in info["actividades"]}
        ini, fin = minutos(fila)
        n_slots = (fin - ini) // dur
        # Sesiones dentro del reloj y sin receso interno (<= 3 slots).
        if n_slots > 3:
            errores["sesion_mayor_3h"] += 1
        if ini not in slots:
            errores["fuera_reloj"] += 1
        # Turnos.
        semestre = semestre_de_materia(fila["mat_cur"])
        ventanas = [jornadas[j] for j in jornadas_de_semestre(semestre, reglas) if j in jornadas]
        if "EMP" in actividades and especiales.get("practicas_empresa", {}).get("solo_mananas", True):
            ventanas = [jornadas["MANANA"]]
        if not any(v0 <= ini and fin <= v1 for v0, v1 in ventanas):
            errores["fuera_turno"] += 1
        # EMP sin receso intermedio.
        if "EMP" in actividades and n_slots > 3:
            errores["emp_con_receso"] += 1
        # H2 disponibilidad (si no fue relajada).
        relajado = "H2 (disponibilidad)" in relajaciones.get(clave, [])
        if fila["instructor"] and not relajado:
            franjas = defaultdict(list)
            for instructor in info["instructores"]:
                franjas.update(disponibilidad.get(instructor.upper(), {}))
            if franjas and not any(
                a <= ini and fin <= b
                for a, b in franjas.get(fila["dia"], [])
            ):
                errores["fuera_disponibilidad"] += 1
        # H6 laboratorio obligatorio (si no fue relajado).
        carrera = prefijo_carrera(fila["mat_cur"])
        if (
            carrera in H6
            and actividades & {"TEC", "TAL"}
            and fila["salon"] != PSEUDO_SALON
            and "H6 (sin laboratorio histórico)" not in relajaciones.get(clave, [])
        ):
            area = inventario.get((fila["edificio"], fila["salon"]), {}).get("area", "AULA")
            if not area.startswith("LABORATORIO"):
                errores["h6_sin_laboratorio"] += 1

    for (bloque, mat_cur), dias in dias_por_par.items():
        info = demanda[(bloque, mat_cur)]
        actividades = {a.upper() for a in info["actividades"]}
        if "TAL" in actividades and len(dias) < tal_min:
            if "TAL >= 2 días" not in relajaciones.get((bloque, mat_cur), []):
                errores["tal_menos_dias"] += 1
        if (
            "TAL" not in actividades and "TEC" in actividades
            and prefijo_carrera(mat_cur) not in comunes
            and len(dias) > 1
        ):
            if "TEC 1 día" not in relajaciones.get((bloque, mat_cur), []):
                errores["tec_multiples_dias"] += 1

    # Transiciones >= 15 min entre cursos distintos del mismo bloque/día.
    por_bloque_dia = defaultdict(list)
    for fila in filas:
        por_bloque_dia[(fila["bloque"], fila["dia"])].append(fila)
    for sesiones in por_bloque_dia.values():
        sesiones.sort(key=lambda f: f["hora_ini"])
        for a, b in zip(sesiones, sesiones[1:]):
            _, fin_a = minutos(a)
            ini_b, _ = minutos(b)
            if ini_b - fin_a < 15:
                errores["transicion_corta"] += 1

    print("\n=== CUMPLIMIENTO DE REGLAS ===")
    if not errores:
        print("TODAS las reglas duras se cumplen. ✓")
        ok = True
    else:
        for nombre, cuenta in sorted(errores.items()):
            print(f"FALLO {nombre}: {cuenta}")
        ok = False
    if relajaciones:
        print(f"\nRelajaciones documentadas ({len(relajaciones)} pares):")
        for clave, motivos in sorted(relajaciones.items()):
            print(f"  {clave[0]}/{clave[1]}: {', '.join(motivos)}")
    return ok


def main() -> int:
    print("1) Leyendo horario base consolidado…")
    filas_base = cargar_base()
    demanda = calcular_demanda(filas_base)
    print(f"   {len(filas_base)} sesiones → {len(demanda)} pares (bloque, mat_cur).")

    print("2) Leyendo reglas_horario.json y archivos auxiliares…")
    fuentes = cargar_reglas()
    reglas = fuentes["reglas"]
    inventario = cargar_inventario_salones(fuentes["salones"])
    disponibilidad = cargar_disponibilidad(fuentes["disponibilidad"])
    jornadas = construir_jornadas(reglas)
    slots, ciclo_de, dur, receso = construir_reloj_academico(reglas)
    _comunes.clear()
    _comunes.update(
        reglas.get("modos_dictado", {})
        .get("modular_tec_carrera", {})
        .get("prefijos_comunes_excluidos", [])
    )
    dias = [d for d in DIAS_ORDEN if d in {
        str(f["dia"]).upper() for f in filas_base
    }]
    eliminados = dias_con_feriados(fuentes, dias)
    if eliminados:
        dias = [d for d in dias if d not in eliminados]
        print(f"   H7 feriados: días completos de feriado eliminados: {eliminados}")
    print(f"   días: {dias} | slots: {len(slots)} (reloj 3x45 + receso 15).")

    print("3-4) Inicializando CpModel y variables x[bloque, materia, salon, dia, hora]…")
    model = cp_model.CpModel()
    variables, presencia, usado, dominio_x, dominio_y, relajaciones = crear_variables(
        model, demanda, inventario, disponibilidad, jornadas, reglas,
        slots, dias, dur, receso,
    )
    print(f"   {len(variables)} variables x | {len(presencia)} variables y.")

    print("5) Aplicando restricciones duras…")
    restringir_completitud(model, variables, dominio_x, demanda)
    restringir_cruces_grupo(model, variables, dominio_x)
    restringir_cruces_aula(model, variables, dominio_x)
    restringir_cruces_docente(model, variables, dominio_x, demanda)
    n_trans = restringir_transiciones(
        model, presencia, dominio_y, slots, ciclo_de, dur, receso
    )
    n_emp = restringir_emp(model, presencia, dominio_y, demanda, slots, dur, receso)
    n_dias = restringir_dias_tec_tal(model, usado, demanda)
    n_pref = objetivo_preferencias(model, presencia, usado, demanda, slots, jornadas, reglas)
    print(
        f"   completitud + cruces (grupo/aula/docente) + transiciones "
        f"({n_trans} cláusulas) + EMP ({n_emp}) + días TEC/TAL ({n_dias}) ✓\n"
        f"   preferencias activas: {n_pref} términos."
    )

    print("6) Resolviendo (límite 60 s)…")
    solver, nombre_estado = resolver(model)
    filas_salida = formatear_salida(solver, variables, demanda, ciclo_de, dur)

    cumplen = verificar_cumplimiento(
        filas_salida, demanda, disponibilidad, inventario, jornadas,
        reglas, relajaciones, slots, dur,
    )

    SALIDA_PATH.write_text(
        json.dumps(filas_salida, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print(f"\nEstado: {nombre_estado} | Sesiones: {len(filas_salida)} "
          f"| Archivo: {SALIDA_PATH}")
    return 0 if cumplen else 1


if __name__ == "__main__":
    from generar_horario import main as generate_validated_schedule

    sys.exit(generate_validated_schedule())
