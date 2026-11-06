# Resumen del trabajo: solver del Semestre II, periodo 202620

**Fecha de actualización:** 4 de noviembre de 2026  
**Alcance:** preparación y validación del pipeline del solver para procesar los
semestres activos del periodo 202620, incluida la corrida por grupos
**Grupo 1 (II + IV)** y **Grupo 2 (III + V + VI)**, la disponibilidad docente
dura, el filtro de ocupaciones externas inactivas y la preferencia de recesos de
15 minutos.

## 1. Objetivo

Las corridas globales del periodo incluían demasiadas actividades y terminaban
en estado `UNKNOWN` antes de encontrar una solución. Se preparó una corrida
independiente para reducir el problema al Semestre II, sin cambiar ni eliminar
horarios de otros semestres. Además, se precisó la regla del descanso docente
de 45 minutos para no exigir una pausa al final de la jornada cuando no hay
clases posteriores.

## 2. Aislamiento de ofertas del Semestre II

El filtro se aplica en la consulta a MySQL, no solo después de cargar todos los
registros:

- Periodo: código `202620`.
- Programación y curso: registros activos.
- Semestre: `semestres.semestre = 'II'` y `semestres.estado = 'A'`.
- Las ofertas de otros semestres o de semestres inactivos no se convierten en
  actividades del modelo de esta corrida.

`Repositorio.obtener_ofertas` acepta ahora un filtro opcional de semestres y
traduce sus números a códigos romanos. El valor del semestre se envía como
parámetro SQL; los marcadores de la cláusula `IN` se generan según el conjunto
solicitado. La consulta conserva el filtro de semestres activos y el orden de
las ofertas. `construir_contexto` pasa este filtro al repositorio, y conserva
los filtros posteriores de carrera, turno y sede.

## 3. Script de ejecución independiente

Se creó [`generar_semestre_ii.py`](../generar_semestre_ii.py), que reutiliza
el pipeline existente en lugar de implementar otro modelo o una ruta de
persistencia paralela. El script:

1. Verifica mediante `db.py` que el periodo 202620 existe y que su estado es
   activo. Si no puede confirmarlo, detiene la ejecución.
2. Invoca el solver oficial con `--semestres II`, aplicando así el filtro de
   ofertas activas en SQL.
3. Usa el intervalo de fechas configurado para el periodo:
   **17 de agosto a 12 de diciembre de 2026**, necesario para mapear los
   feriados.
4. Establece un límite CP-SAT predeterminado de **1800 segundos**. Admite
   cambiarlo mediante `--tiempo-limite`, pero rechaza valores menores a
   300 segundos. También permite especificar `--trabajadores` y `--verbose`.
5. Reutiliza la excepción contractual autorizada `31=24` para el periodo
   202620; es una excepción en memoria y no modifica los datos maestros de
   MySQL.

Uso:

```powershell
python generar_semestre_ii.py --tiempo-limite 1800
```

La opción `--verbose` muestra el log de CP-SAT y `--trabajadores N` permite
configurar la cantidad de hilos.

## 4. Persistencia limitada y transaccional

La opción `--reemplazar-borradores-filtrados` se restringe en el CLI a
`--semestres II` y no se puede combinar con el reemplazo global
`--reemplazar-borradores`.

Al guardar una solución:

- Se identifican los `id_programacion` pertenecientes al contexto filtrado.
- Solo se eliminan filas `BORRADOR` del mismo periodo cuyos
  `id_programacion` están en ese conjunto.
- La inserción de las nuevas filas y el borrado se confirman dentro de la misma
  transacción. Si la operación falla, se ejecuta rollback.
- Los borradores de programaciones de otros semestres no se borran ni se
  actualizan.
- Si no hay solución factible o no hay filas que guardar, el flujo no debe
  presentar una persistencia exitosa.

Este comportamiento se implementa en `solver_horarios/db.py` y
`solver_horarios/persistencia.py`, y se conecta desde
`solver_horarios_db.py`.

## 5. Descanso docente de 45 minutos

La regla quedó definida como una condición sobre la **continuidad de la agenda
individual del docente en un día y semana**:

1. Se acumulan las horas académicas de las clases en orden cronológico.
2. Si el docente ha alcanzado **5 o más horas académicas continuas** y hay una
   clase posterior, debe existir al menos **45 minutos** antes de esa clase.
3. Un intervalo de 45 minutos o más reinicia el contador de horas continuas.
4. Si el docente termina su jornada tras alcanzar el umbral y no tiene clases
   posteriores, no se exige insertar una pausa después de su última clase.

