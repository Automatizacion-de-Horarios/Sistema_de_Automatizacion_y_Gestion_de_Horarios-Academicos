"""Variables y restricciones CP-SAT del motor de horarios."""

from __future__ import annotations

import logging
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field

from ortools.sat.python import cp_model

from .actividades import generar_pares_permitidos
from .config import (
    BREAK_MIN,
    LONG_BREAK_MIN,
    LONG_BREAK_THRESHOLD,
    MAX_COHORT_CROSS_TURN_GAP_MIN,
    MAX_COHORT_DAILY_ACAD_HOURS,
    MAX_COHORT_DAILY_SPAN_MIN,
    MAX_COHORT_FIRST_CLASS_START_MIN,
    MAX_TEACHER_DAILY_ACAD_HOURS,
    MAX_TEACHER_DAILY_SPAN_MIN,
    MORNING_END_MIN,
    NIGHT_START_MIN,
    PENALIZACION_CAMBIO_AULA_CLAS,
    PENALIZACION_DESVIACION_FRANJA,
    PENALIZACION_DOBLE_TURNO_COHORTE,
    PENALIZACION_RECESO_30,
    PENALIZACION_DOBLE_TURNO_DIARIO,
    PENALIZACION_TEC_DIA_ADICIONAL,
    PENALIZACION_VIR_CERCANIA,
    VIR_SEPARACION_PREFERIDA_MIN,
    Actividad,
    ErrorDatos,
    ambiente_es_aula_comun,
    sin_acentos,
)
from .planificacion import Contexto, bandas_cohorte

log = logging.getLogger(__name__)

FACTOR_PRIORIDAD_TIEMPO_PARCIAL = 100_000


