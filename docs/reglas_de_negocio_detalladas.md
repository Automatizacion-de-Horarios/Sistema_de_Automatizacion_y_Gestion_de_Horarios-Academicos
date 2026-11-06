# DOCUMENTO DE REGLAS Y RESTRICCIONES PARA EL MOTOR DE HORARIOS (OR-TOOLS CP-SAT)

Este documento especifica de manera formal y detallada todas las restricciones operativas, académicas, temporales y de recursos que debe cumplir el solver de optimización para la institución.

---

## 1. RESTRICCIONES DE RECURSOS Y ASIGNACIÓN (HARD CONSTRAINTS)

### 1.0. Semestres y vigencia de la oferta
* Solo se planifican cursos cuyo semestre relacionado tenga `semestres.estado = 'A'`. Las ofertas de semestres con estado `I` quedan fuera de la consulta y no generan actividades ni alertas de infactibilidad.
* El filtro se aplica junto con `programacion_academica.estado = 'A'` y `cursos.estado = 'A'`; un registro activo en la programación no reactiva un semestre inactivo.
* En el esquema `db_horarios.sql`, `semestres.estado` es `CHAR(1)` (`A`/`I`), mientras que `programacion_academica.id_docente_tec` y `id_docente_tal` son anulables. La nulabilidad permite cursos que no requieren esa modalidad, pero no sustituye la validación del docente que sí requiere una modalidad presente.

### 1.0.1. Generación por grupos y ocupaciones externas
* Al generar un subconjunto de semestres, los bloques `BORRADOR`/`CONFIRMADO` de las programaciones fuera del grupo se cargan como ocupaciones externas y reservan al docente y al ambiente. El solver no puede generar un bloque que se solape con ellos.
* Para cargar esas ocupaciones se consideran únicamente programaciones y cursos activos. Los borradores de programaciones o cursos inactivos no bloquean recursos; `--auditar` sí lee todas las filas para detectar datos obsoletos.
* Al guardar un grupo, solo se reemplazan los `BORRADOR` de las programaciones seleccionadas. Los horarios de otros grupos no se modifican.
* La auditoría `--auditar` verifica choques cruzados de docente y ambiente en todo el periodo y no persiste cambios.
* Si CP-SAT devuelve `INFACTIBLE`, el CLI ejecuta un diagnóstico detallado con presupuesto configurable (`--tiempo-diagnostico`, por defecto 120 s). El reporte incluye actividades con muy pocas ubicaciones compatibles con ocupaciones externas, docentes con disponibilidad ajustada, cohortes con alta ocupación de banda y el aislamiento de la programación externa que, al retirarse, vuelve factible el grupo. No modifica datos ni relaja reglas.

### 1.1. Docentes
* **No solapamiento de docentes:** Un docente jamás puede estar asignado a dos aulas, cursos o grupos distintos de manera simultánea en el mismo bloque horario.
* **Respeto a asignaciones oficiales:** El docente solo puede impartir los cursos y grupos en los que ha sido formalmente asignado en la base de datos (`programacion_academica` - `id_docente_tec` e `id_docente_tal`).
* **Validación obligatoria por modalidad:** Si `cursos.horas_teoria > 0`, la oferta requiere `programacion_academica.id_docente_tec`; si `cursos.horas_taller > 0` y la actividad es TAL institucional, requiere `id_docente_tal`. En cursos con ambas cargas se validan ambos campos independientemente. Un curso puramente TEC con `id_docente_tal = NULL` es válido, y uno puramente TAL con `id_docente_tec = NULL` también.
* **Exenciones sin docente institucional:** Las horas virtuales no requieren docente ni aula institucional. Una actividad clasificada EMP tampoco requiere docente institucional ni ambiente físico. En el esquema actual, `cursos.horario_sinfo = 'EMP'` identifica la práctica en empresa; la propiedad del curso también reconoce la denominación histórica “Práctica en Empresa”. Las horas de evaluación no generan actividades.
* **Falla temprana de asignación:** La ausencia de un docente para una modalidad presencial requerida es un error de preflight que detiene la corrida antes de CP-SAT; no se convierte en una actividad TEC/TAL sin docente.
* **Hallazgo de datos, periodo 202620 (auditoría 2026-11-02):** Se encontraron 358 ofertas activas de programación/curso: 265 ligadas a semestres activos y 93 a semestres inactivos. Tras filtrar semestres inactivos y excluir EMP de la validación docente, queda una modalidad institucional activa sin docente: TAL de `NSID-529` (`Seminario de Habilidades Prácticas II`, `horario_sinfo='TAL'`, `horas_taller=80`, semestre V activo). No es EMP según los datos actuales y debe corregirse/asignarse antes de ejecutar CP-SAT. La clasificación de la base de datos prevalece sobre una suposición basada únicamente en que los docentes estén en NULL.
* **Disponibilidad horaria como restricción dura:**
  * Si el docente tiene activo el indicador de restricción (`docentes.usa_restriccion_horaria = 1`) y franjas activas registradas, el solver solo puede ubicar la clase completa dentro de una de esas franjas. No se generan pares `(día, inicio)` fuera de la disponibilidad.
  * La disponibilidad se intersecta con la banda oficial del turno. Si no existe intersección para una actividad, la corrida falla con un diagnóstico detallado; no se amplía automáticamente la banda ni se relaja la disponibilidad.
  * Si `usa_restriccion_horaria = 0`, la disponibilidad registrada se ignora por completo y se consideran los espacios válidos de la franja institucional; si existen franjas, se emite una advertencia.
  * Si `usa_restriccion_horaria = 1` pero no hay franjas activas, no se aplica una restricción de disponibilidad y se emite una advertencia.
  * La disponibilidad no obliga a ocupar todos los espacios ni a distribuir la carga en una cantidad fija de días; solo limita dónde puede ubicarse cada bloque.