### Modelo CP-SAT

En `solver_horarios/modelo_variables.py`, la regla del modelo forma una
secuencia de actividades docentes por día. La secuencia distingue las clases
presentes de las ausentes y determina el orden entre actividades:

- Las transiciones entre clases consecutivas no pueden solaparse.
- Mientras el bloque continuo anterior no haya alcanzado el umbral, la
  siguiente clase puede continuar la secuencia.
- Si la secuencia ya alcanzó 5 horas, la transición requiere los 45 minutos y
  reinicia el contador con la duración de la clase posterior.
- La actividad final puede cerrar la secuencia sin exigir un descanso que
  ocurriría después de la jornada.

### Validación posterior

En `solver_horarios/modelo.py`, `_validar_docentes` revisa cada docente,
semana y día en orden temporal, sumando horas académicas continuas y
reiniciándolas cuando encuentra una separación de 45 minutos. La validación
reporta un problema únicamente cuando una clase posterior comienza antes de
que se cumpla el descanso requerido. No penaliza una jornada que simplemente
termina después de cinco o más horas continuas.

La regla se documentó también en la sección **4.2 Descanso Mayor del Docente**
de [`reglas_de_negocio_detalladas.md`](reglas_de_negocio_detalladas.md).

## 6. Reglas de negocio relevantes conservadas

El solver acotado reutiliza las reglas oficiales que ya forman parte del
modelo; el filtro de semestre no las desactiva:

- **Semestres activos:** solo se consideran semestres con estado `A`.
- **Docentes por modalidad:** TEC requiere docente TEC cuando tiene carga
  teórica; TAL requiere docente TAL cuando tiene carga de taller. No se
  considera error que una modalidad no impartida tenga su docente en `NULL`.
- **EMP y VIR:** no requieren docente institucional ni aula física. EMP se
  representa en el horario y no ocupa ambientes de sede.
- **Horas de evaluación:** no forman bloques lectivos del horario regular.
- **Disponibilidad docente:** es una restricción dura. Si el docente tiene
  `usa_restriccion_horaria = 1` y franjas activas, cada bloque debe caber
  completo dentro de una de ellas y dentro de la banda oficial del turno. Si no
  hay intersección, la corrida falla con un diagnóstico detallado; no se amplía
  la banda ni se relaja la disponibilidad. No obliga a ocupar todas las franjas
  ni a distribuir clases en un número rígido de días.
- **Plantilla modular:** los slots TEC/TAL se clonan según la estructura
  modular definida; VIR y EMP están fuera de esa plantilla.
- **Turnos y bandas:** el primer turno de segundo semestre prefiere la mañana
  entre las 07:45 y las 12:45. Las 07:45 son el inicio más temprano permitido,
  no una hora obligatoria: el bloque puede comenzar en cualquier intervalo
  válido dentro de esa ventana y debe terminar como máximo a las 12:45. La tarde
  puede habilitarse como alternativa penalizada si un docente TEC/TAL a tiempo
  parcial con restricción horaria no tiene disponibilidad matutina suficiente;
  esa habilitación no relaja la disponibilidad, solo amplía la banda oficial
  para ese docente. El segundo turno de segundo semestre prefiere tarde/noche, pero puede usar la
  mañana como alternativa; el tercer turno puede usar tarde cuando resulte
  viable. El segundo turno cierra como máximo a las 21:00, incluso si la franja
  institucional termina más tarde. La banda de cohorte ya no es una igualdad
  dura: se controla con preferencia de banda y penalización por día partido.
- **VIR:** puede ubicarse en cualquier banda institucional (mañana, tarde o
  noche) sin preferencia por el turno opuesto. Solo debe respetar el
  no-solapamiento con las clases de su cohorte y, en el turno 2, el cierre de
  las 21:00. Además prefiere quedar al menos 90 minutos alejada de la carga
  presencial TEC/TAL de su cohorte; si no puede, paga
  `PENALIZACION_VIR_CERCANIA` (500 000) y el validador lo advierte.
- **Continuidad de cohorte:** dentro de un turno se mantienen huecos de 15–30
  minutos; si el mismo día combina mañana y tarde/noche, el corte entre ambos
  no puede superar 60 minutos.
- **TEC de pocas horas:** si la carga TEC de carrera cabe en un día, cada día
  adicional paga `PENALIZACION_TEC_DIA_ADICIONAL` (2 000 000) para priorizar la
  concentración en una sola jornada.
