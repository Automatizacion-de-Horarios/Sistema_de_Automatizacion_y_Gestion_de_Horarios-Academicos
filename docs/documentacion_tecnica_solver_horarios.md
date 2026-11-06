# Documentación técnica
## Sistema de Automatización y Gestión de Horarios Académicos

**Propósito:** describir la captura de datos, la preparación de insumos, la
construcción y validación de horarios, y las rutas de ejecución disponibles en
el proyecto.

**Alcance:** este documento se basa en el código fuente del repositorio. El
proyecto conserva dos flujos de generación distintos: el flujo anterior basado
en archivos JSON y el motor vigente conectado a MySQL con OR-Tools CP-SAT. Se
explican por separado porque sus mecanismos de preprocesamiento y algunas
reglas, en especial EMP, no son idénticos. También se mantienen utilidades y
modelos JSON anteriores que no constituyen una tercera ruta de producción.

---

## 1. Descripción general del problema

La planificación académica consiste en asignar día, hora y, cuando
corresponda, ambiente a las actividades de cada oferta académica. La solución
debe atender simultáneamente:

- Las horas y modalidades de cada curso: teoría (`TEC`), taller (`TAL`),
  virtual (`VIR`) y práctica en empresa (`EMP`).
- La asignación y disponibilidad de los docentes.
- La sede, el turno, el grupo y las semanas lectivas de la oferta.
- El estado, tipo y compatibilidad de aulas y ambientes.
- El calendario del periodo y los feriados.
- La prohibición de cruces y otras reglas de continuidad académica.

El proyecto utiliza **Google OR-Tools CP-SAT** para buscar una combinación de
horarios que cumpla las reglas obligatorias y, cuando hay varias opciones,
favorezca las preferencias institucionales. El resultado del motor MySQL se
guarda como borrador; no equivale por sí mismo a una confirmación oficial.

### 1.1 Dos flujos que conviven en el repositorio

| Flujo | Entrada | Generación y validación | Salida |
|---|---|---|---|
| JSON (anterior / independiente) | Archivos de `json/`; puede recibir horarios convertidos desde Excel | `generar_horario.py` prepara copias, ejecuta `solver_engine.py` y valida con `validar_horario.py`; reintenta con distintas semillas | `horarios_generados/horario_generado.json` |
| MySQL + CP-SAT (flujo de producción documentado en el [README](../README.md)) | Oferta, docentes, disponibilidad, ambientes y calendario consultados en MySQL | `solver_horarios_db.py` coordina preflight, actividades, modelo CP-SAT y validación | Filas `BORRADOR` en `horarios_generados` de MySQL; admite `--dry-run` |

El preprocesador y el retry loop descritos en este documento pertenecen al
flujo JSON. **No se ejecutan** al invocar `solver_horarios_db.py`. El motor
MySQL tiene su propio constructor de modelo y límite de búsqueda.

---

## 2. Arquitectura y recorrido de datos

```text
Aplicación web
  React ── JWT/API Express ── MySQL
                             ├─ usuarios y docentes
                             ├─ disponibilidad docente
                             ├─ oferta, cursos y periodos
                             └─ aulas, compatibilidad y feriados
                                      │
                                      ▼
                         solver_horarios_db.py
                         lectura → preflight → actividades
                         → modelo CP-SAT → validación
                                      │
                         --dry-run ───┴── guardar BORRADOR

Flujo JSON separado
  json/*.json ── generar_horario.py
                  ├─ copia y adapta → horarios_generados/insumos/
                  ├─ ejecuta solver_engine.py con distintas semillas
                  ├─ valida → validar_horario.py
                  └─ publica el candidato validado como JSON final
```

La aplicación web administra información en MySQL. La ruta JSON consume
archivos preparados por separado; no lee ni modifica las tablas de MySQL. El
motor de base de datos sí lee la información maestra y, cuando se ejecuta sin
`--dry-run`, escribe el resultado en la tabla de horarios generados.

---

## 3. Ingreso de datos: usuarios y docentes

### 3.1 Acceso de usuarios

El backend expone el inicio y la verificación de sesión en
[`src/routes/authRoutes.js`](../src/routes/authRoutes.js). El controlador
[`src/controllers/authController.js`](../src/controllers/authController.js)
recibe DNI o correo institucional y contraseña, verifica el hash con
`bcryptjs` y emite un JWT con vigencia de ocho horas. El token contiene el
identificador del usuario y su rol. Las rutas administrativas de docentes
requieren un JWT válido; el módulo de docentes, además, vuelve a comprobar que
la cuenta siga activa y registra quién efectuó cada modificación.