* **Prioridad operativa de docentes con disponibilidad más cerrada:** el preflight y CP-SAT priorizan primero a los docentes con franjas de disponibilidad activas, ordenados por menor cantidad de minutos disponibles y, luego, por menor dominio de pares día/hora. Después se ubican los docentes de tiempo parcial sin franjas declaradas. Esto no relaja ninguna restricción; solo cambia el orden de ramificación para resolver primero los recursos más escasos.
* **Límites de carga semanal por tipo de contrato (horas reloj):**
  * **Tiempo Completo (TC):** Máximo $36$ horas reloj semanales.
  * **Tiempo Parcial (TP) - Lunes a Viernes:** Máximo $19$ horas reloj semanales.
  * **Tiempo Parcial (TP) - Lunes a Sábado:** Máximo $23$ horas reloj semanales.
  * Estas metas se comparan con minutos reales de clase ($1$ hora reloj $= 60$ min), no con horas académicas de $45$ min.
* **Límite de jornada diaria:** Un docente puede trabajar como máximo $9$ horas reales al día (medidas de manera continua desde el inicio de su primera clase hasta el término de la última, incluyendo todos los recesos internos).

- La disponibilidad registrada por un docente en su cuadrícula operativa funciona estrictamente como un rango o ventana de permiso (intervalo temporal habilitado), y nunca como una obligación de ocupación total ni continua de toda la franja.

### 1.2. Ambientes y Espacios Físicos
* **No solapamiento de ambientes:** Un laboratorio, taller o aula común no puede albergar a dos clases distintas al mismo tiempo.
* **Asignación exclusiva de ambientes por compatibilidad:** Si un curso tiene registros en `ambiente_cursos_permitidos` para el periodo, se asigna exclusivamente a uno de esos ambientes autorizados; no puede colocarse en un aula común ni en otro laboratorio. Si el curso no tiene ningún registro de compatibilidad, se asigna exclusivamente a un aula común de su sede, nunca a un laboratorio/taller. La excepción de Seguridad e Higiene se rige por los ambientes que tenga configurados explícitamente en la tabla, sin regla especial codificada por nombre.
* **Continuidad de aula común (CLAS):** si dos bloques consecutivos de la misma cohorte quedan separados únicamente por un receso de **15 minutos**, son del mismo docente o del mismo curso, y ambos pueden usar aulas comunes, el modelo penaliza con fuerza el cambio de aula. Las aulas CLAS son equivalentes; no se debe trasladar al grupo entre aulas comunes tras un receso. La regla **no aplica a laboratorios ni talleres especializados**, y es una preferencia fuerte, no una restricción dura: si la disponibilidad de aulas obliga a moverse, el horario sigue siendo factible.
* **Excepciones de infraestructura:** 
  * Las clases **Virtuales (SV-EV)** no consumen docentes institucionales ni requieren aulas físicas.
  * Las **Prácticas en Empresa** se realizan en espacios externos a la institución; por lo tanto, no requieren aulas ni docentes institucionales.

---

## 2. RESTRICCIONES TEMPORALES Y CALENDARIO