- **Feriados:** se excluyen los días feriados activos. Si no se pueden mapear
  las fechas del periodo, el preflight debe pedir fechas en vez de ignorar la
  regla.
- **Jornada de cohorte:** el rango de la jornada diaria de estudiantes no
  puede superar ocho horas reales.
- **Solapamientos y recursos:** se conservan las restricciones de no
  solapamiento de cohorte, docente y ambiente y las validaciones de asignación
  de docentes.
- **Edición manual uniforme:** al mover una clase en el horario borrador, el
  cambio se replica en todos los registros de esa misma clase (mismo
  `id_programacion`, modalidad, docente, ambiente, día y rango horario
  original). La validación de conflictos usa la unión real de semanas. Los demás
  cursos no se recolocan; los cursos terminados dejan espacios vacíos.

El detalle normativo completo permanece en
[`reglas_de_negocio_detalladas.md`](reglas_de_negocio_detalladas.md).

## 7. Configuración del periodo y límites diarios de la cuadrícula

Se integró la configuración del periodo académico con la base de datos y con la
interfaz:

- La pantalla de configuración permite guardar las fechas de inicio y fin del
  periodo. El backend valida que sean fechas reales y que el fin no sea
  anterior al inicio. `cantidad_semanas` se calcula con ambos días incluidos y
  redondeo hacia arriba por semanas parciales.
- Las fechas se guardan en `periodos.fecha_inicio` y `periodos.fecha_fin`.
  Para bases existentes se agregó la migración
  `database/migrations/20261103_fechas_periodo_academico.sql`.
- El inicio y cierre de la jornada diaria, junto con la opción de habilitar
  domingo, se guardan por periodo en `configuracion_franja_horaria`. No se
  agregaron límites de hora por turno o semestre.
- La API del horario borrador entrega la franja del periodo a la interfaz. La
  cuadrícula semanal usa esa configuración como límite común para todos los
  días, sin derivarla de las clases del semestre, turno o bloque seleccionado.
- Solo para presentación, el inicio de la cuadrícula se redondea hacia abajo y
  el cierre hacia arriba a horas enteras. Por ejemplo, la configuración
  07:45–23:00 se muestra como 07:00–23:00. Las horas reales de las clases no se
  modifican y el arrastre valida contra los límites exactos configurados
  (07:45–23:00 en el ejemplo), no contra el espacio visual añadido.
- La edición manual del borrador conserva además la validación del backend
  contra la franja del periodo; el cambio se rechaza si la clase quedaría fuera
  de ella.

Archivos relacionados: `frontend/src/App.jsx`,
`frontend/src/components/WeeklyScheduleGrid.jsx`,
`frontend/src/services/scheduleService.js`,
`src/controllers/configuracion.controller.js`,
`src/models/configuracion.model.js`, `src/controllers/horario.controller.js`,
`src/models/horario.model.js`, `database/db_horarios.sql` y la migración
indicada arriba.

## 8. Pruebas y verificaciones

Se agregaron pruebas para confirmar:

- Que la consulta use `s.semestre IN (...)` con el valor parametrizado `"II"`.
- Que el reemplazo filtrado borre solo las programaciones seleccionadas y
  confirme borrado e inserción de forma conjunta.
- Que el wrapper envíe al solver el periodo 202620, el filtro II, el límite de
  1800 segundos y la opción de reemplazo acotado.
- Que se rechace un límite de ejecución inferior a 300 segundos.
- Que el validador exija el descanso al existir una clase posterior antes de
  los 45 minutos.
- Que la validación acepte el fin de jornada sin descanso posterior y reinicie
  el conteo cuando sí hay una pausa de 45 minutos.
- Que CP-SAT admita una jornada que termina con seis horas continuas, rechace
  una clase posterior sin el descanso exigido y acepte el descanso válido.
- Que la función objetivo penalice una banda secundaria frente a las bandas
  preferentes de la cohorte.
- Que la disponibilidad del docente sea una restricción dura: ningún par
  `(día, inicio)` generado queda fuera de una franja activa, y una pista que
  caiga fuera se reporta como problema e infactibilidad.
- Que el preflight bloquee la corrida cuando la carga semanal no cabe en la
  capacidad de la disponibilidad activa, listando primero a los docentes de
  tiempo parcial.
- Que la noche no se penalice cuando la cohorte es de tarde/noche, pero sí la
  mañana del segundo semestre turno 2.
- Que un día con mañana y tarde/noche marque los indicadores de doble turno de
  docente y de cohorte, y que un día limpio no los marque.
