# Grupo 1: docentes reales, cursos por periodo y disponibilidad

## Archivos modificados

- src/models/docente.model.js
- src/controllers/docente.controller.js
- src/routes/docente.routers.js (se conserva el nombre que tiene el repositorio)
- frontend/src/views/DocentesView.jsx
- frontend/src/views/DocentesView.css
- frontend/src/App.jsx: únicamente se pasa periodoGlobal al componente del Equipo 1 y se usa como key para separar la vista de cada periodo.
- database/grupo1_docentes_real.sql: script local, no ejecutado automáticamente.
- Este documento.

No se modifican las rutas ni los componentes de los otros equipos, la configuración de conexión ni el .env. No se ejecutan consultas de escritura en la base de datos desde la entrega.

## Estado actual de la base y arranque local

Se verificó con consultas de solo lectura que docentes tiene las diez columnas necesarias y que cursos_docentes ya existe. La configuración del módulo devuelve preparado = true. El panel está vacío porque todavía no hay docentes registrados desde esta pantalla.

No es necesario volver a ejecutar ALTER TABLE ni CREATE TABLE en esta base. database/grupo1_docentes_real.sql queda como un script sencillo para preparar una base nueva; database/grupo1_verificar.sql solo consulta el estado actual.

Para probar:

1. Iniciar o reiniciar el backend desde la raíz con npm run dev (o npm start).
2. En otra terminal, entrar en frontend y ejecutar npm run dev.
3. Iniciar sesión, seleccionar 2026-II y abrir Docentes.
4. Pulsar Registrar Instructor, completar el formulario y guardar.
5. Seleccionar cursos y disponibilidad; recargar para comprobar que persisten.

La estructura agrega DNI opcional con índice único, registrado_en_panel y fecha_registro en docentes. Los registros antiguos quedan con registrado_en_panel = 0, sin borrar sus datos ni relaciones. El panel registra los nuevos con valor 1 y solo muestra esos registros.

cursos_docentes tiene referencias a docentes, cursos y periodos; evita repetir la combinación docente + curso + periodo. No se insertaron docentes de ejemplo ni se reiniciaron identificadores.

## Flujo de registro

- Registrar Instructor abre un formulario con nombres y apellidos separados, DNI opcional y especialidad.
- Las dos cajas superiores sirven para buscar por nombre y DNI.
- El primer registro se crea activo, sin cursos y sin disponibilidad.
- No se precarga ningún instructor, curso seleccionado ni horario.
- El DNI, cuando se ingresa, debe tener 8 dígitos y no puede repetirse con otro docente de la base.
- Sin DNI se permiten registros con el mismo nombre, ya que el nombre no es un identificador único.
- La creación y los cambios toman el usuario de la sesión verificada; el navegador no decide el valor de auditoría.
- Se mantiene especialidad. No se transforma en id_carrera ni se limita qué carreras puede enseñar.

## Cursos por periodo

El periodo se recibe del selector global en App.jsx. Su código se resuelve en periodos; no se supone que el código sea la clave numérica. Actualmente la base tiene 202620 (2026 - II).

La asignación permite varias carreras, filtros por carrera, semestre, código, nombre y tipo, y cursos complementarios según cursos.is_carrera. Muestra las horas de teoría, taller, virtual, evaluación y el total curricular. Estas horas no se suman a la disponibilidad semanal.

Al cambiar los filtros se conserva la selección completa. Las relaciones retiradas pasan a I y pueden reactivarse. Se guardan solo las relaciones del periodo seleccionado; no se reemplazan las de otros periodos. Un periodo cerrado permite consultar, pero no modificar cursos.

cursos_docentes guarda la selección docente-curso por periodo. No sustituye programacion_academica, donde el otro equipo ya gestiona grupo, turno, sede y docentes TEC/TAL. La integración entre ambas decisiones debe coordinarse con ese equipo; este módulo no sobrescribe su programación.

## Disponibilidad

Es una disponibilidad semanal general, conforme a la tabla existente. No se agregó id_periodo a disponibilidad_docentes para no alterar los contratos de otros equipos.

Rango y cuadrícula editan las mismas franjas: no crean dos fuentes de datos. El rango permite agregar varios tramos por día y retirarlos. La cuadrícula usa celdas de 15 minutos, clic o arrastre y accesos de mañana, tarde y noche.

Al guardar se unen superposiciones y separaciones de hasta 45 minutos; una separación de 60 minutos queda aparte. La vista de rangos muestra lo que se guardará, incluidos los recesos unidos. El contador del listado no suma dos veces superposiciones.

Guardar vacío desactiva los tramos vigentes. Repetir la misma selección reutiliza las filas anteriores. Todas las escrituras del docente se realizan dentro de una transacción y bloquean ese registro mientras dura el cambio.

No se importa Excel ni se corrigen automáticamente datos históricos de VAE, formación en empresa o revisión de cuadernos.

## Estado, acciones y clases

- El estado de la fila abre un formulario independiente A/I/V.
- Editar los datos personales no cambia indirectamente el estado.
- Acciones contiene únicamente Editar datos y Ver ficha completa con auditoría, como se acordó.
- La ficha incluye fecha de registro, último usuario y fecha de modificación, estado, cursos del periodo y disponibilidad.
- La auditoría es el último cambio: no se implementó un historial completo.
- Clases presenta la semana vacía con aviso de integración pendiente. La base consultada no tiene todavía días y horas de clases generadas. No se inventa un horario a partir de disponibilidad o de cursos asignados.

## Pruebas manuales después del SQL

1. El panel debe quedar vacío aunque existan docentes antiguos en la base.
2. Registrar un docente y verificar que aparece después de recargar la página.
3. Editar sus datos y cambiar A/I/V. Verificar auditoría y conservación de sus relaciones.
4. Seleccionar cursos de dos carreras y un complementario, guardar y reabrir.
5. Si existe otro periodo, comprobar que sus asignaciones son independientes.
6. Marcar lunes 08:00–08:15, 09:00–09:15 y 10:15–10:30. La vista previa debe devolver 08:00–09:15 y 10:15–10:30.
7. Guardar dos veces y comprobar que no agrega asignaciones ni franjas activas idénticas.
8. Confirmar que los docentes antiguos, la programación y las otras pantallas permanecen disponibles en sus módulos.

El frontend se compiló localmente y se revisó con ESLint. Las pruebas de backend usan conexiones simuladas: no insertan docentes ni ejecutan la migración real. La configuración real y el listado vacío ya se comprobaron contra MySQL; falta que el usuario registre su primer docente real para probar la persistencia desde la pantalla.

## API

Todas las rutas están bajo /api/docentes, protegidas por el JWT y una cuenta activa. Todas reciben ?periodo=202620 (o el código global seleccionado).

- GET /: listado y configuración.
- POST /: registro real.
- PUT /:id: datos del docente.
- PATCH /:id/estado: estado A/I/V.
- GET y PUT /:id/cursos: asignaciones por periodo.
- GET y PUT /:id/disponibilidad: franjas semanales.
- GET /:id/ficha: ficha completa y auditoría.

No existe DELETE. Se conserva el control de acceso autenticado que utiliza actualmente el proyecto; no se cambian permisos ni roles de los otros módulos.
