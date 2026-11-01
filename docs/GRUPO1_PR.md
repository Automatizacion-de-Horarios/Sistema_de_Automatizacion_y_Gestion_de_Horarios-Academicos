# Gestión de docentes y disponibilidad

Se mantiene la gestión conectada a MySQL, con búsqueda por nombre, registro de docentes por nombres y apellidos, edición, tipo de contrato, estado Activo/Inactivo y disponibilidad semanal.

La cuadrícula muestra la disponibilidad existente en `disponibilidad_docentes`, guarda los cambios en esa misma tabla y limita los intervalos a las horas de `configuracion_franja_horaria` para el periodo seleccionado. La auditoría continúa registrándose en la base de datos sin exponerse en la interfaz.

Se agregó la bandera `docentes.usa_restriccion_horaria`. El check **Usar restricción horaria** está dentro de la cuadrícula: en tiempo parcial queda activo y bloqueado; en tiempo completo es opcional. Al cambiar de completo a parcial se activa automáticamente y se exige configurar la cuadrícula; al cambiar de parcial a completo se desactiva por defecto, se conservan las franjas y el usuario puede volver a activarla. El backend valida que una bandera activa tenga al menos una franja.

El solver CP-SAT de la rama `feature/grupo4-horarios` ahora lee la bandera: `0` asigna dentro de la jornada institucional sin usar la cuadrícula y `1` respeta estrictamente las franjas. El script `sincronizar_disponibilidad_docentes.js` exporta la base de datos al JSON del solver y advierte si un docente restringido no tiene franjas. Si la carga semanal de un docente restringido supera sus franjas, el solver falla con `InfeasibleDataError` en lugar de liberar su disponibilidad.

## Verificación recomendada

- Compilar y revisar ESLint en el frontend.
- Probar en la aplicación la búsqueda y el registro de un docente.
- Probar los filtros Todos, Tiempo Completo 36h, Tiempo Parcial 23h y Tiempo Parcial 19h, combinados con la búsqueda.
- Cambiar su estado entre Activo e Inactivo.
- Guardar disponibilidad dentro del horario configurado, recargar la pantalla y confirmar que las celdas guardadas se vuelven a mostrar.
- Probar las transiciones completo→parcial y parcial→completo, el check obligatorio/opcional y la conservación de franjas.
- Ejecutar `node sincronizar_disponibilidad_docentes.js` y confirmar que los docentes restringidos conservan sus franjas.

La pantalla no incluye DNI, identificadores visibles, asignación de cursos, rangos, clases ni auditoría visible.