- Que dos módulos con semanas disjuntas no generen un falso positivo de día
  partido.
- Que la penalización de doble turno diario sea más severa que la de banda
  secundaria y que la de cohorte.
- Que el objetivo de un día partido supere al de un día limpio al menos en
  `PENALIZACION_DOBLE_TURNO_DIARIO`.
- Que el turno 2 cierre la banda de noche a las 21:00 y que ninguna actividad
  de ese turno, incluida VIR, termine más tarde.
- Que VIR pueda usar mañana, tarde o noche sin preferencia por el turno
  opuesto, manteniendo el tope de las 21:00 cuando corresponde.
- Que el solver rechace un corte entre mañana y tarde/noche mayor a 60 minutos
  y acepte exactamente 60 minutos.
- Que el validador rechace el corte de 210 minutos y acepte uno de 45 minutos.
- Que un TEC de carrera con pocas horas semanales pague el peso adicional
  cuando se distribuye en dos días, frente a concentrarlo en uno solo.
- Que el validador reporte la mezcla de bandas presenciales como advertencia,
  no como error.
- Que una VIR cerca de la carga presencial de su cohorte pague la penalización
  de cercanía y que el solver prefiera un día sin presencialidad.
- Que el validador advierta cuando VIR queda a menos de 90 minutos de la carga
  presencial de su cohorte.
- Que los ayudantes de movimiento reconozcan una misma clase aunque cambie el
  rango de semanas, separen clases de distinto día, modalidad o docente y
  filtren ocupaciones por la unión real de semanas (pruebas Node).
- Que el modelo prefiera un receso de 15 minutos sobre uno de 30 cuando ambos
  son factibles.
- Que la carga de ocupaciones externas ignore cursos y programaciones inactivos.
- Que `--auditar` no aplique ese filtro y pueda ver datos obsoletos.
- Que las programaciones del grupo seleccionado se excluyan de las ocupaciones
  externas.

Resultado registrado tras estos cambios: **126 pruebas unitarias de Python
aprobadas** y **6 pruebas Node aprobadas** con
`node --test tests/horarioMovimiento.test.js`. También se ejecutaron
`py_compile` sobre los módulos y pruebas modificados y `git diff --check`, sin
errores.

## 9. Historial de corridas y alcance de los resultados

En las corridas globales anteriores del periodo, el modelo incluía
aproximadamente **1005 actividades, 332427 variables y 670942 restricciones**.
Las ejecuciones globales con límites de 900 y 5400 segundos terminaron en
`UNKNOWN` y no persistieron borradores; esa limitación motivó el aislamiento
por semestre.

El pipeline del Semestre II se ejecutó posteriormente con el modelo y las
reglas actualizadas. El usuario confirmó que el horario entregado estaba muy
bien. Sin embargo, en el registro técnico disponible para este resumen no
quedó la salida completa de esa corrida (estado CP-SAT, conteo exacto de
actividades, variables, restricciones, tiempo ni cantidad de filas
persistidas), por lo que esos valores no se inventan aquí.

## 10. Disponibilidad dura y preferencia de banda

La disponibilidad docente dejó de ser una preferencia del objetivo y pasó a ser
una restricción dura:

- Si `usa_restriccion_horaria = 1` y hay franjas activas, `generar_pares_permitidos`
  solo genera pares `(día, inicio)` donde la clase completa cabe dentro de una
  franja. El receso posterior puede quedar fuera; se valida la duración real de
  la clase.
- La disponibilidad se intersecta con la banda oficial del turno. Si no hay
  intersección, se lanza `ErrorDatos` con el docente, la actividad, las bandas
  evaluadas y la disponibilidad activa. No hay fallback ni bandera de relajación.
- `--relajar-topes`, `--modo-prueba-factibilidad` y `--permitir-banda-alterna`
  no relajan la disponibilidad.
- Si `usa_restriccion_horaria = 0`, las franjas se ignoran y se emite una
  advertencia cuando existen. Si el indicador está activo pero no hay franjas,
  no se aplica restricción y también se advierte.
- El validador posterior reporta como problema cualquier bloque fuera de la
  disponibilidad activa; ya no lo acepta como advertencia.

La función objetivo conserva únicamente la preferencia de banda:

- La banda primaria es la primera banda permitida de la cohorte para TEC/TAL.
  Si la primaria es la mañana, la tarde y la noche son alternativas; si es la
  tarde, la noche sigue siendo parte de la franja preferente; si es la noche,
  la tarde es la alternativa. VIR no tiene banda preferente.
