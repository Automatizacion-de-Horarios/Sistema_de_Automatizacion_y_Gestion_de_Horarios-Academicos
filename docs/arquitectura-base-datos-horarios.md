# Arquitectura de datos para la programación de horarios

## Propósito y alcance

Este documento describe el modelo relacional que sirve como fuente de datos
para la programación académica: qué representa cada tabla, cómo se relacionan
sus datos y qué información aporta cada una al proceso.

La referencia funcional de este documento es el **esquema vigente de MySQL en
Aiven descrito por el equipo**. No es una migración ni una especificación de
las reglas del optimizador. Las reglas detalladas para generar y validar
horarios se documentarán por separado. Este documento tampoco implementa ni
define la lógica de un solver.

## Vista general

El modelo combina cinco grupos de información:

1. **Oferta del período:** cursos, grupos, sede, turno y docentes responsables.
2. **Estructura académica:** carreras, semestres y datos de cada curso.
3. **Recursos físicos:** ambientes, tipos de ambiente y compatibilidad de cursos.
4. **Disponibilidad y calendario:** disponibilidad docente, feriados y límites
   de la franja institucional.
5. **Parámetros de contratación:** perfil, contrato y restricciones horarias de
   cada docente.

Relaciones conceptuales principales:

```text
carreras
  └── semestres
        └── cursos
              └── programacion_academica
                    ├── periodos
                    ├── sedes
                    ├── turnos
                    ├── docentes (asignación TEC)
                    └── docentes (asignación TAL)

periodos
  ├── configuracion_franja_horaria
  ├── ambiente_cursos_permitidos ── ambientes ── tipo_ambiente
  └── programacion_academica

docentes
  ├── disponibilidad_docentes
  └── programacion_academica
```

La tabla `feriados` aporta fechas institucionales al calendario. La
configuración del período también determina si el domingo se considera parte
de la franja disponible.

## Tablas del modelo

### 1. `programacion_academica`

Registra la **oferta oficial de secciones** que se debe organizar. Cada fila
identifica una instancia de un curso para un período, sede, turno y grupo.

Sus datos funcionales incluyen:

- Período académico.
- Sede.
- Curso ofertado.
- Turno y grupo.
- Docente asignado a Teoría/Tecnología (`TEC`).
- Docente asignado a Taller/Empresa (`TAL`).
- Estado de la oferta.

Una fila de oferta no es todavía una clase en un día y hora: define qué sección
debe recibir horario y quiénes son sus docentes asignados. La identidad
operativa de la sección se obtiene combinando período, sede, curso, turno y
grupo.

### 2. `cursos`

Es el catálogo de asignaturas y sus características académicas. Aporta el
código y nombre del curso, el semestre al que pertenece, su clasificación
(curso de carrera o complementario), las semanas correspondientes cuando
estén registradas y las horas totales por modalidad:

- Teoría/Tecnología (`TEC`).
- Taller/Empresa (`TAL`).
- Virtuales (`SV-EV`).
- Evaluación semestral.

Las horas de evaluación semestral se almacenan como dato curricular, pero
**no forman parte de las horas que se deben colocar en el horario regular**.
Las horas de las otras modalidades se conservan separadas porque describen
actividades con necesidades distintas.

La relación con `semestres` permite determinar la carrera y el ciclo
curricular del curso.

### 3. `ambiente_cursos_permitidos`

Es una relación entre período, ambiente y curso que expresa qué espacios
especializados están autorizados para cada curso en ese período. Su función es
restringir la selección de ambientes cuando la actividad requiere laboratorio
o taller.

Si el curso tiene una o más filas para el período, solo puede ocupar uno de los
ambientes enumerados y no se ofrece aula común como alternativa. Si no tiene
filas, solo puede ocupar un aula común de su sede; no puede usar laboratorios o
talleres especializados. El conjunto configurado en esta tabla es, por tanto,
una asignación exclusiva cuando existe.

### 4. `ambientes`

Inventaría los espacios físicos institucionales: aulas, laboratorios y
talleres. Describe sus características operativas, entre ellas:

- Tipo de ambiente.
- Aforo máximo.
- Sede, cuando está asociada.
- Pabellón y piso.
- Estado o condición de disponibilidad del espacio.

Este catálogo proporciona los recursos físicos que pueden asociarse a una
actividad. La sede del ambiente debe ser coherente con la sede de la oferta.

### 5. `tipo_ambiente`

Catálogo de categorías de espacios, por ejemplo, aula común, laboratorio
especializado o taller. `ambientes` referencia esta clasificación.

El tipo permite distinguir espacios generales de aquellos cuya utilización
depende de requisitos académicos específicos. La clasificación debe
interpretarse junto con la información de compatibilidad de
`ambiente_cursos_permitidos`.

### 6. `disponibilidad_docentes`

Contiene las franjas de disponibilidad por docente, día de semana y hora de
inicio y fin. Cada fila existente representa una franja vigente:

- La tabla **no tiene columna `estado`** en el modelo vigente.
- Para retirar una franja se elimina el registro.
- No se debe inferir que una fila está inactiva por un valor de estado.

La aplicación de estas franjas depende del indicador maestro
`docentes.usa_restriccion_horaria`: con valor `1`, se exige respetar las
franjas registradas; con valor `0`, el docente se considera disponible dentro
de la franja institucional. La disponibilidad registrada y el indicador deben
leerse conjuntamente.

### 7. `docentes`

Mantiene los perfiles de los profesores, su estado, tipo de contrato y
configuración de disponibilidad. El indicador `usa_restriccion_horaria`
controla si las franjas de `disponibilidad_docentes` se aplican o se ignoran
para efectos de disponibilidad.

Los contratos aportan límites de carga semanal en **horas reloj** (60 min),
no en horas académicas (45 min):

- **Tiempo completo:** meta de 36 horas reloj semanales.
- **Tiempo parcial de lunes a viernes:** tope de 19 horas reloj semanales.
- **Tiempo parcial de lunes a sábado:** tope de 23 horas reloj semanales.

La oferta referencia al docente responsable de TEC y, de forma independiente,
al responsable de TAL. Si una modalidad no tiene un docente institucional
asignado, su campo puede no tener asignación; esto es relevante, por ejemplo,
para actividades externas que no consumen un docente institucional.

### 8. `carreras`

Catálogo de programas profesionales o especialidades. Cada carrera agrupa sus
semestres y, mediante ellos, los cursos de su estructura curricular.

### 9. `semestres`

Representa los ciclos formativos de una carrera (por ejemplo, I a VI). Relaciona
un semestre con su carrera y sirve como agrupación académica de los cursos.
El número o denominación del semestre también permite contextualizar las
ofertas dentro de su malla curricular.

### 10. `sedes`

Catálogo de campus o sedes físicas. La oferta referencia una sede y los
ambientes pueden estar asociados a una sede, de modo que la asignación de
recursos respete la ubicación institucional.

### 11. `turnos`

Catálogo de jornadas macro (por ejemplo, mañana, tarde y noche). La oferta
referencia el turno correspondiente. El turno describe la jornada asignada a
la sección; los límites horarios concretos se consultan en la configuración
institucional y no se deducen únicamente del nombre del turno.

### 12. `periodos`

Identifica el ciclo académico activo o histórico, sus fechas y su estado. Es
la entidad temporal principal que vincula la oferta académica con la
configuración de franja, las compatibilidades de ambientes y el calendario que
corresponda.

Las semanas del período son la base temporal para interpretar la duración
académica de los cursos. El dato de semanas debe provenir del período o de la
fuente institucional vigente acordada para ese ciclo; no debe asumirse un
número fijo cuando la base de datos proporcione la duración real.

### 13. `configuracion_franja_horaria`

Contiene parámetros institucionales asociados al período:

- Hora de inicio de la jornada institucional.
- Hora de cierre.
- Duración en minutos del módulo o bloque académico.
- `incluir_domingo`, con `0` para no habilitar domingos y `1` para
  habilitarlos.

La duración del módulo permite convertir la carga académica a bloques
temporales reales. La hora de inicio y la hora de cierre delimitan la ventana
institucional. El domingo solo forma parte de los días habilitados cuando la
configuración del período lo indica expresamente.

