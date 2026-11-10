"""Pruebas unitarias de las reglas puras del motor de horarios.

No requieren MySQL. Validan cálculos de semanas, bloques, calendario, bandas,
topes docentes, metadatos de plantilla modular y la restricción CP-SAT de
clonación de día/hora.
"""

from __future__ import annotations

import unittest
from dataclasses import replace
from datetime import date

from solver_horarios.actividades import (
    _ambientes_para,
    _dividir_bloques,
    _dividir_emp,
    construir_actividades,
    generar_pares_permitidos,
    max_horas_para_ventana,
)
from solver_horarios.config import (
    ACADEMIC_HOUR_MIN,
    MARGEN_RECUPERACION,
    PENALIZACION_DESVIACION_FRANJA,
    PENALIZACION_DOBLE_TURNO_COHORTE,
    PENALIZACION_DOBLE_TURNO_DIARIO,
    PENALIZACION_TEC_DIA_ADICIONAL,
    PENALIZACION_VIR_CERCANIA,
    SEMANAS_LECTIVAS,
    VIR_SEPARACION_PREFERIDA_MIN,
    Actividad,
    Ambiente,
    BloqueProgramado,
    Calendario,
    Curso,
    Docente,
    ErrorDatos,
    FranjaInstitucional,
    Oferta,
    Periodo,
    agrupar_semanas,
    alinear_grilla,
    clave_natural_codigo,
    distribuir_entero,
    distribuir_semanas,
    formatear_hora,
    numero_semestre,
)
from solver_horarios.planificacion import (
    Contexto,
    _es_seminario_tal,
    _exigir_fechas_para_feriados,
    asignar_ventanas,
)
from solver_horarios.modelo import _validar_modalidades
from solver_horarios.preflight import (
    cargas_docentes,
    diagnosticar_y_validar,
    verificar_asignaciones_docente,
    verificar_capacidad_docente,
    verificar_margen_lectivo,
    verificar_plantilla_modular,
)
from solver_horarios.db import Repositorio
from solver_horarios.persistencia import guardar_horario
from solver_horarios_db import _aplicar_fechas_periodo


def _curso(semestre_num: int = 3) -> Curso:
    return Curso(
        id_curso=1,
        id_semestre=1,
        id_carrera=1,
        codigo_carrera="PCID",
        semestre_romano="III",
        semestre_num=semestre_num,
        mat_cur="PCID-301",
        nombre="Curso de prueba",
        semanas_db=4,
        horas_tec=5,
        horas_tal=0,
        horas_vir=0,
        horas_eval=0,
        total_horas=5,
        is_carrera=True,
        horario_sinfo="",
    )


def _contexto(semestre_num: int = 3, turno: int = 1) -> tuple[Contexto, Oferta]:
    curso = _curso(semestre_num)
    oferta = Oferta(
        id_programacion=1,
        id_periodo=1,
        id_sede=1,
        id_turno=turno,
        grupo="01",
        id_docente_tec=None,
        id_docente_tal=None,
        curso=curso,
    )
    ctx = Contexto(
        periodo=Periodo(id_periodo=1, codigo="TEST", descripcion="Prueba", semanas=18),
        franja=FranjaInstitucional(inicio_min=465, cierre_min=1380, incluir_domingo=False),
        ofertas=[oferta],
        docentes={},
        ambientes={},
        compatibilidad={},
        turnos={1: 1},
        dias=tuple(range(6)),
        calendario=Calendario(None, None, 18, frozenset()),
        turnos_por_cohorte={oferta.cohorte_turnos: {turno}},
    )
    return ctx, oferta


def _contexto_dos_modulos(
    horas: tuple[tuple[int, int, int], tuple[int, int, int]] = (
        (20, 40, 0),
        (20, 40, 0),
    ),
) -> Contexto:
    """Dos módulos de la misma cohorte y un aula genérica."""
    ofertas = []
    for indice, (horas_tec, horas_tal, horas_vir) in enumerate(horas, start=1):
        curso = Curso(
            id_curso=indice,
            id_semestre=indice,
            id_carrera=1,
            codigo_carrera="PCID",
            semestre_romano="III",
            semestre_num=3,
            mat_cur=f"PCID-30{indice}",
            nombre="Curso modular",
            semanas_db=4,
            horas_tec=horas_tec,
            horas_tal=horas_tal,
            horas_vir=horas_vir,
            horas_eval=0,
            total_horas=horas_tec + horas_tal + horas_vir,
            is_carrera=True,
            horario_sinfo="",
        )
        ofertas.append(
            Oferta(
                id_programacion=100 + indice,
                id_periodo=1,
                id_sede=1,
                id_turno=1,
                grupo="01",
                id_docente_tec=None,
                id_docente_tal=None,
                curso=curso,
            )
        )
    ambiente = Ambiente(
        id_ambiente=10,
        codigo="A-101",
        id_tipo=1,
        tipo="AULA",
        aforo=40,
        estado="DISPONIBLE",
        id_sede=1,
    )
    return Contexto(
        periodo=Periodo(id_periodo=1, codigo="TEST", descripcion="Prueba", semanas=18),
        franja=FranjaInstitucional(
            inicio_min=465, cierre_min=1380, incluir_domingo=False
        ),
        ofertas=ofertas,
        docentes={},
        ambientes={ambiente.id_ambiente: ambiente},
        compatibilidad={},
        turnos={1: 1},
        dias=tuple(range(6)),
        calendario=Calendario(None, None, 18, frozenset()),
        turnos_por_cohorte={ofertas[0].cohorte_turnos: {1}},
        ambientes_por_sede={1: (ambiente.id_ambiente,)},
    )


class PruebasAmbientesPermitidos(unittest.TestCase):
    def setUp(self):
        self.ctx, self.oferta = _contexto(semestre_num=2, turno=1)
        self.ctx.ambientes = {
            1: Ambiente(
                1, "LAB-DISENO", 1, "Laboratorio Diseño", 30, "DISPONIBLE", 1
            ),
            2: Ambiente(2, "AULA-101", 5, "Aula", 30, "DISPONIBLE", 1),
            3: Ambiente(
                3, "LAB-AUTORIZADO", 2, "Laboratorio Computacion", 30,
                "DISPONIBLE", 1,
            ),
        }
        self.ctx.ambientes_por_sede = {1: (1, 2, 3)}

    def test_sin_mapeo_solo_permite_aulas_comunes(self):
        self.ctx.compatibilidad = {}

        self.assertEqual(
            _ambientes_para(self.ctx, self.oferta, "TEC", permitir_generico=False),
            (2,),
        )

    def test_con_mapeo_solo_permite_laboratorio_autorizado(self):
        self.ctx.compatibilidad = {self.oferta.curso.id_curso: (3,)}

        self.assertEqual(
            _ambientes_para(self.ctx, self.oferta, "TEC", permitir_generico=False),
            (3,),
        )

    def test_sin_mapeo_rechaza_laboratorio(self):
        actividad = Actividad(
            uid=1,
            oferta=self.oferta,
            modalidad="TEC",
            semana_inicio=0,
            semana_fin=1,
            horas_academicas=2,
            duracion_min=90,
            docente_id=None,
            ambientes=(1,),
        )
        bloque = BloqueProgramado(
            actividad=actividad,
            dia=0,
            inicio_min=465,
            fin_min=555,
            id_ambiente=1,
        )

        problemas, _ = _validar_modalidades(self.ctx, [bloque])

        self.assertTrue(
            any("regla de asignación de ambiente" in problema for problema in problemas)
        )

    def test_con_mapeo_rechaza_aula_comun(self):
        self.ctx.compatibilidad = {self.oferta.curso.id_curso: (3,)}
        actividad = Actividad(
            uid=1,
            oferta=self.oferta,
            modalidad="TEC",
            semana_inicio=0,
            semana_fin=1,
            horas_academicas=2,
            duracion_min=90,
            docente_id=None,
            ambientes=(2,),
        )
        bloque = BloqueProgramado(
            actividad=actividad,
            dia=0,
            inicio_min=465,
            fin_min=555,
            id_ambiente=2,
        )

        problemas, _ = _validar_modalidades(self.ctx, [bloque])

        self.assertTrue(
            any("regla de asignación de ambiente" in problema for problema in problemas)
        )


class PruebasSemanas(unittest.TestCase):
    def test_distribuir_semanas_conserva_el_total(self):
        semanas = distribuir_semanas(50, 18)
        self.assertEqual(sum(semanas), 50)
        self.assertEqual(semanas[:14], [3] * 14)
        self.assertEqual(semanas[14:], [2] * 4)

    def test_distribuir_semanas_sin_carga(self):
        self.assertEqual(distribuir_semanas(0, 18), [])
        self.assertEqual(distribuir_semanas(10, 0), [])

    def test_agrupar_semanas_omite_ceros(self):
        self.assertEqual(
            agrupar_semanas([3, 3, 2, 2, 0, 2]),
            [(0, 2, 3), (2, 4, 2), (5, 6, 2)],
        )

    def test_distribuir_entero_equilibrado(self):
        self.assertEqual(distribuir_entero(7, 3), [3, 2, 2])
        self.assertEqual(distribuir_entero(6, 3), [2, 2, 2])
        self.assertEqual(distribuir_entero(1, 3), [1, 0, 0])


class PruebasBloques(unittest.TestCase):
    def test_bloques_de_tres_horas_maximo(self):
        self.assertEqual(_dividir_bloques(5), [3, 2])
        self.assertEqual(_dividir_bloques(7), [3, 2, 2])
        self.assertEqual(_dividir_bloques(9), [3, 3, 3])

    def test_emp_en_dias_completos(self):
        self.assertEqual(_dividir_emp(10), [5, 5])
        self.assertEqual(_dividir_emp(8), [8])

    def test_capacidad_de_ventana(self):
        self.assertEqual(max_horas_para_ventana(135), 3)
        self.assertEqual(max_horas_para_ventana(300), 6)
        self.assertEqual(max_horas_para_ventana(240), 5)
        self.assertEqual(max_horas_para_ventana(0), 0)


