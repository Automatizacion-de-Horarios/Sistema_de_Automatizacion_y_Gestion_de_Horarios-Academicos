// API pública del módulo Equipo 1. Otros equipos importan SOLO desde aquí:
//   import { useDocentes } from '../docentes';
export { useDocentes } from './hooks/useDocentes';
export { docenteDisponibleEn } from './utils/disponibilidad';
export { default as DocentesPage } from './components/DocentesPage';