### 14. `feriados`

Registra las fechas no lectivas institucionales, su descripción y estado. Para
la planificación se deben considerar únicamente los feriados activos. Un
feriado activo impide programar clases en su fecha; los registros inactivos no
bloquean el calendario.

La política de recuperación de clases afectadas por feriados pertenece al
conjunto de reglas del horario y no cambia el propósito de esta tabla: ser la
fuente institucional de fechas feriadas.

## Cómo se conectan los datos en una planificación

El recorrido de información, descrito a nivel de datos, es el siguiente:

1. **Se selecciona el período** y se consultan su estado, duración y
   configuración de franja horaria.
2. **Se identifican las ofertas activas** de `programacion_academica` para
   ese período. Cada oferta indica curso, sede, turno, grupo y docentes
   responsables por modalidad.
3. **Se completa el contexto curricular** de cada curso mediante
   `cursos → semestres → carreras`. Los atributos del curso separan TEC, TAL,
   virtuales y evaluación semestral.
4. **Se consultan los recursos físicos** en `ambientes`, su clasificación en
   `tipo_ambiente` y, cuando el curso requiere un espacio especializado, las
   compatibilidades de `ambiente_cursos_permitidos`.
5. **Se consulta el perfil docente** para conocer contrato y
   `usa_restriccion_horaria`. Las franjas de `disponibilidad_docentes` se
   aplican según ese indicador.
6. **Se consulta el calendario institucional** mediante `feriados` y la
   configuración del período, incluido `incluir_domingo`.
7. El resultado de combinar estos datos puede consumirse posteriormente para
   construir y validar una propuesta de horario. La selección de días,
   bloques, descansos, secuencias y demás reglas pertenece al documento
   específico de reglas del solver.

## Interpretación de horas y modalidades

Las horas de `cursos` se deben leer por modalidad, no como una única cantidad
indiferenciada. La planificación utiliza las horas de TEC, TAL y virtuales;
las horas de evaluación semestral son externas al horario regular. La
conversión entre carga académica y tiempo real utiliza la duración del módulo
configurada para el período. Una hora académica equivale a 45 minutos reales,
según el modelo funcional vigente.

La cantidad total de semanas debe obtenerse de la fuente correspondiente al
período. Cuando se distribuya una carga total semanalmente, el criterio de
división entre semanas y distribución del residuo forma parte de las reglas de
negocio del solver, no de la estructura relacional por sí sola.

## Consideraciones de integridad y lectura

- Utilizar el mismo `id_periodo` al leer oferta, configuración y
  compatibilidad de ambientes.
- Utilizar exclusivamente ofertas y entidades que estén vigentes según los
  estados definidos por cada tabla.
- Tratar `disponibilidad_docentes` como un conjunto de franjas activas; su
  vigencia no se determina mediante una columna `estado`.
- Interpretar `usa_restriccion_horaria` como interruptor de aplicación de las
  franjas, no como ausencia o eliminación de los datos de disponibilidad.
- Usar los vínculos curriculares para obtener carrera y semestre, en vez de
  duplicar esa información en la oferta.
- Verificar sede y tipo de ambiente al relacionar la oferta con un espacio.
- No exponer ni incluir en documentación los registros reales poblados,
  credenciales o datos personales de docentes. Este documento describe el
  esquema lógico, no una copia de la base productiva.

## Nota sobre el volcado SQL del repositorio

El archivo [`database/db_horarios.sql`](../database/db_horarios.sql) es un
volcado versionado y puede no representar todos los cambios que ya están
aplicados en Aiven. En particular, el esquema descrito por el equipo incluye
atributos vigentes de contratos y `usa_restriccion_horaria` en `docentes`,
`incluir_domingo` y duración del módulo en `configuracion_franja_horaria`, y
la semántica vigente de `disponibilidad_docentes` sin columna `estado`.

Por tanto, para cambios futuros de esquema o generación de integraciones, se
debe confirmar primero la estructura real de Aiven y sincronizar el volcado
del repositorio. No se debe inferir que la base productiva carece de un campo
solo porque no aparezca en ese archivo.
