# Sistema de Automatización y Gestión de Horarios Académicos

Aplicación web para apoyar la planificación de horarios, la gestión académica y la administración de ambientes.

## Motor MySQL + CP-SAT (`solver_horarios_db.py`)

Este repositorio incluye un motor de horarios que lee **toda** la información
académica desde MySQL y escribe el resultado en `horarios_generados` con
`estado = 'BORRADOR'`. No usa los JSON del flujo anterior: cursos, oferta,
docentes, disponibilidad, ambientes, turnos, franja institucional y feriados se
consultan en la base de datos del periodo.

### Requisitos

- Python 3.10 o superior.
- Dependencias del motor:

  ```powershell
  pip install -r requirements-solver.txt
  ```

- Credenciales de MySQL en `.env` o en las variables `MYSQL_HOST`,
  `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD` y `MYSQL_DB`. También se pueden
  sobrescribir con `--mysql-host`, `--mysql-port`, `--mysql-user`,
  `--mysql-password` y `--mysql-db`.

### Uso rápido

```powershell
# Resolver todo el periodo activo y guardar el borrador
python solver_horarios_db.py

# Resolver una parte de la oferta sin escribir nada
python solver_horarios_db.py --carreras PCID --semestres II --dry-run

# Reemplazar los borradores existentes del periodo
python solver_horarios_db.py --periodo 202620 --reemplazar-borradores

# Aplicar feriados a un periodo cuyas fechas no están en la tabla periodos
python solver_horarios_db.py --periodo 202620 --fecha-inicio 2026-08-17 --fecha-fin 2026-12-12 --dry-run

# Resolver y guardar únicamente los semestres II activos de 202620
python generar_semestre_ii.py --tiempo-limite 1800

# Diagnosticar las pistas del horario semilla sin generar ni guardar horario
python integrar_horario_semilla.py --diagnostico-semilla --tiempo-diagnostico 60 -- --relajar-topes
```

Filtros disponibles: `--carreras` (códigos separados por coma), `--semestres`
(`I`..`X` o `1`..`10`), `--turnos` (IDs) y `--sedes` (IDs).

Pruebas unitarias de las reglas (sin MySQL; incluye una prueba CP-SAT de la plantilla):

```powershell
python -m unittest discover -s tests -v
```

### Controles del solver

| Opción | Efecto |
| --- | --- |
| `--dry-run` | Resuelve, valida y muestra el resumen, pero no escribe en MySQL. |
| `--tiempo-limite` | Segundos máximos de CP-SAT (por defecto 300). |
| `--trabajadores` | Hilos de búsqueda (por defecto hasta 8). |
| `--semilla` | Semilla aleatoria para comparar ejecuciones. |
| `--reemplazar-borradores` | Borra e inserta en una sola transacción. |
| `--reemplazar-borradores-filtrados` | Solo con `--semestres II`: reemplaza borradores de las programaciones seleccionadas y conserva los demás. |
| `--diagnostico-semilla` | Compara factibilidad sin pistas y con las asignaciones semilla fijadas temporalmente como supuestos; no genera ni escribe horario. Requiere `--horario-semilla`. |
| `--diagnostico-infactibilidad` | Solo con `--dry-run`: activa todos los grupos de reglas mediante supuestos y solicita a CP-SAT un núcleo suficiente si el modelo oficial es infactible. No relaja reglas ni genera o guarda horario; el núcleo no necesariamente es mínimo. |
| `--tiempo-diagnostico` | Límite por comprobación del modo diagnóstico (por defecto 60 segundos). |
| `--modo-prueba-factibilidad` | Sólo con `--dry-run`: omite temporalmente jornada/descansos largos docentes, bandas y topes diarios/continuidad de cohorte, y exclusividad de ambientes; relaja topes contractuales y quita el objetivo, incluidas las preferencias blandas de concentración/equilibrio TEC y orden TEC/TAL. Mantiene dominios horarios, no-solapamiento de cohorte/docente, plantilla modular, reglas EMP y disponibilidad docente dura. El resultado puede tener ambientes superpuestos, no valida todas las reglas y no se puede guardar. |

Ejemplo de prueba exploratoria con el modelo reducido:

```powershell
python integrar_horario_semilla.py -- --modo-prueba-factibilidad
```
| `--relajar-topes` | Solo exploratorio: permite excesos de carga docente penalizados. No relaja disponibilidad ni no-solapamiento. |
| `--excepcion-tope-docente 31=24` | Excepción autorizada solo para `202620`: aplica en memoria el tope de 24 h reloj/semana a Omar Cristian Lupaca Quispe; no modifica MySQL. |
| `--sin-objetivo` | Busca cualquier solución factible sin minimizar. |
| `--horario-semilla` | JSON opcional; las coincidencias exactas se agregan como hints no vinculantes. |
| `--log-semilla` | Archivo donde se registran bloques sin mapeo o sin actividad compatible. |
| `--permitir-ambiente-generico` | Usa aulas comunes si no hay ambiente especializado en la sede. |
| `--permitir-docente-inactivo` | Mantiene ofertas asignadas a docentes con estado distinto de `A`. |
| `--permitir-compresion-modular` | Solo exploratorio: comprime módulos TEC que exceden el periodo. |
| `--permitir-banda-alterna` | Solo diagnóstico: permite salir de la banda oficial del turno, incluso cruzando 12:45 o 18:00. No relaja la disponibilidad docente. |
| `-v`, `--verbose` | Muestra el log detallado de CP-SAT y de la construcción. |

`generar_semestre_ii.py` verifica que el periodo 202620 esté activo y consulta
en MySQL únicamente ofertas de semestres con `semestres.semestre = 'II'` y
`semestres.estado = 'A'`. Ejecuta el preflight y el pipeline oficial CP-SAT,
con límite predeterminado de 1800 segundos. Si encuentra una solución factible,
reemplaza transaccionalmente solo borradores vinculados a las programaciones
del subconjunto Semestre II; no borra ni modifica los registros de otros
semestres. Las fechas usadas para excluir feriados son 2026-08-17 a 2026-12-12.

### Exportar horarios por carrera (Excel + ZIP)

Con el servidor Express activo, la vista de horarios ofrece el botón
**Descargar ZIP**. También se puede invocar directamente:

```http
GET /api/horarios/exportar?periodo=202620
Authorization: Bearer <token>
```

La respuesta es un ZIP con un Excel institucional por zonal/carrera (por
ejemplo `TACNA_INGENIERIA_DE_SOFTWARE_CON_IA.xlsx`). Los archivos se generan
con las 24 columnas del formato institucional: `PARTE_PERIODO` y
`NRO_ALUMNOS_INSCRITOS` quedan vacíos, `INSTRUCTOR` se inserta después de
`D_FIN`, `IND_SESION` vale 1 cuando la fila tiene docente y 2 cuando no, y
`SECCION` es un consecutivo único por curso/bloque/grupo/actividad dentro de cada
archivo (las sesiones virtuales comparten la sección TEC del curso).

Los archivos Excel y el ZIP se escriben únicamente dentro de
`horarios_generados/`, sin modificar ni sobrescribir los archivos de datos base.

### Ejecutar el solver desde el backend

El backend puede lanzar el CLI `solver_horarios_db.py` sin reescribir la lógica
del solver. El proceso se ejecuta en segundo plano para no bloquear la petición
HTTP mientras CP-SAT busca una solución.

```http
POST /api/horarios/solver/ejecutar
Authorization: Bearer <token>
Content-Type: application/json

{
  "periodo": "202620",
  "reemplazar_borradores": true,
  "dry_run": false
}
```

- `reemplazar_borradores` debe ser `true` si el periodo ya tiene filas
  `BORRADOR`; de lo contrario el solver se negará a sobrescribirlas.
- `dry_run: true` resuelve y valida sin escribir en MySQL.

La respuesta inmediata es `202 Accepted` con un identificador de trabajo:

```json
{
  "success": true,
  "message": "Ejecución del solver iniciada.",
  "jobId": "...",
  "data": {
    "id": "...",
    "estado": "EJECUTANDO",
    "periodo": "202620"
  }
}
```

Para consultar el avance:

```http
GET /api/horarios/solver/estado/:jobId
GET /api/horarios/solver/actual
Authorization: Bearer <token>
```

El estado puede ser `EJECUTANDO`, `COMPLETADO` o `ERROR`. La respuesta incluye
las últimas líneas del log, con credenciales redactadas. El log completo se
guarda en `horarios_generados/solver/`.

El backend elige el intérprete en este orden:

1. `PYTHON_BIN` del entorno.
2. `.venv/bin/python` o `.venv/Scripts/python.exe` del proyecto.
3. `python3` en Linux o `python` en Windows.

Variables opcionales:

```env
PYTHON_BIN=/home/senati/apps/sistema-horarios/.venv/bin/python
SOLVER_TIEMPO_LIMITE=300
SOLVER_TRABAJADORES=2
SOLVER_TIMEOUT_MS=900000
```

El despliegue crea `.venv` y ejecuta
`pip install -r requirements-solver.txt` antes de reiniciar PM2.

### Usar horario base como semilla