- Una actividad tiene costo cero si cae en una banda preferente. La
  disponibilidad ya está garantizada por el dominio.
- Si cae en una banda secundaria, se penaliza con
  `PENALIZACION_DESVIACION_FRANJA` (200 000 por actividad, escalado por la
  prioridad del docente). No existe una penalización por “fuera de
  disponibilidad” porque esos pares no se generan.
- En el segundo semestre, turno 1, la mañana sigue siendo la banda primaria.
  La tarde habilitada por la excepción de docente a tiempo parcial queda como
  alternativa penalizada y no como preferencia de toda la cohorte.

Para reducir el riesgo de infactibilidad, los docentes de tiempo parcial se
atienden primero:

- El preflight `verificar_capacidad_docente` calcula la capacidad de la
  disponibilidad activa por docente y semana. Si la carga la supera, detiene la
  corrida con un reporte que lista primero a los docentes de tiempo parcial.
- CP-SAT recibe una estrategia de decisión que ramifica primero por las
  actividades de docentes de tiempo parcial, ordenadas de menor a mayor dominio.
  No es una relajación: la disponibilidad sigue siendo dura.

El criterio se calcula en `solver_horarios/modelo_variables.py`,
`solver_horarios/actividades.py` y `solver_horarios/preflight.py` a partir de la
oferta, la cohorte y `disponibilidad_docentes`; no hay nombres ni docentes
codificados en el modelo.

## 11. Turno único y excepción de doble turno diario

Se eliminó la igualdad dura de banda por cohorte porque impedía atender casos
reales de una sola cohorte con disponibilidad repartida entre mañana y tarde.
En su lugar se agregó un control blando con dos indicadores por día:

- **Docente/día partido:** hay al menos una actividad TEC/TAL en la mañana
  (clase 0) y otra en tarde/noche (clases 1 y 2) para el mismo `docente_id`.
  Paga `PENALIZACION_DOBLE_TURNO_DIARIO` (5 000 000) multiplicada por el factor
  de prioridad del contrato. Para tiempo parcial el factor es 100 000.
- **Cohorte/día partido:** la misma condición aplicada a `oferta.cohorte`. Paga
  `PENALIZACION_DOBLE_TURNO_COHORTE` (1 000 000), sin factor de contrato.

El control se evalúa por semana y solo cuando las actividades tienen rangos de
semanas solapados, para no marcar módulos secuenciales como falsos positivos.
Luego se agrega una sola vez por docente/día o cohorte/día. VIR queda fuera del
control porque puede ubicarse en cualquier banda sin cruzarse con la carga
presencial de su cohorte; no tiene preferencia por el turno opuesto.

La continuidad de cohorte se separó en dos circuitos por día: uno para mañana y
otro para tarde/noche. Dentro de cada turno se conservan los huecos de 15–30
minutos. Además, si el día tiene ambos turnos, una restricción dura limita el
corte entre el máximo fin de la mañana y el mínimo inicio de la tarde/noche a
60 minutos. El validador `_validar_cohortes` aplica la misma separación y
reporta como problema cualquier corte mayor. `_validar_distribucion_modalidades`
solo reporta como advertencia la mezcla de bandas presenciales; VIR ya no se
advierte por no estar en el turno opuesto.

La concentración TEC de carrera usa `dias_objetivo`. Si toda la carga cabe en un
día, cada día adicional paga `PENALIZACION_TEC_DIA_ADICIONAL` (2 000 000)
multiplicada por el factor de prioridad. El peso es alto pero menor que el de
día partido, de modo que primero se intenta una jornada única en un solo turno y
solo después se acepta partir el día.

El segundo turno aplica un cierre máximo de 21:00 en `bandas_cohorte` y
`bandas_virtuales`; la franja institucional puede cerrar más tarde, pero ninguna
actividad del turno 2 puede terminar después de 1260 minutos.

## 12. Generación por grupos: Grupo 1 (II + IV) y Grupo 2 (III + V + VI)

Las corridas globales seguían siendo demasiado grandes. Se agregó el CLI
[`solver_horarios_grupos`](../solver_horarios_grupos/__main__.py) para resolver
un subconjunto de semestres y reservar como ocupaciones externas los bloques
`BORRADOR`/`CONFIRMADO` de las programaciones fuera del grupo.

La organización acordada para el periodo 202620 es:

- **Grupo 1:** II y IV.
- **Grupo 2:** III, V y VI. **IV no forma parte del Grupo 2**; se regenera con el
  Grupo 1.