### 3.2 Registro y mantenimiento de docentes

La pantalla [`frontend/src/views/DocentesView.jsx`](../frontend/src/views/DocentesView.jsx)
consulta la API autenticada `/api/docentes`. Permite listar, crear y editar
docentes, cambiar su estado o contrato y mantener sus franjas disponibles.
Las rutas están declaradas en
[`src/routes/docente.routers.js`](../src/routes/docente.routers.js) y se
montan en [`server.js`](../server.js) bajo `/api/docentes`.

El controlador [`src/controllers/docente.controller.js`](../src/controllers/docente.controller.js)
coordina las solicitudes. Las validaciones centralizadas de
[`src/utils/docentes.util.js`](../src/utils/docentes.util.js) verifican, entre
otros datos, nombres, apellidos, estado, contrato y horas permitidas:

- Tiempo completo: 36 horas semanales.
- Tiempo parcial: 19 o 23 horas semanales.
- La disponibilidad se expresa por día y por intervalos de 15 minutos dentro
  de la franja institucional configurada.

El modelo [`src/models/docente.model.js`](../src/models/docente.model.js)
persiste los datos del docente y sus franjas en MySQL. También conserva los
datos de auditoría de las modificaciones. Cambiar el estado del docente no
elimina su disponibilidad.

> **Criterio de interpretación:** la interfaz describe la cuadrícula como
> restricción horaria y el motor MySQL la aplica como restricción dura. Si el
> docente tiene `usa_restriccion_horaria = 1` y franjas activas, solo se generan
> pares `(día, inicio)` donde la clase completa cabe dentro de una franja. La
> disponibilidad se intersecta con la banda oficial del turno; si no hay
> intersección, la corrida falla con un diagnóstico detallado. No hay fallback
> ni bandera que relaje la disponibilidad. El flujo JSON estricto también la
> configura como dura.

---

## 4. Ingreso y lectura de insumos académicos

### 4.1 Flujo MySQL

El repositorio [`solver_horarios/db.py`](../solver_horarios/db.py) centraliza
las consultas del motor. Lee el periodo, la franja institucional, turnos,
ofertas activas, docentes y disponibilidad, ambientes, compatibilidad de
cursos y feriados. Las ofertas se filtran por periodo y por registros activos
de programación, curso y semestre. Los filtros opcionales por carrera,
semestre, turno y sede se aplican antes de construir el problema.

Las credenciales se obtienen de la configuración del proyecto (`.env` o
variables `MYSQL_*`), y pueden sobrescribirse mediante opciones de línea de
comandos. No se recomienda incluir credenciales en este documento ni en el
código fuente.

### 4.2 Flujo JSON y conversión desde Excel

El flujo JSON requiere estos archivos en `json/`:

`config_semestre.json`, `cursos.json`, `curso_docentes.json`,
`disponibilidad_docentes.json`, `feriados.json`, `horas_cursos.json`,
`reglas_ambientes.json`, `reglas_horario.json` y `salones.json`.

La herramienta [`exportar_base_json.py`](../exportar_base_json.py) lee una
planilla Excel y extrae bloques de horario, modalidad, cohorte y docente para
producir un JSON de referencia. [`generar_json_detallado.py`](../generar_json_detallado.py)
es otra utilidad para convertir una planilla a `horario_base_detallado.json`,
utilizable como horario semilla por el flujo MySQL. Estos archivos semilla no
sustituyen la oferta académica cargada en la base de datos.

---

## 5. Saneamiento y protección de datos base

El preprocesamiento del flujo JSON está en
[`generar_horario.py`](../generar_horario.py), principalmente en
`_prepare_inputs()`.

### 5.1 Qué hace

1. Comprueba que cada archivo JSON requerido exista y tenga el tipo de dato
   esperado (objeto o lista).
2. Normaliza cadenas: elimina espacios externos, convierte campos
   controlados a mayúsculas y estandariza horas válidas a `HH:MM`.
3. Rechaza horas con formato inválido, valores fuera de rango o segundos
   distintos de cero.
4. Refuerza en una **copia de trabajo** algunas reglas duras, completa la
   configuración EMP exigida por este flujo y amplía el conjunto de ambientes
   con recursos auxiliares.
5. Escribe los datos adaptados bajo `horarios_generados/insumos/` y registra
   los cambios en `horarios_generados/ajustes_preprocesamiento.json`.

