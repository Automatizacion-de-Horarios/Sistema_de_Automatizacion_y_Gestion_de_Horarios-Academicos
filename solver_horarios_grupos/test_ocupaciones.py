from __future__ import annotations

import unittest
from types import SimpleNamespace

from ortools.sat.python import cp_model

from .ocupaciones import (
    OcupacionExterna,
    agregar_restricciones_externas,
    detectar_conflictos_cruzados,
    detectar_conflictos_externos,
    ocupacion_desde_fila,
)


def _ocupacion(
    *,
    semana_inicio: int = 1,
    semana_fin: int = 4,
    id_docente: int | None = 8,
    id_ambiente: int | None = 3,
) -> OcupacionExterna:
    return OcupacionExterna(
        id_horario=11,
        id_programacion=90,
        id_docente=id_docente,
        id_ambiente=id_ambiente,
        modalidad="TEC",
        dia=0,
        inicio_min=600,
        fin_min=630,
        semana_inicio=semana_inicio,
        semana_fin=semana_fin,
        estado="BORRADOR",
    )


class OcupacionesExternasTests(unittest.TestCase):
    def test_convierte_dia_horas_y_semanas_a_valores_del_modelo(self) -> None:
        reserva = ocupacion_desde_fila(
            {
                "id_horario": 1,
                "id_programacion": 2,
                "id_docente": 8,
                "id_ambiente": 3,
                "tipo_modalidad": "TAL",
                "dia_semana": "MIÉRCOLES",
                "hora_inicio": "10:00:00",
                "hora_fin": "11:30:00",
                "semana_inicio": 2,
                "semana_fin": 6,
                "estado": "CONFIRMADO",
            }
        )
        self.assertEqual((reserva.dia, reserva.inicio_min, reserva.fin_min), (2, 600, 690))
        self.assertEqual(
            (reserva.semana_inicio_interna, reserva.semana_fin), (1, 6)
        )

    def test_restriccion_externa_impide_choque_de_docente(self) -> None:
        model = cp_model.CpModel()
        dia = model.NewIntVar(0, 1, "dia")
        inicio = model.NewIntVar(600, 660, "inicio")
        model.AddAllowedAssignments([dia, inicio], [(0, 600), (0, 630), (0, 660), (1, 600)])
        actividad = SimpleNamespace(
            uid=1,
            docente_id=8,
            ambientes=(),
            semana_inicio=0,
            semana_fin=3,
            duracion_min=30,
            modalidad="TEC",
        )
        construccion = SimpleNamespace(
            actividades=[actividad],
            selector_ambiente={},
            dia={1: dia},
            inicio={1: inicio},
            model=model,
        )

        self.assertEqual(agregar_restricciones_externas(construccion, [_ocupacion()]), 1)
        solver = cp_model.CpSolver()
        self.assertIn(solver.Solve(model), (cp_model.OPTIMAL, cp_model.FEASIBLE))
        self.assertTrue(
            solver.Value(dia) != 0 or solver.Value(inicio) >= 645
        )

    def test_restriccion_externa_impide_choque_de_ambiente(self) -> None:
        model = cp_model.CpModel()
        dia = model.NewIntVar(0, 0, "dia")
        inicio = model.NewIntVar(600, 660, "inicio")
        selector = model.NewBoolVar("ambiente_3")
        model.Add(selector == 1)
        actividad = SimpleNamespace(
            uid=2,
            docente_id=None,
            ambientes=(3,),
            semana_inicio=0,
            semana_fin=3,
            duracion_min=30,
            modalidad="TAL",
        )
        construccion = SimpleNamespace(
            actividades=[actividad],
            selector_ambiente={2: [(3, selector)]},
            dia={2: dia},
            inicio={2: inicio},
            model=model,
        )

        self.assertEqual(
            agregar_restricciones_externas(
                construccion, [_ocupacion(id_docente=None)]
            ),
            1,
        )
        solver = cp_model.CpSolver()
        self.assertIn(solver.Solve(model), (cp_model.OPTIMAL, cp_model.FEASIBLE))
        self.assertGreaterEqual(solver.Value(inicio), 630)

    def test_semanas_disjuntas_no_agregan_restricciones(self) -> None:
        model = cp_model.CpModel()
        dia = model.NewIntVar(0, 1, "dia")
        inicio = model.NewIntVar(600, 630, "inicio")
        actividad = SimpleNamespace(
            uid=1,
            docente_id=8,
            ambientes=(),
            semana_inicio=0,
            semana_fin=4,
            duracion_min=30,
            modalidad="TEC",
        )
        construccion = SimpleNamespace(
            actividades=[actividad],
            selector_ambiente={},
            dia={1: dia},
            inicio={1: inicio},
            model=model,
        )
        self.assertEqual(
            agregar_restricciones_externas(
                construccion, [_ocupacion(semana_inicio=5, semana_fin=8)]
            ),
            0,
        )

    def test_auditoria_detecta_choque_de_ambiente_con_semanas_solapadas(self) -> None:
        conflictos = detectar_conflictos_externos(
            [
                {
                    "id_programacion": 5,
                    "id_docente": None,
                    "id_ambiente": 3,
                    "tipo_modalidad": "TAL",
                    "dia_semana": "LUNES",
                    "hora_inicio": "10:15:00",
                    "hora_fin": "11:00:00",
                    "semana_inicio": 3,
                    "semana_fin": 5,
                }
            ],
            [_ocupacion(id_docente=None)],
        )
        self.assertEqual(len(conflictos), 1)
        self.assertIn("ambiente 3", conflictos[0])

    def test_auditoria_cruzada_ignora_semanas_disjuntas(self) -> None:
        primera = _ocupacion()
        segunda = OcupacionExterna(
            id_horario=12,
            id_programacion=91,
            id_docente=8,
            id_ambiente=3,
            modalidad="TEC",
            dia=0,
            inicio_min=600,
            fin_min=630,
            semana_inicio=5,
            semana_fin=8,
            estado="BORRADOR",
        )
        self.assertEqual(
            detectar_conflictos_cruzados([primera, segunda]),
            [],
        )

    def test_auditoria_cruzada_detecta_choque_de_docente(self) -> None:
        primera = _ocupacion(id_ambiente=None)
        segunda = OcupacionExterna(
            id_horario=12,
            id_programacion=91,
            id_docente=8,
            id_ambiente=None,
            modalidad="TEC",
            dia=0,
            inicio_min=615,
            fin_min=645,
            semana_inicio=2,
            semana_fin=4,
            estado="CONFIRMADO",
        )
        conflictos = detectar_conflictos_cruzados([primera, segunda])
        self.assertEqual(len(conflictos), 1)
        self.assertIn("docente 8", conflictos[0])


if __name__ == "__main__":
    unittest.main()
