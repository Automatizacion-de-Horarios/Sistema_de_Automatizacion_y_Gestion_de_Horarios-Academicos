"""Pruebas de carga de ocupaciones externas del runner por grupos."""

from __future__ import annotations

import unittest

from solver_horarios_grupos.ocupaciones import (
    cargar_filas_periodo,
    cargar_ocupaciones_externas,
)


class _CursorFalso:
    def __init__(self, filas: list[dict]) -> None:
        self.filas = filas
        self.consulta = ""
        self.parametros = None

    def __enter__(self) -> "_CursorFalso":
        return self

    def __exit__(self, *_args) -> bool:
        return False

    def execute(self, consulta: str, parametros) -> None:
        self.consulta = consulta
        self.parametros = parametros

    def fetchall(self) -> list[dict]:
        return self.filas


class _ConexionFalsa:
    def __init__(self, filas: list[dict]) -> None:
        self.filas = filas
        self.cursor_usado: _CursorFalso | None = None

    def cursor(self) -> _CursorFalso:
        self.cursor_usado = _CursorFalso(self.filas)
        return self.cursor_usado


class _RepoFalso:
    def __init__(self, filas: list[dict]) -> None:
        self.conn = _ConexionFalsa(filas)


def _fila(id_horario: int, id_programacion: int) -> dict:
    return {
        "id_horario": id_horario,
        "id_programacion": id_programacion,
        "id_ambiente": None,
        "id_docente": None,
        "tipo_modalidad": "TEC",
        "dia_semana": "LUNES",
        "hora_inicio": "07:45:00",
        "hora_fin": "09:15:00",
        "semana_inicio": 1,
        "semana_fin": 2,
        "estado": "BORRADOR",
    }


class CargaOcupacionesExternasTest(unittest.TestCase):
    def test_solo_activos_filtra_cursos_y_programaciones_inactivos(self) -> None:
        repo = _RepoFalso([])

        cargar_filas_periodo(repo, 7, solo_activos=True)

        assert repo.conn.cursor_usado is not None
        consulta = repo.conn.cursor_usado.consulta
        assert "JOIN programacion_academica" in consulta
        assert "JOIN cursos" in consulta
        assert "pa.estado = 'A'" in consulta
        assert "c.estado = 'A'" in consulta
        assert repo.conn.cursor_usado.parametros == (7,)

    def test_auditoria_no_filtra_para_poder_ver_datos_obsoletos(self) -> None:
        repo = _RepoFalso([])

        cargar_filas_periodo(repo, 7)

        assert repo.conn.cursor_usado is not None
        consulta = repo.conn.cursor_usado.consulta
        assert "JOIN programacion_academica" not in consulta
        assert "pa.estado" not in consulta

    def test_ocupaciones_externas_ignora_inactivos_y_excluye_el_grupo(self) -> None:
        filas = [
            _fila(1, 10),
            _fila(2, 20),
        ]
        repo = _RepoFalso(filas)

        externas = cargar_ocupaciones_externas(repo, 7, {10})

        assert repo.conn.cursor_usado is not None
        consulta = repo.conn.cursor_usado.consulta
        assert "pa.estado = 'A'" in consulta
        assert "c.estado = 'A'" in consulta
        assert [ocupacion.id_horario for ocupacion in externas] == [2]


if __name__ == "__main__":
    unittest.main()