### 2.1. Periodos y Fechas Limite
* **Ventana del Periodo:** Toda la programación debe ceñirse estrictamente a las fechas de inicio y fin definidas en la tabla `periodos` para el ciclo activo (ej. `2026-II`).
* **Semanas lectivas:** `SEMANAS_LECTIVAS = 16`. Ningún curso regular ni seminario TAL puede terminar después de la semana lectiva 16.
* **Margen de Recuperación por Feriados:** `MARGEN_RECUPERACION = 2`. Las semanas 17 y 18 de un periodo de 18 quedan reservadas exclusivamente para recuperar clases perdidas por feriados. El horario regular no las ocupa.
* **Días Feriados:** El solver tiene prohibido programar clases en los días registrados como activos en la tabla `feriados`.
* **Mapeo obligatorio:** para excluir los feriados de fechas reales, el periodo debe tener fecha de inicio. Si hay feriados activos y no existe esa fecha en la base de datos, se debe proporcionar `--fecha-inicio`; de lo contrario, el preflight aborta en vez de continuar sin poder garantizar la regla.
* **Alcance de la recuperación:** la reserva del margen es una regla dura del calendario. La generación automática de sesiones de recuperación en las semanas 17-18 es una fase separada.
* **Gestión de Domingos:** Los domingos son ajustables. El solver solo los utilizará si el parámetro institucional (`configuracion_franja_horaria.incluir_domingo`) está configurado en `1` para el periodo activo.

### 2.2. Prácticas en Empresa
* Ocurren típicamente en las mañanas (de 8:00 AM a 2:00 PM).
* Se representan en el horario como modalidad `EMP`, no requieren docente institucional ni ambiente físico y no se restringen a días consecutivos ni a días separados de TEC/TAL.
* No llevan recesos intermedios y se programan en bloques continuos dentro de la ventana de 08:00 a 14:00.

### Restricción estricta de Días Feriados:

El motor de optimización tiene la prohibición absoluta de programar actividades académicas presenciales o virtuales en las fechas registradas como días feriados activos en la tabla feriados.

Si el calendario oficial cuenta con feriados dentro del periodo activo, el modelo debe desplazar o evitar dichos bloques, respetando el margen de recuperación reservado en el calendario.

---

## 3. CONVERSIÓN DE HORAS Y CÁLCULO DE MÓDULOS

* **Equivalencia Académica:** Una hora académica equivale exactamente a **$45$ minutos reales**.
* **Exclusión de Evaluaciones:** `horas_evaluacion` corresponde a gestión externa y **no se programa ni suma** en los bloques semanales TEC/TAL ni en la carga lectiva del solver.
* **Cálculo de Carga Semanal:** 
  * Las horas lectivas de un curso se dividen de manera independiente para **TEC**, **TAL** y **Virtuales** entre su ventana de semanas, acotada a las $16$ semanas lectivas. `horas_evaluacion` queda excluida de este cálculo.
  * **Manejo de Fracciones y Residuos:** Si la división no es exacta, la parte entera determina las horas académicas semanales fijas, y el residuo sobrante se distribuye asignando $1$ hora académica extra en las primeras semanas del ciclo hasta agotar el total.
* **Plantilla modular rígida (TEC/TAL):**
  * El primer módulo de una línea de carrera define el patrón semanal de slots TEC/TAL: modalidad, etiqueta de día, índice de bloque y duración.
  * Los módulos sucesivos de la misma cohorte deben replicar exactamente ese patrón. El solver elige **un solo día y una sola hora de inicio** por slot y los clona en todos los módulos; no es una preferencia blanda.
  * Si un módulo sucesivo tiene un slot faltante, adicional o con otra duración, el preflight aborta con diagnóstico antes de CP-SAT.
  * Las horas **VIR** quedan fuera de la plantilla rígida para no bloquear diferencias menores de una hora entre planes de estudio.
* **Secuenciación de Cursos de Carrera (TEC):**
  * Los cursos de carrera de Teoría/Tecnología se dictan de forma modular y secuencial según el código del curso (ej. si un semestre tiene cuatro cursos de $4$ semanas cada uno en un ciclo de $16$ semanas: Semanas 1-4 para el curso 1, Semanas 5-8 para el curso 2, etc.).
  * **Excepción de cursos largos:** los cursos de carrera con TEC de $16$ semanas (por ejemplo, Inglés Técnico `NCCU-239` o Informática) **no forman parte de la cadena secuencial**. Se programan en paralelo durante su ventana de $16$ semanas y se excluyen de la suma de módulos que se comprime.
  * Solo se imparte **un curso de carrera TEC a la vez** durante su bloque de semanas asignadas, salvo los cursos largos en paralelo indicados en el punto anterior.
  * La carga semanal de un curso TEC de carrera debe concentrarse preferentemente en **un solo día** a la semana. Si resulta estrictamente necesario por volumen de horas, se permite dividir en dos días, pero repartido en partes iguales.