@dataclass
class Construccion:
    ctx: Contexto
    actividades: list[Actividad]
    relajar_topes: bool = False
    recesos_estrictos: bool = True
    modo_prueba_factibilidad: bool = False
    sin_objetivo: bool = False
    diagnostico_infactibilidad: bool = False
    pistas_semilla: dict[int, tuple[int, int]] = field(default_factory=dict)

    model: cp_model.CpModel = field(default_factory=cp_model.CpModel)
    pares: dict[int, list[tuple[int, int]]] = field(default_factory=dict)
    bandas_actividad: dict[int, set[int]] = field(default_factory=dict)
    preferencia_banda: dict[int, cp_model.BoolVar] = field(default_factory=dict)
    dia: dict[int, cp_model.IntVar] = field(default_factory=dict)
    inicio: dict[int, cp_model.IntVar] = field(default_factory=dict)
    banda_horaria: dict[int, cp_model.IntVar] = field(default_factory=dict)
    presente: dict[tuple[int, int], cp_model.BoolVar] = field(default_factory=dict)
    banda_manana: dict[int, cp_model.BoolVar] = field(default_factory=dict)
    turno_manana_dia: dict[tuple[int, int], cp_model.BoolVar] = field(default_factory=dict)
    turno_no_manana_dia: dict[tuple[int, int], cp_model.BoolVar] = field(default_factory=dict)
    doble_turno_docente: dict[tuple[int, int], cp_model.BoolVar] = field(default_factory=dict)
    doble_turno_cohorte: dict[tuple, cp_model.BoolVar] = field(default_factory=dict)
    selector_ambiente: dict[int, list[tuple[int, cp_model.BoolVar]]] = field(default_factory=dict)
    intervalo_dia: dict[int, cp_model.IntervalVar] = field(default_factory=dict)
    intervalo_tiempo: dict[int, cp_model.IntervalVar] = field(default_factory=dict)
    terminos_objetivo: list[cp_model.LinearExpr] = field(default_factory=list)
    por_uid: dict[int, Actividad] = field(default_factory=dict)
    supuestos_diagnostico: dict[int, str] = field(default_factory=dict)

    # ------------------------------------------------------------------
    # Construcción
    # ------------------------------------------------------------------

    def construir(self) -> cp_model.CpModel:
        self.por_uid = {actividad.uid: actividad for actividad in self.actividades}

        def agregar_grupo(nombre: str, accion: Callable[[], None]) -> None:
            inicio = len(self.model.Proto().constraints)
            accion()
            if not self.diagnostico_infactibilidad:
                return
            fin = len(self.model.Proto().constraints)
            if inicio == fin:
                return
            supuesto = self.model.NewBoolVar(f"diagnostico_{nombre}")
            for indice in range(inicio, fin):
                self.model.Proto().constraints[
                    indice
                ].enforcement_literal.append(supuesto.Index())
            self.model.AddAssumption(supuesto)
            self.supuestos_diagnostico[supuesto.Index()] = nombre

        agregar_grupo("dominios_y_dia_hora", self._crear_variables)
        self._priorizar_docentes_restrictivos()
        agregar_grupo("pistas_semilla", self._agregar_pistas_semilla)
        agregar_grupo("plantilla_modular", self._enlazar_plantilla)
        agregar_grupo("orden_tec_tal", self._agregar_secuencia_modalidades)
        if not self.modo_prueba_factibilidad:
            agregar_grupo("distribucion_tec", self._agregar_concentracion_tec)
        agregar_grupo("asignacion_de_ambientes", self._crear_selectores_ambiente)
        agregar_grupo("intervalos", self._crear_intervalos)
        agregar_grupo("no_solapamiento", self._agregar_no_solapamiento)
        agregar_grupo("topes_docentes", self._agregar_topes_docentes)
        if not self.modo_prueba_factibilidad:
            agregar_grupo("jornada_docente", self._agregar_jornada_docente)
            agregar_grupo("descansos_largos_docente", self._agregar_recesos_largos)
        if not self.modo_prueba_factibilidad:
            agregar_grupo("limites_diarios_cohorte", self._agregar_limites_cohorte)
        agregar_grupo("primer_inicio_cohorte", self._agregar_primer_inicio_cohorte)
        if not self.modo_prueba_factibilidad:
            agregar_grupo("continuidad_cohorte", self._agregar_continuidad_cohorte)
            agregar_grupo("turnos_mixtos", self._agregar_turnos_mixtos)
            agregar_grupo("separacion_virtual", self._agregar_separacion_virtual)
        agregar_grupo("objetivo", self._agregar_objetivo)
        return self.model

    def _agregar_pistas_semilla(self) -> None:
        for uid, (dia, inicio) in self.pistas_semilla.items():
            if uid not in self.por_uid:
                raise ErrorDatos(
                    f"La semilla referencia la actividad inexistente {uid}."
                )
            if (dia, inicio) not in self.pares.get(uid, ()):
                raise ErrorDatos(
                    f"La pista semilla de la actividad {uid} no pertenece a sus "
                    "pares candidatos."
                )
            self.model.AddHint(self.dia[uid], dia)
            self.model.AddHint(self.inicio[uid], inicio)

    def _crear_variables(self) -> None:
        for actividad in self.actividades:
            pares = generar_pares_permitidos(self.ctx, actividad)
            self.pares[actividad.uid] = pares
            dias = sorted({dia for dia, _ in pares})
            inicios = [inicio for _, inicio in pares]
            dia_var = self.model.NewIntVar(dias[0], dias[-1], f"dia_{actividad.uid}")
            inicio_var = self.model.NewIntVar(
                min(inicios), max(inicios), f"inicio_{actividad.uid}"
            )
            self.model.AddAllowedAssignments([dia_var, inicio_var], pares)
            self.dia[actividad.uid] = dia_var
            self.inicio[actividad.uid] = inicio_var
            asignaciones_banda = [
                (dia, inicio, self._clasificar_banda(inicio, actividad.duracion_min))
                for dia, inicio in pares
            ]
            bandas = sorted({asignacion[2] for asignacion in asignaciones_banda})
            banda_var = self.model.NewIntVar(
                bandas[0], bandas[-1], f"banda_{actividad.uid}"
            )
            self.model.AddAllowedAssignments(
                [dia_var, inicio_var, banda_var], asignaciones_banda
            )
            self.banda_horaria[actividad.uid] = banda_var
            self.bandas_actividad[actividad.uid] = set(bandas)

            # Las bandas preferentes son la primaria y, en turnos de
            # tarde/noche, las que comienzan más tarde que ella. Así no se
            # penaliza la noche cuando la cohorte usa la franja tarde/noche,
            # pero sí la tarde cuando la banda primaria es la mañana. VIR no
            # tiene banda preferente: puede ubicarse en cualquier banda sin
            # cruzarse con las clases de su cohorte.
            bandas_actividad = (
                []
                if actividad.modalidad == "VIR"
                else bandas_cohorte(self.ctx, actividad.oferta)
            )
            clases_aceptables = set(bandas)
            if len(bandas_actividad) > 1:
                inicio_primario, fin_primario = bandas_actividad[0]
                if fin_primario <= MORNING_END_MIN:
                    clases_aceptables = {0}
                else:
                    clases_aceptables = {
                        self._clasificar_banda(inicio, actividad.duracion_min)
                        for inicio, _ in bandas_actividad
                        if inicio >= inicio_primario
                    }
            if (
                not self.sin_objetivo
                and len(bandas_actividad) > 1
                and not set(bandas) <= clases_aceptables
            ):
                en_banda_preferente = self.model.NewBoolVar(
                    f"banda_preferente_{actividad.uid}"
                )
                self.model.AddAllowedAssignments(
                    [banda_var, en_banda_preferente],
                    [
                        (clase, int(clase in clases_aceptables))
                        for clase in sorted(bandas)
                    ],
                )
                self.preferencia_banda[actividad.uid] = en_banda_preferente

            for dia in dias:
                indicador = self.model.NewBoolVar(f"dia_{actividad.uid}_es_{dia}")
                self.model.Add(dia_var == dia).OnlyEnforceIf(indicador)
                self.model.Add(dia_var != dia).OnlyEnforceIf(indicador.Not())
                self.presente[(actividad.uid, dia)] = indicador

    @staticmethod
    def _clasificar_banda(inicio: int, duracion: int) -> int:
        if inicio + duracion <= MORNING_END_MIN:
            return 0
        if inicio >= NIGHT_START_MIN:
            return 2
        return 1

    def _bandera_manana(self, actividad: Actividad) -> cp_model.BoolVar:
        """Variable 1 si la actividad queda en la banda de mañana."""
        if actividad.uid in self.banda_manana:
            return self.banda_manana[actividad.uid]
        bandera = self.model.NewBoolVar(f"banda_manana_{actividad.uid}")
        self.model.Add(
            self.banda_horaria[actividad.uid] == 0
        ).OnlyEnforceIf(bandera)
        self.model.Add(
            self.banda_horaria[actividad.uid] != 0
        ).OnlyEnforceIf(bandera.Not())
        self.banda_manana[actividad.uid] = bandera
        return bandera

    def _indicadores_turno_dia(
        self, actividad: Actividad, dia: int
    ) -> tuple[cp_model.BoolVar, cp_model.BoolVar]:
        """Indicadores de presencia en mañana y en tarde/noche para un día."""
        clave = (actividad.uid, dia)
        if clave in self.turno_manana_dia:
            return (
                self.turno_manana_dia[clave],
                self.turno_no_manana_dia[clave],
            )
        presente = self.presente[clave]
        bandera = self._bandera_manana(actividad)
        manana = self.model.NewBoolVar(f"manana_dia_{actividad.uid}_{dia}")
        self.model.AddBoolAnd([presente, bandera]).OnlyEnforceIf(manana)
        self.model.AddBoolOr(
            [presente.Not(), bandera.Not()]
        ).OnlyEnforceIf(manana.Not())
        no_manana = self.model.NewBoolVar(
            f"no_manana_dia_{actividad.uid}_{dia}"
        )
        self.model.AddBoolAnd(
            [presente, bandera.Not()]
        ).OnlyEnforceIf(no_manana)
        self.model.AddBoolOr(
            [presente.Not(), bandera]
        ).OnlyEnforceIf(no_manana.Not())
        self.turno_manana_dia[clave] = manana
        self.turno_no_manana_dia[clave] = no_manana
        return manana, no_manana

    def _doble_turno_conjunto(
        self, actividades: list[Actividad], dia: int, etiqueta: str
    ) -> cp_model.BoolVar | None:
        """1 si un conjunto de actividades usa mañana y tarde/noche el mismo día."""
        if len(actividades) < 2:
            return None
        indicadores = [
            self._indicadores_turno_dia(actividad, dia)
            for actividad in actividades
        ]
        manana = self.model.NewBoolVar(f"manana_{etiqueta}")
        no_manana = self.model.NewBoolVar(f"no_manana_{etiqueta}")
        self.model.AddMaxEquality(
            manana, [indicador for indicador, _ in indicadores]
        )
        self.model.AddMaxEquality(
            no_manana, [indicador for _, indicador in indicadores]
        )
        doble = self.model.NewBoolVar(f"doble_{etiqueta}")
        self.model.AddBoolAnd([manana, no_manana]).OnlyEnforceIf(doble)
        self.model.AddBoolOr(
            [manana.Not(), no_manana.Not()]
        ).OnlyEnforceIf(doble.Not())
        return doble

    def _max_bool(
        self, variables: list[cp_model.BoolVar], etiqueta: str
    ) -> cp_model.BoolVar:
        if len(variables) == 1:
            return variables[0]
        maximo = self.model.NewBoolVar(etiqueta)
        self.model.AddMaxEquality(maximo, variables)
        return maximo

    def _agregar_turnos_mixtos(self) -> None:
        """Penaliza días partidos entre mañana y tarde/noche.

        La igualdad dura de banda por cohorte se sustituyó por una preferencia
        blanda. Así un docente puede usar ambas franjas el mismo día cuando su
        disponibilidad lo exige, pero pagando un costo objetivo muy alto. El
        control se hace por docente y por cohorte, y solo considera actividades
        cuyos rangos de semanas se solapan.
        """
        if self.sin_objetivo:
            return

        semanas_docente: dict[tuple[int, int, int], set[int]] = defaultdict(set)
        semanas_cohorte: dict[tuple[tuple, int, int], set[int]] = defaultdict(set)
        for actividad in self.actividades:
            if actividad.modalidad not in {"TEC", "TAL"}:
                continue
            dias = [
                dia for dia in self.ctx.dias
                if (actividad.uid, dia) in self.presente
            ]
            if not dias:
                continue
            for semana in range(actividad.semana_inicio, actividad.semana_fin):
                for dia in dias:
                    if actividad.docente_id is not None:
                        semanas_docente[
                            (actividad.docente_id, dia, semana)
                        ].add(actividad.uid)
                    semanas_cohorte[
                        (actividad.oferta.cohorte, dia, semana)
                    ].add(actividad.uid)

        conjuntos_docente: dict[tuple[int, int], set[frozenset[int]]] = defaultdict(set)
        for (docente_id, dia, _semana), uids in semanas_docente.items():
            conjuntos_docente[(docente_id, dia)].add(frozenset(uids))
        conjuntos_cohorte: dict[tuple[tuple, int], set[frozenset[int]]] = defaultdict(set)
        for (cohorte, dia, _semana), uids in semanas_cohorte.items():
            conjuntos_cohorte[(cohorte, dia)].add(frozenset(uids))

        for numero, ((docente_id, dia), conjuntos) in enumerate(
            conjuntos_docente.items()
        ):
            dobles: list[cp_model.BoolVar] = []
            for subindice, uids in enumerate(conjuntos):
                actividades = [self.por_uid[uid] for uid in sorted(uids)]
                doble = self._doble_turno_conjunto(
                    actividades, dia, f"doc_{numero}_{subindice}"
                )
                if doble is not None:
                    dobles.append(doble)
            if not dobles:
                continue
            doble_dia = self._max_bool(dobles, f"doc_dia_{numero}")
            self.doble_turno_docente[(docente_id, dia)] = doble_dia
            self.terminos_objetivo.append(
                doble_dia
                * PENALIZACION_DOBLE_TURNO_DIARIO
                * self._factor_prioridad_docente_id(docente_id)
            )

        for numero, ((cohorte, dia), conjuntos) in enumerate(
            conjuntos_cohorte.items()
        ):
            dobles = []
            for subindice, uids in enumerate(conjuntos):
                actividades = [self.por_uid[uid] for uid in sorted(uids)]
                doble = self._doble_turno_conjunto(
                    actividades, dia, f"coh_{numero}_{subindice}"
                )
                if doble is not None:
                    dobles.append(doble)
            if not dobles:
                continue
            doble_dia = self._max_bool(dobles, f"coh_dia_{numero}")
            self.doble_turno_cohorte[(cohorte, dia)] = doble_dia
            self.terminos_objetivo.append(
                doble_dia * PENALIZACION_DOBLE_TURNO_COHORTE
            )

    @staticmethod
    def _rangos_se_solapan(izquierda: Actividad, derecha: Actividad) -> bool:
        return max(izquierda.semana_inicio, derecha.semana_inicio) < min(
            izquierda.semana_fin, derecha.semana_fin
        )

    def _agregar_separacion_virtual(self) -> None:
        """Penaliza VIR demasiado cerca de la carga presencial de su cohorte.

        La cercanía se mide en minutos reales entre el fin de un bloque y el
        inicio del otro cuando ambos caen el mismo día y sus semanas se
        solapan. Si la distancia es menor que
        ``VIR_SEPARACION_PREFERIDA_MIN``, la actividad virtual paga una sola
        vez la penalización, aunque esté cerca de varios bloques. Las clases
        virtuales de días sin presencialidad, o suficientemente alejadas,
        quedan sin costo. La regla es blanda: una cohorte con la presencialidad
        muy concentrada puede seguir usando VIR cerca, pero solo como último
        recurso.
        """
        if self.sin_objetivo:
            return

        presenciales_por_cohorte: dict[tuple, list[Actividad]] = defaultdict(list)
        for actividad in self.actividades:
            if actividad.modalidad in {"TEC", "TAL"}:
                presenciales_por_cohorte[actividad.oferta.cohorte].append(actividad)

        cero = self.model.NewConstant(0)
        for virtual in self.actividades:
            if virtual.modalidad != "VIR":
                continue
            cercanias: list[cp_model.BoolVar] = []
            for presencial in presenciales_por_cohorte.get(
                virtual.oferta.cohorte, ()
            ):
                if not self._rangos_se_solapan(virtual, presencial):
                    continue

                etiqueta = f"{virtual.uid}_{presencial.uid}"
                mismo_dia = self.model.NewBoolVar(f"vir_mismo_dia_{etiqueta}")
                self.model.Add(
                    self.dia[virtual.uid] == self.dia[presencial.uid]
                ).OnlyEnforceIf(mismo_dia)
                self.model.Add(
                    self.dia[virtual.uid] != self.dia[presencial.uid]
                ).OnlyEnforceIf(mismo_dia.Not())

                distancia = self.model.NewIntVar(
                    0,
                    self.ctx.franja.cierre_min + 1,
                    f"vir_distancia_{etiqueta}",
                )
                self.model.AddMaxEquality(
                    distancia,
                    [
                        self.inicio[presencial.uid]
                        - (self.inicio[virtual.uid] + virtual.duracion_min),
                        self.inicio[virtual.uid]
                        - (self.inicio[presencial.uid] + presencial.duracion_min),
                        cero,
                    ],
                )
                cerca_en_tiempo = self.model.NewBoolVar(
                    f"vir_cerca_tiempo_{etiqueta}"
                )
                self.model.Add(
                    distancia < VIR_SEPARACION_PREFERIDA_MIN
                ).OnlyEnforceIf(cerca_en_tiempo)
                self.model.Add(
                    distancia >= VIR_SEPARACION_PREFERIDA_MIN
                ).OnlyEnforceIf(cerca_en_tiempo.Not())

                cerca = self.model.NewBoolVar(f"vir_cerca_{etiqueta}")
                self.model.AddBoolAnd(
                    [mismo_dia, cerca_en_tiempo]
                ).OnlyEnforceIf(cerca)
                self.model.AddBoolOr(
                    [mismo_dia.Not(), cerca_en_tiempo.Not()]
                ).OnlyEnforceIf(cerca.Not())
                cercanias.append(cerca)

            if cercanias:
                cerca_virtual = self._max_bool(
                    cercanias, f"vir_cerca_total_{virtual.uid}"
                )
                self.terminos_objetivo.append(
                    cerca_virtual * PENALIZACION_VIR_CERCANIA
                )

    def _agregar_secuencia_modalidades(self) -> None:
        if self.sin_objetivo:
            return
        tec_carrera = [
            actividad for actividad in self.actividades
            if actividad.modalidad == "TEC" and actividad.oferta.curso.is_carrera
        ]
        tal = [a for a in self.actividades if a.modalidad == "TAL"]
        for teoria in tec_carrera:
            for taller in tal:
                if teoria.oferta.cohorte != taller.oferta.cohorte:
                    continue
                if not self._rangos_se_solapan(teoria, taller):
                    continue
                mismo_dia = self.model.NewBoolVar(
                    f"mismo_dia_tec_tal_{teoria.uid}_{taller.uid}"
                )
                self.model.Add(
                    self.dia[teoria.uid] == self.dia[taller.uid]
                ).OnlyEnforceIf(mismo_dia)
                self.model.Add(
                    self.dia[teoria.uid] != self.dia[taller.uid]
                ).OnlyEnforceIf(mismo_dia.Not())
                orden_flexible = self.model.NewBoolVar(
                    f"orden_flexible_tec_tal_{teoria.uid}_{taller.uid}"
                )
                self.model.Add(
                    self.dia[taller.uid] >= self.dia[teoria.uid] + 1
                ).OnlyEnforceIf([mismo_dia.Not(), orden_flexible.Not()])
                self.model.Add(
                    self.inicio[taller.uid]
                    >= self.inicio[teoria.uid] + teoria.duracion_min + BREAK_MIN
                ).OnlyEnforceIf([mismo_dia, orden_flexible.Not()])
                self.terminos_objetivo.append(orden_flexible * 100_000)

    def _agregar_concentracion_tec(self) -> None:
        if self.sin_objetivo:
            return
        grupos: set[tuple[int, frozenset[int]]] = set()
        for actividad in self.actividades:
            if actividad.modalidad != "TEC" or not actividad.oferta.curso.is_carrera:
                continue
            for semana in range(actividad.semana_inicio, actividad.semana_fin):
                clave = (
                    actividad.oferta.id_programacion,
                    frozenset(
                        otra.uid for otra in self.actividades
                        if otra.oferta.id_programacion == actividad.oferta.id_programacion
                        and otra.modalidad == "TEC"
                        and otra.semana_inicio <= semana < otra.semana_fin
                    ),
                )
                grupos.add(clave)
        for programacion, uids in grupos:
            actividades = [self.por_uid[uid] for uid in sorted(uids)]
            if len(actividades) < 2:
                continue
            etiqueta = "_".join(str(uid) for uid in sorted(uids))
            dias_usados: list[cp_model.BoolVar] = []
            horas_por_dia: list[cp_model.LinearExpr] = []
            horas_totales = sum(
                actividad.horas_academicas for actividad in actividades
            )
            docentes = {
                actividad.docente_id
                for actividad in actividades
                if actividad.docente_id is not None
            }
            capacidad_diaria = MAX_COHORT_DAILY_ACAD_HOURS
            if len(docentes) == 1:
                capacidad_diaria = min(
                    capacidad_diaria, MAX_TEACHER_DAILY_ACAD_HOURS
                )
            dias_objetivo = max(
                1,
                (horas_totales + capacidad_diaria - 1) // capacidad_diaria,
            )
            # Si toda la carga TEC cabe en un día, cada día adicional se
            # penaliza con mucha fuerza. Así un curso de carrera con pocas
            # horas semanales prioriza concentrarse en una sola jornada. El
            # peso queda por debajo del día partido docente para no forzar
            # mañana y tarde cuando la alternativa es usar dos días limpios.
            peso_dias = (
                PENALIZACION_TEC_DIA_ADICIONAL
                if dias_objetivo == 1
                else 10_000
            )
            factor_prioridad = max(
                self._factor_prioridad_docente(actividad)
                for actividad in actividades
            )
            for dia in self.ctx.dias:
                indicadores = [
                    self.presente[(actividad.uid, dia)]
                    for actividad in actividades
                    if (actividad.uid, dia) in self.presente
                ]
                usado = self.model.NewBoolVar(
                    f"tec_dia_{programacion}_{etiqueta}_{dia}"
                )
                if indicadores:
                    self.model.AddMaxEquality(usado, indicadores)
                else:
                    self.model.Add(usado == 0)
                dias_usados.append(usado)
                horas_por_dia.append(
                    sum(
                        actividad.horas_academicas
                        * self.presente[(actividad.uid, dia)]
                        for actividad in actividades
                        if (actividad.uid, dia) in self.presente
                    )
                )
            diferencia_dias = self.model.NewIntVar(
                0, len(self.ctx.dias), f"tec_diferencia_dias_{programacion}_{etiqueta}"
            )
            self.model.AddAbsEquality(
                diferencia_dias, sum(dias_usados) - dias_objetivo
            )
            self.terminos_objetivo.append(
                diferencia_dias * factor_prioridad * peso_dias
            )
            for izquierda in range(len(self.ctx.dias)):
                for derecha in range(izquierda + 1, len(self.ctx.dias)):
                    ambos = self.model.NewBoolVar(
                        f"tec_dias_activos_{programacion}_{etiqueta}_"
                        f"{izquierda}_{derecha}"
                    )
                    self.model.AddBoolAnd(
                        [dias_usados[izquierda], dias_usados[derecha]]
                    ).OnlyEnforceIf(ambos)
                    self.model.AddBoolOr(
                        [dias_usados[izquierda].Not(), dias_usados[derecha].Not()]
                    ).OnlyEnforceIf(ambos.Not())
                    diferencia_horas = self.model.NewIntVar(
                        0,
                        horas_totales,
                        f"tec_diferencia_horas_{programacion}_{etiqueta}_"
                        f"{izquierda}_{derecha}",
                    )
                    self.model.AddAbsEquality(
                        diferencia_horas,
                        horas_por_dia[izquierda] - horas_por_dia[derecha],
                    ).OnlyEnforceIf(ambos)
                    self.terminos_objetivo.append(
                        diferencia_horas * factor_prioridad * 1_000
                    )

    def _agregar_continuidad_cohorte(self) -> None:
        grupos: dict[tuple, list[Actividad]] = {}
        for actividad in self.actividades:
            if actividad.modalidad not in {"TEC", "TAL"}:
                continue
            for semana in range(actividad.semana_inicio, actividad.semana_fin):
                clave = (
                    actividad.oferta.cohorte,
                    frozenset(
                        otra.uid for otra in self.actividades
                        if otra.oferta.cohorte == actividad.oferta.cohorte
                        and otra.modalidad in {"TEC", "TAL"}
                        and otra.semana_inicio <= semana < otra.semana_fin
                    ),
                )
                grupos[clave] = [
                    self.por_uid[uid] for uid in sorted(clave[1])
                ]

        for (cohorte, _), actividades in grupos.items():
            if len(actividades) < 2:
                continue
            etiqueta = "_".join(str(a.uid) for a in actividades)
            for dia in self.ctx.dias:
                presentes = [
                    actividad for actividad in actividades
                    if (actividad.uid, dia) in self.presente
                ]
                if len(presentes) < 2:
                    continue
                indicadores = [
                    self._indicadores_turno_dia(actividad, dia)
                    for actividad in presentes
                ]
                # La mañana y la tarde/noche son circuitos independientes:
                # dentro de cada turno se conserva la continuidad 15-30. El
                # corte entre ambos turnos se limita aparte a 60 minutos.
                self._agregar_circuito_continuidad(
                    presentes,
                    [manana for manana, _ in indicadores],
                    f"manana_{etiqueta}_{dia}",
                )
                self._agregar_circuito_continuidad(
                    presentes,
                    [no_manana for _, no_manana in indicadores],
                    f"tarde_{etiqueta}_{dia}",
                )
                self._agregar_corte_entre_turnos(
                    presentes,
                    indicadores,
                    f"corte_{etiqueta}_{dia}",
                )

    def _agregar_corte_entre_turnos(
        self,
        actividades: list[Actividad],
        indicadores: list[tuple[cp_model.BoolVar, cp_model.BoolVar]],
        etiqueta: str,
    ) -> None:
        """Limita el hueco entre el último bloque de mañana y el primero de tarde.

        Si una cohorte tiene actividades presenciales en ambos turnos el mismo
        día, el estudiante no puede esperar más de una hora entre la última
        clase de la mañana y la primera de la tarde/noche. El cálculo usa el
        máximo fin real de la mañana y el mínimo inicio real de la tarde/noche,
        de modo que el corte sea el que efectivamente vive el estudiante.
        """
        if len(actividades) < 2:
            return
        puede_manana = any(
            0 in self.bandas_actividad.get(actividad.uid, set())
            for actividad in actividades
        )
        puede_no_manana = any(
            any(
                banda != 0
                for banda in self.bandas_actividad.get(actividad.uid, set())
            )
            for actividad in actividades
        )
        if not (puede_manana and puede_no_manana):
            return

        horizonte = self.ctx.franja.cierre_min + 1
        hay_manana = self.model.NewBoolVar(f"corte_hay_manana_{etiqueta}")
        hay_no_manana = self.model.NewBoolVar(f"corte_hay_tarde_{etiqueta}")
        self.model.AddMaxEquality(
            hay_manana, [manana for manana, _ in indicadores]
        )
        self.model.AddMaxEquality(
            hay_no_manana, [no_manana for _, no_manana in indicadores]
        )
        ambos = self.model.NewBoolVar(f"corte_ambos_{etiqueta}")
        self.model.AddBoolAnd([hay_manana, hay_no_manana]).OnlyEnforceIf(ambos)
        self.model.AddBoolOr(
            [hay_manana.Not(), hay_no_manana.Not()]
        ).OnlyEnforceIf(ambos.Not())

        fines_manana: list[cp_model.IntVar] = []
        inicios_tarde: list[cp_model.IntVar] = []
        for indice, (actividad, (manana, no_manana)) in enumerate(
            zip(actividades, indicadores)
        ):
            fin_manana = self.model.NewIntVar(
                0, horizonte, f"corte_fin_manana_{etiqueta}_{indice}"
            )
            self.model.Add(
                fin_manana
                == self.inicio[actividad.uid] + actividad.duracion_min
            ).OnlyEnforceIf(manana)
            self.model.Add(fin_manana == 0).OnlyEnforceIf(manana.Not())
            fines_manana.append(fin_manana)

            inicio_tarde = self.model.NewIntVar(
                0, horizonte, f"corte_inicio_tarde_{etiqueta}_{indice}"
            )
            self.model.Add(
                inicio_tarde == self.inicio[actividad.uid]
            ).OnlyEnforceIf(no_manana)
            self.model.Add(
                inicio_tarde == horizonte
            ).OnlyEnforceIf(no_manana.Not())
            inicios_tarde.append(inicio_tarde)

        max_fin_manana = self.model.NewIntVar(
            0, horizonte, f"corte_max_fin_manana_{etiqueta}"
        )
        min_inicio_tarde = self.model.NewIntVar(
            0, horizonte, f"corte_min_inicio_tarde_{etiqueta}"
        )
        self.model.AddMaxEquality(max_fin_manana, fines_manana)
        self.model.AddMinEquality(min_inicio_tarde, inicios_tarde)
        self.model.Add(
            min_inicio_tarde >= max_fin_manana
        ).OnlyEnforceIf(ambos)
        self.model.Add(
            min_inicio_tarde - max_fin_manana <= MAX_COHORT_CROSS_TURN_GAP_MIN
        ).OnlyEnforceIf(ambos)

    def _agregar_circuito_continuidad(
        self,
        actividades: list[Actividad],
        indicadores: list[cp_model.BoolVar],
        etiqueta: str,
    ) -> None:
        """Ordena y compacta solo los bloques activos de un mismo turno."""
        vacio = self.model.NewBoolVar(f"cohorte_vacia_{etiqueta}")
        self.model.Add(sum(indicadores) == 0).OnlyEnforceIf(vacio)
        self.model.Add(sum(indicadores) >= 1).OnlyEnforceIf(vacio.Not())
        arcos = [(0, 0, vacio)]
        arcos_siguiente: dict[tuple[int, int], cp_model.BoolVar] = {}
        for indice, (actividad, indicador) in enumerate(
            zip(actividades, indicadores), start=1
        ):
            arcos.append((indice, indice, indicador.Not()))
            inicio = self.model.NewBoolVar(
                f"cohorte_inicio_{etiqueta}_{indice}"
            )
            fin = self.model.NewBoolVar(f"cohorte_fin_{etiqueta}_{indice}")
            arcos.extend(((0, indice, inicio), (indice, 0, fin)))
            for otro_indice, (otra, _) in enumerate(
                zip(actividades, indicadores), start=1
            ):
                if indice == otro_indice:
                    continue
                siguiente = self.model.NewBoolVar(
                    f"cohorte_arco_{etiqueta}_{indice}_{otro_indice}"
                )
                arcos.append((indice, otro_indice, siguiente))
                arcos_siguiente[(indice, otro_indice)] = siguiente
                self.model.Add(
                    self.inicio[otra.uid]
                    >= self.inicio[actividad.uid]
                    + actividad.duracion_min
                    + BREAK_MIN
                ).OnlyEnforceIf(siguiente)
                self.model.Add(
                    self.inicio[otra.uid]
                    <= self.inicio[actividad.uid]
                    + actividad.duracion_min
                    + 30
                ).OnlyEnforceIf(siguiente)
                # La grilla sólo permite 15 o 30 minutos entre bloques
                # consecutivos del mismo turno. Marcamos el caso de 30 para
                # penalizarlo: el receso normal es de 15 y el de 30 sólo debe
                # aparecer cuando no haya otra combinación razonable.
                receso_30 = self.model.NewBoolVar(
                    f"cohorte_receso30_{etiqueta}_{indice}_{otro_indice}"
                )
                self.model.Add(
                    self.inicio[otra.uid]
                    >= self.inicio[actividad.uid]
                    + actividad.duracion_min
                    + 30
                ).OnlyEnforceIf([siguiente, receso_30])
                self.model.Add(
                    self.inicio[otra.uid]
                    <= self.inicio[actividad.uid]
                    + actividad.duracion_min
                    + BREAK_MIN
                ).OnlyEnforceIf([siguiente, receso_30.Not()])
                self.model.Add(receso_30 == 0).OnlyEnforceIf(siguiente.Not())
                if not self.sin_objetivo:
                    self.terminos_objetivo.append(
                        receso_30 * PENALIZACION_RECESO_30
                    )
                self._agregar_penalizacion_aula(
                    actividad,
                    otra,
                    siguiente,
                    receso_30,
                    etiqueta,
                    indice,
                    otro_indice,
                )
        # Prohibir intercalados (curso A -> curso B -> curso A): las sesiones de
        # un mismo curso deben quedar contiguas dentro del circuito del turno.
        for j in range(1, len(actividades) + 1):
            entrantes = [
                i
                for i in range(1, len(actividades) + 1)
                if (i, j) in arcos_siguiente
            ]
            salientes = [
                k
                for k in range(1, len(actividades) + 1)
                if (j, k) in arcos_siguiente
            ]
            if not (entrantes and salientes):
                continue
            curso_j = actividades[j - 1].oferta.id_programacion
            for i in entrantes:
                curso_i = actividades[i - 1].oferta.id_programacion
                for k in salientes:
                    if i == k:
                        continue
                    curso_k = actividades[k - 1].oferta.id_programacion
                    if curso_i == curso_k and curso_j != curso_i:
                        self.model.Add(
                            arcos_siguiente[(i, j)]
                            + arcos_siguiente[(j, k)]
                            <= 1
                        )

        self.model.AddCircuit(arcos)

    def _selectores_clas(
        self, actividad: Actividad
    ) -> dict[int, cp_model.BoolVar]:
        """Selectores de aulas comunes (CLAS) de una actividad."""
        resultado: dict[int, cp_model.BoolVar] = {}
        for id_ambiente, selector in self.selector_ambiente.get(actividad.uid, []):
            ambiente = self.ctx.ambientes.get(id_ambiente)
            if ambiente is not None and ambiente_es_aula_comun(ambiente):
                resultado[id_ambiente] = selector
        return resultado

    def _continuidad_aula_aplica(
        self, actividad: Actividad, otra: Actividad
    ) -> bool:
        """True si dos bloques deben preferir la misma aula CLAS."""
        if actividad.modalidad not in {"TEC", "TAL"}:
            return False
        if otra.modalidad not in {"TEC", "TAL"}:
            return False
        mismo_docente = (
            actividad.docente_id is not None
            and actividad.docente_id == otra.docente_id
        )
        mismo_curso = (
            actividad.oferta.id_programacion == otra.oferta.id_programacion
        )
        return mismo_docente or mismo_curso

    def _agregar_penalizacion_aula(
        self,
        actividad: Actividad,
        otra: Actividad,
        siguiente: cp_model.BoolVar,
        receso_30: cp_model.BoolVar,
        etiqueta: str,
        indice: int,
        otro_indice: int,
    ) -> None:
        """Penaliza cambiar de aula CLAS en bloques consecutivos con 15 min.

        Solo aplica a TEC/TAL de la misma cohorte que son consecutivos en el
        circuito del turno, con el mismo docente o el mismo curso. Se ignoran
        laboratorios especializados: la regla busca evitar traslados entre aulas
        comunes equivalentes, no forzar que un laboratorio se use como aula.
        """
        if self.sin_objetivo or not self._continuidad_aula_aplica(actividad, otra):
            return
        selectores_actividad = self._selectores_clas(actividad)
        selectores_otra = self._selectores_clas(otra)
        comunes = sorted(
            set(selectores_actividad) & set(selectores_otra)
        )
        if not comunes:
            return

        receso_15 = self.model.NewBoolVar(
            f"aula_receso15_{etiqueta}_{indice}_{otro_indice}"
        )
        self.model.Add(receso_15 == siguiente - receso_30)

        mismos: list[cp_model.BoolVar] = []
        for id_ambiente in comunes:
            mismo = self.model.NewBoolVar(
                f"aula_misma_{etiqueta}_{indice}_{otro_indice}_{id_ambiente}"
            )
            self.model.AddBoolAnd(
                [
                    receso_15,
                    selectores_actividad[id_ambiente],
                    selectores_otra[id_ambiente],
                ]
            ).OnlyEnforceIf(mismo)
            self.model.AddBoolOr(
                [
                    receso_15.Not(),
                    selectores_actividad[id_ambiente].Not(),
                    selectores_otra[id_ambiente].Not(),
                ]
            ).OnlyEnforceIf(mismo.Not())
            mismos.append(mismo)

        # Si hay receso de 15 y no comparten aula, paga la penalización. Si
        # comparten, el término se cancela. El receso de 30 no activa la regla.
        self.terminos_objetivo.append(
            receso_15 * PENALIZACION_CAMBIO_AULA_CLAS
            - sum(mismos) * PENALIZACION_CAMBIO_AULA_CLAS
        )

    def _enlazar_plantilla(self) -> None:
        """Clona día y hora de inicio entre módulos de una misma línea.

        La plantilla es una restricción dura, no una preferencia: todas las
        actividades TEC/TAL que comparten ``(plantilla_id, plantilla_slot)``
        usan exactamente el mismo día y minuto de inicio. El preflight valida
        que las duraciones también coincidan, de modo que el fin sea idéntico.
        VIR queda fuera de la plantilla por decisión institucional.
        """
        grupos: dict[tuple[str, str], list[Actividad]] = defaultdict(list)
        for actividad in self.actividades:
            if actividad.plantilla_id and actividad.plantilla_slot:
                grupos[(actividad.plantilla_id, actividad.plantilla_slot)].append(
                    actividad
                )

        for (plantilla_id, slot), actividades in sorted(grupos.items()):
            if len(actividades) <= 1:
                continue
            duraciones = {actividad.duracion_min for actividad in actividades}
            if len(duraciones) > 1:
                raise ErrorDatos(
                    f"La plantilla {plantilla_id}, slot {slot}, tiene duraciones "
                    f"distintas ({sorted(duraciones)} min) y no puede clonarse "
                    "con hora de fin idéntica."
                )

            # El módulo de referencia (orden 0) es el ancla lógica. Si por
            # algún motivo no está en el grupo, se usa el primero disponible;
            # el preflight ya habrá reportado el slot faltante.
            base = next(
                (
                    actividad
                    for actividad in actividades
                    if actividad.oferta.modulo_orden == 0
                ),
                actividades[0],
            )
            for actividad in actividades:
                if actividad.uid == base.uid:
                    continue
                self.model.Add(self.dia[actividad.uid] == self.dia[base.uid])
                self.model.Add(self.inicio[actividad.uid] == self.inicio[base.uid])

    def _crear_selectores_ambiente(self) -> None:
        for actividad in self.actividades:
            if not actividad.ambientes:
                self.selector_ambiente[actividad.uid] = []
                continue
            selectores: list[tuple[int, cp_model.BoolVar]] = []
            for id_ambiente in actividad.ambientes:
                selector = self.model.NewBoolVar(
                    f"ambiente_{actividad.uid}_{id_ambiente}"
                )
                selectores.append((id_ambiente, selector))
            self.model.Add(sum(selector for _, selector in selectores) == 1)
            self.selector_ambiente[actividad.uid] = selectores

    def _crear_intervalos(self) -> None:
        for actividad in self.actividades:
            uid = actividad.uid
            dia_var = self.dia[uid]
            inicio_var = self.inicio[uid]
            duracion = actividad.duracion_min
            self.intervalo_dia[uid] = self.model.NewIntervalVar(
                dia_var, 1, dia_var + 1, f"int_dia_{uid}"
            )
            # EMP se dicta en bloques continuos sin receso intermedio. El resto
            # de modalidades reserva 15 minutos de transición después de cada
            # sesión; así se cumple el receso por cambio de curso y el de cada
            # tres horas académicas.
            receso = 0 if actividad.modalidad == "EMP" else BREAK_MIN
            self.intervalo_tiempo[uid] = self.model.NewIntervalVar(
                inicio_var,
                duracion + receso,
                inicio_var + duracion + receso,
                f"int_tiempo_{uid}",
            )

    def _agregar_no_solapamiento(self) -> None:
        cohorte: dict[tuple, list[tuple]] = defaultdict(list)
        docente: dict[tuple, list[tuple]] = defaultdict(list)
        ambiente: dict[tuple, list[tuple]] = defaultdict(list)

        for actividad in self.actividades:
            uid = actividad.uid
            x = self.intervalo_dia[uid]
            y = self.intervalo_tiempo[uid]
            intervalos_ambiente = {}
            if not self.modo_prueba_factibilidad:
                for id_ambiente, selector in self.selector_ambiente[uid]:
                    x_amb = self.model.NewOptionalIntervalVar(
                        self.dia[uid], 1, self.dia[uid] + 1, selector,
                        f"int_amb_dia_{uid}_{id_ambiente}",
                    )
                    y_amb = self.model.NewOptionalIntervalVar(
                        self.inicio[uid],
                        actividad.duracion_min,
                        self.inicio[uid] + actividad.duracion_min,
                        selector,
                        f"int_amb_tiempo_{uid}_{id_ambiente}",
                    )
                    intervalos_ambiente[id_ambiente] = (x_amb, y_amb)
            for semana in range(actividad.semana_inicio, actividad.semana_fin):
                cohorte[(actividad.oferta.cohorte, semana)].append((x, y))
                if actividad.docente_id is not None:
                    docente[(actividad.docente_id, semana)].append((x, y))
                for id_ambiente, intervalos in intervalos_ambiente.items():
                    ambiente[(id_ambiente, semana)].append(intervalos)

        grupos_recursos = [
            ("grupo", cohorte), ("docente", docente), ("ambiente", ambiente),
        ]
        if self.modo_prueba_factibilidad:
            grupos_recursos = grupos_recursos[:2]
        for etiqueta, grupos in grupos_recursos:
            conjuntos_agregados: set[tuple[int, ...]] = set()
            for pares in grupos.values():
                if len(pares) <= 1:
                    continue
                clave = tuple(
                    sorted(par[0].Index() for par in pares)
                )
                if clave in conjuntos_agregados:
                    continue
                conjuntos_agregados.add(clave)
                self.model.AddNoOverlap2D(
                    [par[0] for par in pares], [par[1] for par in pares]
                )

    def _agregar_topes_docentes(self) -> None:
        """Topes semanales y diarios de carga docente.

        La carga semanal se calcula por semana real de vigencia de cada
        actividad y se expresa en minutos reales: el contrato (36/23/19) son
        horas reloj, igual que la disponibilidad del frontend. El tope diario
        se mantiene en horas académicas y la jornada real se controla aparte
        en `_agregar_jornada_docente`.
        """
        carga_semanal: dict[tuple[int, int], list[Actividad]] = defaultdict(list)
        for actividad in self.actividades:
            if actividad.docente_id is None:
                continue
            for semana in range(actividad.semana_inicio, actividad.semana_fin):
                carga_semanal[(actividad.docente_id, semana)].append(actividad)

        for (docente_id, semana), actividades in sorted(carga_semanal.items()):
            docente = self.ctx.docentes.get(docente_id)
            if docente is None:
                continue
            # El contrato se expresa en horas reloj: se compara la duración
            # real de las sesiones (45 min por hora académica) contra el tope
            # convertido a minutos, no contra un conteo de horas académicas.
            carga_min = sum(a.duracion_min for a in actividades)
            if carga_min <= docente.tope_semanal_min:
                continue
            if self.relajar_topes:
                slack = self.model.NewIntVar(
                    0, carga_min, f"exceso_semanal_{docente_id}_{semana}"
                )
                self.model.Add(carga_min <= docente.tope_semanal_min + slack)
                # El slack ahora está en minutos. Se mantiene una penalización
                # equivalente a la anterior por hora académica (100.000 / 45).
                self.terminos_objetivo.append(slack * 2_222)
            else:
                # En modo estricto el preflight ya abortó; esta restricción
                # deja constancia en el modelo y evita generar un borrador que
                # incumpla el contrato.
                self.model.Add(carga_min <= docente.tope_semanal_min)

        # Límite diario por docente/semana/día. Se agrupan primero las
        # actividades para no recorrer toda la lista en cada combinación.
        por_docente_dia: dict[tuple[int, int], list[Actividad]] = defaultdict(list)
        for actividad in self.actividades:
            if actividad.docente_id is None:
                continue
            for dia in self.ctx.dias:
                if (actividad.uid, dia) in self.presente:
                    por_docente_dia[(actividad.docente_id, dia)].append(actividad)

        for (docente_id, dia), actividades in sorted(por_docente_dia.items()):
            semanas = sorted({
                semana
                for actividad in actividades
                for semana in range(actividad.semana_inicio, actividad.semana_fin)
            })
            for semana in semanas:
                activos = [
                    actividad for actividad in actividades
                    if actividad.semana_inicio <= semana < actividad.semana_fin
                ]
                if not activos:
                    continue
                terminos = [
                    self.presente[(actividad.uid, dia)] * actividad.horas_academicas
                    for actividad in activos
                ]
                maximo_posible = sum(
                    actividad.horas_academicas for actividad in activos
                )
                if maximo_posible <= MAX_TEACHER_DAILY_ACAD_HOURS:
                    continue
                total = sum(terminos)
                if self.relajar_topes:
                    slack = self.model.NewIntVar(
                        0,
                        maximo_posible,
                        f"exceso_diario_{docente_id}_{semana}_{dia}",
                    )
                    self.model.Add(total <= MAX_TEACHER_DAILY_ACAD_HOURS + slack)
                    self.terminos_objetivo.append(slack * 50_000)
                else:
                    self.model.Add(total <= MAX_TEACHER_DAILY_ACAD_HOURS)

    def _agregar_jornada_docente(self) -> None:
        """La jornada real de un docente no puede superar 9 horas continuas.

        Para cada par de sesiones que pueden coincidir en un mismo día se exige
        que, en cualquiera de los dos órdenes, la distancia entre el inicio de
        la primera y el fin de la última no exceda 540 minutos. La restricción
        sólo se activa si ambas sesiones están presentes ese día.
        """
        por_docente_dia: dict[tuple[int, int], list[Actividad]] = defaultdict(list)
        for actividad in self.actividades:
            if actividad.docente_id is None:
                continue
            for dia in self.ctx.dias:
                if (actividad.uid, dia) in self.presente:
                    por_docente_dia[(actividad.docente_id, dia)].append(actividad)

        for (docente_id, dia), actividades in sorted(por_docente_dia.items()):
            for indice, izquierda in enumerate(actividades):
                for derecha in actividades[indice + 1:]:
                    if not _rangos_se_solapan(
                        izquierda.semana_inicio, izquierda.semana_fin,
                        derecha.semana_inicio, derecha.semana_fin,
                    ):
                        continue
                    pi = self.presente[(izquierda.uid, dia)]
                    pj = self.presente[(derecha.uid, dia)]
                    fin_derecha = (
                        self.inicio[derecha.uid] + derecha.duracion_min
                    )
                    fin_izquierda = (
                        self.inicio[izquierda.uid] + izquierda.duracion_min
                    )
                    if self.relajar_topes:
                        slack = self.model.NewIntVar(
                            0, 24 * 60,
                            f"exceso_jornada_{docente_id}_{dia}_"
                            f"{izquierda.uid}_{derecha.uid}",
                        )
                        self.model.Add(
                            fin_derecha - self.inicio[izquierda.uid]
                            <= MAX_TEACHER_DAILY_SPAN_MIN + slack
                        ).OnlyEnforceIf([pi, pj])
                        self.model.Add(
                            fin_izquierda - self.inicio[derecha.uid]
                            <= MAX_TEACHER_DAILY_SPAN_MIN + slack
                        ).OnlyEnforceIf([pi, pj])
                        self.terminos_objetivo.append(slack * 50_000)
                    else:
                        self.model.Add(
                            fin_derecha - self.inicio[izquierda.uid]
                            <= MAX_TEACHER_DAILY_SPAN_MIN
                        ).OnlyEnforceIf([pi, pj])
                        self.model.Add(
                            fin_izquierda - self.inicio[derecha.uid]
                            <= MAX_TEACHER_DAILY_SPAN_MIN
                        ).OnlyEnforceIf([pi, pj])

    def _agregar_recesos_largos(self) -> None:
        if not self.recesos_estrictos:
            return
        por_semana_dia: dict[tuple[int, int, int], list[Actividad]] = defaultdict(list)
        for actividad in self.actividades:
            if actividad.docente_id is None:
                continue
            for semana in range(actividad.semana_inicio, actividad.semana_fin):
                for dia in self.ctx.dias:
                    if (actividad.uid, dia) in self.presente:
                        por_semana_dia[
                            (actividad.docente_id, semana, dia)
                        ].append(actividad)

        grupos: dict[tuple[int, int, tuple[int, ...]], list[Actividad]] = {}
        for (docente_id, _, dia), actividades in por_semana_dia.items():
            if len(actividades) < 2:
                continue
            clave = (docente_id, dia, tuple(sorted(a.uid for a in actividades)))
            grupos.setdefault(clave, actividades)

        for (docente_id, dia, _), actividades in sorted(grupos.items()):
            actividades = sorted(actividades, key=lambda a: a.uid)
            presentes = [
                self.presente[(actividad.uid, dia)]
                for actividad in actividades
            ]
            hay_clases = self.model.NewBoolVar(
                f"docente_activo_{docente_id}_{dia}_{actividades[0].uid}"
            )
            self.model.AddMaxEquality(hay_clases, presentes)

            arcos: list[tuple[int, int, cp_model.IntVar]] = [
                (0, 0, hay_clases.Not())
            ]
            por_nodo = {
                indice + 1: actividad
                for indice, actividad in enumerate(actividades)
            }
            acumuladas = {
                nodo: self.model.NewIntVar(
                    0,
                    MAX_TEACHER_DAILY_ACAD_HOURS,
                    f"horas_continuas_{docente_id}_{dia}_{actividad.uid}",
                )
                for nodo, actividad in por_nodo.items()
            }

            for nodo, actividad in por_nodo.items():
                presente = self.presente[(actividad.uid, dia)]
                arcos.append((nodo, nodo, presente.Not()))
                primero = self.model.NewBoolVar(
                    f"primera_clase_{docente_id}_{dia}_{actividad.uid}"
                )
                ultimo = self.model.NewBoolVar(
                    f"ultima_clase_{docente_id}_{dia}_{actividad.uid}"
                )
                arcos.extend(((0, nodo, primero), (nodo, 0, ultimo)))
                self.model.Add(
                    acumuladas[nodo] == actividad.horas_academicas
                ).OnlyEnforceIf(primero)

            for nodo_izq, izquierda in por_nodo.items():
                for nodo_der, derecha in por_nodo.items():
                    if nodo_izq == nodo_der:
                        continue
                    siguiente = self.model.NewBoolVar(
                        f"siguiente_{docente_id}_{dia}_"
                        f"{izquierda.uid}_{derecha.uid}"
                    )
                    arcos.append((nodo_izq, nodo_der, siguiente))
                    descanso = self.model.NewBoolVar(
                        f"descanso45_{docente_id}_{dia}_"
                        f"{izquierda.uid}_{derecha.uid}"
                    )
                    fin_izquierda = (
                        self.inicio[izquierda.uid] + izquierda.duracion_min
                    )
                    self.model.Add(
                        self.inicio[derecha.uid] >= fin_izquierda
                    ).OnlyEnforceIf(siguiente)
                    self.model.Add(
                        self.inicio[derecha.uid]
                        >= fin_izquierda + LONG_BREAK_MIN
                    ).OnlyEnforceIf([siguiente, descanso])
                    self.model.Add(
                        self.inicio[derecha.uid]
                        <= fin_izquierda + LONG_BREAK_MIN - 1
                    ).OnlyEnforceIf([siguiente, descanso.Not()])
                    self.model.Add(
                        acumuladas[nodo_der] == derecha.horas_academicas
                    ).OnlyEnforceIf([siguiente, descanso])
                    self.model.Add(
                        acumuladas[nodo_izq] <= LONG_BREAK_THRESHOLD - 1
                    ).OnlyEnforceIf([siguiente, descanso.Not()])
                    self.model.Add(
                        acumuladas[nodo_der]
                        == acumuladas[nodo_izq] + derecha.horas_academicas
                    ).OnlyEnforceIf([siguiente, descanso.Not()])

            self.model.AddCircuit(arcos)

    def _agregar_limites_cohorte(self) -> None:
        por_cohorte_semana: dict[tuple, list[Actividad]] = defaultdict(list)
        for actividad in self.actividades:
            for semana in range(actividad.semana_inicio, actividad.semana_fin):
                por_cohorte_semana[
                    (actividad.oferta.cohorte, semana)
                ].append(actividad)

        parejas: set[tuple[int, int]] = set()
        for actividades in por_cohorte_semana.values():
            for indice, izquierda in enumerate(actividades):
                for derecha in actividades[indice + 1:]:
                    parejas.add(
                        (min(izquierda.uid, derecha.uid),
                         max(izquierda.uid, derecha.uid))
                    )

        for izquierda_uid, derecha_uid in sorted(parejas):
            izquierda = self.por_uid[izquierda_uid]
            derecha = self.por_uid[derecha_uid]
            for dia in self.ctx.dias:
                presente_izquierda = self.presente.get((izquierda_uid, dia))
                presente_derecha = self.presente.get((derecha_uid, dia))
                if presente_izquierda is None or presente_derecha is None:
                    continue
                izquierda_antes = self.model.NewBoolVar(
                    f"cohorte_{izquierda_uid}_antes_{derecha_uid}_{dia}"
                )
                derecha_antes = self.model.NewBoolVar(
                    f"cohorte_{derecha_uid}_antes_{izquierda_uid}_{dia}"
                )
                ambas = [presente_izquierda, presente_derecha]
                self.model.AddBoolOr(
                    [izquierda_antes, derecha_antes]
                ).OnlyEnforceIf(ambas)
                self.model.Add(
                    self.inicio[derecha_uid]
                    >= self.inicio[izquierda_uid] + izquierda.duracion_min
                ).OnlyEnforceIf([*ambas, izquierda_antes])
                self.model.Add(
                    self.inicio[derecha_uid]
                    + derecha.duracion_min
                    - self.inicio[izquierda_uid]
                    <= MAX_COHORT_DAILY_SPAN_MIN
                ).OnlyEnforceIf([*ambas, izquierda_antes])
                self.model.Add(
                    self.inicio[izquierda_uid]
                    >= self.inicio[derecha_uid] + derecha.duracion_min
                ).OnlyEnforceIf([*ambas, derecha_antes])
                self.model.Add(
                    self.inicio[izquierda_uid]
                    + izquierda.duracion_min
                    - self.inicio[derecha_uid]
                    <= MAX_COHORT_DAILY_SPAN_MIN
                ).OnlyEnforceIf([*ambas, derecha_antes])

    def _agregar_primer_inicio_cohorte(self) -> None:
        """Impide que III-VI empiecen su jornada después de las 20:00.

        La regla se evalúa por cohorte, semana y día. Si la cohorte tiene al
        menos una actividad ese día, alguna de ellas debe comenzar a más tardar
        a las 20:00. No se exige que todas empiecen temprano: las sesiones
        posteriores pueden usar la noche completa.
        """
        por_grupo: dict[tuple, dict[int, Actividad]] = defaultdict(dict)
        for actividad in self.actividades:
            if actividad.oferta.curso.semestre_num < 3:
                continue
            for semana in range(actividad.semana_inicio, actividad.semana_fin):
                for dia in self.ctx.dias:
                    if (actividad.uid, dia) not in self.presente:
                        continue
                    por_grupo[
                        (actividad.oferta.cohorte, semana, dia)
                    ][actividad.uid] = actividad

        for (cohorte, semana, dia), grupo in sorted(por_grupo.items()):
            actividades = list(grupo.values())
            presentes = [
                self.presente[(actividad.uid, dia)] for actividad in actividades
            ]
            hay_clases = self.model.NewBoolVar(
                f"hay_clases_{abs(hash((cohorte, semana, dia))) % 10**9}"
            )
            self.model.AddMaxEquality(hay_clases, presentes)

            tempranas: list[cp_model.BoolVar] = []
            for actividad in actividades:
                presente = self.presente[(actividad.uid, dia)]
                temprana = self.model.NewBoolVar(
                    f"inicio_temprano_{actividad.uid}_{semana}_{dia}"
                )
                self.model.Add(temprana <= presente)
                self.model.Add(
                    self.inicio[actividad.uid] <= MAX_COHORT_FIRST_CLASS_START_MIN
                ).OnlyEnforceIf([presente, temprana])
                self.model.Add(
                    self.inicio[actividad.uid] >= MAX_COHORT_FIRST_CLASS_START_MIN + 1
                ).OnlyEnforceIf([presente, temprana.Not()])
                tempranas.append(temprana)

            self.model.Add(sum(tempranas) >= hay_clases)

    def _factor_prioridad_docente_id(self, docente_id: int | None) -> int:
        if docente_id is None:
            return 1
        docente = self.ctx.docentes.get(docente_id)
        if docente is None:
            return 1
        contrato = sin_acentos(docente.tipo_contrato)
        if "PARCIAL" in contrato or "MEDIO" in contrato:
            return FACTOR_PRIORIDAD_TIEMPO_PARCIAL
        return 1

    def _factor_prioridad_docente(self, actividad: Actividad) -> int:
        return self._factor_prioridad_docente_id(actividad.docente_id)

    def _docente_tiempo_parcial(self, docente_id: int | None) -> bool:
        if docente_id is None:
            return False
        docente = self.ctx.docentes.get(docente_id)
        if docente is None:
            return False
        contrato = sin_acentos(docente.tipo_contrato)
        return "PARCIAL" in contrato or "MEDIO" in contrato

    def _minutos_disponibilidad_semana(self, docente_id: int | None) -> int:
        """Minutos de disponibilidad activa declarados por el docente."""
        docente = self.ctx.docentes.get(docente_id) if docente_id is not None else None
        if docente is None or not docente.usa_restriccion:
            return 10**9
        total = 0
        for dia in self.ctx.dias:
            for inicio, fin in docente.disponibilidad.get(dia, ()):
                inicio = max(int(inicio), self.ctx.franja.inicio_min)
                fin = min(int(fin), self.ctx.franja.cierre_min)
                if fin > inicio:
                    total += fin - inicio
        return total

    def _clave_prioridad_docente(
        self, actividad: Actividad
    ) -> tuple[int, int, int, int]:
        """Ordena primero a los docentes con agendas más restrictivas.

        El primer componente separa docentes con disponibilidad activa (0),
        docentes de tiempo parcial sin franjas declaradas (1) y el resto (2).
        Dentro del primer grupo se prioriza la menor cantidad de minutos
        disponibles y, luego, el menor dominio de pares candidatos. La
        disponibilidad sigue siendo una restricción dura: esto solo guía la
        ramificación para ubicar primero los recursos escasos.
        """
        docente = (
            self.ctx.docentes.get(actividad.docente_id)
            if actividad.docente_id is not None
            else None
        )
        tiene_disponibilidad = bool(
            docente
            and docente.usa_restriccion
            and any(docente.disponibilidad.values())
        )
        if tiene_disponibilidad:
            grupo = 0
            minutos = self._minutos_disponibilidad_semana(actividad.docente_id)
        elif self._docente_tiempo_parcial(actividad.docente_id):
            grupo = 1
            minutos = 10**9
        else:
            grupo = 2
            minutos = 10**9
        return (
            grupo,
            minutos,
            len(self.pares.get(actividad.uid, ())),
            actividad.uid,
        )

    def _priorizar_docentes_restrictivos(self) -> None:
        """Ramifica primero por docentes con disponibilidad más cerrada.

        La disponibilidad ya es una restricción dura: esta estrategia no relaja
        nada. Solo guía la búsqueda para resolver antes las agendas ajustadas y
        evitar que docentes con horarios amplios consuman primero los cupos
        escasos. Los docentes de tiempo parcial sin franjas declaradas también
        se priorizan, después de los que tienen disponibilidad activa.
        """
        actividades = [
            actividad
            for actividad in self.actividades
            if actividad.uid in self.dia
            and self._clave_prioridad_docente(actividad)[0] < 2
        ]
        actividades.sort(key=self._clave_prioridad_docente)
        variables: list[cp_model.IntVar] = []
        for actividad in actividades:
            variables.append(self.dia[actividad.uid])
            variables.append(self.inicio[actividad.uid])
        if not variables:
            return
        self.model.AddDecisionStrategy(
            variables,
            cp_model.CHOOSE_FIRST,
            cp_model.SELECT_MIN_VALUE,
        )

    def _agregar_objetivo(self) -> None:
        if self.sin_objetivo:
            return
        usados: dict[tuple, list[cp_model.IntVar]] = defaultdict(list)
        for actividad in self.actividades:
            for dia in self.ctx.dias:
                indicador = self.presente.get((actividad.uid, dia))
                if indicador is not None:
                    usados[(actividad.oferta.cohorte, dia)].append(indicador)
        for (cohorte, dia), indicadores in usados.items():
            usado = self.model.NewBoolVar(f"grupo_usa_{abs(hash((cohorte, dia))) % 10**9}")
            self.model.AddMaxEquality(usado, indicadores)
            self.terminos_objetivo.append(usado * 20)

        # Preferencia de banda. La disponibilidad docente ya es una restricción
        # dura y no se penaliza: simplemente queda fuera del dominio. Solo se
        # penaliza caer en una banda secundaria de la cohorte. No hay nombres
        # de docentes: el criterio se deriva de los datos de cada oferta.
        for actividad in self.actividades:
            factor_prioridad = self._factor_prioridad_docente(actividad)
            en_banda_preferente = self.preferencia_banda.get(actividad.uid)
            if en_banda_preferente is not None:
                self.terminos_objetivo.append(
                    en_banda_preferente.Not()
                    * PENALIZACION_DESVIACION_FRANJA
                    * factor_prioridad
                )

        # Evitar, cuando sea posible, días con muchas semanas feriadas: la
        # persistencia omite esas semanas y el curso perdería horas.
        if self.ctx.calendario.disponible:
            for actividad in self.actividades:
                factor_prioridad = self._factor_prioridad_docente(actividad)
                for dia in self.ctx.dias:
                    indicador = self.presente.get((actividad.uid, dia))
                    if indicador is None:
                        continue
                    feriadas = sum(
                        1 for semana in range(
                            actividad.semana_inicio, actividad.semana_fin
                        )
                        if self.ctx.calendario.es_feriado(semana, dia)
                        or self.ctx.calendario.fuera_de_periodo(semana, dia)
                    )
                    if feriadas:
                        self.terminos_objetivo.append(
                            indicador * feriadas * 1_000 * factor_prioridad
                        )

        # Preferir los inicios tempranos dentro de la ventana permitida.
        for actividad in self.actividades:
            self.terminos_objetivo.append(
                self.inicio[actividad.uid]
                * self._factor_prioridad_docente(actividad)
            )

        if self.terminos_objetivo:
            self.model.Minimize(sum(self.terminos_objetivo))


def _rangos_se_solapan(a0: int, a1: int, b0: int, b1: int) -> bool:
    return max(a0, b0) < min(a1, b1)