Fragmento representativo:

```python
for filename, data in adapted.items():
    _write_json(INPUT_DIR / filename, data)

_write_json(OUTPUT_DIR / "ajustes_preprocesamiento.json", {
    "origenes": [str(SOURCE_DIR)],
    "horario_base_consolidado_usado": False,
    "archivos_adaptados": sorted(adapted),
    "cantidad_ajustes": len(changes),
    "ajustes": changes,
})
```

`SOURCE_DIR` apunta a `json/`; `INPUT_DIR` apunta a
`horarios_generados/insumos/`. Por ello, las normalizaciones no se guardan
encima de los JSON fuente ni se modifica MySQL desde esta etapa. El script sí
limpia archivos de ejecuciones anteriores dentro de la carpeta de insumos de
trabajo y el candidato temporal antes de comenzar.

### 5.2 Ajustes que afectan la interpretación de datos

El preprocesador no se limita a corregir formato. En el estado actual del
código también:

- Sustituye la disponibilidad copiada de cada docente asignado por la jornada
  operativa completa de lunes a sábado.
- Fuerza a verdadero un conjunto configurado de restricciones duras.
- Configura EMP para solo mañanas, sin receso, con ventana estricta
  `08:00–14:00`, bloques completos, días consecutivos y al menos dos días.
- Genera cuatro ambientes auxiliares por cada ambiente original, con
  identificadores `AUXILIAR`.

Cada uno de estos cambios queda incluido en el reporte de ajustes. Antes de
interpretar el resultado como una aplicación literal de la disponibilidad o
del inventario original, se debe revisar dicho reporte: la jornada ampliada y
los ambientes auxiliares son datos de modelado de esa corrida, no
modificaciones de las fuentes.

---

## 6. Preflight, planificación y construcción de actividades

En el flujo MySQL, el controlador principal es
[`solver_horarios_db.py`](../solver_horarios_db.py). El recorrido normal es:

1. Cargar configuración y abrir la conexión a MySQL.
2. Consultar periodo, franja, compatibilidad de ambientes y feriados.
3. Construir el contexto de la oferta filtrada.
4. Comprobar asignaciones docentes y capacidad de carga antes de llamar a
   CP-SAT.
5. Generar actividades y ventanas lectivas.
6. Construir, resolver y validar el modelo.
7. Transformar los bloques a filas y, salvo en `--dry-run`, guardarlos como
   borrador.

Responsabilidades principales del paquete
[`solver_horarios/`](../solver_horarios/):

| Módulo | Responsabilidad |
|---|---|
| [`config.py`](../solver_horarios/config.py) | Constantes institucionales, lectura de configuración, modelos de datos, calendario y conversiones de horas. Una hora académica equivale a 45 minutos; la grilla usa intervalos de 15 minutos. |
| [`db.py`](../solver_horarios/db.py) | Lecturas de MySQL y operaciones de escritura de horarios. |
| [`planificacion.py`](../solver_horarios/planificacion.py) | Contexto de oferta, ventanas por semanas, bandas horarias por turno y calendario. |
| [`actividades.py`](../solver_horarios/actividades.py) | Convierte horas de curso en bloques semanales `TEC`, `TAL`, `VIR` o `EMP`; determina ambientes candidatos y pares de día/hora permitidos. |
| [`preflight.py`](../solver_horarios/preflight.py) | Detecta docentes requeridos ausentes, cargas que exceden topes y otros problemas antes de resolver. |
| [`modelo_variables.py`](../solver_horarios/modelo_variables.py) | Define variables, intervalos, restricciones CP-SAT y términos de la función objetivo. |
| [`modelo.py`](../solver_horarios/modelo.py) | Ejecuta el solver, interpreta el estado, extrae bloques y valida la solución. |
| [`persistencia.py`](../solver_horarios/persistencia.py) | Convierte bloques en filas, separa rangos alrededor de feriados y coordina el guardado transaccional. |
| [`semilla.py`](../solver_horarios/semilla.py) | Lee y asocia bloques de un horario semilla como sugerencias no vinculantes. |

`generar_semestre_ii.py` es un ejecutable acotado al periodo `202620` y a
ofertas activas del Semestre II. `integrar_horario_semilla.py` llama al mismo
motor MySQL con opciones para importar pistas desde un horario base.