`integrar_horario_semilla.py` carga `horario_base_detallado.json`, consulta la
oferta activa del periodo `202620` y cruza carrera, semestre, grupo y docente
con MySQL. El sufijo del encabezado (por ejemplo, `NSID201`) se interpreta como
cohorte (semestre 2, grupo 01), no como código de curso. La exportación arma un
catálogo de docentes principales desde todas las cabeceras; una mención de
docente y curso dentro de una celda tiene prioridad, incluso si el docente no
aparece en ese catálogo. Las celdas de clase sin etiqueta de sesión se exportan
como `TEC`, y los códigos de cohorte explícitos de la celda se separan en
carrera, semestre y grupo. El campo `curso` se conserva como referencia, pero
no participa en el cruce con MySQL. El emparejamiento usa estrictamente cohorte
(carrera, semestre y grupo), docente, modalidad, día y hora. Para VIR, el
docente del bloque se valida contra los docentes TEC/TAL asignados a la oferta,
aunque la actividad VIR del solver no tenga docente propio. El día debe
coincidir y las horas de inicio y fin pueden desviarse hasta 10 minutos del
slot permitido. Solo se inyecta una
pista cuando existe una única actividad compatible;
los casos ausentes o ambiguos se omiten y se registran en el log. Las etiquetas
`VAE` y `SV-EV` se traducen a `VIR`. Las coincidencias válidas se agregan al
modelo con `AddHint` para día y hora: son preferencias, no restricciones, por
lo que CP-SAT puede reubicarlas si chocan con las reglas. El solver mantiene
explícitamente desactivado `fix_variables_to_their_hinted_value` y activa la
reparación de hints cuando hay semilla, para que una pista en conflicto no
fije un valor inviable. Las aulas se asignan con las restricciones normales
porque el JSON semilla no contiene ambiente.
Al ejecutar con una semilla, el resumen muestra los bloques asociados por
`id_programacion` e `id_docente`. El inicio y fin pueden desviarse hasta 10
minutos del slot permitido; el hint se fija a la hora real del slot válido más
cercano. El tiempo límite de CP-SAT es de al menos 300 segundos, tanto desde el
wrapper como al invocar directamente el solver.

La ejecución predeterminada es segura y no persiste cambios:

```powershell
python integrar_horario_semilla.py
```

Para guardar un borrador, se debe solicitar explícitamente:

```powershell
python integrar_horario_semilla.py --guardar -- --reemplazar-borradores
```

Los bloques sin una coincidencia única o sin actividad compatible se registran
en `integrar_horario_semilla.log` y se omiten, sin detener la corrida.

### Qué hace el motor

1. **Preflight:** valida carga docente, disponibilidad real, ventanas de días,
   secuenciación modular TEC, el límite de 16 semanas lectivas y la continuidad
   de la plantilla TEC/TAL. Aborta con un diagnóstico legible antes de CP-SAT
   cuando los datos son imposibles. La carga que no cabe en la disponibilidad
   activa también detiene la corrida, con un reporte que lista primero a los
   docentes de tiempo parcial por tener agendas más ajustadas.
2. **Construcción:** divide TEC, TAL y VIR de forma independiente en sesiones de
   hasta 3 horas académicas, reparte el residuo en las primeras semanas y
   respeta la ventana modular de cada curso. TEC/TAL reciben un slot de
   plantilla; VIR queda flexible.
3. **CP-SAT:** impone no-solapamiento de cohorte, docente y ambiente; topes
   semanales por contrato **en horas reloj** (36/23/19 h = minutos reales de
   clase); una jornada diaria máxima de 8 horas reales por cohorte y 9 horas
   reales por docente; disponibilidad docente como **restricción dura** cuando
   `usa_restriccion_horaria = 1` y hay franjas activas; una penalización por usar
   bandas secundarias; una penalización severa por día partido entre mañana y
   tarde/noche para docentes y cohortes; recesos de 15 minutos; descanso docente
   de 45 minutos cuando corresponde; las reglas de turno por semestre; y la
   clonación dura de día/hora de inicio entre módulos de una misma línea. La
   búsqueda ramifica primero por las actividades de docentes de tiempo parcial,
   ordenadas de menor a mayor dominio.
4. **Validación interna:** vuelve a comprobar todas las reglas duras sobre la
   solución extraída, incluida la igualdad de la plantilla modular. Si una
   solución no cumple, no se persiste.
5. **Persistencia:** convierte cada bloque semanal en filas de
   `horarios_generados`, partiendo el rango de semanas alrededor de feriados
   cuando hay calendario mapeado.

