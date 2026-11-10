"""Acceso a MySQL. Todas las consultas del modelo viven aquí."""

from __future__ import annotations

import logging
import re
from collections import defaultdict
from datetime import date, datetime
from typing import Any

import pymysql
from pymysql.cursors import DictCursor

from .config import (
    Ambiente,
    ConfiguracionDb,
    Curso,
    Docente,
    ErrorDatos,
    FranjaInstitucional,
    Oferta,
    Periodo,
    indice_dia,
    minutos_de_hora,
    numero_semestre,
)

log = logging.getLogger(__name__)


class Repositorio:
    """Repositorio de solo lectura para la planificación y escritura final."""

    def __init__(self, cfg: ConfiguracionDb):
        self.cfg = cfg
        try:
            self.conn = pymysql.connect(
                host=cfg.host,
                port=cfg.puerto,
                user=cfg.usuario,
                password=cfg.password,
                database=cfg.base_datos,
                charset="utf8mb4",
                cursorclass=DictCursor,
                autocommit=False,
                connect_timeout=20,
                read_timeout=120,
                write_timeout=120,
            )
        except pymysql.MySQLError as exc:
            raise ErrorDatos(f"No se pudo conectar a MySQL ({cfg.resumen}): {exc}") from exc

    def cerrar(self) -> None:
        try:
            self.conn.close()
        except Exception:  # pragma: no cover - cierre defensivo
            pass

    # ------------------------------------------------------------------
    # Periodo, franja y turnos
    # ------------------------------------------------------------------

    def obtener_periodo(self, codigo: str | None) -> Periodo:
        with self.conn.cursor() as cur:
            if codigo:
                cur.execute(
                    "SELECT * FROM periodos WHERE codigo_periodo = %s LIMIT 1", (codigo,)
                )
            else:
                cur.execute(
                    "SELECT * FROM periodos WHERE estado = 'A' "
                    "ORDER BY id_periodo DESC LIMIT 1"
                )
            fila = cur.fetchone()
        if not fila:
            detalle = f"código {codigo!r}" if codigo else "activo"
            raise ErrorDatos(f"No existe un periodo {detalle} en la tabla periodos.")
        semanas = int(fila.get("cantidad_semanas") or 0)
        if semanas <= 0:
            raise ErrorDatos(
                f"El periodo {fila.get('codigo_periodo')} no tiene cantidad_semanas válida."
            )

        columnas = self._columnas("periodos")
        inicio = self._fecha_de_fila(fila, columnas, ("fecha_inicio", "fecha_inicio_periodo", "inicio_periodo", "fecha_ini"))
        fin = self._fecha_de_fila(fila, columnas, ("fecha_fin", "fecha_fin_periodo", "fin_periodo", "fecha_termino"))

        return Periodo(
            id_periodo=int(fila["id_periodo"]),
            codigo=str(fila.get("codigo_periodo") or ""),
            descripcion=str(fila.get("descripcion") or ""),
            semanas=semanas,
            fecha_inicio=inicio,
            fecha_fin=fin,
        )

    def _columnas(self, tabla: str) -> set[str]:
        with self.conn.cursor() as cur:
            cur.execute(f"SHOW COLUMNS FROM `{tabla}`")
            return {str(fila["Field"]) for fila in cur.fetchall()}

    @staticmethod
    def _fecha_de_fila(fila: dict[str, Any], columnas: set[str], candidatas: tuple[str, ...]) -> date | None:
        for nombre in candidatas:
            if nombre not in columnas:
                continue
            valor = fila.get(nombre)
            if isinstance(valor, datetime):
                return valor.date()
            if isinstance(valor, date):
                return valor
            if isinstance(valor, str) and valor.strip():
                try:
                    return date.fromisoformat(valor.strip()[:10])
                except ValueError:
                    continue
        return None

    def obtener_franja(self, id_periodo: int, periodo: Periodo) -> FranjaInstitucional:
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM configuracion_franja_horaria WHERE id_periodo = %s LIMIT 1",
                (id_periodo,),
            )
            fila = cur.fetchone()
        if not fila:
            raise ErrorDatos(
                f"No existe configuración de franja horaria para el periodo {id_periodo}."
            )

        # El nombre real de la columna puede variar por codificación histórica.
        inicio = None
        for clave, valor in fila.items():
            if "inicio" in clave.lower():
                inicio = minutos_de_hora(valor)
                break
        cierre = minutos_de_hora(fila.get("hora_cierre_noche"))
        if inicio is None or cierre is None:
            raise ErrorDatos("La franja horaria del periodo no tiene horas válidas.")
        if cierre <= inicio:
            raise ErrorDatos("La hora de cierre institucional debe ser posterior al inicio.")
        return FranjaInstitucional(
            inicio_min=inicio,
            cierre_min=cierre,
            incluir_domingo=bool(int(fila.get("incluir_domingo") or 0)),
        )

    def obtener_turnos(self) -> dict[int, int]:
        with self.conn.cursor() as cur:
            cur.execute("SELECT id_turno, codigo_turno FROM turnos ORDER BY id_turno")
            filas = cur.fetchall()
        resultado: dict[int, int] = {}
        for fila in filas:
            codigo = str(fila.get("codigo_turno") or "")
            numeros = [int(x) for x in re.findall(r"\d+", codigo)]
            resultado[int(fila["id_turno"])] = numeros[-1] if numeros else int(fila["id_turno"])
        return resultado

    # ------------------------------------------------------------------
    # Oferta académica y catálogo
    # ------------------------------------------------------------------

    def obtener_ofertas(
        self, id_periodo: int, *, semestres: set[int] | None = None
    ) -> list[Oferta]:
        sql = """
            SELECT pa.id_programacion, pa.id_periodo, pa.id_sede, pa.id_curso,
                   pa.id_turno, pa.grupo, pa.id_docente_tec, pa.id_docente_tal,
                   c.id_semestre, c.mat_cur, c.nombre_curso, c.semanas,
                   c.horas_teoria, c.horas_taller, c.horas_virtual,
                   c.horas_evaluacion, c.total_horas, c.is_carrera, c.horario_sinfo,
                   s.id_carrera, s.semestre, ca.codigo_carrera
              FROM programacion_academica pa
              JOIN cursos c       ON c.id_curso = pa.id_curso
              JOIN semestres s    ON s.id_semestre = c.id_semestre
              JOIN carreras ca    ON ca.id_carrera = s.id_carrera
             WHERE pa.id_periodo = %s
               AND pa.estado = 'A'
               AND c.estado = 'A'
                AND s.estado = 'A'
        """
        parametros: list[Any] = [id_periodo]
        if semestres is not None:
            romanos = {
                1: "I", 2: "II", 3: "III", 4: "IV", 5: "V",
                6: "VI", 7: "VII", 8: "VIII", 9: "IX", 10: "X",
            }
            desconocidos = semestres.difference(romanos)
            if desconocidos:
                raise ErrorDatos(
                    "Semestres inválidos al consultar ofertas: "
                    + ", ".join(map(str, sorted(desconocidos)))
                )
            if not semestres:
                raise ErrorDatos("El filtro semestres no puede estar vacío.")
            seleccion = sorted(romanos[semestre] for semestre in semestres)
            marcadores = ", ".join(["%s"] * len(seleccion))
            sql += f" AND s.semestre IN ({marcadores})"
            parametros.extend(seleccion)
        sql += (
            " ORDER BY ca.codigo_carrera, s.semestre, pa.id_turno, "
            "pa.grupo, c.mat_cur"
        )
        with self.conn.cursor() as cur:
            cur.execute(sql, parametros)
            filas = cur.fetchall()

        ofertas: list[Oferta] = []
        for fila in filas:
            curso = Curso(
                id_curso=int(fila["id_curso"]),
                id_semestre=int(fila["id_semestre"]),
                id_carrera=int(fila["id_carrera"]),
                codigo_carrera=str(fila.get("codigo_carrera") or ""),
                semestre_romano=str(fila.get("semestre") or ""),
                semestre_num=numero_semestre(fila.get("semestre")),
                mat_cur=str(fila.get("mat_cur") or ""),
                nombre=str(fila.get("nombre_curso") or ""),
                semanas_db=int(fila["semanas"]) if fila.get("semanas") is not None else None,
                horas_tec=int(fila.get("horas_teoria") or 0),
                horas_tal=int(fila.get("horas_taller") or 0),
                horas_vir=int(fila.get("horas_virtual") or 0),
                horas_eval=int(fila.get("horas_evaluacion") or 0),
                total_horas=int(fila.get("total_horas") or 0),
                is_carrera=bool(int(fila.get("is_carrera") or 0)),
                horario_sinfo=str(fila.get("horario_sinfo") or ""),
            )
            ofertas.append(
                Oferta(
                    id_programacion=int(fila["id_programacion"]),
                    id_periodo=int(fila["id_periodo"]),
                    id_sede=int(fila["id_sede"]),
                    id_turno=int(fila["id_turno"]),
                    grupo=str(fila.get("grupo") or "01"),
                    id_docente_tec=int(fila["id_docente_tec"]) if fila.get("id_docente_tec") else None,
                    id_docente_tal=int(fila["id_docente_tal"]) if fila.get("id_docente_tal") else None,
                    curso=curso,
                )
            )
        if not ofertas:
            raise ErrorDatos(f"No hay oferta académica activa para el periodo {id_periodo}.")
        return ofertas

    def obtener_docentes(self) -> dict[int, Docente]:
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT id_docente, nombres, apellidos, tipo_contrato, "
                "horas_semanales_meta, usa_restriccion_horaria, estado "
                "FROM docentes ORDER BY id_docente"
            )
            filas = cur.fetchall()
            # El esquema base puede no tener la columna `estado`. Cuando exista,
            # se aplica el mismo filtro que el frontend para no exigir franjas
            # que el usuario ya desactivó.
            cur.execute(
                "SHOW COLUMNS FROM disponibilidad_docentes LIKE 'estado'"
            )
            tiene_estado = cur.fetchone() is not None
            filtro_estado = " WHERE estado = 'A'" if tiene_estado else ""
            cur.execute(
                "SELECT id_docente, dia_semana, hora_inicio, hora_fin "
                "FROM disponibilidad_docentes" + filtro_estado
            )
            disponibilidad = cur.fetchall()

        franjas: dict[int, dict[int, list[tuple[int, int]]]] = defaultdict(lambda: defaultdict(list))
        for fila in disponibilidad:
            dia = indice_dia(fila.get("dia_semana"))
            inicio = minutos_de_hora(fila.get("hora_inicio"))
            fin = minutos_de_hora(fila.get("hora_fin"))
            if dia is None or inicio is None or fin is None or fin <= inicio:
                continue
            franjas[int(fila["id_docente"])][dia].append((inicio, fin))

        docentes: dict[int, Docente] = {}
        for fila in filas:
            id_docente = int(fila["id_docente"])
            nombre = f"{fila.get('nombres') or ''} {fila.get('apellidos') or ''}".strip()
            docente = Docente(
                id_docente=id_docente,
                nombre=nombre or f"Docente {id_docente}",
                tipo_contrato=str(fila.get("tipo_contrato") or ""),
                horas_meta=int(fila.get("horas_semanales_meta") or 0),
                usa_restriccion=bool(int(fila.get("usa_restriccion_horaria") or 0)),
                estado=str(fila.get("estado") or ""),
                disponibilidad={
                    dia: tuple(sorted(valores))
                    for dia, valores in franjas.get(id_docente, {}).items()
                },
            )
            docentes[id_docente] = docente
        return docentes

    def obtener_ambientes(self) -> list[Ambiente]:
        sql = """
            SELECT a.id, a.codigo_ambiente, a.id_tipo_ambiente, a.aforo_maximo,
                   a.estado, a.id_sede, t.nombre_tipo_ambiente
              FROM ambientes a
              JOIN tipo_ambiente t ON t.id_tipo_ambiente = a.id_tipo_ambiente
             ORDER BY a.id_sede, a.codigo_ambiente
        """
        with self.conn.cursor() as cur:
            cur.execute(sql)
            filas = cur.fetchall()
        return [
            Ambiente(
                id_ambiente=int(fila["id"]),
                codigo=str(fila.get("codigo_ambiente") or ""),
                id_tipo=int(fila.get("id_tipo_ambiente") or 0),
                tipo=str(fila.get("nombre_tipo_ambiente") or ""),
                aforo=int(fila.get("aforo_maximo") or 0),
                estado=str(fila.get("estado") or ""),
                id_sede=int(fila["id_sede"]) if fila.get("id_sede") is not None else 0,
            )
            for fila in filas
        ]

    def obtener_compatibilidad(self, id_periodo: int) -> dict[int, tuple[int, ...]]:
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT id_curso, id_ambiente FROM ambiente_cursos_permitidos "
                "WHERE id_periodo = %s",
                (id_periodo,),
            )
            filas = cur.fetchall()
        resultado: dict[int, list[int]] = defaultdict(list)
        for fila in filas:
            resultado[int(fila["id_curso"])].append(int(fila["id_ambiente"]))
        return {curso: tuple(sorted(set(ambientes))) for curso, ambientes in resultado.items()}

    def obtener_feriados(self) -> list[date]:
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT fecha FROM feriados WHERE LOWER(TRIM(estado)) = 'activo'"
            )
            filas = cur.fetchall()
        fechas: list[date] = []
        for fila in filas:
            valor = fila.get("fecha")
            if isinstance(valor, datetime):
                fechas.append(valor.date())
            elif isinstance(valor, date):
                fechas.append(valor)
            elif isinstance(valor, str) and valor.strip():
                try:
                    fechas.append(date.fromisoformat(valor.strip()[:10]))
                except ValueError:
                    continue
        return fechas

    # ------------------------------------------------------------------
    # Escritura del resultado
    # ------------------------------------------------------------------

    def crear_borrador(
        self,
        id_periodo: int,
        nombre: str | None = None,
        *,
        confirmar: bool = True,
    ) -> int:
        """Crea un borrador nuevo y devuelve su ID.

        La generación del nombre es secuencial por periodo. Si `confirmar` es
        falso, la inserción queda dentro de la transacción abierta para que el
        guardado completo pueda confirmarse o revertirse junto con las filas.
        """
        with self.conn.cursor() as cur:
            nombre_final = (nombre or "").strip()
            if not nombre_final:
                cur.execute(
                    "SELECT nombre FROM horarios_borradores WHERE id_periodo = %s",
                    (id_periodo,),
                )
                usados = {
                    str(fila.get("nombre") or "")
                    for fila in cur.fetchall()
                }
                consecutivo = 1
                while f"Borrador {consecutivo}" in usados:
                    consecutivo += 1
                nombre_final = f"Borrador {consecutivo}"

            cur.execute(
                "INSERT INTO horarios_borradores (id_periodo, nombre, estado) "
                "VALUES (%s, %s, 'BORRADOR')",
                (id_periodo, nombre_final),
            )
            id_borrador = int(cur.lastrowid)
        if confirmar:
            self.conn.commit()
        return id_borrador

    def validar_borrador(self, id_borrador: int, id_periodo: int) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT id_borrador FROM horarios_borradores "
                "WHERE id_borrador = %s AND id_periodo = %s",
                (id_borrador, id_periodo),
            )
            if cur.fetchone() is None:
                raise ErrorDatos(
                    f"El borrador {id_borrador} no existe para el periodo "
                    f"{id_periodo}."
                )

    def contar_borradores(self, id_periodo: int) -> int:
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) AS total FROM horarios_generados "
                "WHERE id_periodo = %s AND estado = 'BORRADOR'",
                (id_periodo,),
            )
            fila = cur.fetchone()
        return int(fila.get("total") or 0) if fila else 0

    def borrar_borradores(self, id_periodo: int) -> int:
        with self.conn.cursor() as cur:
            cur.execute(
                "DELETE FROM horarios_generados "
                "WHERE id_periodo = %s AND estado = 'BORRADOR'",
                (id_periodo,),
            )
            return int(cur.rowcount or 0)

    def borrar_borradores_programaciones(
        self, id_periodo: int, id_programaciones: set[int]
    ) -> int:
        if not id_programaciones:
            return 0
        ids = sorted(id_programaciones)
        marcadores = ", ".join(["%s"] * len(ids))
        with self.conn.cursor() as cur:
            cur.execute(
                "DELETE FROM horarios_generados "
                "WHERE id_periodo = %s AND estado = 'BORRADOR' "
                f"AND id_programacion IN ({marcadores})",
                [id_periodo, *ids],
            )
            return int(cur.rowcount or 0)

    def insertar_horarios(
        self,
        filas: list[dict[str, Any]],
        *,
        id_borrador: int | None = None,
        confirmar: bool = True,
    ) -> int:
        if not filas:
            return 0
        if id_borrador is not None:
            sql = """
                INSERT INTO horarios_generados
                    (id_borrador, id_periodo, id_programacion, id_ambiente,
                     id_docente, tipo_modalidad, dia_semana, hora_inicio,
                     hora_fin, semana_inicio, semana_fin, estado)
                VALUES
                    (%(id_borrador)s, %(id_periodo)s, %(id_programacion)s,
                     %(id_ambiente)s, %(id_docente)s, %(tipo_modalidad)s,
                     %(dia_semana)s, %(hora_inicio)s, %(hora_fin)s,
                     %(semana_inicio)s, %(semana_fin)s, 'BORRADOR')
            """
            filas_insertar = [
                {**fila, "id_borrador": id_borrador} for fila in filas
            ]
        else:
            sql = """
                INSERT INTO horarios_generados
                    (id_periodo, id_programacion, id_ambiente, id_docente,
                     tipo_modalidad, dia_semana, hora_inicio, hora_fin,
                     semana_inicio, semana_fin, estado)
                VALUES
                    (%(id_periodo)s, %(id_programacion)s, %(id_ambiente)s, %(id_docente)s,
                     %(tipo_modalidad)s, %(dia_semana)s, %(hora_inicio)s, %(hora_fin)s,
                     %(semana_inicio)s, %(semana_fin)s, 'BORRADOR')
            """
            filas_insertar = filas
        try:
            with self.conn.cursor() as cur:
                cur.executemany(sql, filas_insertar)
            if confirmar:
                self.conn.commit()
            return len(filas)
        except pymysql.MySQLError:
            self.conn.rollback()
            raise