class PruebasTopesDocentes(unittest.TestCase):
    """Los topes 36/23/19 son horas reloj, no horas académicas."""

    @staticmethod
    def _docente(tipo: str = "TIEMPO_COMPLETO", meta: int = 36) -> Docente:
        return Docente(
            id_docente=1,
            nombre="Docente de prueba",
            tipo_contrato=tipo,
            horas_meta=meta,
            usa_restriccion=False,
            estado="A",
        )

    @staticmethod
    def _actividad(
        uid: int,
        oferta: Oferta,
        docente_id: int,
        horas_academicas: int,
        semana_inicio: int = 0,
        semana_fin: int = 1,
    ) -> Actividad:
        return Actividad(
            uid=uid,
            oferta=oferta,
            modalidad="TEC",
            semana_inicio=semana_inicio,
            semana_fin=semana_fin,
            horas_academicas=horas_academicas,
            duracion_min=horas_academicas * ACADEMIC_HOUR_MIN,
            docente_id=docente_id,
            ambientes=(),
        )

    def test_tope_semanal_se_convierte_a_minutos_reales(self):
        self.assertEqual(self._docente().tope_semanal_min, 36 * 60)
        self.assertEqual(
            self._docente("TIEMPO_PARCIAL", 23).tope_semanal_min, 23 * 60
        )
        self.assertEqual(
            self._docente("TIEMPO_PARCIAL", 19).tope_semanal_min, 19 * 60
        )

    def test_carga_semanal_suma_duracion_real(self):
        ctx, oferta = _contexto()
        ctx.docentes = {1: self._docente()}
        actividades = [
            self._actividad(1, oferta, 1, 3),  # 135 min
            self._actividad(2, oferta, 1, 2),  # 90 min
        ]

        cargas, topes = cargas_docentes(ctx, actividades)

        self.assertEqual(cargas[(1, 0)], 225)
        self.assertEqual(topes[1], 2160)

    def test_preflight_acepta_exactamente_36_horas_reloj(self):
        ctx, oferta = _contexto()
        ctx.docentes = {1: self._docente()}
        # 48 h académicas = 2.160 min = 36 h reloj.
        actividad = self._actividad(1, oferta, 1, 48)

        diagnosticar_y_validar(ctx, [actividad], relajar_topes=False)

    def test_preflight_rechaza_mas_de_36_horas_reloj(self):
        ctx, oferta = _contexto()
        ctx.docentes = {1: self._docente()}
        # 49 h académicas = 2.205 min = 36,75 h reloj.
        actividad = self._actividad(1, oferta, 1, 49)

        with self.assertRaises(ErrorDatos) as contexto:
            diagnosticar_y_validar(ctx, [actividad], relajar_topes=False)
        self.assertIn("36.75 h reloj", str(contexto.exception))
        self.assertIn("tope 36 h reloj", str(contexto.exception))

    def test_preflight_rechaza_mas_de_19_horas_reloj_en_parcial(self):
        ctx, oferta = _contexto()
        ctx.docentes = {1: self._docente("TIEMPO_PARCIAL", 19)}
        # 26 h académicas = 1.170 min = 19,5 h reloj.
        actividad = self._actividad(1, oferta, 1, 26)

        with self.assertRaises(ErrorDatos):
            diagnosticar_y_validar(ctx, [actividad], relajar_topes=False)

    def test_preflight_bloquea_carga_que_no_cabe_en_disponibilidad(self):
        ctx, oferta = _contexto()
        ctx.docentes = {
            1: Docente(
                id_docente=1,
                nombre="Docente completo",
                tipo_contrato="TIEMPO COMPLETO",
                horas_meta=36,
                usa_restriccion=True,
                estado="A",
                disponibilidad={0: ((465, 600),)},
            ),
            2: Docente(
                id_docente=2,
                nombre="Docente parcial",
                tipo_contrato="TIEMPO PARCIAL",
                horas_meta=19,
                usa_restriccion=True,
                estado="A",
                disponibilidad={0: ((465, 600),)},
            ),
        }
        # Cada docente acumula 180 min de clase, pero su única franja activa
        # admite 135 min (3 h académicas). La carga no cabe.
        actividades = [
            self._actividad(1, oferta, 1, 2),
            self._actividad(2, oferta, 1, 2),
            self._actividad(3, oferta, 2, 2),
            self._actividad(4, oferta, 2, 2),
        ]

        with self.assertRaises(ErrorDatos) as contexto:
            verificar_capacidad_docente(ctx, actividades)
        mensaje = str(contexto.exception)
        self.assertIn("disponibilidad activa", mensaje)
        self.assertIn("Docente parcial", mensaje)
        self.assertIn("Docente completo", mensaje)
        # Los docentes de tiempo parcial se listan primero por su agenda más
        # ajustada.
        self.assertLess(
            mensaje.index("Docente parcial"),
            mensaje.index("Docente completo"),
        )

    def test_descanso_largo_se_exige_si_hay_clases_despues_de_cinco_horas(self):
        from solver_horarios.config import BloqueProgramado
        from solver_horarios.modelo import _validar_docentes

        ctx, oferta = _contexto()
        ctx.docentes = {1: self._docente()}
        horas_e_inicios = [(3, 465), (2, 615), (1, 720)]
        bloques = [
            BloqueProgramado(
                self._actividad(uid, oferta, 1, horas),
                0,
                inicio,
                inicio + horas * ACADEMIC_HOUR_MIN,
                None,
            )
            for uid, (horas, inicio) in enumerate(horas_e_inicios, start=1)
        ]

        problemas = _validar_docentes(
            ctx, bloques, relajar_topes=False
        )

        self.assertTrue(any("tras 5 h académicas continuas" in p for p in problemas))

    def test_descanso_largo_se_omite_al_terminar_la_jornada(self):
        from solver_horarios.config import BloqueProgramado
        from solver_horarios.modelo import _validar_docentes

        ctx, oferta = _contexto()
        ctx.docentes = {1: self._docente()}
        horas_e_inicios = [(3, 465), (3, 615)]
        bloques = [
            BloqueProgramado(
                self._actividad(uid, oferta, 1, horas),
                0,
                inicio,
                inicio + horas * ACADEMIC_HOUR_MIN,
                None,
            )
            for uid, (horas, inicio) in enumerate(horas_e_inicios, start=1)
        ]

        problemas = _validar_docentes(
            ctx, bloques, relajar_topes=False
        )

        self.assertFalse(any("descanso" in p for p in problemas))

    def test_descanso_de_cuarenta_y_cinco_minutos_reinicia_continuidad(self):
        from solver_horarios.config import BloqueProgramado
        from solver_horarios.modelo import _validar_docentes

        ctx, oferta = _contexto()
        ctx.docentes = {1: self._docente()}
        horas_e_inicios = [(3, 465), (2, 615), (1, 750)]
        bloques = [
            BloqueProgramado(
                self._actividad(uid, oferta, 1, horas),
                0,
                inicio,
                inicio + horas * ACADEMIC_HOUR_MIN,
                None,
            )
            for uid, (horas, inicio) in enumerate(horas_e_inicios, start=1)
        ]

        problemas = _validar_docentes(
            ctx, bloques, relajar_topes=False
        )

        self.assertFalse(any("descanso" in p for p in problemas))


    @staticmethod
    def _resolver(horas_e_inicios: list[tuple[int, int]]) -> int:
        from ortools.sat.python import cp_model

        from solver_horarios.modelo_variables import Construccion

        ctx, oferta = _contexto(semestre_num=3)
        ctx.docentes = {
            1: PruebasTopesDocentes._docente(),
        }
        actividades = [
            PruebasTopesDocentes._actividad(uid, oferta, 1, horas)
            for uid, (horas, _) in enumerate(horas_e_inicios, start=1)
        ]
        construccion = Construccion(ctx=ctx, actividades=actividades)
        construccion._crear_variables()
        construccion._agregar_recesos_largos()
        for actividad, (_, inicio) in zip(actividades, horas_e_inicios):
            construccion.model.Add(construccion.dia[actividad.uid] == 0)
            construccion.model.Add(construccion.inicio[actividad.uid] == inicio)

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5
        solver.parameters.num_search_workers = 1
        return solver.Solve(construccion.model)

    def test_modelo_permite_seis_horas_si_no_hay_clase_posterior(self):
        from ortools.sat.python import cp_model

        estado = self._resolver([(3, 465), (3, 615)])

        self.assertIn(estado, (cp_model.OPTIMAL, cp_model.FEASIBLE))

    def test_modelo_exige_descanso_tras_cinco_horas_si_hay_clase_posterior(self):
        from ortools.sat.python import cp_model

        estado = self._resolver([(3, 465), (2, 615), (1, 720)])

        self.assertEqual(estado, cp_model.INFEASIBLE)

    def test_modelo_acepta_descanso_antes_de_la_clase_posterior(self):
        from ortools.sat.python import cp_model

        estado = self._resolver([(3, 465), (2, 615), (1, 765)])

        self.assertIn(estado, (cp_model.OPTIMAL, cp_model.FEASIBLE))

    def test_modelo_prefiere_receso_de_15_minutos_sobre_30(self):
        from ortools.sat.python import cp_model

        from solver_horarios.modelo_variables import Construccion

        ctx, oferta = _contexto(semestre_num=3)
        ctx.docentes = {1: self._docente()}
        actividades = [
            self._actividad(1, oferta, 1, 2),  # 90 min
            self._actividad(2, oferta, 1, 2),  # 90 min
        ]
        construccion = Construccion(ctx=ctx, actividades=actividades)
        construccion._crear_variables()
        primera, segunda = actividades
        construccion.model.Add(construccion.dia[primera.uid] == 0)
        construccion.model.Add(construccion.dia[segunda.uid] == 0)
        construccion.model.Add(construccion.inicio[primera.uid] == 465)
        construccion.model.AddAllowedAssignments(
            [construccion.inicio[segunda.uid]],
            [(570,), (585,)],  # 09:30 (receso 15) u 09:45 (receso 30)
        )
        indicadores = []
        for actividad in actividades:
            indicador = construccion.model.NewBoolVar(
                f"manana_receso_test_{actividad.uid}"
            )
            construccion.model.Add(indicador == 1)
            indicadores.append(indicador)
        # Sin la penalización, el modelo preferiría el inicio más tardío.
        construccion.terminos_objetivo.append(
            (585 - construccion.inicio[segunda.uid]) * 1_000
        )
        construccion._agregar_circuito_continuidad(
            actividades, indicadores, "receso_test"
        )
        construccion.model.Minimize(sum(construccion.terminos_objetivo))

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5
        solver.parameters.num_search_workers = 1
        estado = solver.Solve(construccion.model)

        self.assertIn(estado, (cp_model.OPTIMAL, cp_model.FEASIBLE))
        self.assertEqual(solver.Value(construccion.inicio[segunda.uid]), 570)

    def test_curso_puramente_tec_no_exige_docente_tal(self):
        ctx, oferta = _contexto()
        oferta.id_docente_tec = 1
        oferta.id_docente_tal = None

        verificar_asignaciones_docente(ctx)

    def test_preflight_exige_docente_para_cada_modalidad_presencial(self):
        ctx, oferta = _contexto()
        oferta.curso = replace(
            oferta.curso,
            horas_tec=5,
            horas_tal=4,
            total_horas=9,
        )
        oferta.id_docente_tec = 1
        oferta.id_docente_tal = None

        with self.assertRaisesRegex(ErrorDatos, "prog=1: TAL"):
            verificar_asignaciones_docente(ctx)

        oferta.id_docente_tec = None
        with self.assertRaises(ErrorDatos) as contexto:
            verificar_asignaciones_docente(ctx)
        self.assertIn("prog=1: TEC", str(contexto.exception))
        self.assertIn("prog=1: TAL", str(contexto.exception))

    def test_emp_no_exige_docente_institucional_tal(self):
        ctx, oferta = _contexto()
        oferta.curso = replace(
            oferta.curso,
            horario_sinfo="EMP",
            horas_tec=2,
            horas_tal=8,
            total_horas=10,
        )
        oferta.id_docente_tec = None
        oferta.id_docente_tal = None

        verificar_asignaciones_docente(ctx)


class PruebasFiltroSemestreActivo(unittest.TestCase):
    def test_consulta_de_ofertas_filtra_semestres_activos(self):
        class CursorFake:
            query = ""

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def execute(self, query, _params):
                self.query = query

            def fetchall(self):
                return []

        class ConexionFake:
            def __init__(self):
                self.cursor_fake = CursorFake()

            def cursor(self):
                return self.cursor_fake

        repo = object.__new__(Repositorio)
        repo.conn = ConexionFake()

        with self.assertRaisesRegex(ErrorDatos, "No hay oferta"):
            repo.obtener_ofertas(1)

        self.assertIn("AND s.estado = 'A'", repo.conn.cursor_fake.query)

    def test_consulta_filtra_semestre_ii_en_mysql(self):
        class CursorFake:
            query = ""
            params = None

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def execute(self, query, params):
                self.query = query
                self.params = params

            def fetchall(self):
                return []

        class ConexionFake:
            def __init__(self):
                self.cursor_fake = CursorFake()

            def cursor(self):
                return self.cursor_fake

        repo = object.__new__(Repositorio)
        repo.conn = ConexionFake()

        with self.assertRaisesRegex(ErrorDatos, "No hay oferta"):
            repo.obtener_ofertas(1, semestres={2})

        self.assertIn("s.semestre IN (%s)", repo.conn.cursor_fake.query)
        self.assertEqual(repo.conn.cursor_fake.params, [1, "II"])