El motor es transaccional: si falla la inserción, hace `rollback`. Si ya existen
borradores del periodo, se niega a sobrescribirlos salvo que se use
`--reemplazar-borradores`.

### Feriados y fechas del periodo

El calendario regular usa `SEMANAS_LECTIVAS = 16`. Las semanas 17 y 18 del
periodo de 18 quedan reservadas como `MARGEN_RECUPERACION` y no reciben
actividades regulares ni seminarios TAL.

La tabla `periodos` del esquema vigente no expone columnas de fecha de inicio y
fin. Por eso los feriados solo pueden mapearse a semanas si se indica
`--fecha-inicio` (o si el esquema se amplía con fechas). Se puede indicar
`--fecha-fin` para definir el límite oficial del calendario; si se omite, se
calcula a partir de la fecha de inicio y la duración del periodo. Si hay feriados
activos y no se proporciona una fecha de inicio, el preflight aborta: no puede
garantizar la exclusión absoluta de esos días. Con el calendario mapeado, un
bloque se parte en varios rangos para no programar la semana feriada.

El segundo semestre, turno 1, prefiere la mañana hasta las 12:45; la tarde
puede habilitarse como alternativa penalizada, especialmente para docentes a
tiempo parcial con disponibilidad vespertina. Esa habilitación no relaja la
disponibilidad: cada bloque debe caber además en una franja activa del docente.
El segundo semestre, turno 2,
prefiere tarde/noche y puede usar la mañana como alternativa. El tercer
semestre conserva la mañana como banda primaria del turno 1 y puede usar
tarde/noche como alternativa. **A partir del cuarto semestre (IV, V, VI…) queda
prohibido el turno mañana:** TEC, TAL y VIR se restringen a tarde/noche. En los
semestres III–VI la primera clase del día no puede comenzar después de las
20:00; las clases posteriores sí pueden usar la noche completa. El segundo
turno cierra como máximo a las 21:00, incluso en su banda de noche.
Las horas VIR pueden ubicarse en cualquier banda institucional permitida para su
semestre (sin mañana desde IV) siempre que no se crucen con las clases de su
cohorte; ya no se exige el turno opuesto. El
modelo prefiere además que queden al menos **90 minutos alejadas** de la carga
presencial TEC/TAL de la misma cohorte cuando comparten día; si no es posible,
la cercanía paga `PENALIZACION_VIR_CERCANIA` (500 000) y el validador lo reporta
como advertencia. La jornada diaria de una cohorte, incluyendo actividades VIR y
EMP, no puede exceder 480 minutos entre su primera actividad y la última. EMP no
consume docente institucional ni ambiente físico, pero sí aparece en el horario
generado.

El modelo prefiere que cada docente y cada cohorte permanezcan en un solo turno
por día. Un día con mañana y tarde/noche se permite solo como último recurso y
paga una penalización muy alta (5 000 000 por docente/día, escalada por
contrato, y 1 000 000 por cohorte/día). Entre clases consecutivas de una misma
cohorte no puede haber una holgura mayor a **30 minutos**; el modelo prefiere 15
minutos y penaliza los 30. Las sesiones de un mismo curso deben quedar
contiguas: se prohíbe intercalar otro curso entre ellas. Un TEC de
carrera cuyas horas caben en un día paga 2 000 000 por cada día adicional
usado, para priorizar la jornada única.

Cuando dos bloques consecutivos de la misma cohorte quedan separados solo por
un receso de 15 minutos, son del mismo docente o del mismo curso y ambos pueden
usar aulas comunes, el modelo prefiere fuertemente mantener la misma aula CLAS
(`PENALIZACION_CAMBIO_AULA_CLAS = 1 500 000`). No aplica a laboratorios ni
talleres especializados: un cambio de aula común tras un receso se evita, pero
la regla es blanda para no volver infactible el horario si la disponibilidad de
aulas obliga a moverse.

La ramificación de CP-SAT prioriza primero a los docentes con disponibilidad
más cerrada (menos minutos disponibles y menor dominio de pares día/hora), y
después a los docentes de tiempo parcial sin franjas declaradas. Si una corrida
grupal termina `INFACTIBLE`, el CLI genera un diagnóstico detallado con las
actividades con menos ubicaciones compatibles, la carga de docentes/cohortes y
el aislamiento de la programación externa que bloquea al grupo; el presupuesto
se controla con `--tiempo-diagnostico`.

### Edición manual y uniformidad semanal