* **Cursos Complementarios y Seminarios:**
  * Los cursos complementarios no siguen una estructura modular estricta; sus horas de TEC se distribuyen de manera flexible a lo largo del semestre cumpliendo su total.
  * El curso de "Seminario" (que imparte TAL a partir de 4to semestre) se distribuye de forma uniforme a lo largo de las $16$ semanas del semestre.

  ### Cursos largos de carrera en paralelo (Excepción a la secuencia):
  Los cursos de carrera con TEC de $16$ semanas (por ejemplo, Inglés Técnico NCCU-239 o Informática) no forman parte de la cadena secuencial de bloques cortos (como los de 4 semanas). Se programan obligatoriamente en paralelo durante toda su ventana de $16$ semanas y se excluyen del mecanismo de compresión modular.
  
  ### Rigidez estructural y replicación de plantillas (Patrón de Bloques):
  - El primer módulo de una línea de carrera define de forma estricta el patrón semanal de slots TEC/TAL (modalidad, etiqueta de día, índice de bloque y duración).
  - Los módulos sucesivos de la misma cohorte deben replicar exactamente ese mismo patrón estructural. El solver selecciona un solo día y una sola hora de inicio por slot y los clona en todos los módulos de manera rígida.
  - Si un módulo sucesivo presenta un slot faltante, adicional o con otra duración, el control previo (preflight) abortará el proceso con un diagnóstico de error antes de invocar al motor CP-SAT. Las horas VIR quedan excluidas de esta plantilla rígida para evitar bloqueos por diferencias menores entre planes de estudio.
  
  ### Distribución flexible de sesiones de Teoría/Tecnología (TEC):
  - La distribución horaria de las sesiones TEC se adapta dinámicamente según el volumen de horas del curso:
  
      - Poco requerimiento horario: Si el curso requiere pocas horas a la semana, la carga TEC debe concentrarse preferentemente en un solo día.
      - Mayor requerimiento horario: Si el curso requiere un volumen mayor de horas a la semana, las sesiones TEC deben dividirse y repartirse de manera equitativa a lo largo de los días principales de la semana.
---

## 4. REGLAS DE RECESOS, PAUSAS Y JORNADAS

### 4.1. Recesos Estándar (Alumnos y Docentes)
* **Receso cada 3 horas académicas:** Por cada $3$ horas académicas continuas de clase ($2$ horas y $15$ minutos reales), debe programarse obligatoriamente un receso de **$15$ minutos**.
* **Receso por Cambio de Curso:** Si finaliza una clase y comienza un curso diferente en el mismo grupo, debe existir un receso de **$15$ minutos** (ampliable a $30$ minutos por motivos logísticos de ambiente). Si la clase consecutiva pertenece al **mismo curso**, **no existe receso** entre horas académicas individuales (salvo la pausa de $15$ min al cumplir múltiplos de $3$ horas académicas).

### 4.2. Descanso Mayor del Docente
* **Pausa de 45 minutos:** Cuando el docente acumula **5 o más horas académicas continuas** en el día y tiene una clase posterior, debe existir un descanso de **$45$ minutos** antes de esa clase. Un descanso de 45 minutos reinicia el conteo de continuidad. Si el docente ya no tiene clases posteriores al alcanzar ese umbral y termina su jornada, el descanso se omite por completo. La pausa protege la jornada del docente y no inserta huecos ni altera por sí sola la continuidad de la cohorte estudiantil.
* **Excepción para Docentes a Tiempo Parcial (Cierre de Jornada):** Si a un docente a tiempo parcial le restaba únicamente **$1$ hora académica** para culminar su carga semanal, se permite extender el bloque a **$6$ horas académicas continuas** (respetando solo sus pausas de $15$ min) para evitarle un receso de $45$ min por una sola hora final. Tras concluir esta hora, el docente se retira inmediatamente a su domicilio y finaliza su jornada diaria. En el turno mañana, esta excepción debe evitarse asignando un descanso estándar de $1$ hora.

---

## 5. ORGANIZACIÓN DE TURNOS Y VENTANAS ESTUDIANTILES