El paquete [`solver_horarios_grupos/`](../solver_horarios_grupos/) añade el CLI
de grupos, la carga de ocupaciones externas y el módulo
[`diagnostico.py`](../solver_horarios_grupos/diagnostico.py). Este último se
activa cuando CP-SAT devuelve `INFACTIBLE`: resume actividades sin ubicación
compatible, carga de docentes/cohortes y aísla por búsqueda binaria la
programación externa que bloquea al grupo.

---

## 7. Motor OR-Tools CP-SAT y reglas

El modelo representa cada bloque con variables de día y hora de inicio. El
dominio de cada variable se limita a los pares autorizados que generan
`actividades.py`. Luego se añaden las restricciones de recursos y calendario.

Ejemplo del modelo de intervalos y no solapamiento en
[`solver_horarios/modelo_variables.py`](../solver_horarios/modelo_variables.py):

```python
receso = 0 if actividad.modalidad == "EMP" else BREAK_MIN
self.intervalo_tiempo[uid] = self.model.NewIntervalVar(
    inicio_var,
    duracion + receso,
    inicio_var + duracion + receso,
    f"int_tiempo_{uid}",
)
```

Los intervalos de las actividades se agrupan por cohorte, docente y ambiente.
CP-SAT recibe una restricción de no solapamiento para impedir que un recurso
se use simultáneamente:

```python
self.model.AddNoOverlap2D(
    [par[0] for par in pares],
    [par[1] for par in pares],
)
```

### 7.1 Restricciones duras del flujo MySQL

Entre las reglas que el modelo y su validador aplican se encuentran:

- Cada actividad debe caber dentro de las ventanas válidas de su turno y de la
  franja institucional, alineada a la grilla horaria.
- No puede haber cruces de horario para una cohorte ni para un docente; tampoco
  puede asignarse un ambiente a dos sesiones simultáneas.
- TEC y TAL presenciales deben tener docente y ambiente compatibles. La
  validación previa detiene el proceso si falta un docente para una modalidad
  requerida.
- Los topes semanales contractuales, las cargas diarias y el rango máximo de
  jornada docente se modelan antes de aceptar la solución, salvo opciones
  exploratorias explícitas.
- El calendario verifica que haya fechas utilizables para cada día propuesto;
  al persistir, los rangos de semanas se dividen para omitir las semanas que
  coinciden con feriados o quedan fuera del periodo.
- Los descansos y transiciones se aplican a las modalidades regulares. EMP no
  reserva el receso de 15 minutos. En la continuidad de cohorte, el receso
  normal es de 15 minutos; el modelo marca y penaliza los huecos de 30 minutos
  (`PENALIZACION_RECESO_30`), que quedan como último recurso cuando no hay otra
  combinación razonable.
- La programación de semanas regulares se limita a las semanas lectivas
  previstas. Las semanas de recuperación no se convierten automáticamente en
  clases regulares.
- VIR y EMP no requieren docente institucional ni ambiente físico. Las horas
  de evaluación no se convierten en bloques de clase regulares.

Aunque el repositorio carga el campo `aforo_maximo` de cada ambiente, el modelo
MySQL no lo contrasta con la matrícula de la sección para restringir
asignaciones; en esta ruta las restricciones de ambiente se basan en estado,
sede, tipo y compatibilidad. La disponibilidad registrada del docente es una
restricción dura cuando `usa_restriccion_horaria = 1` y existen franjas activas:
el dominio de cada actividad se reduce a los pares donde la clase completa cabe
en una franja y en la banda oficial del turno. La asignación docente en la
oferta, el no-solapamiento y los topes contractuales también se tratan como
reglas duras en el modo normal.

### 7.2 EMP: ventana de 08:00 a 14:00

En el flujo MySQL, [`config.py`](../solver_horarios/config.py) define
`EMP_START_MIN = 08:00` y `EMP_END_MIN = 14:00`.
[`actividades.py`](../solver_horarios/actividades.py) construye los pares
permitidos de EMP con inicio a las 08:00 y rechaza bloques que no caben dentro
de la ventana.
El modelo no añade receso a EMP y el validador comprueba que la actividad esté
dentro del intervalo y que no lleve docente ni ambiente.

La duración se deriva de las horas académicas de la oferta y se limita a un
máximo de ocho horas académicas (360 minutos). **Por tanto, el flujo MySQL
garantiza la ventana y el inicio de las 08:00, pero una actividad de menos de
ocho horas académicas puede terminar antes de las 14:00.** Cuando el bloque
tiene las ocho horas académicas completas, ocupa el bloque continuo
`08:00–14:00`.

