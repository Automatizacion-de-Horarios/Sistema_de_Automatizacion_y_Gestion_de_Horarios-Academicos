// Utilidades para convertir entre:
//  - FILAS de la tabla disponibilidad_docentes: { dia_semana, hora_inicio, hora_fin }
//  - SLOTS de la cuadrícula: claves "dia-HH:MM" de 1 hora, ej. "1-08:00" (Lunes 08:00 a 09:00)

export const normalizarHora = (h) => String(h).slice(0, 5); // "08:00:00" -> "08:00"

export const aMinutos = (h) => {
  const [hh, mm] = normalizarHora(h).split(':').map(Number);
  return hh * 60 + mm;
};

export const aHora = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export const claveSlot = (dia, hora) => `${dia}-${normalizarHora(hora)}`;

// Devuelve las claves de slot que cubre un rango (incluye horas parciales)
function expandirRango(dia, inicio, fin) {
  const ini = aMinutos(inicio);
  const end = aMinutos(fin);
  const claves = [];
  for (let m = Math.floor(ini / 60) * 60; m < end; m += 60) {
    if (m + 60 > ini) claves.push(claveSlot(dia, aHora(m)));
  }
  return claves;
}

export function filasASlots(filas = []) {
  const slots = new Set();
  filas.forEach((f) => expandirRango(f.dia_semana, f.hora_inicio, f.hora_fin).forEach((k) => slots.add(k)));
  return [...slots];
}

export function rangosASlots(rangos = []) {
  const slots = new Set();
  rangos.forEach((r) => expandirRango(r.dia, r.inicio, r.fin).forEach((k) => slots.add(k)));
  return [...slots];
}

// Agrupa slots contiguos en rangos: [{ dia, inicio, fin }]
export function slotsARangos(slots = []) {
  const porDia = {};
  slots.forEach((k) => {
    const [dia, hora] = k.split('-');
    (porDia[dia] = porDia[dia] || []).push(aMinutos(hora));
  });
  const rangos = [];
  Object.keys(porDia)
    .sort()
    .forEach((dia) => {
      const mins = porDia[dia].sort((a, b) => a - b);
      let ini = mins[0];
      let prev = mins[0];
      for (let i = 1; i <= mins.length; i++) {
        const cur = mins[i];
        if (cur !== prev + 60) {
          rangos.push({ dia: Number(dia), inicio: aHora(ini), fin: aHora(prev + 60) });
          ini = cur;
        }
        prev = cur;
      }
    });
  return rangos;
}

export const slotsAFilas = (docenteId, slots) =>
  slotsARangos(slots).map((r) => ({
    docente_id: docenteId,
    dia_semana: r.dia,
    hora_inicio: r.inicio,
    hora_fin: r.fin
  }));

// ¿El docente puede dictar en ese día y rango? (estado Activo y todas las horas marcadas)
export function docenteDisponibleEn(docente, dia, horaInicio, horaFin) {
  if (!docente || docente.estado !== 'A') return false;
  const set = new Set(docente.slots);
  const ini = aMinutos(horaInicio);
  const fin = aMinutos(horaFin);
  if (fin <= ini) return false;
  for (let m = Math.floor(ini / 60) * 60; m < fin; m += 60) {
    if (!set.has(claveSlot(dia, aHora(m)))) return false;
  }
  return true;
}

export const formatearFecha = (valor) => {
  if (!valor) return '—';
  const d = new Date(valor);
  if (isNaN(d)) return String(valor).slice(0, 16).replace('T', ' ');
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