### 5.1. Distribución de Turnos por Semestre
* **Segundo Semestre, turno 1:** por defecto se programa dentro de la ventana de mañana **07:45–12:45**. Las 07:45 son el inicio permitido más temprano, no una hora obligatoria de inicio; cada bloque puede comenzar en cualquier intervalo válido de 15 minutos dentro de la ventana, siempre que termine a más tardar a las 12:45 PM. **Excepción por docente a tiempo parcial:** se puede habilitar la banda de tarde cuando un docente TP asignado a TEC/TAL tiene activa su restricción horaria, ninguna franja registrada permite ubicar al menos uno de sus bloques lectivos en la mañana y sí existe una franja vespertina capaz de contenerlo. La mañana sigue siendo la banda primaria; la tarde habilitada por esta excepción se trata como alternativa penalizada, no como preferencia de toda la cohorte. No se habilita por docentes de tiempo completo ni por falta de datos de disponibilidad. La disponibilidad es una restricción dura: la excepción solo amplía la banda oficial para el docente parcial, pero cada bloque debe caber además en una franja activa del docente.
* **Tercer semestre:** conserva la mañana como banda primaria del turno 1 y puede usar tarde/noche como alternativa.
* **Cuarto semestre en adelante (IV, V, VI…):** **queda prohibido el turno mañana**. TEC, TAL y VIR se restringen exclusivamente a las bandas de tarde y noche: el turno 1 y el turno 2 prefieren tarde/noche y el turno 3 prefiere noche/tarde. La tarde no tiene una hora mínima fija de inicio: las 12:45 son el límite inferior de la banda, no una hora obligatoria.
* **Primera clase de III–VI:** en cada cohorte, semana y día, la primera actividad no puede comenzar después de las **20:00 (1200 minutos)**. Las clases posteriores del mismo día sí pueden usar la noche completa. La regla es dura y se valida tanto en el modelo como en la auditoría final.
* **Segundo Semestre, turno 2:** prefiere la tarde/noche, pero puede ocupar la mañana como alternativa cuando la disponibilidad de docentes y los recursos/espacios del horario lo permitan. El turno 1 conserva su límite matutino; esta alternativa no lo modifica.
* **Cierre máximo del segundo turno:** ninguna actividad del turno 2 puede terminar después de las **21:00** (1260 minutos). El tope se aplica a TEC, TAL, VIR y a cualquier banda alternativa del turno, aunque la franja institucional cierre más tarde.
* **Turno 3:** puede usar la tarde como alternativa a la noche cuando haya capacidad; no se presupone que todas las carreras tengan tres turnos.
* **Semestres I–II, turnos sin regla específica:** por la tarde o por la noche, según la preferencia del turno.
* **Inicio flexible de la tarde:** las 12:45 PM son el límite inferior de la banda vespertina, no una hora obligatoria de inicio. Un bloque puede comenzar más tarde (por ejemplo, a la 1:30 PM) si así encaja con la disponibilidad, los recursos y las demás restricciones.

### 5.2. Continuidad y distribución de la carga
* **Separación entre clases presenciales:** entre bloques consecutivos de una misma cohorte, dentro del mismo turno o entre la última clase de mañana y la primera de tarde/noche, se permiten como máximo **30 minutos** (incluido el receso estándar de 15 minutos). Un intervalo mayor invalida la solución. El solver prefiere el receso de **15 minutos** y penaliza el de 30 (`PENALIZACION_RECESO_30`); el de 30 solo se usa cuando no existe otra combinación razonable.
* **Continuidad de curso (sin intercalados):** las sesiones de un mismo curso deben desarrollarse de forma continua y corrida en el bloque diario. Se prohíbe el patrón curso A → curso B → curso A: no se puede interrumpir un curso con otro y luego retomarlo.
* **Plantilla modular:** el primer módulo define el patrón TEC/TAL y sus sucesores clonan de forma rígida el día, la hora y la duración de cada slot. Los módulos cortos pueden ceder la secuencia al siguiente cuando concluyen. VIR y EMP no forman parte de esta plantilla.
* **Distribución y orden TEC/TAL:** concentrar TEC y programar TEC antes de TAL son preferencias de optimización; no sustituyen ni flexibilizan la plantilla modular rígida.
* **Clases virtuales:** las horas virtuales pueden ubicarse en cualquier banda institucional (mañana, tarde o noche), sin preferencia por el turno opuesto. La única condición dura es que no se solapen con las clases de su cohorte (misma sede, carrera, semestre, turno y grupo). A partir del cuarto semestre tampoco pueden usar la mañana. En el turno 2 siguen sujetas al cierre máximo de las 21:00. No forman parte de la plantilla TEC/TAL ni del control de día partido.
* **Separación de las horas virtuales:** el modelo prefiere que VIR quede al menos **90 minutos** alejada de la carga presencial TEC/TAL de la misma cohorte cuando comparten día y semanas. Si no puede lograrlo, la actividad virtual paga `PENALIZACION_VIR_CERCANIA` (500 000). La regla es blanda para no volver infactible una cohorte con la presencialidad muy concentrada; aun así, el peso es suficiente para preferir un día sin presencialidad o una franja claramente separada. El validador reporta como advertencia cualquier VIR que quede por debajo de ese margen.
* **Disponibilidad docente:** Es una restricción dura. Cada bloque debe caber dentro de una franja activa del docente y dentro de la banda oficial del turno. No amplía las bandas institucionales del turno; si no hay intersección, la corrida se detiene con un diagnóstico detallado.
* **Jornada diaria de cohorte:** el intervalo real desde la primera actividad hasta la última, incluyendo VIR y EMP, no puede exceder **8 horas (480 minutos)**.
* **Pausa docente de 45 minutos:** se aplica a la agenda del docente y no crea una pausa obligatoria en el horario de los estudiantes. Entre bloques TEC/TAL consecutivos de una cohorte se permiten como máximo **30 minutos**, tanto dentro de un turno como entre mañana y tarde/noche.