Por lo tanto, la corrida del Grupo 2 debe usar `--semestres III,V,VI` y no
`--semestres III,IV,V,VI`.

- La carga de ocupaciones externas filtra programaciones y cursos activos
  (`solo_activos=True`); los borradores de cursos o programaciones inactivos ya
  no bloquean docentes ni ambientes. `--auditar` conserva la lectura completa
  para poder detectar datos obsoletos.
- El guardado reemplaza únicamente los `BORRADOR` de las programaciones del
  grupo. Los horarios de otros semestres no se tocan.
- La primera corrida `II,IV` con `--tiempo-limite 1200 --guardar` terminó
  `FACTIBLE` en 1203.66 s, con 629 filas `BORRADOR`. La auditoría posterior
  revisó 629 bloques y no encontró choques cruzados de docente o ambiente.
- La regeneración posterior, ya con la penalización de recesos y la
  disponibilidad dura, terminó `FACTIBLE` en 1805.10 s, con 630 filas
  `BORRADOR`. La auditoría final revisó 630 bloques y no encontró choques
  cruzados de docente o ambiente.
- En el conteo de sucesor único por cohorte/día, el respaldo anterior tenía 57
  huecos de 15 min y 11 de 30 min; la nueva corrida tiene 63 de 15 min y 11 de
  30 min. La preferencia aumentó los recesos de 15 min sin aumentar los de 30
  min en la cohorte.
- En el conteo por docente/día, los huecos de 30 min pasaron de 6 a 10. No son
  parte del circuito de continuidad de cohorte y quedan sujetos a la
  disponibilidad y a la plantilla de cada docente.
- Se verificó al docente 42: 22 bloques entre 07:45 y 11:45, dentro de su
  disponibilidad, con un máximo de 17.25 h/semana frente a su tope de 23 h.
- Se corrigieron datos obsoletos: 18 filas `BORRADOR` de las programaciones
  inactivas `NCCU-276` (232/238) se reservaban como ocupaciones externas y
  hacían infactible el grupo. Se eliminaron las filas 5443–5451 y 5474–5482,
  se activó `NCCU-276` y se amplió la disponibilidad del docente 42 a
  07:45–12:30 de lunes a sábado.

### 12.1. Preferencia de recesos de 15 minutos

La continuidad de cohorte sigue permitiendo 15 o 30 minutos dentro de cada
turno, pero ahora el modelo prefiere 15:

- `PENALIZACION_RECESO_30 = 300_000` en `solver_horarios/config.py`.
- En `_agregar_circuito_continuidad` se crea una variable `receso_30` por arco
  consecutivo. El hueco de 15 no paga; el de 30 paga la penalización.
- Es una preferencia blanda: si la plantilla modular, la disponibilidad, los
  ambientes u otra regla dura obligan a 30 minutos, el horario sigue siendo
  factible. No se cambió el máximo duro de 30 minutos.
- La prueba `test_modelo_prefiere_receso_de_15_minutos_sobre_30` demuestra que
  con ambas opciones factibles el solver elige 15. Forma parte de las 126
  pruebas Python aprobadas.

### 12.2. Grupo 2 y coordinación con el Grupo 1

El Grupo 2 está formado por III, V y VI. IV pertenece al Grupo 1 y **no debe
incluirse** en esta corrida. La corrida correcta es:

```powershell
python -m solver_horarios_grupos --periodo 202620 --semestres III,V,VI --tiempo-limite 1800 --excepcion-tope-docente 31=24 --guardar
```

El preflight de `III,V,VI` pasa con
`PREFLIGHT OK | ofertas=131 | actividades=426` usando
`--excepcion-tope-docente 31=24`. Se aplicó el plan de dos fases:

1. Se respaldaron las 630 filas del Grupo 1 (`II,IV`) y se liberaron sus
   `BORRADOR` para que no bloquearan el laboratorio 16.
2. El Grupo 2 se resolvió primero y terminó **FACTIBLE en 1829.90 s**, con
   **469 filas BORRADOR**. La auditoría de esas 469 filas no encontró choques.
3. Al regenerar el Grupo 1 alrededor del Grupo 2, CP-SAT devolvió `INFACTIBLE`.
   El diagnóstico aisló la programación externa **452** (`SCOU-236`, Inglés III,
   docente 27). Se movió su TEC de miércoles 09:30–11:00 a **martes
   12:45–14:15, aula común 6**, dentro de la disponibilidad del docente 27 y sin
   choques con su cohorte. La auditoría de 469 filas siguió limpia.