El flujo JSON estricto tiene una regla distinta:
[`solver_engine.py`](../solver_engine.py) exige que cada sesión EMP dure los
360 minutos completos y el validador
[`validar_horario.py`](../validar_horario.py) verifica el bloque exacto
`08:00–14:00`, el mínimo de dos días consecutivos y que esos días no se
mezclen con TEC/TAL de la misma sección. Estas condiciones no deben
atribuirse al motor MySQL.

### 7.3 Preferencias y función objetivo

Si existe más de una combinación factible, el objetivo intenta mejorar la
calidad del horario: favorece las bandas preferentes del turno, una distribución
conveniente por días y los inicios más tempranos dentro de la ventana
autorizada. La disponibilidad docente no se penaliza en el objetivo porque ya
es una restricción dura del dominio. La preferencia por recesos de 15 minutos
se modela con `PENALIZACION_RECESO_30`: los huecos de 30 minutos pagan un costo
blando y solo se aceptan cuando no existe una combinación mejor. La continuidad
de aula común se modela con `PENALIZACION_CAMBIO_AULA_CLAS`: dos bloques
consecutivos de la misma cohorte, separados solo por 15 minutos y del mismo
docente o curso, prefieren mantenerse en la misma aula CLAS. La regla excluye
laboratorios especializados y es blanda. Estas preferencias no reemplazan las
reglas duras.

Para reducir el riesgo de infactibilidad, el preflight
`verificar_capacidad_docente` bloquea la corrida cuando la carga semanal supera
la capacidad de la disponibilidad activa. CP-SAT recibe una estrategia de
decisión que ramifica primero por los docentes con disponibilidad activa,
ordenados por menor cantidad de minutos disponibles y menor dominio de pares
día/hora; después ubica a los docentes de tiempo parcial sin franjas declaradas.
La estrategia no relaja ninguna regla.

El método `resolver_horario()` en
[`modelo.py`](../solver_horarios/modelo.py) configura el límite de tiempo,
los hilos de búsqueda y la semilla. Acepta estados `FEASIBLE` u `OPTIMAL`,
extrae los bloques y ejecuta la validación antes de devolverlos. Si no obtiene
una solución aceptable, informa el estado y no persiste un horario.

---

## 8. Bucle de reintentos del flujo JSON

El retry loop está en `main()` de
[`generar_horario.py`](../generar_horario.py). Su propósito es intentar
obtener un candidato válido con distintas semillas y no publicar una salida
que haya fallado la validación.

```python
for attempt in range(1, max_attempts + 1):
    env["CP_SAT_RANDOM_SEED"] = str(attempt)
    env["CP_SAT_USE_FALLBACK"] = "1"
    candidate.unlink(missing_ok=True)

    if _run([sys.executable, str(ROOT / "solver_engine.py")], env):
        continue

    validation_status = _run(
        [sys.executable, str(ROOT / "validar_horario.py")], env
    )
    if validation_status == 0:
        os.replace(candidate, FINAL_SCHEDULE)
        return 0

    candidate.unlink(missing_ok=True)
```

El orden de trabajo es:

1. El máximo predeterminado es 20 intentos; se puede ajustar con la variable
   `HORARIOS_MAX_INTENTOS`, que debe ser mayor que cero.
2. Cada intento usa una semilla distinta y ejecuta `solver_engine.py` en modo
   de fallback heurístico.
3. Si el motor produce candidato, `validar_horario.py` comprueba reglas,
   solapamientos, horarios, feriados y requisitos EMP.
4. Si el candidato es válido, se mueve a `horarios_generados/horario_generado.json`.
   Si no, se elimina el archivo temporal y se continúa con otra semilla.
5. Si se agotan los intentos heurísticos, el programa desactiva el fallback y
   ejecuta una búsqueda CP-SAT estricta, con límite predeterminado de 900
   segundos (`CP_SAT_TIME_LIMIT` permite cambiarlo).
6. El candidato final solo se publica después de superar de nuevo el
   validador. Si no se obtiene solución válida, se informa el error y no se
   presenta un nuevo horario final como exitoso.

Este ciclo externo no es el comportamiento del ejecutable
`solver_horarios_db.py`: ese ejecutable realiza una resolución CP-SAT limitada
por `--tiempo-limite`; no repite automáticamente una secuencia de semillas
como `generar_horario.py`.

---

## 9. Validación, salida y persistencia

### 9.1 Validación JSON