- El motor de optimización tiene la libertad y autonomía de elegir las horas justas y necesarias dentro de esa ventana de disponibilidad para cumplir con la carga lectiva oficial del curso, sin forzar bloques adicionales ni saturar la jornada más allá de los requerimientos de la malla curricular.

### 5.3. Preferencia de banda horaria (soft constraint)
* **Bandas preferentes:** para cada actividad presencial TEC/TAL se toma como referencia la primera banda devuelta por `bandas_cohorte`. Si esa banda es la mañana, la tarde y la noche son alternativas; si es la tarde, la noche se considera parte de la misma franja preferente; si es la noche, la tarde es la alternativa. En III se exponen las tres bandas institucionales, pero solo se penalizan las que no pertenecen a la franja preferente. En IV en adelante no existe la banda de mañana: solo tarde y noche, ambas preferentes. No se penaliza la noche cuando el turno es de tarde/noche. VIR no tiene banda preferente: usa las bandas institucionales permitidas para su semestre.
* **Banda primaria:** una actividad tiene costo cero cuando cae en la banda preferente de su cohorte. La disponibilidad del docente ya está garantizada por la restricción dura y no se penaliza.
* **Banda secundaria:** si la actividad cae en una banda no preferente, se aplica `PENALIZACION_DESVIACION_FRANJA` (200 000) en la función objetivo. Esto evita que el solver mueva bloques completos a la tarde por conveniencia matemática cuando la mañana es la banda principal.
* **Disponibilidad fuera del objetivo:** no existe penalización por caer fuera de la disponibilidad porque esos pares no se generan. Las bandas secundarias siguen disponibles solo si también están dentro de la disponibilidad activa del docente.
* **Sin nombres hardcodeados:** el criterio se calcula con los datos de la oferta, la cohorte y `bandas_cohorte`; aplica a todos los docentes y no requiere listas especiales.
* **Uso de bandas secundarias:** el solver las usará cuando no exista una combinación factible en la banda preferida o cuando el costo de respetarla supere el de las demás reglas blandas, siempre que la disponibilidad dura del docente lo permita.