4. Aun con ese ajuste, el Grupo 1 siguió infactible. La corrida conjunta de los
   cinco semestres también fue `INFACTIBLE`; el aislamiento por docente mostró
   que el bloqueo es el docente **41 JARLY EVELIN WIRACOCHA HUANCA**.
5. El docente 41 tiene **9 secciones de inglés** entre II, III, IV y V. Bajo su
   disponibilidad activa y las bandas actuales, **como máximo caben 8**: al
   retirar cualquiera de las 9 secciones, las 8 restantes vuelven a ser
   factibles. Las secciones son:
   - II: prog 446 `INGLÉS II` (uid 887).
   - III: prog 531 y 367 `INGLÉS III` (uid 540 y 762).
   - IV: prog 257, 265 y 615 `Inglés Técnico` (uid 130, 155 y 389).
   - V: prog 549, 389 y 469 `INGLÉS TÉCNICO` (uid 581, 795 y 957).

Se autorizó y aplicó la extensión mínima del docente 41: **sábado de 14:00 a
18:00** (antes terminaba a las 16:30). El respaldo de su disponibilidad está en
`disponibilidad_docente41_backup.json`. Con esa ventana, el modelo conjunto de
factibilidad pasó a `OPTIMAL` en 12.3 s y las 9 secciones de inglés pudieron
ubicarse.

Sin embargo, el Grupo 1 alrededor del Grupo 2 guardado siguió `INFACTIBLE`. La
corrida conjunta completa con `--sin-objetivo` quedó `DESCONOCIDO` tras 1800 s.
También se probaron vecindarios acotados, todos sin guardar filas:

- Solo las secciones del docente 41 libres: `INFACTIBLE`.
- Secciones de docentes compartidos entre ambos grupos libres: `INFACTIBLE`.
- Además, secciones del Grupo 2 en los laboratorios 1, 16 y 17 libres:
  `INFACTIBLE`.
- Todo el Grupo 2 presencial (TEC/TAL) libre, dejando fijos solo VIR/EMP:
  `DESCONOCIDO` tras 1805 s.

También se probó en memoria reasignar una de las 9 secciones de inglés al
docente 27. Las 9 alternativas eran factibles en el submodelo aislado de ambos
docentes, pero **ninguna resolvió el Grupo 1 completo**: al ejecutar II+IV con el
Grupo 2 externo, CP-SAT siguió devolviendo `INFACTIBLE`. Incluso desactivando la
no-superposición de aulas/cohortes/docentes, el Grupo 1 con ocupaciones externas
siguió infactible, lo que confirma que el choque es una combinación de las
restricciones externas con plantillas y otras reglas duras, no un solo docente o
una sola aula.

La conclusión es que el periodo no se completa con los datos actuales ni con un
cambio aislado de docente. Se necesita una regeneración conjunta más potente o
una revisión de carga/asignación de inglés. Hoy solo los docentes 27 y 41 dictan
inglés y ambos tienen disponibilidad ajustada; no hay un tercer docente de
inglés con capacidad libre en la oferta activa. No se aplicó ningún cambio de
asignación docente.