class PruebasPersistenciaFiltrada(unittest.TestCase):
    def test_reemplaza_solo_programaciones_filtradas(self):
        class RepoFake:
            def __init__(self):
                self.conn = self
                self.calls = []

            def contar_borradores(self, periodo):
                self.calls.append(("contar", periodo))
                return 12

            def crear_borrador(self, periodo, nombre=None, *, confirmar=True):
                self.calls.append(("crear_borrador", periodo, confirmar))
                return 999

            def validar_borrador(self, id_borrador, periodo):
                self.calls.append(("validar_borrador", id_borrador, periodo))

            def borrar_borradores_programaciones(self, periodo, ids):
                self.calls.append(("borrar_filtrado", periodo, ids))
                return 4

            def insertar_horarios(self, filas, *, id_borrador=None, confirmar=True):
                self.calls.append(("insertar", len(filas), id_borrador, confirmar))
                return len(filas)

            def commit(self):
                self.calls.append(("commit",))

            def rollback(self):
                self.calls.append(("rollback",))

        repo = RepoFake()
        filas = [{"id_periodo": 1}, {"id_periodo": 1}]
        insertados = guardar_horario(
            repo,
            filas,
            id_periodo=1,
            reemplazar_programaciones={21, 22},
        )

        self.assertEqual(insertados, 2)
        self.assertIn(("borrar_filtrado", 1, {21, 22}), repo.calls)
        self.assertIn(("insertar", 2, 999, False), repo.calls)
        self.assertIn(("commit",), repo.calls)
        self.assertNotIn(("borrar_global", 1), repo.calls)


class PruebasVentanasModulares(unittest.TestCase):
    def test_curso_de_16_semanas_no_entra_en_la_cadena_secuencial(self):
        ctx, _ = _contexto()
        base = _curso()

        def oferta(pid: int, codigo: str, semanas: int, tec: int) -> Oferta:
            curso = replace(
                base,
                id_curso=pid,
                mat_cur=codigo,
                semanas_db=semanas,
                horas_tec=tec,
                total_horas=tec,
            )
            return Oferta(
                id_programacion=pid,
                id_periodo=1,
                id_sede=1,
                id_turno=1,
                grupo="01",
                id_docente_tec=None,
                id_docente_tal=None,
                curso=curso,
            )

        largo = oferta(1, "NCCU-239", 16, 32)
        cortos = [
            oferta(2, "NAED-424", 4, 5),
            oferta(3, "NAED-425", 4, 5),
            oferta(4, "NAED-426", 4, 5),
            oferta(5, "NAED-427", 4, 5),
        ]
        ctx.ofertas = [largo, *cortos]

        with self.assertLogs("solver_horarios.planificacion", level="WARNING") as logs:
            asignar_ventanas(ctx)

        self.assertEqual((largo.ventana_inicio, largo.ventana_fin), (0, 16))
        self.assertEqual(
            [(o.ventana_inicio, o.ventana_fin) for o in cortos],
            [(0, 4), (4, 8), (8, 12), (12, 16)],
        )
        self.assertTrue(any("larga duración" in linea for linea in logs.output))
        self.assertFalse(any("suman" in linea for linea in logs.output))