### 5.4. Turno único y excepción de doble turno diario
* **Preferencia estricta de turno único:** cada docente y cada curso/cohorte deben concentrar sus actividades TEC/TAL en un solo turno siempre que sea posible: preferentemente todo en la mañana o todo en la tarde/noche durante la semana, y como mínimo un solo turno por día, según el turno de la cohorte y la disponibilidad base del docente. La igualdad dura de banda por cohorte se sustituyó por una preferencia blanda: la banda principal de `bandas_cohorte` tiene costo cero y las bandas alternas pagan `PENALIZACION_DESVIACION_FRANJA`. Así se evita que un ajuste matemático mueva toda la cohorte a una banda secundaria por conveniencia.
* **Definición de día partido:** un día está partido cuando un mismo docente o una misma cohorte tiene al menos una actividad TEC/TAL en la mañana (clase horaria 0) y al menos otra en la tarde/noche (clases 1 y 2) el mismo día. La tarde y la noche cuentan como un solo turno; no se penaliza combinarlas entre sí.
* **Penalización del docente:** cada docente/día partido paga `PENALIZACION_DOBLE_TURNO_DIARIO` (5 000 000) multiplicada por el factor de prioridad del contrato. Para tiempo parcial el factor es 100 000, de modo que el costo efectivo es extremadamente alto. Es la penalización más severa del modelo: solo se acepta cuando no existe ninguna combinación factible en un solo turno.
* **Penalización de la cohorte:** cada cohorte/día partido paga `PENALIZACION_DOBLE_TURNO_COHORTE` (1 000 000), sin multiplicarse por contrato. Evita que los estudiantes queden repartidos entre mañana y tarde/noche el mismo día aunque los docentes sean distintos.
* **Control por semanas solapadas:** el día partido se evalúa por semana. Solo se marca cuando las actividades que coinciden en el día tienen rangos de semanas que se solapan. Dos módulos secuenciales que nunca comparten semana no generan falsos positivos. El indicador se agrega por docente/día y por cohorte/día, de modo que un patrón repetido en varias semanas paga una sola vez por día.
* **Excepción matemáticamente indispensable:** si la disponibilidad de un docente, la capacidad de ambientes o la ventana del turno impiden cumplir toda la carga en un solo turno, el modelo puede usar mañana y tarde/noche el mismo día. La solución sigue siendo válida, pero queda registrada con la penalización y el validador reporta la mezcla como advertencia, no como error. La disponibilidad no se relaja para evitar el día partido.
* **Continuidad dentro de cada turno:** cuando hay un día partido, la continuidad de 15–30 minutos se exige por separado dentro de la mañana y dentro de la tarde/noche. Se prefiere el receso de **15 minutos**; el de 30 se penaliza y queda como último recurso. El corte entre el último bloque de la mañana y el primero de la tarde/noche debe ser de **30 minutos como máximo**; un corte mayor vuelve inválida la solución.
* **TEC de carrera con pocas horas semanales:** si la carga TEC de una programación cabe en un solo día según la capacidad diaria, el modelo prioriza concentrarla en una sola jornada. Cada día adicional usado paga `PENALIZACION_TEC_DIA_ADICIONAL` (2 000 000), multiplicada por el factor de prioridad docente. El peso es fuerte, pero inferior al de día partido docente: si concentrar todo exige mañana y tarde, el modelo prefiere primero una alternativa de un solo turno antes que partir la jornada.
* **VIR fuera del control de día partido:** las horas virtuales pueden estar en cualquier banda, no se cuentan como actividad que parte el día y no participan en la continuidad de 15–30 minutos. Su única condición es no solaparse con las clases de su cohorte (misma sede, carrera, semestre, turno y grupo); en el turno 2 también respetan el cierre de las 21:00. Además se prefiere que queden al menos 90 minutos alejadas de la carga presencial de su cohorte, según la regla 5.2.
* **Sin nombres hardcodeados:** el control se calcula con `docente_id`, `oferta.cohorte`, días, semanas y banda horaria. Aplica genéricamente a todos los docentes y cohortes; no contiene listas de nombres ni excepciones por persona.

### 5.5. Edición manual y uniformidad semanal

* **Propagación a todas las semanas:** cuando el asistente académico mueve una clase en el horario borrador, el cambio se replica en **todos los registros de esa misma clase**, no solo en la semana visible. El horario debe ser uniforme durante todo el semestre; por eso no se permite que una semana quede en un día u hora y las demás en otro.
* **Identidad de la clase:** se consideran parte de la misma clase los registros BORRADOR con el mismo `id_programacion`, `tipo_modalidad`, `id_docente`, `id_ambiente`, día original y rango horario original. Esa identidad incluye las filas que el solver partió por feriados o por rangos de semanas, pero no mezcla otros bloques del mismo curso, otras modalidades ni otros docentes o ambientes.
* **Validación por la unión real de semanas:** antes de guardar, el backend comprueba conflictos de salón, docente y cohorte contra todas las semanas que ocupa la clase. La verificación usa los rangos reales de cada fila y no un intervalo continuo inventado, para no rechazar movimientos por semanas en las que la clase no se dicta.
* **Cursos terminados y espacios vacíos:** mover una clase no recalcula ni recoloca los demás cursos. Si un curso termina antes, sus espacios quedan vacíos y los demás conservan su día y hora. El sistema no reempaqueta el horario ni mueve otras clases para llenar esos huecos.
* **Sin cambios parciales:** si el movimiento genera un conflicto en cualquiera de las semanas de la clase, la operación completa se rechaza y no se guarda ninguna fila. La actualización y su verificación posterior ocurren dentro de la misma transacción.
* **Respuesta al cliente:** el endpoint devuelve todos los `id_horario` expandidos. La cuadrícula usa esa lista para actualizar también las demás semanas en pantalla, de modo que el cambio se vea de inmediato sin recargar el periodo.

## 6. Configuración del periodo y horario diario de la cuadrícula