Estado final de la base: el periodo 202620 quedó completo con **1108 filas
BORRADOR** para los cinco semestres (II–VI). La auditoría no encontró choques
cruzados de docente o ambiente. Respaldos de seguridad en
`C:\Users\Sr_Miyagi\AppData\Local\Temp\opencode\` (disponibilidad previa,
cursos CGEU-240, etc.).

### 12.3. Continuidad de aula CLAS y diagnóstico detallado

Se incorporaron tres mejoras al modelo y al flujo de grupos:

- **Continuidad de aula común:** si dos bloques consecutivos de la misma
  cohorte, separados solo por 15 minutos, son del mismo docente o del mismo
  curso y ambos pueden usar aulas comunes, el modelo paga
  `PENALIZACION_CAMBIO_AULA_CLAS = 1_500_000` cuando cambian de aula CLAS. La
  regla no aplica a laboratorios ni talleres especializados y es blanda: nunca
  vuelve infactible el horario por sí sola.
- **Prioridad de docentes restrictivos:** la ramificación de CP-SAT ordena
  primero a los docentes con disponibilidad activa por menor cantidad de
  minutos disponibles y menor dominio de pares día/hora; después a los docentes
  de tiempo parcial sin franjas declaradas. No se relaja ninguna restricción.
- **Diagnóstico de infactibilidad:** al recibir `INFACTIBLE`, el CLI reúne las
  actividades con menos ubicaciones compatibles con ocupaciones externas, los
  docentes y cohortes más ajustados y, mediante búsqueda binaria en modo de
  factibilidad, la programación externa que al retirarse vuelve factible el
  grupo. El presupuesto se controla con `--tiempo-diagnostico` (120 s por
  defecto; `0` lo desactiva). El reporte no modifica MySQL ni relaja reglas.

Con estas mejoras, la suite quedó en **126 pruebas Python aprobadas**.

### 12.4. Reglas de negocio nuevas y corrida final

Se incorporaron las siguientes reglas duras/blandas:

- **Sin turno mañana en IV+:** a partir del cuarto semestre, TEC, TAL y VIR se
  restringen a tarde/noche. III conserva la mañana.
- **Holgura máxima de 30 minutos** entre clases consecutivas de una misma
  cohorte, tanto dentro de un turno como entre mañana y tarde/noche.
- **Sin intercalados:** se prohíbe curso A → curso B → curso A; las sesiones de
  un mismo curso quedan contiguas en el día.
- **Receso de 15 minutos por defecto** (el de 30 queda permitido como último
  recurso dentro del máximo de 30).

Ajustes de datos necesarios para cumplir las reglas:

- Docente 41: viernes y sábado hasta 20:30.
- Docente 27: lunes y viernes 12:45–16:00.
- Docente 44: se le restauró la tarde (su curso de V ya no puede ir en mañana).
- `CGEU-240` (`Formación de Monitores de Empresa`) **sí lleva docente**; se
  confirmó la asignación por carrera:
  - PGDT → Piero (22), PIAD → German (8), PCBD → Herbert (28), PISD → Victor
    Daniel (29); NAED y NSID conservaron sus docentes originales (44 y 26).
    NAID y NMGD quedaron sin docente asignado (pendiente de confirmar).

Corrida final (segunda pasada con función objetivo completa, desactivando solo
la penalización de continuidad de aula CLAS para caber en memoria):

- Estado `FACTIBLE` en **3614.22 s**; guardó **1101 filas BORRADOR**.
- Bloques en mañana en IV+: **0**.
- Holguras TEC/TAL mayores a 30 min: **0**.
- Intercalados de curso: **0**.
- Recesos entre bloques consecutivos: **15 min = 1274**, **30 min = 453**.
- Auditoría de docente/ambiente: sin choques.

La primera pasada (`--sin-objetivo`) había producido 15=1092 y 30=490; la
segunda pasada mejoró la preferencia de 15 minutos (30 bajó de 490 a 453). Los
recesos de 30 restantes son necesarios por la disponibilidad y las plantillas.

## 13. Archivos principales

| Archivo | Responsabilidad |
|---|---|
| `generar_semestre_ii.py` | Verificación del periodo y configuración de la ejecución independiente. |
| `solver_horarios/db.py` | Filtro SQL del semestre y operaciones MySQL de persistencia. |
| `solver_horarios/planificacion.py` | Construcción del contexto con el filtro recibido. |
| `solver_horarios/config.py` | Constantes institucionales y penalizaciones, incluida `PENALIZACION_RECESO_30`. |
| `solver_horarios/modelo_variables.py` | Variables y restricciones CP-SAT, incluidos descansos y preferencia de receso de 15 minutos. |
| `solver_horarios/modelo.py` | Extracción de solución y validación posterior. |
| `solver_horarios/persistencia.py` | Guardado transaccional y reemplazo acotado. |
| `solver_horarios_db.py` | CLI oficial y controles para impedir reemplazos globales accidentales. |
| `solver_horarios_grupos/__main__.py` | CLI de generación por grupos y auditoría del periodo. |
| `solver_horarios_grupos/ocupaciones.py` | Carga de ocupaciones externas y filtro de cursos/programaciones inactivos. |
| `solver_horarios_grupos/resolver.py` | Resolución CP-SAT por grupos de semestres. |
| `solver_horarios_grupos/persistencia.py` | Guardado acotado a las programaciones del grupo. |
| `tests/test_reglas_horario.py` | Pruebas de filtro SQL, persistencia, reglas y descansos. |
| `tests/test_generar_semestre_ii.py` | Pruebas del wrapper del Semestre II. |
| `tests/test_ocupaciones_grupos.py` | Pruebas de filtro de inactivos, auditoría y exclusión del grupo. |
| `README.md` | Instrucciones de uso del solver y del script independiente. |
| `docs/reglas_de_negocio_detalladas.md` | Especificación normativa detallada del modelo. |
