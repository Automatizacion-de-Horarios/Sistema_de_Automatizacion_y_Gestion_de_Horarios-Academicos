# Gestión de docentes y disponibilidad

El panel usa las tablas existentes `docentes`, `disponibilidad_docentes`, `periodos` y `configuracion_franja_horaria` de `database/db_horarios.sql`. No crea datos de ejemplo ni modifica el esquema. Si falta la columna `docentes.usa_restriccion_horaria`, ejecuta una vez `database/docentes_restriccion_horaria.sql`; el script es idempotente y deja en `1` a los docentes de tiempo parcial.

## Funciones

- Lista docentes de la base de datos y permite filtrar por nombres o apellidos.
- El listado tiene cuatro filtros de contrato: Todos, Tiempo Completo 36h, Tiempo Parcial 23h y Tiempo Parcial 19h; el filtro se combina con la búsqueda por nombre.
- El registro solicita nombres, apellidos y tipo de contrato; los nuevos registros quedan activos.
- La edición de datos se abre desde el botón de engranaje y también permite cambiar el tipo de contrato.
- El tipo de contrato también se puede cambiar directamente desde la columna Contrato de la tabla; el cambio se guarda en la base de datos.
- Los contratos disponibles son tiempo completo (36 h semanales) y tiempo parcial de lunes a viernes (19 h) o de lunes a sábado (23 h).
- La columna `docentes.usa_restriccion_horaria` decide si el solver respeta la cuadrícula: `0` permite asignar dentro de la franja institucional y `1` exige las franjas marcadas.
- Al registrar un tiempo completo la bandera queda en `0`; al registrar un tiempo parcial queda en `1`.
- Al cambiar de tiempo completo a parcial la bandera se activa en `1` y la pantalla abre la cuadrícula si aún no tiene franjas. Al cambiar de parcial a completo se desactiva en `0`, se conserva la cuadrícula guardada y el usuario puede volver a activarla manualmente desde la cuadrícula.
- En tiempo parcial el check de la cuadrícula es obligatorio y no se puede desmarcar. En tiempo completo es opcional.
- El estado solo permite Activo e Inactivo y se cambia directamente desde la tabla, sin abrir una ventana.
- La cuadrícula trabaja con intervalos de 15 minutos y obtiene sus horas mínima y máxima de la configuración del periodo seleccionado.
- El listado inicial ya incluye las franjas activas de cada docente, por lo que abrir la cuadrícula no genera otra consulta. Guardar persiste las franjas y la bandera en `disponibilidad_docentes` y `docentes`.
- Los cambios de docente y disponibilidad actualizan el usuario y la fecha de modificación en la base de datos; estos datos de auditoría no se muestran en el panel.

La disponibilidad es semanal y pertenece al docente, según la estructura existente; no se agrega una relación con el periodo. La configuración horaria del periodo determina los límites disponibles de la cuadrícula y también se valida en el backend al guardar.

El panel no asigna cursos ni muestra DNI, identificadores, auditoría o clases. La tabla `cursos_docentes` y el script `database/grupo1_docentes_real.sql` no son requisitos para esta pantalla.

## Integración con el solver

El solver CP-SAT vive en la rama `feature/grupo4-horarios`. Para sincronizar la base de datos con su entrada `json/disponibilidad_docentes.json` se usa:

```bash
node sincronizar_disponibilidad_docentes.js
```

El script exporta para cada docente activo su `usa_restriccion_horaria`, `horas_semanales_meta` y `franjas_disponibles`. Los docentes con bandera `0` se preparan con la jornada operativa completa; los de bandera `1` conservan únicamente sus franjas. `generar_horario.py`, `solver_engine.py` y `validar_horario.py` respetan esa bandera y no liberan automáticamente a un docente restringido.

Un docente con bandera `1` y sin franjas se muestra como **Configurar** en el listado y hará infactible el solver hasta que se complete su cuadrícula. Al momento de esta verificación hay 7 docentes de tiempo parcial en esa situación. El solver también rechaza a un docente restringido cuya carga semanal asignada supera las horas de su cuadrícula; el reporte de `InfeasibleDataError` indica los nombres para corregirlos.

## Uso y comprobaciones

1. Iniciar el backend desde la raíz con `npm run dev` (o `npm start`) y el frontend desde `frontend` con `npm run dev`.
2. Iniciar sesión, elegir un periodo que tenga una fila en `configuracion_franja_horaria` y abrir Docentes.
3. Buscar por nombre, registrar un instructor y verificar que aparece tras actualizar el listado.
4. Cambiarlo a Inactivo y de nuevo a Activo.
5. Abrir la cuadrícula, confirmar que respeta el horario configurado, marcar disponibilidad, guardarla y volver a abrirla para comprobar la persistencia.
6. Probar el check **Usar restricción horaria**: en tiempo parcial debe estar marcado y bloqueado; en tiempo completo debe poder marcarse y desmarcarse.
7. Cambiar un tiempo completo a parcial sin cuadrícula y confirmar que se abre la cuadrícula y que no se puede guardar sin marcar al menos una franja.
8. Cambiar un parcial a completo y confirmar que la bandera queda en `0`, que las franjas siguen guardadas y que el check puede volver a marcarse.
9. Confirmar que los cambios continúan actualizando los datos internos de auditoría.

## API

Las rutas están bajo `/api/docentes`, protegidas por el JWT y una cuenta activa. Reciben `?periodo=<codigo_periodo>`.

- `GET /`: listado y configuración horaria; incluye `usa_restriccion_horaria` por docente.
- `POST /`: crear docente; el backend asigna la bandera según el contrato.
- `PUT /:id`: editar nombres, apellidos, especialidad y contrato; conserva o reinicia la bandera según corresponda.
- `PATCH /:id/estado`: cambiar a Activo o Inactivo.
- `PATCH /:id/contrato`: cambiar contrato y horas; responde con la bandera resultante.
- `GET /:id/disponibilidad`: devuelve `franjas` y `usa_restriccion_horaria`.
- `PUT /:id/disponibilidad`: recibe `franjas` y `usa_restriccion_horaria`; persiste ambos. Con bandera `1` exige al menos una franja.
