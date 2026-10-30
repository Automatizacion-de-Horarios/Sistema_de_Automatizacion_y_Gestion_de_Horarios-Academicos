// Configuración compartida del sistema (un solo lugar para cambiar nombres y constantes).

// Usuario que se registra en la auditoría. Cuando exista login, reemplazar por el usuario real.
export const USUARIO_ACTUAL = 'Joaquin_Coordinador';

// Nombres de tablas en Supabase. Si en la BD real se llaman distinto, se cambia SOLO aquí.
export const TABLAS = {
  docentes: 'docentes',
  disponibilidad: 'disponibilidad_docentes',
  competencias: 'docente_competencias', // docente_id, curso_id (opcional)
  cursos: 'cursos',                      // Equipo 3 (solo lectura)
  horarios: 'horarios_asignados',        // Equipo 4 (solo lectura)
  ambientes: 'ambientes'                 // Equipo 2 (solo lectura)
};

export const DIAS = [
  { n: 1, nombre: 'Lunes' },
  { n: 2, nombre: 'Martes' },
  { n: 3, nombre: 'Miércoles' },
  { n: 4, nombre: 'Jueves' },
  { n: 5, nombre: 'Viernes' },
  { n: 6, nombre: 'Sábado' }
];

// Franjas de 1 hora de 07:00 a 21:00
export const HORAS = Array.from({ length: 14 }, (_, i) => {
  const h = 7 + i;
  const ini = `${String(h).padStart(2, '0')}:00`;
  const fin = `${String(h + 1).padStart(2, '0')}:00`;
  return { id: ini, label: `${ini} - ${fin}` };
});

export const ESTADOS = {
  A: { texto: 'Activo (A)', clase: 'status-a', icono: 'fa-check', detalle: 'Disponible para programación' },
  I: { texto: 'Inactivo (I)', clase: 'status-i', icono: 'fa-times', detalle: 'Retirado / Inhabilitado' },
  V: { texto: 'Vacaciones (V)', clase: 'status-v', icono: 'fa-umbrella-beach', detalle: 'Suspensión temporal' }
};