class PruebasPlantillaModular(unittest.TestCase):
    def test_objetivo_prioriza_docentes_a_tiempo_parcial(self):
        from solver_horarios.modelo_variables import Construccion

        ctx, oferta = _contexto(semestre_num=3)
        oferta.id_docente_tec = 1
        parcial = Docente(
            id_docente=1,
            nombre="Docente parcial",
            tipo_contrato="TIEMPO MÉDIO",
            horas_meta=19,
            usa_restriccion=False,
            estado="A",
        )
        ctx.docentes[1] = parcial
        actividad = Actividad(
            uid=1,
            oferta=oferta,
            modalidad="TEC",
            semana_inicio=0,
            semana_fin=4,
            horas_academicas=2,
            duracion_min=90,
            docente_id=1,
            ambientes=(),
        )
        construccion = Construccion(ctx=ctx, actividades=[actividad])
        self.assertEqual(
            construccion._factor_prioridad_docente(actividad),
            100_000,
        )

        ctx.docentes[1] = replace(parcial, tipo_contrato="TIEMPO COMPLETO")
        self.assertEqual(construccion._factor_prioridad_docente(actividad), 1)
    def test_curso_de_18_semanas_se_acota_al_limite_lectivo(self):
        ctx, oferta = _contexto()
        oferta.curso = replace(
            oferta.curso,
            semanas_db=18,
            horas_tec=80,
            total_horas=80,
        )

        asignar_ventanas(ctx)

        self.assertEqual((oferta.ventana_inicio, oferta.ventana_fin), (0, SEMANAS_LECTIVAS))
        self.assertEqual(SEMANAS_LECTIVAS + MARGEN_RECUPERACION, 18)

    def test_seminario_tal_termina_en_la_semana_16(self):
        ctx, oferta = _contexto(semestre_num=4)
        oferta.curso = replace(
            oferta.curso,
            nombre="SEMINARIO DE PRÁCTICA",
            semanas_db=18,
            horas_tec=0,
            horas_tal=80,
            total_horas=80,
        )

        asignar_ventanas(ctx)

        self.assertEqual((oferta.ventana_inicio, oferta.ventana_fin), (0, 16))

    def test_modulos_sucesivos_comparten_metadatos_y_slots(self):
        ctx = _contexto_dos_modulos()
        actividades = construir_actividades(ctx)

        self.assertEqual(len({o.plantilla_id for o in ctx.ofertas}), 1)
        self.assertEqual(
            [o.modulo_orden for o in ctx.ofertas],
            [0, 1],
        )

        slots: dict[str, set[int]] = {}
        for actividad in actividades:
            if not actividad.plantilla_slot:
                continue
            slots.setdefault(actividad.plantilla_slot, set()).add(
                actividad.duracion_min
            )
        self.assertTrue(slots)
        for duraciones in slots.values():
            self.assertEqual(len(duraciones), 1)
        verificar_plantilla_modular(ctx, actividades)

    def test_modelo_fuerza_dia_y_hora_iguales_por_slot(self):
        from ortools.sat.python import cp_model

        from solver_horarios.modelo_variables import Construccion

        ctx = _contexto_dos_modulos()
        actividades = construir_actividades(ctx)
        construccion = Construccion(
            ctx=ctx, actividades=actividades, sin_objetivo=True
        )
        modelo = construccion.construir()
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 10
        solver.parameters.num_search_workers = 1

        status = solver.Solve(modelo)
        self.assertIn(status, (cp_model.OPTIMAL, cp_model.FEASIBLE))

        grupos: dict[str, list[Actividad]] = {}
        for actividad in actividades:
            if actividad.plantilla_slot:
                grupos.setdefault(actividad.plantilla_slot, []).append(actividad)
        self.assertTrue(grupos)
        for grupo in grupos.values():
            dias = {solver.Value(construccion.dia[a.uid]) for a in grupo}
            inicios = {solver.Value(construccion.inicio[a.uid]) for a in grupo}
            self.assertEqual(len(dias), 1)
            self.assertEqual(len(inicios), 1)

    def test_modelo_rechaza_jornada_estudiantil_mayor_a_ocho_horas(self):
        from ortools.sat.python import cp_model

        from solver_horarios.modelo_variables import Construccion

        ctx = _contexto_dos_modulos()
        oferta = ctx.ofertas[0]
        oferta.curso = replace(
            oferta.curso,
            horas_tec=1,
            horas_tal=0,
            horas_vir=1,
            total_horas=2,
            semanas_db=4,
        )
        ctx.ofertas = [oferta]
        actividades = construir_actividades(ctx)
        construccion = Construccion(ctx=ctx, actividades=actividades)
        modelo = construccion.construir()
        tec = next(a for a in actividades if a.modalidad == "TEC")
        virtual = next(a for a in actividades if a.modalidad == "VIR")
        modelo.Add(construccion.dia[tec.uid] == 0)
        modelo.Add(construccion.inicio[tec.uid] == 945)
        modelo.Add(construccion.dia[virtual.uid] == 0)
        modelo.Add(construccion.inicio[virtual.uid] == 465)

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5

        self.assertEqual(solver.Solve(modelo), cp_model.INFEASIBLE)

    def test_vir_queda_fuera_de_la_plantilla_rigida(self):
        # Mismo patrón TEC/TAL, pero VIR 28 vs 27: no debe bloquear.
        ctx = _contexto_dos_modulos(((20, 40, 28), (20, 40, 27)))
        actividades = construir_actividades(ctx)

        vir = [a for a in actividades if a.modalidad == "VIR"]
        self.assertTrue(vir)
        self.assertTrue(all(a.plantilla_id is None for a in vir))
        self.assertTrue(all(a.plantilla_slot is None for a in vir))
        verificar_plantilla_modular(ctx, actividades)

    def test_horas_de_evaluacion_no_se_programan(self):
        ctx = _contexto_dos_modulos()
        for oferta in ctx.ofertas:
            oferta.curso = replace(
                oferta.curso,
                horas_eval=100,
                total_horas=oferta.curso.total_horas + 100,
            )

        actividades = construir_actividades(ctx)

        # Cada actividad representa una semana recurrente: 20 TEC + 40 TAL
        # repartidas en 4 semanas = 15 h académicas semanales por módulo.
        self.assertEqual(
            sum(actividad.horas_academicas for actividad in actividades),
            2 * ((20 + 40) // 4),
        )
        self.assertEqual(
            {actividad.modalidad for actividad in actividades},
            {"TEC", "TAL"},
        )

    def test_tec_no_impone_dias_por_etiqueta(self):
        ctx = _contexto_dos_modulos()
        actividades = construir_actividades(ctx)
        tec = [
            actividad
            for actividad in actividades
            if actividad.modalidad == "TEC"
        ]

        self.assertTrue(tec)
        self.assertTrue(all(actividad.enlace_dia is None for actividad in tec))
        self.assertTrue(
            all(actividad.plantilla_slot.startswith("TEC:_:") for actividad in tec)
        )

    def test_disponibilidad_docente_restringe_pares_oficiales(self):
        ctx = _contexto_dos_modulos(((4, 0, 0), (4, 0, 0)))
        for oferta in ctx.ofertas:
            oferta.curso = replace(
                oferta.curso,
                semestre_num=2,
                semestre_romano="II",
            )
            oferta.id_docente_tec = 1
        ctx.turnos_por_cohorte = {ctx.ofertas[0].cohorte_turnos: {1}}
        ctx.docentes[1] = Docente(
            id_docente=1,
            nombre="Docente prueba",
            tipo_contrato="TIEMPO PARCIAL",
            horas_meta=19,
            usa_restriccion=True,
            estado="A",
            disponibilidad={0: ((780, 1170),)},
        )

        actividades = construir_actividades(ctx)
        tec = [
            actividad
            for actividad in actividades
            if actividad.modalidad == "TEC"
        ]
        self.assertTrue(tec)
        for actividad in tec:
            pares = generar_pares_permitidos(ctx, actividad)
            self.assertTrue(pares)
            for _, inicio in pares:
                self.assertGreaterEqual(inicio, 780)
                self.assertLessEqual(
                    inicio + actividad.duracion_min,
                    1170,
                )

    def test_disponibilidad_docente_parcial_habilita_tarde_y_respeta_franja(self):
        ctx = _contexto_dos_modulos(((4, 0, 0), (4, 0, 0)))
        oferta = ctx.ofertas[0]
        oferta.curso = replace(
            oferta.curso,
            semestre_num=2,
            semestre_romano="II",
        )
        oferta.id_docente_tec = 1
        ctx.turnos_por_cohorte = {oferta.cohorte_turnos: {1}}
        ctx.docentes[1] = Docente(
            id_docente=1,
            nombre="Docente prueba",
            tipo_contrato="TIEMPO PARCIAL",
            horas_meta=19,
            usa_restriccion=True,
            estado="A",
            disponibilidad={0: ((780, 1170),)},
        )

        actividad = next(
            actividad
            for actividad in construir_actividades(ctx)
            if actividad.oferta.id_programacion == oferta.id_programacion
            and actividad.modalidad == "TEC"
        )

        pares = generar_pares_permitidos(ctx, actividad)
        self.assertTrue(pares)
        for _, inicio in pares:
            self.assertGreaterEqual(inicio, 765)
            self.assertGreaterEqual(inicio, 780)
            self.assertLessEqual(
                inicio + actividad.duracion_min,
                1170,
            )

    def test_preflight_detecta_patron_tecnico_incompatible(self):
        # El segundo módulo tiene otro número de bloques TEC/TAL.
        ctx = _contexto_dos_modulos(((20, 40, 0), (12, 24, 0)))
        actividades = construir_actividades(ctx)

        with self.assertRaises(ErrorDatos) as contexto:
            verificar_plantilla_modular(ctx, actividades)
        self.assertIn("plantilla modular rígida", str(contexto.exception))
        self.assertIn("PCID-302", str(contexto.exception))

    def test_validacion_de_solucion_rechaza_plantilla_desalineada(self):
        from collections import defaultdict

        from solver_horarios.config import BloqueProgramado
        from solver_horarios.modelo import _validar_plantilla

        ctx = _contexto_dos_modulos()
        actividades = construir_actividades(ctx)
        tec = [a for a in actividades if a.modalidad == "TEC" and a.plantilla_slot]
        por_slot = defaultdict(list)
        for actividad in tec:
            por_slot[actividad.plantilla_slot].append(actividad)
        grupo = next(g for g in por_slot.values() if len(g) >= 2)
        bloques = [
            BloqueProgramado(
                actividad=actividad,
                dia=0,
                inicio_min=480,
                fin_min=480 + actividad.duracion_min,
                id_ambiente=10,
            )
            for actividad in grupo[:2]
        ]
        self.assertEqual(_validar_plantilla(bloques), [])

        bloques[1].dia = 1
        self.assertTrue(_validar_plantilla(bloques))


class PruebasTecTal(unittest.TestCase):
    """Reglas de módulo y preferencias para TEC/TAL."""

    @staticmethod
    def _contexto_con_dos_cursos() -> Contexto:
        ofertas = []
        for indice, (codigo, horas_tec, horas_tal) in enumerate(
            (("PCID-301", 20, 40), ("PCID-302", 12, 24)), start=1
        ):
            curso = Curso(
                id_curso=indice,
                id_semestre=indice,
                id_carrera=1,
                codigo_carrera="PCID",
                semestre_romano="III",
                semestre_num=3,
                mat_cur=codigo,
                nombre="Curso modular",
                semanas_db=4,
                horas_tec=horas_tec,
                horas_tal=horas_tal,
                horas_vir=0,
                horas_eval=0,
                total_horas=horas_tec + horas_tal,
                is_carrera=True,
                horario_sinfo="",
            )
            ofertas.append(
                Oferta(
                    id_programacion=100 + indice,
                    id_periodo=1,
                    id_sede=1,
                    id_turno=1,
                    grupo="01",
                    id_docente_tec=None,
                    id_docente_tal=None,
                    curso=curso,
                )
            )
        ambiente = Ambiente(
            id_ambiente=10,
            codigo="A-101",
            id_tipo=1,
            tipo="AULA",
            aforo=40,
            estado="DISPONIBLE",
            id_sede=1,
        )
        return Contexto(
            periodo=Periodo(
                id_periodo=1, codigo="TEST", descripcion="Prueba", semanas=18
            ),
            franja=FranjaInstitucional(
                inicio_min=465, cierre_min=1380, incluir_domingo=False
            ),
            ofertas=ofertas,
            docentes={},
            ambientes={ambiente.id_ambiente: ambiente},
            compatibilidad={},
            turnos={1: 1},
            dias=tuple(range(6)),
            calendario=Calendario(None, None, 18, frozenset()),
            turnos_por_cohorte={ofertas[0].cohorte_turnos: {1}},
            ambientes_por_sede={1: (ambiente.id_ambiente,)},
        )

    def test_tal_acompana_al_tec_en_su_modulo(self):
        ctx = self._contexto_con_dos_cursos()
        actividades = construir_actividades(ctx)

        rangos: dict[tuple[int, str], set[tuple[int, int]]] = {}
        for actividad in actividades:
            clave = (actividad.oferta.id_programacion, actividad.modalidad)
            rangos.setdefault(clave, set()).add(
                (actividad.semana_inicio, actividad.semana_fin)
            )

        # Dos cursos de carrera de 4 semanas: módulos 1-4 y 5-8. El TAL de
        # cada curso debe dictarse en el mismo módulo que su TEC.
        self.assertEqual(rangos[(101, "TEC")], {(0, 4)})
        self.assertEqual(rangos[(101, "TAL")], {(0, 4)})
        self.assertEqual(rangos[(102, "TEC")], {(4, 8)})
        self.assertEqual(rangos[(102, "TAL")], {(4, 8)})

    def test_seminario_solo_es_tal_si_no_tiene_tec(self):
        curso = self._contexto_con_dos_cursos().ofertas[0].curso
        base = {
            **curso.__dict__,
            "nombre": "SEMINARIO DE PRÁCTICA",
            "semestre_num": 4,
            "horas_tal": 80,
        }
        solo_tal = type(curso)(**{**base, "horas_tec": 0})
        con_tec = type(curso)(**{**base, "horas_tec": 20})
        self.assertTrue(_es_seminario_tal(solo_tal))
        self.assertFalse(_es_seminario_tal(con_tec))

    def test_solver_concentra_tec_ordena_tal_y_ubica_virtual_libremente(self):
        from ortools.sat.python import cp_model

        from solver_horarios.modelo import _extraer_bloques, validar_solucion
        from solver_horarios.modelo_variables import Construccion
        from solver_horarios.planificacion import bandas_virtuales

        ctx = self._contexto_con_dos_cursos()
        oferta = ctx.ofertas[0]
        oferta.curso = replace(
            oferta.curso,
            horas_tec=16,
            horas_tal=8,
            horas_vir=4,
            total_horas=28,
        )
        ctx.ofertas = [oferta]
        actividades = construir_actividades(ctx)
        construccion = Construccion(ctx=ctx, actividades=actividades)
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 10
        solver.parameters.num_search_workers = 1
        estado = solver.Solve(construccion.construir())

        self.assertIn(estado, (cp_model.OPTIMAL, cp_model.FEASIBLE))
        bloques = _extraer_bloques(solver, construccion)
        problemas, _ = validar_solucion(ctx, bloques)
        self.assertEqual(problemas, [])

        tec = [b for b in bloques if b.actividad.modalidad == "TEC"]
        tal = [b for b in bloques if b.actividad.modalidad == "TAL"]
        virtual = [b for b in bloques if b.actividad.modalidad == "VIR"]
        self.assertEqual(len({bloque.dia for bloque in tec}), 1)
        self.assertTrue(
            min((bloque.dia, bloque.inicio_min) for bloque in tal)
            > max((bloque.dia, bloque.inicio_min) for bloque in tec)
            or any(
                taller.dia == teoria.dia
                and taller.inicio_min >= teoria.fin_min + 15
                for taller in tal for teoria in tec
            )
        )
        permitidas = bandas_virtuales(ctx, oferta)
        self.assertTrue(
            all(
                any(
                    inicio <= bloque.inicio_min and bloque.fin_min <= fin
                    for inicio, fin in permitidas
                )
                for bloque in virtual
            )
        )

    def test_objetivo_prioriza_un_solo_dia_para_tec_de_pocas_horas(self):
        from ortools.sat.python import cp_model

        from solver_horarios.modelo_variables import Construccion

        ctx, oferta = _contexto(semestre_num=3, turno=1)
        primera = Actividad(
            uid=1, oferta=oferta, modalidad="TEC", semana_inicio=0, semana_fin=4,
            horas_academicas=2, duracion_min=90, docente_id=None, ambientes=(),
        )
        segunda = replace(primera, uid=2)
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5
        objetivos: dict[str, float] = {}
        for etiqueta, dias in (("un_dia", (0, 0)), ("dos_dias", (0, 1))):
            construccion = Construccion(ctx=ctx, actividades=[primera, segunda])
            modelo = construccion.construir()
            modelo.Add(construccion.dia[primera.uid] == dias[0])
            modelo.Add(construccion.dia[segunda.uid] == dias[1])
            modelo.Add(construccion.banda_horaria[primera.uid] == 0)
            modelo.Add(construccion.banda_horaria[segunda.uid] == 0)
            estado = solver.Solve(modelo)
            self.assertIn(estado, (cp_model.OPTIMAL, cp_model.FEASIBLE))
            objetivos[etiqueta] = solver.ObjectiveValue()

        # La diferencia incorpora también el costo por iniciar más temprano,
        # por eso se tolera un margen pequeño alrededor del peso principal.
        self.assertGreaterEqual(
            objetivos["dos_dias"] - objetivos["un_dia"],
            PENALIZACION_TEC_DIA_ADICIONAL - 1_000,
        )

    def test_solver_equilibra_tec_si_debe_usar_dos_dias(self):
        from ortools.sat.python import cp_model

        from solver_horarios.modelo import _extraer_bloques
        from solver_horarios.modelo_variables import Construccion

        ctx = self._contexto_con_dos_cursos()
        oferta = ctx.ofertas[0]
        oferta.curso = replace(
            oferta.curso,
            horas_tec=40,
            horas_tal=0,
            horas_vir=0,
            total_horas=40,
        )
        oferta.id_docente_tec = 1
        ctx.ofertas = [oferta]
        ctx.docentes[1] = Docente(
            id_docente=1,
            nombre="Docente prueba",
            tipo_contrato="TIEMPO COMPLETO",
            horas_meta=36,
            usa_restriccion=False,
            estado="A",
        )
        actividades = construir_actividades(ctx)
        construccion = Construccion(ctx=ctx, actividades=actividades)
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 10
        solver.parameters.num_search_workers = 1
        estado = solver.Solve(construccion.construir())

        self.assertIn(estado, (cp_model.OPTIMAL, cp_model.FEASIBLE))
        bloques = _extraer_bloques(solver, construccion)
        horas_por_dia: dict[int, int] = {}
        for bloque in bloques:
            horas_por_dia[bloque.dia] = (
                horas_por_dia.get(bloque.dia, 0)
                + bloque.actividad.horas_academicas
            )
        self.assertEqual(sorted(horas_por_dia.values()), [5, 5])


class PruebasCalendario(unittest.TestCase):
    def test_fecha_fin_indicada_se_conserva_en_periodo(self):
        periodo = Periodo(1, "202620", "2026-II", 18)
        resultado = _aplicar_fechas_periodo(
            periodo, "2026-08-17", "2026-12-12"
        )
        self.assertEqual(resultado.fecha_inicio, date(2026, 8, 17))
        self.assertEqual(resultado.fecha_fin, date(2026, 12, 12))

    def test_fecha_fin_sin_inicio_o_anterior_se_rechaza(self):
        periodo = Periodo(1, "202620", "2026-II", 18)
        with self.assertRaisesRegex(ErrorDatos, "--fecha-fin requiere"):
            _aplicar_fechas_periodo(periodo, None, "2026-12-12")
        with self.assertRaisesRegex(ErrorDatos, "no puede ser anterior"):
            _aplicar_fechas_periodo(
                periodo, "2026-08-17", "2026-08-16"
            )

    def test_feriados_activos_sin_fecha_de_inicio_fallan_explicito(self):
        periodo = Periodo(1, "202620", "2026-II", 18)
        calendario = Calendario(None, None, 18, frozenset())

        with self.assertRaisesRegex(ErrorDatos, "--fecha-inicio"):
            _exigir_fechas_para_feriados(
                periodo, calendario, [date(2026, 8, 24)]
            )

    def test_feriados_activos_con_calendario_mapeado_son_validos(self):
        periodo = Periodo(1, "202620", "2026-II", 18)
        calendario = Calendario(
            date(2026, 8, 17), date(2026, 12, 20), 18,
            frozenset({date(2026, 8, 24)}),
        )
        _exigir_fechas_para_feriados(
            periodo, calendario, [date(2026, 8, 24)]
        )

    def test_dividir_rango_alrededor_de_feriado(self):
        calendario = Calendario(
            inicio=date(2026, 8, 17),  # lunes
            fin=date(2026, 9, 13),
            semanas=4,
            feriados=frozenset({date(2026, 8, 24)}),
        )
        self.assertTrue(calendario.es_feriado(1, 0))
        self.assertFalse(calendario.es_feriado(1, 1))
        self.assertEqual(calendario.dividir_rango(0, 4, 0), [(0, 1), (2, 4)])
        self.assertEqual(calendario.dividir_rango(0, 4, 1), [(0, 4)])

    def test_calendario_sin_fechas_no_divide(self):
        calendario = Calendario(None, None, 18, frozenset())
        self.assertFalse(calendario.disponible)
        self.assertEqual(calendario.dividir_rango(0, 18, 0), [(0, 18)])


class PruebasBandas(unittest.TestCase):
    def test_primer_turno_segundo_semestre_puede_usar_tarde_por_docente_parcial(self):
        from solver_horarios.planificacion import bandas_cohorte

        ctx, oferta = _contexto(semestre_num=2, turno=1)
        oferta.id_docente_tec = 1
        ctx.docentes[1] = Docente(
            id_docente=1,
            nombre="Docente parcial",
            tipo_contrato="TIEMPO PARCIAL",
            horas_meta=19,
            usa_restriccion=True,
            estado="A",
            disponibilidad={0: ((810, 990),)},
        )

        self.assertEqual(
            bandas_cohorte(ctx, oferta), [(465, 765), (765, 1080)]
        )

    def test_primer_turno_no_se_mueve_a_tarde_por_docente_completo(self):
        from solver_horarios.planificacion import bandas_cohorte

        ctx, oferta = _contexto(semestre_num=2, turno=1)
        oferta.id_docente_tec = 1
        ctx.docentes[1] = Docente(
            id_docente=1,
            nombre="Docente completo",
            tipo_contrato="TIEMPO COMPLETO",
            horas_meta=36,
            usa_restriccion=True,
            estado="A",
            disponibilidad={0: ((810, 990),)},
        )

        self.assertEqual(bandas_cohorte(ctx, oferta), [(465, 765)])

    def test_primer_turno_se_mantiene_manana_si_docente_parcial_tiene_ventana(self):
        from solver_horarios.planificacion import bandas_cohorte

        ctx, oferta = _contexto(semestre_num=2, turno=1)
        oferta.id_docente_tec = 1
        ctx.docentes[1] = Docente(
            id_docente=1,
            nombre="Docente parcial",
            tipo_contrato="TIEMPO PARCIAL",
            horas_meta=19,
            usa_restriccion=True,
            estado="A",
            disponibilidad={0: ((465, 600),)},
        )

        self.assertEqual(bandas_cohorte(ctx, oferta), [(465, 765)])

    def test_tercer_semestre_turno_1_permite_manana_tarde_y_noche(self):
        """Regresión: la cohorte debe poder caer a tarde o noche si la mañana no alcanza."""
        from solver_horarios.planificacion import bandas_cohorte

        ctx, oferta = _contexto(semestre_num=3, turno=1)
        self.assertEqual(
            bandas_cohorte(ctx, oferta),
            [(465, 765), (765, 1080), (1080, 1380)],
        )
        actividad = Actividad(
            uid=1,
            oferta=oferta,
            modalidad="TEC",
            semana_inicio=0,
            semana_fin=4,
            horas_academicas=3,
            duracion_min=135,
            docente_id=None,
            ambientes=(),
        )
        pares = generar_pares_permitidos(ctx, actividad)
        inicios = {inicio for _, inicio in pares}
        self.assertTrue(any(inicio < 765 for inicio in inicios))
        self.assertTrue(any(765 <= inicio < 1080 for inicio in inicios))
        self.assertTrue(any(inicio >= 1080 for inicio in inicios))
        # Ningún bloque puede cruzar los límites de las bandas.
        for _, inicio in pares:
            self.assertTrue(
                inicio + 135 <= 765
                or (inicio >= 765 and inicio + 135 <= 1080)
                or inicio >= 1080
            )

    def test_segundo_semestre_primer_turno_solo_manana(self):
        ctx, oferta = _contexto(semestre_num=2, turno=1)
        from solver_horarios.planificacion import bandas_cohorte

        self.assertEqual(bandas_cohorte(ctx, oferta), [(465, 765)])
        actividad = Actividad(
            uid=1,
            oferta=oferta,
            modalidad="TEC",
            semana_inicio=0,
            semana_fin=4,
            horas_academicas=3,
            duracion_min=135,
            docente_id=None,
            ambientes=(),
        )
        self.assertTrue(
            all(inicio + actividad.duracion_min <= 765
                for _, inicio in generar_pares_permitidos(ctx, actividad))
        )
        ctx.permitir_banda_alterna = True
        self.assertEqual(bandas_cohorte(ctx, oferta), [(465, 765)])
        self.assertTrue(
            all(inicio + actividad.duracion_min <= 765
                for _, inicio in generar_pares_permitidos(ctx, actividad))
        )

    def test_segundo_semestre_manana_admite_inicios_en_toda_la_ventana(self):
        ctx, oferta = _contexto(semestre_num=2, turno=1)
        ctx.franja = replace(ctx.franja, inicio_min=420)
        actividad = Actividad(
            uid=1,
            oferta=oferta,
            modalidad="TEC",
            semana_inicio=0,
            semana_fin=4,
            horas_academicas=2,
            duracion_min=90,
            docente_id=None,
            ambientes=(),
        )

        pares = generar_pares_permitidos(ctx, actividad)
        inicios = {inicio for _, inicio in pares}

        self.assertIn(465, inicios)
        self.assertIn(600, inicios)
        self.assertTrue(all(465 <= inicio and inicio + 90 <= 765 for inicio in inicios))

    def test_segundo_turno_segundo_semestre_tiene_manana_alternativa(self):
        from solver_horarios.planificacion import bandas_cohorte

        ctx, oferta = _contexto(semestre_num=2, turno=2)
        self.assertEqual(
            bandas_cohorte(ctx, oferta),
            [(765, 1080), (1080, 1260), (465, 765)],
        )

        actividad = Actividad(
            uid=1,
            oferta=oferta,
            modalidad="TEC",
            semana_inicio=0,
            semana_fin=4,
            horas_academicas=3,
            duracion_min=135,
            docente_id=None,
            ambientes=(),
        )
        pares = generar_pares_permitidos(ctx, actividad)
        inicios = {inicio for _, inicio in pares}
        self.assertIn(810, inicios)
        self.assertTrue(any(inicio < 765 for inicio in inicios))

    def test_solver_prefiere_tarde_para_segundo_turno_segundo_semestre(self):
        from ortools.sat.python import cp_model

        from solver_horarios.modelo_variables import Construccion

        ctx, oferta = _contexto(semestre_num=2, turno=2)
        actividad = Actividad(
            uid=1,
            oferta=oferta,
            modalidad="TEC",
            semana_inicio=0,
            semana_fin=4,
            horas_academicas=2,
            duracion_min=90,
            docente_id=None,
            ambientes=(),
        )
        construccion = Construccion(ctx=ctx, actividades=[actividad])
        solver = cp_model.CpSolver()
        estado = solver.Solve(construccion.construir())

        self.assertIn(estado, (cp_model.OPTIMAL, cp_model.FEASIBLE))
        self.assertGreaterEqual(solver.Value(construccion.inicio[actividad.uid]), 765)

    def test_tercer_semestre_no_permite_primera_clase_despues_de_20(self):
        from ortools.sat.python import cp_model

        from solver_horarios.modelo_variables import Construccion

        ctx, oferta = _contexto(semestre_num=3, turno=1)
        ctx.franja = replace(ctx.franja, inicio_min=1080)
        actividad = Actividad(
            uid=1,
            oferta=oferta,
            modalidad="TEC",
            semana_inicio=0,
            semana_fin=4,
            horas_academicas=3,
            duracion_min=135,
            docente_id=None,
            ambientes=(),
        )
        construccion = Construccion(ctx=ctx, actividades=[actividad])
        model = construccion.construir()
        model.Add(construccion.inicio[actividad.uid] >= 1215)
        solver = cp_model.CpSolver()

        self.assertEqual(solver.Solve(model), cp_model.INFEASIBLE)

    def test_tercer_turno_puede_usar_tarde(self):
        from solver_horarios.planificacion import bandas_cohorte

        ctx, oferta = _contexto(semestre_num=2, turno=3)
        self.assertEqual(
            bandas_cohorte(ctx, oferta), [(1080, 1380), (765, 1080)]
        )

        ctx, oferta = _contexto(semestre_num=1, turno=1)
        self.assertEqual(
            bandas_cohorte(ctx, oferta), [(765, 1080), (1080, 1380)]
        )

        ctx, oferta = _contexto(semestre_num=3, turno=2)
        self.assertEqual(
            bandas_cohorte(ctx, oferta),
            [(765, 1080), (1080, 1260), (465, 765)],
        )

        ctx, oferta = _contexto(semestre_num=4, turno=1)
        self.assertEqual(
            bandas_cohorte(ctx, oferta),
            [(765, 1080), (1080, 1380)],
        )

    def test_virtual_puede_usar_cualquier_banda(self):
        from solver_horarios.planificacion import bandas_virtuales

        ctx, oferta = _contexto(semestre_num=2, turno=1)
        virtual = Actividad(
            uid=1,
            oferta=oferta,
            modalidad="VIR",
            semana_inicio=0,
            semana_fin=4,
            horas_academicas=2,
            duracion_min=90,
            docente_id=None,
            ambientes=(),
        )
        self.assertEqual(
            bandas_virtuales(ctx, oferta),
            [(465, 765), (765, 1080), (1080, 1380)],
        )
        inicios = {inicio for _, inicio in generar_pares_permitidos(ctx, virtual)}
        self.assertTrue(any(inicio < 765 for inicio in inicios))
        self.assertTrue(any(765 <= inicio < 1080 for inicio in inicios))
        self.assertTrue(any(inicio >= 1080 for inicio in inicios))

    def test_virtual_segundo_turno_cierra_a_las_21(self):
        from solver_horarios.planificacion import bandas_virtuales

        ctx, oferta = _contexto(semestre_num=2, turno=2)
        virtual = Actividad(
            uid=1,
            oferta=oferta,
            modalidad="VIR",
            semana_inicio=0,
            semana_fin=4,
            horas_academicas=2,
            duracion_min=90,
            docente_id=None,
            ambientes=(),
        )
        self.assertEqual(
            bandas_virtuales(ctx, oferta),
            [(465, 765), (765, 1080), (1080, 1260)],
        )
        pares = generar_pares_permitidos(ctx, virtual)
        self.assertTrue(
            all(
                inicio + 90 <= 1260
                for _, inicio in pares
                if inicio >= 1080
            )
        )

    def test_virtual_cerca_de_presencial_paga_penalizacion(self):
        from ortools.sat.python import cp_model

        from solver_horarios.modelo_variables import Construccion

        ctx, oferta = _contexto(semestre_num=3, turno=1)
        teoria = Actividad(
            uid=1, oferta=oferta, modalidad="TEC", semana_inicio=0, semana_fin=4,
            horas_academicas=2, duracion_min=90, docente_id=None, ambientes=(),
        )
        virtual = replace(teoria, uid=2, modalidad="VIR")
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5
        objetivos: dict[str, float] = {}
        for etiqueta, (dia_tec, inicio_tec, dia_vir, inicio_vir) in (
            ("cerca", (0, 480, 0, 585)),
            ("lejos", (0, 480, 1, 480)),
        ):
            construccion = Construccion(ctx=ctx, actividades=[teoria, virtual])
            modelo = construccion.construir()
            modelo.Add(construccion.dia[teoria.uid] == dia_tec)
            modelo.Add(construccion.inicio[teoria.uid] == inicio_tec)
            modelo.Add(construccion.dia[virtual.uid] == dia_vir)
            modelo.Add(construccion.inicio[virtual.uid] == inicio_vir)
            estado = solver.Solve(modelo)
            self.assertIn(estado, (cp_model.OPTIMAL, cp_model.FEASIBLE))
            objetivos[etiqueta] = solver.ObjectiveValue()

        self.assertGreaterEqual(
            objetivos["cerca"] - objetivos["lejos"],
            PENALIZACION_VIR_CERCANIA - 1_000,
        )

    def test_virtual_se_prefiere_lejos_de_la_carga_presencial(self):
        from ortools.sat.python import cp_model

        from solver_horarios.modelo_variables import Construccion

        ctx, oferta = _contexto(semestre_num=3, turno=1)
        teoria = Actividad(
            uid=1, oferta=oferta, modalidad="TEC", semana_inicio=0, semana_fin=4,
            horas_academicas=2, duracion_min=90, docente_id=None, ambientes=(),
        )
        virtual = replace(teoria, uid=2, modalidad="VIR")
        construccion = Construccion(ctx=ctx, actividades=[teoria, virtual])
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5
        solver.parameters.num_search_workers = 1
        estado = solver.Solve(construccion.construir())

        self.assertIn(estado, (cp_model.OPTIMAL, cp_model.FEASIBLE))
        dia_teoria = solver.Value(construccion.dia[teoria.uid])
        inicio_teoria = solver.Value(construccion.inicio[teoria.uid])
        dia_virtual = solver.Value(construccion.dia[virtual.uid])
        inicio_virtual = solver.Value(construccion.inicio[virtual.uid])
        if dia_teoria == dia_virtual:
            distancia = max(
                inicio_teoria - (inicio_virtual + virtual.duracion_min),
                inicio_virtual - (inicio_teoria + teoria.duracion_min),
            )
            self.assertGreaterEqual(
                distancia,
                VIR_SEPARACION_PREFERIDA_MIN,
                "VIR debe quedar en otro día o suficientemente lejos de TEC.",
            )

    def test_validador_advierte_virtual_demasiado_cerca_de_presencial(self):
        from solver_horarios.modelo import _validar_distribucion_modalidades

        ctx, oferta = _contexto(semestre_num=3)
        teoria = Actividad(
            uid=1, oferta=oferta, modalidad="TEC", semana_inicio=0, semana_fin=4,
            horas_academicas=2, duracion_min=90, docente_id=None, ambientes=(),
        )
        virtual = replace(teoria, uid=2, modalidad="VIR")
        bloques = [
            BloqueProgramado(teoria, 0, 480, 570, None),
            BloqueProgramado(virtual, 0, 585, 675, None),
        ]

        problemas, advertencias = _validar_distribucion_modalidades(bloques)

        self.assertEqual(problemas, [])
        self.assertTrue(
            any(
                "carga presencial" in advertencia
                and str(VIR_SEPARACION_PREFERIDA_MIN) in advertencia
                for advertencia in advertencias
            )
        )

    def test_validador_rechaza_hueco_presencial_mayor_a_30_minutos(self):
        from solver_horarios.config import BloqueProgramado
        from solver_horarios.modelo import _validar_cohortes

        ctx, oferta = _contexto(semestre_num=3)
        primero = Actividad(
            uid=1, oferta=oferta, modalidad="TEC", semana_inicio=0, semana_fin=4,
            horas_academicas=1, duracion_min=45, docente_id=None, ambientes=(),
        )
        segundo = replace(primero, uid=2, modalidad="TAL")
        bloques = [
            BloqueProgramado(primero, 0, 480, 525, None),
            BloqueProgramado(segundo, 0, 570, 615, None),
        ]

        problemas, _ = _validar_cohortes(ctx, bloques)

        self.assertTrue(any("hueco presencial de 45 min" in p for p in problemas))

    def test_validador_limita_jornada_real_de_cohorte_a_ocho_horas(self):
        from solver_horarios.config import BloqueProgramado
        from solver_horarios.modelo import _validar_cohortes

        ctx, oferta = _contexto(semestre_num=3)
        primero = Actividad(
            uid=1, oferta=oferta, modalidad="VIR", semana_inicio=0, semana_fin=4,
            horas_academicas=1, duracion_min=45, docente_id=None, ambientes=(),
        )
        segundo = replace(primero, uid=2)
        bloques = [
            BloqueProgramado(primero, 0, 465, 510, None),
            BloqueProgramado(segundo, 0, 945, 990, None),
        ]

        problemas, _ = _validar_cohortes(ctx, bloques)

        self.assertTrue(any("jornada de 525 min" in problema for problema in problemas))

    def test_validador_rechaza_corte_entre_turnos_mayor_a_una_hora(self):
        from solver_horarios.config import BloqueProgramado
        from solver_horarios.modelo import _validar_cohortes

        ctx, oferta = _contexto(semestre_num=3)
        primero = Actividad(
            uid=1, oferta=oferta, modalidad="TEC", semana_inicio=0, semana_fin=4,
            horas_academicas=2, duracion_min=90, docente_id=None, ambientes=(),
        )
        segundo = replace(primero, uid=2, modalidad="TAL")
        bloques = [
            BloqueProgramado(primero, 0, 465, 555, None),
            BloqueProgramado(segundo, 0, 765, 855, None),
        ]

        problemas, _ = _validar_cohortes(ctx, bloques)

        self.assertTrue(any("corte de 210 min" in p for p in problemas))

    def test_validador_acepta_corte_entre_turnos_de_media_hora(self):
        from solver_horarios.config import BloqueProgramado
        from solver_horarios.modelo import _validar_cohortes

        ctx, oferta = _contexto(semestre_num=3)
        primero = Actividad(
            uid=1, oferta=oferta, modalidad="TEC", semana_inicio=0, semana_fin=4,
            horas_academicas=2, duracion_min=90, docente_id=None, ambientes=(),
        )
        segundo = replace(primero, uid=2, modalidad="TAL")
        bloques = [
            BloqueProgramado(primero, 0, 600, 690, None),
            BloqueProgramado(segundo, 0, 720, 810, None),
        ]

        problemas, _ = _validar_cohortes(ctx, bloques)

        self.assertFalse(any("corte de" in p for p in problemas))

    def test_solver_rechaza_corte_entre_turnos_mayor_a_una_hora(self):
        from ortools.sat.python import cp_model

        from solver_horarios.modelo_variables import Construccion

        ctx, oferta = _contexto(semestre_num=3)
        primera = Actividad(
            uid=1, oferta=oferta, modalidad="TEC", semana_inicio=0, semana_fin=4,
            horas_academicas=2, duracion_min=90, docente_id=None, ambientes=(),
        )
        segunda = replace(primera, uid=2, modalidad="TAL")
        construccion = Construccion(ctx=ctx, actividades=[primera, segunda])
        modelo = construccion.construir()
        modelo.Add(construccion.dia[primera.uid] == 0)
        modelo.Add(construccion.dia[segunda.uid] == 0)
        modelo.Add(construccion.inicio[primera.uid] == 465)
        modelo.Add(construccion.inicio[segunda.uid] == 765)
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5
        estado = solver.Solve(modelo)

        self.assertEqual(estado, cp_model.INFEASIBLE)

    def test_solver_acepta_corte_entre_turnos_de_media_hora(self):
        from ortools.sat.python import cp_model

        from solver_horarios.modelo_variables import Construccion

        ctx, oferta = _contexto(semestre_num=3)
        primera = Actividad(
            uid=1, oferta=oferta, modalidad="TEC", semana_inicio=0, semana_fin=4,
            horas_academicas=2, duracion_min=90, docente_id=None, ambientes=(),
        )
        segunda = replace(primera, uid=2, modalidad="TAL")
        construccion = Construccion(ctx=ctx, actividades=[primera, segunda])
        modelo = construccion.construir()
        modelo.Add(construccion.dia[primera.uid] == 0)
        modelo.Add(construccion.dia[segunda.uid] == 0)
        modelo.Add(construccion.inicio[primera.uid] == 645)
        modelo.Add(construccion.inicio[segunda.uid] == 765)
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5
        estado = solver.Solve(modelo)

        self.assertIn(estado, (cp_model.OPTIMAL, cp_model.FEASIBLE))

    def test_validador_reporta_bandas_mixtas_como_advertencia(self):
        from solver_horarios.config import BloqueProgramado
        from solver_horarios.modelo import _validar_distribucion_modalidades

        ctx, oferta = _contexto(semestre_num=3)
        primero = Actividad(
            uid=1, oferta=oferta, modalidad="TEC", semana_inicio=0, semana_fin=4,
            horas_academicas=2, duracion_min=90, docente_id=None, ambientes=(),
        )
        segundo = replace(primero, uid=2, modalidad="TAL")
        bloques = [
            BloqueProgramado(primero, 0, 465, 555, None),
            BloqueProgramado(segundo, 0, 765, 855, None),
        ]

        problemas, advertencias = _validar_distribucion_modalidades(bloques)

        self.assertEqual(problemas, [])
        self.assertTrue(
            any("combinan turnos" in advertencia for advertencia in advertencias)
        )

    def test_validador_no_bloquea_dias_balance_ni_orden_tec_tal(self):
        from solver_horarios.config import BloqueProgramado
        from solver_horarios.modelo import _validar_distribucion_modalidades

        ctx, oferta = _contexto(semestre_num=3)
        tec_1 = Actividad(
            uid=1, oferta=oferta, modalidad="TEC", semana_inicio=0, semana_fin=4,
            horas_academicas=2, duracion_min=90, docente_id=None, ambientes=(),
        )
        tec_2 = replace(tec_1, uid=2, horas_academicas=1, duracion_min=45)
        tec_3 = replace(tec_1, uid=4, horas_academicas=1, duracion_min=45)
        tal = replace(tec_1, uid=3, modalidad="TAL", horas_academicas=1, duracion_min=45)
        bloques = [
            BloqueProgramado(tec_1, 0, 600, 690, None),
            BloqueProgramado(tec_2, 1, 600, 645, None),
            BloqueProgramado(tal, 0, 480, 525, None),
            BloqueProgramado(tec_3, 2, 600, 645, None),
        ]

        problemas, advertencias = _validar_distribucion_modalidades(bloques)

        self.assertEqual(problemas, [])
        self.assertEqual(advertencias, [])

    def test_cuarto_semestre_respeta_orden_de_turno(self):
        from solver_horarios.planificacion import bandas_cohorte

        ctx_t1, oferta_t1 = _contexto(semestre_num=4, turno=1)
        ctx_t2, oferta_t2 = _contexto(semestre_num=4, turno=2)
        self.assertEqual(
            bandas_cohorte(ctx_t1, oferta_t1),
            [(765, 1080), (1080, 1380)],
        )
        self.assertEqual(
            bandas_cohorte(ctx_t2, oferta_t2),
            [(765, 1080), (1080, 1260)],
        )

    def test_emp_comparte_dia_con_clase_sin_aula_ni_docente(self):
        from solver_horarios.config import BloqueProgramado
        from solver_horarios.modelo import _validar_modalidades, _validar_solapamientos

        ctx, oferta = _contexto(semestre_num=3)
        ctx.ambientes[10] = Ambiente(
            id_ambiente=10,
            codigo="A-101",
            id_tipo=1,
            tipo="AULA",
            aforo=40,
            estado="DISPONIBLE",
            id_sede=1,
        )
        empresa = Actividad(
            uid=1, oferta=oferta, modalidad="EMP", semana_inicio=0, semana_fin=4,
            horas_academicas=2, duracion_min=90, docente_id=None, ambientes=(),
        )
        clase = replace(
            empresa, uid=2, modalidad="TEC", horas_academicas=1,
            duracion_min=45, ambientes=(10,),
        )
        bloques = [
            BloqueProgramado(empresa, 0, 480, 570, None),
            BloqueProgramado(clase, 0, 570, 615, 10),
        ]

        self.assertEqual(_validar_modalidades(ctx, bloques)[0], [])
        self.assertEqual(_validar_solapamientos(bloques), [])


class PruebasPreferenciaBanda(unittest.TestCase):
    @staticmethod
    def _actividad(oferta, uid: int = 1) -> Actividad:
        return Actividad(
            uid=uid,
            oferta=oferta,
            modalidad="TEC",
            semana_inicio=0,
            semana_fin=4,
            horas_academicas=2,
            duracion_min=90,
            docente_id=None,
            ambientes=(),
        )

    def test_turno_de_tarde_noche_no_penaliza_la_noche(self):
        from ortools.sat.python import cp_model

        from solver_horarios.modelo_variables import Construccion

        ctx, oferta = _contexto(semestre_num=4, turno=2)
        actividad = self._actividad(oferta)
        construccion = Construccion(ctx=ctx, actividades=[actividad])
        modelo = construccion.construir()
        modelo.Add(construccion.inicio[actividad.uid] >= 1080)
        solver = cp_model.CpSolver()
        estado = solver.Solve(modelo)

        self.assertIn(estado, (cp_model.OPTIMAL, cp_model.FEASIBLE))
        # A partir de IV no hay banda de mañana: solo tarde y noche, ambas
        # preferentes. No se crea variable de penalización de banda secundaria.
        self.assertNotIn(actividad.uid, construccion.preferencia_banda)

    def test_segundo_semestre_turno_2_penaliza_la_manana(self):
        from ortools.sat.python import cp_model

        from solver_horarios.modelo_variables import Construccion

        ctx, oferta = _contexto(semestre_num=2, turno=2)
        actividad = self._actividad(oferta)
        construccion = Construccion(ctx=ctx, actividades=[actividad])
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5
        estado = solver.Solve(construccion.construir())
        self.assertIn(estado, (cp_model.OPTIMAL, cp_model.FEASIBLE))
        self.assertIn(actividad.uid, construccion.preferencia_banda)
        self.assertGreaterEqual(solver.Value(construccion.inicio[actividad.uid]), 765)
        objetivo_preferente = solver.ObjectiveValue()

        alterna = Construccion(ctx=ctx, actividades=[actividad])
        modelo = alterna.construir()
        modelo.Add(alterna.inicio[actividad.uid] < 765)
        estado = solver.Solve(modelo)
        self.assertIn(estado, (cp_model.OPTIMAL, cp_model.FEASIBLE))
        self.assertGreaterEqual(
            solver.ObjectiveValue() - objetivo_preferente,
            PENALIZACION_DESVIACION_FRANJA - 1_000,
        )

    def test_objetivo_penaliza_banda_secundaria(self):
        from ortools.sat.python import cp_model

        from solver_horarios.modelo_variables import Construccion

        ctx, oferta = _contexto(semestre_num=3, turno=1)
        actividad = self._actividad(oferta)

        construccion = Construccion(ctx=ctx, actividades=[actividad])
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5
        estado = solver.Solve(construccion.construir())
        self.assertIn(estado, (cp_model.OPTIMAL, cp_model.FEASIBLE))
        self.assertLess(solver.Value(construccion.inicio[actividad.uid]), 765)
        objetivo_primaria = solver.ObjectiveValue()

        # Forzar la banda secundaria debe costar al menos la penalización
        # explícita, aunque el inicio sea más tardío.
        alterna = Construccion(ctx=ctx, actividades=[actividad])
        modelo = alterna.construir()
        modelo.Add(alterna.inicio[actividad.uid] >= 765)
        estado = solver.Solve(modelo)
        self.assertIn(estado, (cp_model.OPTIMAL, cp_model.FEASIBLE))
        self.assertGreaterEqual(
            solver.ObjectiveValue() - objetivo_primaria,
            PENALIZACION_DESVIACION_FRANJA,
        )

    def test_disponibilidad_dura_y_banda_primaria(self):
        from ortools.sat.python import cp_model

        from solver_horarios.modelo_variables import Construccion

        ctx, oferta = _contexto(semestre_num=3, turno=1)
        oferta.id_docente_tec = 1
        ctx.docentes[1] = Docente(
            id_docente=1,
            nombre="Docente con franja amplia",
            tipo_contrato="TIEMPO COMPLETO",
            horas_meta=36,
            usa_restriccion=True,
            estado="A",
            disponibilidad={dia: ((465, 900),) for dia in ctx.dias},
        )
        actividad = self._actividad(oferta)
        actividad = replace(actividad, docente_id=1)

        construccion = Construccion(ctx=ctx, actividades=[actividad])
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5
        estado = solver.Solve(construccion.construir())
        self.assertIn(estado, (cp_model.OPTIMAL, cp_model.FEASIBLE))
        self.assertIn(actividad.uid, construccion.preferencia_banda)
        self.assertLess(solver.Value(construccion.inicio[actividad.uid]), 765)
        inicio = solver.Value(construccion.inicio[actividad.uid])
        self.assertGreaterEqual(inicio, 465)
        self.assertLessEqual(inicio + actividad.duracion_min, 900)
        objetivo_primaria = solver.ObjectiveValue()

        alterna = Construccion(ctx=ctx, actividades=[actividad])
        modelo = alterna.construir()
        modelo.Add(alterna.inicio[actividad.uid] >= 765)
        estado = solver.Solve(modelo)
        self.assertIn(estado, (cp_model.OPTIMAL, cp_model.FEASIBLE))
        self.assertGreaterEqual(
            solver.ObjectiveValue() - objetivo_primaria,
            PENALIZACION_DESVIACION_FRANJA,
        )
        inicio_alterno = solver.Value(alterna.inicio[actividad.uid])
        self.assertLessEqual(inicio_alterno + actividad.duracion_min, 900)

    def test_fuera_de_disponibilidad_es_infactible(self):
        from ortools.sat.python import cp_model

        from solver_horarios.modelo_variables import Construccion

        ctx, oferta = _contexto(semestre_num=3, turno=1)
        oferta.id_docente_tec = 1
        ctx.docentes[1] = Docente(
            id_docente=1,
            nombre="Docente de prueba",
            tipo_contrato="TIEMPO COMPLETO",
            horas_meta=36,
            usa_restriccion=True,
            estado="A",
            disponibilidad={0: ((465, 600),)},
        )
        actividad = replace(self._actividad(oferta), docente_id=1)
        construccion = Construccion(ctx=ctx, actividades=[actividad])
        modelo = construccion.construir()
        modelo.Add(construccion.inicio[actividad.uid] >= 600)

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5
        estado = solver.Solve(modelo)
        self.assertEqual(estado, cp_model.INFEASIBLE)

    def test_sin_restriccion_activa_ignora_disponibilidad(self):
        ctx, oferta = _contexto(semestre_num=3, turno=1)
        oferta.id_docente_tec = 1
        ctx.docentes[1] = Docente(
            id_docente=1,
            nombre="Docente sin restricción activa",
            tipo_contrato="TIEMPO COMPLETO",
            horas_meta=36,
            usa_restriccion=False,
            estado="A",
            disponibilidad={0: ((465, 600),)},
        )
        actividad = replace(self._actividad(oferta), docente_id=1)

        pares = generar_pares_permitidos(ctx, actividad)
        self.assertTrue(any(inicio >= 600 for _, inicio in pares))

    def test_validacion_modalidades_reporta_fuera_de_disponibilidad(self):
        ctx, oferta = _contexto(semestre_num=3)
        ctx.ambientes[10] = Ambiente(
            id_ambiente=10,
            codigo="A-101",
            id_tipo=1,
            tipo="AULA",
            aforo=40,
            estado="DISPONIBLE",
            id_sede=1,
        )
        ctx.docentes[1] = Docente(
            id_docente=1,
            nombre="Docente estricto",
            tipo_contrato="TIEMPO COMPLETO",
            horas_meta=36,
            usa_restriccion=True,
            estado="A",
            disponibilidad={0: ((465, 600),)},
        )
        actividad = replace(
            self._actividad(oferta),
            docente_id=1,
            ambientes=(10,),
        )
        bloques = [BloqueProgramado(actividad, 0, 600, 690, 10)]

        problemas, advertencias = _validar_modalidades(ctx, bloques)

        self.assertTrue(
            any("disponibilidad" in problema for problema in problemas)
        )
        self.assertEqual(advertencias, [])

    def test_docentes_tiempo_parcial_se_reconocen_para_priorizar(self):
        from solver_horarios.modelo_variables import Construccion

        ctx, oferta = _contexto(semestre_num=3, turno=1)
        ctx.docentes = {
            1: Docente(
                id_docente=1,
                nombre="Docente parcial",
                tipo_contrato="TIEMPO PARCIAL",
                horas_meta=19,
                usa_restriccion=False,
                estado="A",
            ),
            2: Docente(
                id_docente=2,
                nombre="Docente completo",
                tipo_contrato="TIEMPO COMPLETO",
                horas_meta=36,
                usa_restriccion=False,
                estado="A",
            ),
        }
        actividad = replace(self._actividad(oferta), docente_id=1)
        construccion = Construccion(ctx=ctx, actividades=[actividad])

        self.assertTrue(construccion._docente_tiempo_parcial(1))
        self.assertFalse(construccion._docente_tiempo_parcial(2))
        self.assertFalse(construccion._docente_tiempo_parcial(None))
        construccion.construir()

    def _resolver_dos_actividades(
        self,
        semanas_primera: tuple[int, int],
        semanas_segunda: tuple[int, int],
        *,
        segunda_en_tarde: bool,
    ):
        from ortools.sat.python import cp_model

        from solver_horarios.modelo_variables import Construccion

        ctx, oferta = _contexto(semestre_num=3, turno=1)
        ctx.docentes[1] = Docente(
            id_docente=1,
            nombre="Docente de prueba",
            tipo_contrato="TIEMPO COMPLETO",
            horas_meta=36,
            usa_restriccion=False,
            estado="A",
            disponibilidad={},
        )
        primera = replace(
            self._actividad(oferta, uid=1),
            docente_id=1,
            semana_inicio=semanas_primera[0],
            semana_fin=semanas_primera[1],
        )
        segunda = replace(
            self._actividad(oferta, uid=2),
            docente_id=1,
            semana_inicio=semanas_segunda[0],
            semana_fin=semanas_segunda[1],
        )
        construccion = Construccion(ctx=ctx, actividades=[primera, segunda])
        modelo = construccion.construir()
        modelo.Add(construccion.dia[primera.uid] == 0)
        modelo.Add(construccion.dia[segunda.uid] == 0)
        modelo.Add(construccion.banda_horaria[primera.uid] == 0)
        if segunda_en_tarde:
            modelo.Add(construccion.banda_horaria[segunda.uid] != 0)
        else:
            modelo.Add(construccion.banda_horaria[segunda.uid] == 0)
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5
        estado = solver.Solve(modelo)
        self.assertIn(estado, (cp_model.OPTIMAL, cp_model.FEASIBLE))
        return oferta, construccion, solver

    def test_penalizacion_doble_turno_es_mas_severa_que_banda(self):
        self.assertGreater(
            PENALIZACION_DOBLE_TURNO_DIARIO,
            PENALIZACION_DESVIACION_FRANJA,
        )
        self.assertGreater(
            PENALIZACION_DOBLE_TURNO_DIARIO,
            PENALIZACION_DOBLE_TURNO_COHORTE,
        )

    def test_dia_partido_marca_docente_y_cohorte(self):
        oferta, construccion, solver = self._resolver_dos_actividades(
            (0, 4), (0, 4), segunda_en_tarde=True
        )

        self.assertEqual(
            solver.Value(construccion.doble_turno_docente[(1, 0)]), 1
        )
        self.assertEqual(
            solver.Value(construccion.doble_turno_cohorte[(oferta.cohorte, 0)]),
            1,
        )

    def test_objetivo_incluye_penalizacion_de_dia_partido(self):
        from ortools.sat.python import cp_model

        from solver_horarios.modelo_variables import Construccion

        ctx, oferta = _contexto(semestre_num=3, turno=1)
        ctx.docentes[1] = Docente(
            id_docente=1,
            nombre="Docente de prueba",
            tipo_contrato="TIEMPO COMPLETO",
            horas_meta=36,
            usa_restriccion=False,
            estado="A",
            disponibilidad={},
        )
        primera = replace(self._actividad(oferta, uid=1), docente_id=1)
        segunda = replace(self._actividad(oferta, uid=2), docente_id=1)
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5
        objetivos: dict[str, float] = {}
        for etiqueta, banda_segunda in (("limpio", 0), ("partido", 1)):
            construccion = Construccion(ctx=ctx, actividades=[primera, segunda])
            modelo = construccion.construir()
            modelo.Add(construccion.dia[primera.uid] == 0)
            modelo.Add(construccion.dia[segunda.uid] == 0)
            modelo.Add(construccion.banda_horaria[primera.uid] == 0)
            if banda_segunda == 0:
                modelo.Add(construccion.banda_horaria[segunda.uid] == 0)
            else:
                modelo.Add(construccion.banda_horaria[segunda.uid] != 0)
            estado = solver.Solve(modelo)
            self.assertIn(estado, (cp_model.OPTIMAL, cp_model.FEASIBLE))
            objetivos[etiqueta] = solver.ObjectiveValue()

        self.assertGreaterEqual(
            objetivos["partido"] - objetivos["limpio"],
            PENALIZACION_DOBLE_TURNO_DIARIO,
        )

    def test_dia_limpio_no_marca_doble_turno(self):
        oferta, construccion, solver = self._resolver_dos_actividades(
            (0, 4), (0, 4), segunda_en_tarde=False
        )

        self.assertEqual(
            solver.Value(construccion.doble_turno_docente[(1, 0)]), 0
        )
        self.assertEqual(
            solver.Value(construccion.doble_turno_cohorte[(oferta.cohorte, 0)]),
            0,
        )

    def test_semanas_disjuntas_no_marcan_doble_turno(self):
        oferta, construccion, _solver = self._resolver_dos_actividades(
            (0, 2), (2, 4), segunda_en_tarde=True
        )

        self.assertNotIn((1, 0), construccion.doble_turno_docente)
        self.assertNotIn((oferta.cohorte, 0), construccion.doble_turno_cohorte)


class PruebasContinuidadAula(unittest.TestCase):
    def test_bloques_consecutivos_mismo_docente_prefieren_misma_aula_clas(self):
        from ortools.sat.python import cp_model

        from solver_horarios.modelo_variables import Construccion

        ctx, oferta = _contexto(semestre_num=3, turno=1)
        ctx.ambientes = {
            10: Ambiente(10, "A-101", 1, "AULA", 40, "DISPONIBLE", 1),
            11: Ambiente(11, "A-102", 1, "AULA", 40, "DISPONIBLE", 1),
        }
        ctx.ambientes_por_sede = {1: (10, 11)}
        ctx.docentes[1] = Docente(
            id_docente=1,
            nombre="Docente de prueba",
            tipo_contrato="TIEMPO COMPLETO",
            horas_meta=36,
            usa_restriccion=False,
            estado="A",
            disponibilidad={},
        )
        primera = Actividad(
            uid=1,
            oferta=oferta,
            modalidad="TEC",
            semana_inicio=0,
            semana_fin=2,
            horas_academicas=2,
            duracion_min=90,
            docente_id=1,
            ambientes=(10, 11),
        )
        segunda = replace(primera, uid=2)
        construccion = Construccion(ctx=ctx, actividades=[primera, segunda])
        construccion._crear_variables()
        construccion._crear_selectores_ambiente()
        modelo = construccion.model
        for actividad, inicio in ((primera, 465), (segunda, 570)):
            modelo.Add(construccion.dia[actividad.uid] == 0)
            modelo.Add(construccion.inicio[actividad.uid] == inicio)
        for id_ambiente, selector in construccion.selector_ambiente[primera.uid]:
            if id_ambiente == 10:
                modelo.Add(selector == 1)

        indicadores = []
        for actividad in (primera, segunda):
            indicador = modelo.NewBoolVar(f"aula_test_{actividad.uid}")
            modelo.Add(indicador == 1)
            indicadores.append(indicador)
        construccion._agregar_circuito_continuidad(
            [primera, segunda], indicadores, "aula_test"
        )
        # Sin la regla de continuidad, el objetivo preferiría cambiar a 11.
        for id_ambiente, selector in construccion.selector_ambiente[segunda.uid]:
            if id_ambiente == 11:
                construccion.terminos_objetivo.append(selector * 1_000)
        modelo.Minimize(sum(construccion.terminos_objetivo))

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5
        solver.parameters.num_search_workers = 1
        estado = solver.Solve(modelo)

        self.assertIn(estado, (cp_model.OPTIMAL, cp_model.FEASIBLE))
        valores = {
            id_ambiente: solver.Value(selector)
            for id_ambiente, selector in construccion.selector_ambiente[segunda.uid]
        }
        self.assertEqual(valores[10], 1)
        self.assertEqual(valores[11], 0)

    def test_prioridad_por_disponibilidad_mas_cerrada(self):
        from solver_horarios.modelo_variables import Construccion

        ctx, oferta = _contexto(semestre_num=3, turno=1)
        ctx.docentes = {
            1: Docente(
                id_docente=1,
                nombre="Docente con ventana corta",
                tipo_contrato="TIEMPO COMPLETO",
                horas_meta=36,
                usa_restriccion=True,
                estado="A",
                disponibilidad={0: ((465, 600),)},
            ),
            2: Docente(
                id_docente=2,
                nombre="Docente con ventana amplia",
                tipo_contrato="TIEMPO COMPLETO",
                horas_meta=36,
                usa_restriccion=True,
                estado="A",
                disponibilidad={0: ((465, 765),)},
            ),
        }
        primera = Actividad(
            uid=1,
            oferta=oferta,
            modalidad="TEC",
            semana_inicio=0,
            semana_fin=2,
            horas_academicas=2,
            duracion_min=90,
            docente_id=1,
            ambientes=(),
        )
        segunda = replace(primera, uid=2, docente_id=2)
        construccion = Construccion(ctx=ctx, actividades=[primera, segunda])
        construccion._crear_variables()

        self.assertLess(
            construccion._clave_prioridad_docente(primera),
            construccion._clave_prioridad_docente(segunda),
        )


class PruebasContinuidadCursos(unittest.TestCase):
    def test_modelo_prohibe_intercalar_curso(self):
        from ortools.sat.python import cp_model

        from solver_horarios.modelo_variables import Construccion

        ctx, oferta_a = _contexto(semestre_num=3, turno=1)
        oferta_b = replace(
            oferta_a,
            id_programacion=2,
            curso=replace(oferta_a.curso, mat_cur="PCID-302", nombre="Curso B"),
        )
        ctx.ofertas = [oferta_a, oferta_b]
        a1 = Actividad(
            uid=1, oferta=oferta_a, modalidad="TEC", semana_inicio=0, semana_fin=4,
            horas_academicas=2, duracion_min=90, docente_id=None, ambientes=(),
        )
        b = replace(a1, uid=2, oferta=oferta_b)
        a2 = replace(a1, uid=3)
        construccion = Construccion(ctx=ctx, actividades=[a1, b, a2])
        modelo = construccion.construir()
        for actividad, inicio in ((a1, 465), (b, 570), (a2, 675)):
            modelo.Add(construccion.dia[actividad.uid] == 0)
            modelo.Add(construccion.inicio[actividad.uid] == inicio)
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5
        self.assertEqual(solver.Solve(modelo), cp_model.INFEASIBLE)

    def test_modelo_acepta_curso_contiguo(self):
        from ortools.sat.python import cp_model

        from solver_horarios.modelo_variables import Construccion

        ctx, oferta_a = _contexto(semestre_num=3, turno=1)
        oferta_b = replace(
            oferta_a,
            id_programacion=2,
            curso=replace(oferta_a.curso, mat_cur="PCID-302", nombre="Curso B"),
        )
        ctx.ofertas = [oferta_a, oferta_b]
        a1 = Actividad(
            uid=1, oferta=oferta_a, modalidad="TEC", semana_inicio=0, semana_fin=4,
            horas_academicas=2, duracion_min=90, docente_id=None, ambientes=(),
        )
        a2 = replace(a1, uid=3)
        b = replace(a1, uid=2, oferta=oferta_b)
        construccion = Construccion(ctx=ctx, actividades=[a1, a2, b])
        modelo = construccion.construir()
        for actividad, inicio in ((a1, 465), (a2, 570), (b, 675)):
            modelo.Add(construccion.dia[actividad.uid] == 0)
            modelo.Add(construccion.inicio[actividad.uid] == inicio)
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 5
        self.assertIn(solver.Solve(modelo), (cp_model.OPTIMAL, cp_model.FEASIBLE))


class PruebasUtilidades(unittest.TestCase):
    def test_numero_semestre(self):
        self.assertEqual(numero_semestre("II"), 2)
        self.assertEqual(numero_semestre("VI"), 6)
        self.assertEqual(numero_semestre("10"), 10)
        self.assertEqual(numero_semestre(""), 0)

    def test_orden_natural_de_codigos(self):
        self.assertLess(
            clave_natural_codigo("PIAD-221"), clave_natural_codigo("PIAD-222")
        )

    def test_grilla_y_formato(self):
        self.assertEqual(alinear_grilla(466), 480)
        self.assertEqual(formatear_hora(465), "07:45:00")


if __name__ == "__main__":
    unittest.main()