`validar_horario.py` lee los insumos de trabajo, revisa el horario generado y
devuelve un código de salida distinto de cero cuando encuentra errores. El
retry loop utiliza ese resultado como condición para descartar o publicar el
candidato.

### 9.2 Guardado MySQL

En el flujo de producción, `persistencia.py` transforma los bloques
programados en filas con periodo, programación, modalidad, día, horas y rango
de semanas. Los intervalos que atraviesan semanas feriadas se dividen para
omitir esas semanas. El modelo de base de datos inserta las filas con
`estado = 'BORRADOR'`.

- `--dry-run` resuelve y valida sin escribir en MySQL.
- Si ya hay borradores, la ejecución no los reemplaza de forma implícita.
- `--reemplazar-borradores` solicita reemplazar borradores del periodo.
- `--reemplazar-borradores-filtrados` limita el reemplazo a las programaciones
  seleccionadas; está restringido a Semestre II.
- El borrado y la inserción se realizan en una transacción. Si ocurre un
  error, se hace rollback.

La capa web también permite consultar borradores y mover bloques en la grilla
de horarios mediante [`horario.controller.js`](../src/controllers/horario.controller.js)
y [`horario.model.js`](../src/models/horario.model.js). Esa edición posterior
es distinta de la generación inicial del solver.

---

## 10. Módulos y utilidades relacionadas

Además de los componentes ya descritos, el repositorio contiene:

- [`generar_semestre_ii.py`](../generar_semestre_ii.py): verifica que el
  periodo `202620` esté activo y llama al motor para resolver las ofertas
  activas de Semestre II.
- [`integrar_horario_semilla.py`](../integrar_horario_semilla.py): prepara una
  semilla a partir de un horario base y la pasa al motor MySQL como pistas; las
  pistas no son asignaciones obligatorias.
- [`exportar_base_json.py`](../exportar_base_json.py) y
  [`generar_json_detallado.py`](../generar_json_detallado.py): utilidades de
  conversión desde Excel a formatos JSON.
- [`motor_horarios.py`](../motor_horarios.py): conserva una implementación
  anterior de modelo CP-SAT alimentado por JSON. Su bloque `__main__` delega
  actualmente en `generar_horario.main()`, por lo que ejecutar el archivo
  utiliza el flujo JSON con preprocesamiento, reintentos y validación descrito
  arriba; sus funciones de modelado también permanecen en el archivo.
- [`solver_horarios_grupos/`](../solver_horarios_grupos/): flujo separado para
  resolver grupos de semestres y tomar horarios ya existentes como
  ocupaciones externas. Para reservar docentes y ambientes solo considera
  horarios de programaciones y cursos activos; `--auditar` sigue revisando
  todo el periodo, incluidos los registros obsoletos de cursos inactivos. Su
  ejecución y persistencia se controlan mediante opciones explícitas; no
  reemplaza al ejecutable principal.
- [`tests/`](../tests/): pruebas unitarias para reglas, semilla, exportación y
  selección de Semestre II.

---

## 11. Ejecución y verificación

### Instalar dependencias del solver

```powershell
pip install -r requirements-solver.txt
```

Se requiere Python 3.10 o superior. Las dependencias incluyen OR-Tools,
PyMySQL y openpyxl.

### Probar el flujo MySQL sin escribir

```powershell
python solver_horarios_db.py --semestres II --dry-run
```

### Generar para Semestre II

```powershell
python generar_semestre_ii.py --tiempo-limite 1800
```

### Ejecutar el flujo JSON con reintentos

```powershell
python generar_horario.py
```

### Ejecutar pruebas Python

```powershell
python -m unittest discover -s tests -v
```

Para analizar una ejecución reproducible, conservar el resumen del solver y,
en el flujo JSON, revisar `horarios_generados/ajustes_preprocesamiento.json`
junto con el reporte producido por el validador.

---

## 12. Cierre

La solución integra una aplicación web para administrar usuarios y datos
docentes, un motor CP-SAT para distribuir actividades académicas y controles
de validación y persistencia. Para explicar o evaluar un horario, primero debe
identificarse qué flujo lo generó: el flujo JSON aplica una adaptación de
insumos y un retry loop externo; el motor MySQL lee la oferta desde la base de
datos, realiza preflight, resuelve y valida antes de guardar borradores.
Mantener esta distinción, especialmente en la regla EMP y en los ajustes de
datos, permite reproducir correctamente el resultado y auditar los ajustes
aplicados.
