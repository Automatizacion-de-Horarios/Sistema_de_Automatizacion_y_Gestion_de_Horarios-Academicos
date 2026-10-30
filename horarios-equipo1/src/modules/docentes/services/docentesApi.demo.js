// MODO DEMO: datos en memoria para probar la interfaz sin Supabase.
// Se activa solo cuando faltan SUPABASE_URL / SUPABASE_ANON_KEY en el .env.
import { USUARIO_ACTUAL } from '../../../config/app';
import { rangosASlots, formatearFecha } from '../utils/disponibilidad';

const esperar = (ms = 120) => new Promise((r) => setTimeout(r, ms));
const ahora = () => formatearFecha(new Date().toISOString());
const L_V = (inicio, fin) => [1, 2, 3, 4, 5].map((dia) => ({ dia, inicio, fin }));

let siguienteId = 200;

const cursos = [
  { id: 501, codigo: 'PIAD-525', nombre: 'DESARROLLO DE APLICACIONES WEB', horas: 6, ciclo: 5 },
  { id: 502, codigo: 'PIAD-526', nombre: 'BASE DE DATOS AVANZADA', horas: 4, ciclo: 5 },
  { id: 503, codigo: 'PIAD-527', nombre: 'INGENIERÍA DE SOFTWARE', horas: 4, ciclo: 5 },
  { id: 504, codigo: 'PIAD-528', nombre: 'INTELIGENCIA ARTIFICIAL APLICADA', horas: 4, ciclo: 5 },
  { id: 505, codigo: 'PIAD-529', nombre: 'FORMACIÓN PRÁCTICA EN EMPRESA I', horas: 8, ciclo: 5 },
  { id: 506, codigo: 'PIAD-625', nombre: 'GESTIÓN DE PROYECTOS TI', horas: 4, ciclo: 6 },
  { id: 507, codigo: 'PIAD-626', nombre: 'SEGURIDAD INFORMÁTICA', horas: 4, ciclo: 6 },
  { id: 508, codigo: 'PIAD-627', nombre: 'TECNOLOGÍAS VIRTUALES', horas: 3, ciclo: 6 },
  { id: 509, codigo: 'CGEU-240', nombre: 'FORMACIÓN DE MONITORES DE EMPRESA', horas: 2, ciclo: 6 }
];

let docentes = [
  { id: 101, apellidos: 'ROSPIGLIOSI COHAILA', nombres: 'FREDDY FERNANDO', dni: '70123456', especialidad: 'Software e IA', horasContrato: 30, estado: 'A',
    cursosPermitidos: [501, 502, 504, 505], slots: rangosASlots([...L_V('08:00', '13:00'), { dia: 5, inicio: '14:00', fin: '19:00' }]) },
  { id: 102, apellidos: 'LEON MARIN', nombres: 'GERMAN WILLIAMS', dni: '70234567', especialidad: 'Ingeniería de Software', horasContrato: 24, estado: 'A',
    cursosPermitidos: [501, 503, 506, 508], slots: rangosASlots(L_V('13:00', '19:00')) },
  { id: 103, apellidos: 'SANCHEZ AGUILERA', nombres: 'CARLOS ALBERTO', dni: '70345678', especialidad: 'Seguridad y Gestión', horasContrato: 20, estado: 'A',
    cursosPermitidos: [507, 509], slots: rangosASlots([...L_V('18:00', '21:00'), { dia: 6, inicio: '08:00', fin: '13:00' }]) },
  { id: 104, apellidos: 'VILLALBA CHALLO', nombres: 'JASMIN LESLIE', dni: '70456789', especialidad: 'Tecnologías Virtuales', horasContrato: 12, estado: 'V',
    cursosPermitidos: [508], slots: rangosASlots([...L_V('08:00', '11:00'), { dia: 6, inicio: '08:00', fin: '12:00' }]) }
].map((d) => ({
  ...d,
  nombre: `${d.apellidos}, ${d.nombres}`,
  usuarioModificacion: USUARIO_ACTUAL,
  fechaModificacion: ahora()
}));

const clases = [
  { id: 1, docenteId: 101, dia: 1, inicio: '08:00', fin: '10:00', curso: 'DESARROLLO DE APLICACIONES WEB', ambiente: 'Lab 01' },
  { id: 2, docenteId: 101, dia: 3, inicio: '08:00', fin: '10:00', curso: 'DESARROLLO DE APLICACIONES WEB', ambiente: 'Lab 01' },
  { id: 3, docenteId: 102, dia: 2, inicio: '13:00', fin: '15:00', curso: 'INGENIERÍA DE SOFTWARE', ambiente: 'Aula 202' }
];

const buscar = (id) => docentes.find((d) => d.id === id);
const auditar = (d) => { d.usuarioModificacion = USUARIO_ACTUAL; d.fechaModificacion = ahora(); };

export const docentesApiDemo = {
  async listarDocentes() { await esperar(); return docentes.map((d) => ({ ...d, slots: [...d.slots], cursosPermitidos: [...d.cursosPermitidos] })); },
  async listarCursos() { await esperar(); return cursos.map((c) => ({ ...c })); },

  async crearDocente({ nombres, apellidos, dni, especialidad, horasContrato }) {
    await esperar();
    if (docentes.some((d) => d.dni === dni)) throw new Error('Ya existe un registro con ese valor único (por ejemplo, el DNI).');
    const d = {
      id: ++siguienteId, nombres, apellidos, dni, especialidad: especialidad || 'General', horasContrato: horasContrato || 0,
      estado: 'A', cursosPermitidos: [], slots: rangosASlots(L_V('08:00', '12:00')),
      nombre: [apellidos, nombres].filter(Boolean).join(', ').toUpperCase()
    };
    auditar(d);
    docentes = [...docentes, d];
  },

  async actualizarDocente(id, { nombres, apellidos, dni, especialidad, horasContrato }) {
    await esperar();
    if (docentes.some((d) => d.dni === dni && d.id !== id)) throw new Error('Ya existe un registro con ese valor único (por ejemplo, el DNI).');
    const d = buscar(id);
    Object.assign(d, { nombres, apellidos, dni, especialidad, horasContrato, nombre: [apellidos, nombres].filter(Boolean).join(', ').toUpperCase() });
    auditar(d);
  },

  async cambiarEstado(id, estado) { await esperar(); const d = buscar(id); d.estado = estado; auditar(d); },
  async guardarDisponibilidad(id, slots) { await esperar(); const d = buscar(id); d.slots = [...slots]; auditar(d); },
  async guardarCompetencias(id, cursoIds) { await esperar(); const d = buscar(id); d.cursosPermitidos = [...cursoIds]; auditar(d); },
  async listarClasesDocente(id) { await esperar(); return clases.filter((c) => c.docenteId === id); }
};
