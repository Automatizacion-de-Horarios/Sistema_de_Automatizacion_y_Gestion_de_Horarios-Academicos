# [GRUPO 1] Gestión de docentes y disponibilidad

Se agrega el panel del Equipo 1 conectado a MySQL: registro y edición de docentes, estados activo/inactivo/vacaciones, asignación de cursos por periodo académico, disponibilidad de 15 minutos y consulta del último cambio.

El panel muestra únicamente los docentes registrados desde esta pantalla. Los registros antiguos se conservan en la base. No se precargan ejemplos ni se eliminan docentes, asignaciones o disponibilidad.

## Cambios

- API protegida con el JWT existente.
- Registro con nombres y apellidos separados y DNI opcional de 8 dígitos.
- Cursos de distintas carreras y complementarios con filtros por carrera y semestre.
- Asignaciones independientes por periodo; los periodos cerrados no permiten cambiar cursos.
- Rango y cuadrícula comparten la misma disponibilidad.
- Unión de separaciones de hasta 45 minutos; las de 60 quedan separadas.
- Auditoría con el usuario de la sesión.
- Acciones con edición de datos y ficha completa.
- App.jsx únicamente conecta el componente del Equipo 1 con el periodo global.

## Verificación

- Compilación del frontend y ESLint del componente.
- Once pruebas locales de backend con conexiones simuladas.
- Consulta de lectura contra MySQL: la estructura está preparada y el panel devuelve cero docentes iniciales.
- Prueba visual aislada de registro, cursos de varias carreras, rangos, cambio de estado y ficha, sin insertar docentes en la base real.

## Pendiente de otro equipo

La vista Clases queda vacía y señalada como pendiente hasta integrar el generador. cursos_docentes no sobrescribe programacion_academica ni modifica las pantallas de otros equipos.

## Base de datos

database/grupo1_docentes_real.sql conserva el cambio de estructura. En la base de trabajo actual YA está aplicado; no repetir ALTER TABLE. database/grupo1_verificar.sql sirve para comprobarlo sin escribir datos.

## Antes de enviar

Probar desde la aplicación el registro de un docente real, guardar cursos y disponibilidad, y volver a abrir la pantalla para verificar persistencia. No incluir .env, node_modules ni archivos de dist.