* **Configuración por periodo:** las fechas de inicio/fin, la franja diaria y la opción de habilitar domingo pertenecen al periodo académico seleccionado. La franja se persiste en `configuracion_franja_horaria` (`hora_inicio_mañana`, `hora_cierre_noche`, `incluir_domingo`); las fechas se persisten en `periodos` (`fecha_inicio`, `fecha_fin`).
* **Fechas y semanas:** ambas fechas son obligatorias en la configuración, deben ser fechas reales y la fecha fin debe ser igual o posterior a la fecha inicio. `cantidad_semanas` se calcula incluyendo los dos extremos: `ceil((días entre fechas + 1) / 7)`. Una fracción de semana cuenta como una semana.
* **Franja operativa diaria:** `hora_inicio_mañana` es el inicio diario configurado y `hora_cierre_noche` su cierre. Estos límites son comunes a los días y no se recalculan a partir del turno, semestre, cohorte ni clases actualmente visibles.
* **Domingo:** solo se habilita para la programación cuando `incluir_domingo = 1` para el periodo.
* **Límites de presentación:** la cuadrícula puede mostrar espacio visual hasta horas enteras: redondea el inicio configurado hacia abajo y el cierre hacia arriba. Por ejemplo, una franja 07:45–23:00 se dibuja de 07:00 a 23:00 para que las tarjetas no queden pegadas al borde. Este redondeo es exclusivamente visual: no altera las horas de las clases ni amplía la franja autorizada.
* **Validación al mover clases:** la interfaz y el backend deben validar los movimientos contra las horas exactas guardadas en la configuración del periodo, no contra los límites enteros redondeados de la cuadrícula. Una clase que empiece antes del inicio configurado o termine después del cierre configurado se rechaza.
* **Sin límites de hora por turno:** la cuadrícula semanal del borrador representa la franja operativa diaria configurada para el periodo; no debe inferir franjas separadas desde las sesiones de un turno o semestre seleccionado.

### Estructura de Persistencia: Tabla `horarios_generados`

La tabla `horarios_generados` es el destino final donde el motor del solver (o las modificaciones manuales del asistente académico) almacenará cada bloque o sesión de clase resultante de la optimización.

#### Definición de Columnas y Atributos:

1. **`id_horario`** (INT, Primary Key, Auto Increment):
* Identificador único de cada bloque de horario generado.


2. **`id_periodo`** (INT, Foreign Key $\rightarrow$ `periodos.id_periodo`):
* Relaciona el bloque con el periodo académico activo (ej. `2026-II`).


3. **`id_programacion`** (INT, Foreign Key $\rightarrow$ `programacion_academica.id_programacion`):
* Conecta directamente con la oferta académica oficial, permitiendo identificar la sede, el curso, el turno y el grupo numérico exacto de la clase.


4. **`id_ambiente`** (INT, Foreign Key $\rightarrow$ `ambientes.id`, Nullable):
* Espacio físico asignado (aula o laboratorio). Será `NULL` para clases virtuales (VAEE) o prácticas en empresa que no ocupan infraestructura de la sede.


5. **`id_docente`** (INT, Foreign Key $\rightarrow$ `docentes.id_docente`, Nullable):
* Profesor encargado de impartir el bloque. Será `NULL` en materias virtuales o actividades externas que no requieran docente presencial.


6. **`tipo_modalidad`** (ENUM: `'TEC'`, `'TAL'`, `'VIR'`, `'EMP'`):
* Indica la modalidad pedagógica del bloque: Teoría/Tecnología (`TEC`), Taller (`TAL`), Virtual (`VIR`) o Empresa (`EMP`).


7. **`dia_semana`** (ENUM: `'LUNES'`, `'MARTES'`, `'MIÉRCOLES'`, `'JUEVES'`, `'VIERNES'`, `'SÁBADO'`, `'DOMINGO'`):
* Día de la semana en que se programa la sesión.


8. **`hora_inicio`** y **`hora_fin`** (TIME):
* Rango horario exacto de la sesión (ej. `07:45:00` a `09:00:00`), considerando la estructura de bloques académicos y recesos.


9. **`semana_inicio`** y **`semana_fin`** (INT):
* Rango de semanas del semestre en que este bloque se encuentra activo (ej. semanas 1 a 4 para cursos secuenciales de carrera, o 1 a 16 para cursos transversales/seminarios).


10. **`estado`** (ENUM: `'BORRADOR'`, `'CONFIRMADO'`, Default: `'BORRADOR'`):
* **`BORRADOR`**: Estado de trabajo inicial. Permite al asistente académico o al solver realizar modificaciones, reubicaciones y ajustes libres en la interfaz.
* **`CONFIRMADO`**: Estado de aprobación final. Congela el bloque en modo solo lectura para proteger el horario contra modificaciones accidentales


11. **`fecha_registro`** (DATETIME):
* Marca de tiempo automática de cuándo fue generado o actualizado el registro.