La cuadrícula permite arrastrar una clase del horario borrador a otro día u
hora. El movimiento se aplica a **todas las semanas del curso**, no solo a la
semana visible: el backend identifica la clase por `id_programacion`,
`tipo_modalidad`, `id_docente`, `id_ambiente`, día y rango horario original, y
actualiza todos los registros partidos por feriados o por rangos de semanas. La
validación de salón, docente y cohorte usa la unión real de semanas de la clase.

Los demás cursos no se mueven. Si un curso termina antes, sus espacios quedan
vacíos y el resto conserva su horario. Si el movimiento genera un conflicto en
cualquiera de las semanas, la transacción completa se rechaza. El endpoint
devuelve los `id_horario` expandidos y la cuadrícula los usa para refrescar de
inmediato todas las semanas afectadas.

### Limitaciones conocidas

- **Secuenciación modular estricta:** si los módulos TEC **cortos** de carrera
  de una cohorte suman más de 16 semanas lectivas, el modo estricto aborta. Los
  cursos TEC de larga duración (16 semanas, como Inglés Técnico) se programan
  en paralelo y no se suman a esa cadena. La compresión proporcional existe
  solo para borradores exploratorios y puede volver el modelo infactible.
- **Plantilla modular:** TEC y TAL deben tener el mismo patrón de bloques en
  todos los módulos de la línea. Si un módulo cambia el número o la duración de
  sus bloques, el preflight lo reporta. VIR no forma parte de la plantilla
  rígida para evitar bloqueos por diferencias menores de una hora.
- **Recuperación de feriados:** las semanas 17 y 18 quedan reservadas como
  margen. El motor evita programar en la semana feriada, pero todavía no genera
  automáticamente las sesiones de recuperación en ese margen; la gestión es
  manual o queda para una fase posterior.
- **Continuidad de alumnos:** entre bloques TEC/TAL consecutivos de una misma
  cohorte se exige una holgura de 15–30 minutos; se prefieren 15 minutos y los 30
  se penalizan como último recurso. Esta regla aplica tanto dentro de un turno
  como entre la mañana y la tarde/noche. Las sesiones de un mismo curso deben
  quedar contiguas (sin intercalar otro curso).
- **Ofertas duplicadas:** cada fila activa de `programacion_academica` se trata
  como una sección independiente. Si una misma sección aparece duplicada en dos
  turnos, se programarán ambas; conviene depurar esos datos si no representan
  secciones reales.
- **Datos de disponibilidad:** con `usa_restriccion_horaria = 1` y franjas
  activas, la disponibilidad es una restricción dura: cada bloque debe caber
  completo en una franja y en la banda oficial del turno. Si no hay intersección,
  la corrida falla con un diagnóstico detallado; no se amplía la banda ni se
  relaja la disponibilidad. Con `usa_restriccion_horaria = 0` las franjas se
  ignoran y se emite una advertencia si existen. El validador reporta cualquier
  bloque fuera de la disponibilidad como problema, no como advertencia.

## Requisitos

- Node.js y npm.
- MySQL con el esquema general del sistema. Este repositorio solo incluye el esquema adicional de autenticación en `database/auth.sql`.

## Preparar el entorno

1. En la carpeta raíz, copia `.env.example` a `.env` y configura la conexión MySQL y una clave `JWT_SECRET` propia.
2. En `frontend/`, copia `.env.example` a `.env`. Para desarrollo local, `VITE_API_URL` puede apuntar a `http://localhost:3000`.
3. En MySQL, selecciona la misma base configurada como `MYSQL_DB` y ejecuta `database/auth.sql`.
4. Si la tabla `periodos` ya existe, ejecuta una vez
   `database/migrations/20261103_fechas_periodo_academico.sql` para habilitar
   las fechas de inicio y fin. La cantidad de semanas se calcula al guardar
   contando ambos días del período y redondeando semanas parciales hacia arriba.
5. Instala y crea una cuenta autorizada:

   ```bash
   npm install
   node scripts/crear-usuario.js
   ```

6. Instala las dependencias del frontend:

   ```bash
   cd frontend
   npm install
   ```

## Iniciar en desarrollo

Abre dos terminales desde la raíz del repositorio. En una ejecuta `npm run dev`; en la otra ejecuta `cd frontend && npm run dev`. Vite mostrará la dirección local del frontend, normalmente `http://localhost:5173`.

El backend solo inicia si puede conectarse a MySQL. El login acepta DNI o correo institucional y una contraseña registrada para una cuenta activa.

## Comprobaciones del frontend

Desde `frontend/`, ejecuta `npm run lint` y `npm run build`.

## Seguridad

Los archivos `.env` son locales y no deben subirse al repositorio. `CORS_ORIGINS` acepta una lista separada por comas; al desplegar, configura ahí el origen del frontend.
