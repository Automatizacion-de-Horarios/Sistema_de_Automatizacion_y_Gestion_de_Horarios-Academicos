/**
 * scheduleService.js
 * -----------------------------------------------------------------------------
 * Capa de acceso y transformación de datos para la cuadrícula semanal.
 *
 * Los borradores se consultan desde Express/MySQL; las demás funciones
 * transforman esos registros para la cuadrícula semanal.
 * -----------------------------------------------------------------------------
 */

import { API_BASE_URL } from '../config/api';
import { authFetch } from '../lib/authFetch';

function normalizePeriodo(value) {
  const digits = String(value ?? '202620').replace(/\D/g, '');
  return digits ? Number(digits) : 202620;
}

export const DAYS = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO'];

export function getScheduleSessionKey(row) {
  return [
    row.periodo,
    row.bloque,
    row.dia,
    row.hora_ini,
    row.hora_fin,
    row.mat_cur,
    row.actividad,
    row.tipo_reunion,
    row.edificio,
    row.salon,
    row.instructor,
    row.semana_inicio ?? '',
    row.semana_fin ?? '',
  ].join('|');
}

/** Whether a class's active date ranges include the specific calendar day. */
export function isSessionActiveOnDate(session, date) {
  if (!date || !session.ranges?.length) return true;
  return session.ranges.some((range) =>
    (!range.start || range.start <= date) &&
    (!range.end || range.end >= date)
  );
}

export function hasNoAssignedInstructor(row) {
  return String(row?.edificio ?? '').trim().toUpperCase() === 'SV-EV' ||
    String(row?.tipo_reunion ?? '').trim().toUpperCase() === 'VAEE';
}

/* ============================================================================
 * Feriados (desde la base de datos vía GET /api/feriados)
 * ========================================================================== */

const MESES = [
  'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE',
];

/** Descarga los feriados desde la base de datos. */
export async function fetchHolidays(options = {}) {
  const response = await authFetch(`${API_BASE_URL}/api/feriados`, options);
  if (!response.ok) return [];
  return response.json();
}

/**
 * Convierte las filas de `feriados` de la BD en un Map "MM-DD" -> info.
 * La BD expone `fecha` como "YYYY-MM-DD".
 */
export function buildHolidaysMap(feriados = []) {
  const map = new Map();
  feriados.forEach((feriado) => {
    const fecha = String(feriado?.fecha ?? '');
    const partes = fecha.split('-').map(Number);
    if (partes.length < 3 || !partes[1] || !partes[2]) return;
    const mes = partes[1];
    const dia = partes[2];
    const mmdd = `${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    map.set(mmdd, {
      mes: MESES[mes - 1] ?? String(mes),
      dia,
      fecha_formatted: mmdd,
    });
  });
  return map;
}

/** Normaliza Date / "YYYY-MM-DD" / "MM-DD" a "MM-DD". */
function toMonthDay(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  const match = String(value).match(/(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : null;
}

export const DAY_LABELS = {
  LUNES: 'Lunes',
  MARTES: 'Martes',
  MIERCOLES: 'Miércoles',
  JUEVES: 'Jueves',
  VIERNES: 'Viernes',
  SABADO: 'Sábado',
  DOMINGO: 'Domingo',
};

export const ACTIVITY_LABELS = {
  TEC: 'Teoría',
  TAL: 'Taller',
  ACT: 'Actividad',
  EMP: 'Empresa',
};

export const MEETING_LABELS = {
  CLAS: 'Con docente',
  VAEE: 'Virtual / sin docente',
  REMT: 'Remota',
};

const COURSE_COLOR_PALETTE = [
  { hex: '#F97316', hue: 24 },
  { hex: '#3B82F6', hue: 217 },
  { hex: '#22C55E', hue: 142 },
  { hex: '#8B5CF6', hue: 258 },
  { hex: '#14B8A6', hue: 168 },
  { hex: '#06B6D4', hue: 189 },
  { hex: '#84CC16', hue: 84 },
  { hex: '#F59E0B', hue: 38 },
  { hex: '#6366F1', hue: 239 },
  { hex: '#0EA5E9', hue: 199 },
  { hex: '#16A34A', hue: 142 },
  { hex: '#7C3AED', hue: 262 },
];

function normalizeCourseName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function getCourseColorEntry(value) {
  const key = normalizeCourseName(value);
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = key.charCodeAt(index) + ((hash << 5) - hash);
  }
  return COURSE_COLOR_PALETTE[Math.abs(hash) % COURSE_COLOR_PALETTE.length];
}

function normalizeDraftScheduleRecord(record) {
  const dia = String(record?.dia ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  const modalidad = String(record?.tipo_modalidad ?? '').toUpperCase();

  return {
    ...record,
    periodo: normalizePeriodo(record?.periodo),
    bloque: record?.codigo_cohorte,
    cohorte: record?.cohorte,
    carrera_codigo: record?.codigo_carrera,
    carrera_nombre: record?.nombre_carrera,
    semestre_num: Number(record?.semestre_num) || null,
    mat_cur: record?.codigo_curso ?? '',
    nombre_curso: record?.nombre_curso ?? '',
    actividad: modalidad,
    tipo_reunion: modalidad === 'VIR' ? 'VAEE' : modalidad === 'EMP' ? 'EMP' : 'CLAS',
    dia,
    hora_ini: record?.hora_inicio ?? '',
    hora_fin: record?.hora_fin ?? '',
    instructor: record?.docente ?? null,
    ambiente: record?.ambiente ?? null,
    semana_inicio: Number(record?.semana_inicio),
    semana_fin: Number(record?.semana_fin),
  };
}

export async function fetchDraftSchedule(periodo = '202620', options = {}) {
  const response = await authFetch(
    `${API_BASE_URL}/api/horarios/borradores?periodo=${encodeURIComponent(periodo)}`,
    options
  );
  const result = await response.json();
  if (!response.ok || !result?.success) {
    throw new Error(result?.message || 'No se pudo cargar el horario borrador.');
  }

  return {
    periodo: result.data.codigo,
    estado: result.data.estado,
    semanas: Number(result.data.semanas) || 18,
    fechaInicio: result.data.fecha_inicio ?? null,
    fechaFin: result.data.fecha_fin ?? null,
    franja: result.data.franja ?? null,
    restricciones: {
      ocupaciones: Array.isArray(result.data.restricciones?.ocupaciones)
        ? result.data.restricciones.ocupaciones.map(normalizeDraftScheduleRecord)
        : [],
      disponibilidadDocentes: Array.isArray(result.data.restricciones?.disponibilidad_docentes)
        ? result.data.restricciones.disponibilidad_docentes
        : [],
      docentes: Array.isArray(result.data.restricciones?.docentes)
        ? result.data.restricciones.docentes
        : [],
      ambientes: Array.isArray(result.data.restricciones?.ambientes)
        ? result.data.restricciones.ambientes
        : [],
    },
    bloques: Array.isArray(result.data.bloques)
      ? result.data.bloques.map(normalizeDraftScheduleRecord)
      : [],
  };
}

export async function moveDraftSessions(periodo, ids, day, startTime, options = {}) {
  const response = await authFetch(
    `${API_BASE_URL}/api/horarios/borradores/${encodeURIComponent(periodo)}/mover`,
    {
      ...options,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: JSON.stringify({ ids, dia: day, hora_inicio: startTime }),
    }
  );
  const result = await response.json();
  if (!response.ok || !result?.success) {
    const error = new Error(result?.message || 'No se pudo guardar el cambio de horario.');
    error.conflictos = Array.isArray(result?.conflictos) ? result.conflictos : [];
    throw error;
  }
  return result.data;
}

export async function changeScheduleState(periodo, estado, options = {}) {
  const response = await authFetch(
    `${API_BASE_URL}/api/horarios/borradores/${encodeURIComponent(periodo)}/estado`,
    {
      ...options,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: JSON.stringify({ estado }),
    }
  );
  const result = await response.json();
  if (!response.ok || !result?.success) {
    throw new Error(result?.message || 'No se pudo cambiar el estado del horario.');
  }
  return result.data;
}

/** Convierte "HH:MM:SS" a minutos desde medianoche. */
export function timeToMinutes(time) {
  if (!time || typeof time !== 'string') return null;
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/** Formatea "HH:MM:SS" como "HH:MM". */
export function formatTime(time) {
  if (!time) return '';
  return time.slice(0, 5);
}

/** Parsea "YYYY-MM-DD" como fecha local (evita desfases de zona horaria). */
export function parseLocalDate(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

/** Devuelve el lunes de la semana que contiene la fecha. */
export function startOfWeekMonday(date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = result.getDay(); // 0 = domingo
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(result, diff);
}

export function toISODate(date) {
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatWeekRange(weekStart) {
  const start = parseLocalDate(weekStart);
  if (!start) return '';
  const end = addDays(start, 6);
  const monthShort = (date) =>
    date.toLocaleDateString('es-PE', { month: 'short' }).replace('.', '');
  const sameMonth = start.getMonth() === end.getMonth();
  const left = `${start.getDate()} ${monthShort(start)}`;
  const right = sameMonth ? `${end.getDate()}` : `${end.getDate()} ${monthShort(end)}`;
  return `${left} – ${right} ${end.getFullYear()}`;
}

/**
 * Datos de los 7 días de la semana seleccionada, incluyendo si es feriado.
 * El lunes es el índice 0 (coincide con el orden de `DAYS`).
 */
export function getWeekDays(weekStart, holidaysMap = new Map()) {
  const start = parseLocalDate(weekStart);
  if (!start) return [];
  return DAYS.map((day, index) => {
    const date = addDays(start, index);
    const mmdd = toMonthDay(date);
    const holiday = holidaysMap.get(mmdd) ?? null;
    return {
      day,
      date,
      iso: toISODate(date),
      mmdd,
      holiday,
      isHoliday: Boolean(holiday),
      label: date.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }).replace('.', ''),
    };
  });
}

/** Fila válida para pintar en la cuadrícula. */
export function isRenderableSession(row) {
  return Boolean(
    row &&
      row.dia &&
      DAYS.includes(row.dia) &&
      row.hora_ini &&
      row.hora_fin &&
      row.bloque &&
      row.mat_cur
  );
}

/** Periodos disponibles, más reciente primero. */
export function getPeriods(records = []) {
  return [...new Set(records.map((r) => r.periodo).filter((p) => Number.isFinite(p)))].sort(
    (a, b) => Number(b) - Number(a)
  );
}

/** Bloques/carreras disponibles para un periodo. */
export function getBlocks(records = [], period) {
  return [
    ...new Set(
      records
        .filter((r) => isRenderableSession(r) && (period === null || r.periodo === period))
        .map((r) => r.bloque)
    ),
  ].sort((a, b) => String(a).localeCompare(String(b), 'es'));
}

/** Límites de fechas del dataset completo. */
export function getScheduleBounds(records = []) {
  const starts = [];
  const ends = [];
  records.forEach((r) => {
    const start = parseLocalDate(r.d_inicio);
    const end = parseLocalDate(r.d_fin);
    if (start) starts.push(start);
    if (end) ends.push(end);
  });
  if (!starts.length || !ends.length) return null;
  return {
    min: new Date(Math.min(...starts.map((d) => d.getTime()))),
    max: new Date(Math.max(...ends.map((d) => d.getTime()))),
  };
}

/** Semana inicial: la actual si cae dentro del calendario; si no, la primera. */
export function getDefaultWeekStart(records = [], periodStart = null, periodEnd = null) {
  const bounds = getScheduleBounds(records);
  const today = new Date();
  const startLimit = parseLocalDate(periodStart);
  const endLimit = parseLocalDate(periodEnd);
  if (startLimit) {
    const reference = today < startLimit
      ? startLimit
      : endLimit && today > endLimit
        ? endLimit
        : today;
    return toISODate(startOfWeekMonday(reference));
  }
  const reference = bounds && today >= bounds.min && today <= bounds.max ? today : bounds?.min ?? today;
  return toISODate(startOfWeekMonday(reference));
}

export function getAcademicWeekNumber(weekStart, periodStart) {
  const start = parseLocalDate(weekStart);
  const firstDay = parseLocalDate(periodStart);
  if (!start || !firstDay) return 1;
  const calendarStart = startOfWeekMonday(start);
  const periodWeekStart = startOfWeekMonday(firstDay);
  return Math.floor((calendarStart - periodWeekStart) / (7 * 24 * 60 * 60 * 1000)) + 1;
}

/**
 * Sesiones de un bloque en una semana concreta.
 * - Filtra por periodo, bloque y solapamiento con [lunes, domingo].
 * - Deduplica el mismo slot repetido en varios rangos de fechas (módulos).
 */
export function getWeekSessions(records = [], { period, block, weekStart }) {
  if (!block) return [];
  const start = parseLocalDate(weekStart);
  if (!start) return [];
  const end = addDays(start, 6);

  const overlapping = records.filter((row) => {
    if (!isRenderableSession(row)) return false;
    if (period !== null && row.periodo !== period) return false;
    if (row.bloque !== block) return false;
    const rowStart = parseLocalDate(row.d_inicio);
    const rowEnd = parseLocalDate(row.d_fin);
    if (!rowStart || !rowEnd) return true;
    return rowStart <= end && rowEnd >= start;
  });

  const unique = new Map();
  overlapping.forEach((row) => {
    const key = getScheduleSessionKey(row);
    const noAssignedInstructor = hasNoAssignedInstructor(row);
    const instructorName = noAssignedInstructor ? '' : (row.instructor || '');

    if (!unique.has(key)) {
      unique.set(key, {
        ...row,
        key,
        instructorName,
        hasCatalogInstructor: Boolean(instructorName),
        noAssignedInstructor,
        ranges: [],
        scheduleIds: [],
      });
    }
    const session = unique.get(key);
    if (row.id_horario != null && !session.scheduleIds.includes(Number(row.id_horario))) {
      session.scheduleIds.push(Number(row.id_horario));
    }
    if (row.d_inicio && row.d_fin) {
      const rangeKey = `${row.d_inicio}|${row.d_fin}`;
      if (!session.ranges.some((r) => `${r.start}|${r.end}` === rangeKey)) {
        session.ranges.push({ start: row.d_inicio, end: row.d_fin });
      }
    }
  });

  return [...unique.values()];
}

/**
 * Agrupa por día y calcula carriles para sesiones que se solapan.
 * Devuelve { LUNES: [session...], ... } con `lane` y `laneCount`.
 */
export function layoutSessionsByDay(sessions = []) {
  const byDay = {};
  DAYS.forEach((day) => {
    byDay[day] = [];
  });
  sessions.forEach((session) => {
    if (byDay[session.dia]) byDay[session.dia].push(session);
  });

  DAYS.forEach((day) => {
    const list = [...byDay[day]].sort(
      (a, b) => timeToMinutes(a.hora_ini) - timeToMinutes(b.hora_ini) ||
        timeToMinutes(a.hora_fin) - timeToMinutes(b.hora_fin)
    );

    let cluster = [];
    let clusterEnd = -1;

    const flush = () => {
      if (!cluster.length) return;
      const laneEnds = [];
      const lanes = new Map();

      cluster.forEach((session) => {
        const start = timeToMinutes(session.hora_ini);
        const end = timeToMinutes(session.hora_fin);
        let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(end);
        } else {
          laneEnds[lane] = end;
        }
        lanes.set(session.key, lane);
      });

      cluster.forEach((session) => {
        session.lane = lanes.get(session.key) ?? 0;
        session.laneCount = laneEnds.length;
      });

      cluster = [];
      clusterEnd = -1;
    };

    list.forEach((session) => {
      const start = timeToMinutes(session.hora_ini);
      const end = timeToMinutes(session.hora_fin);
      if (cluster.length && start >= clusterEnd) flush();
      cluster.push(session);
      clusterEnd = Math.max(clusterEnd, end);
    });
    flush();
  });

  return byDay;
}

/**
 * Recesos entre bloques ocupados. Se consideran recesos los huecos de 15 a 30
 * minutos (el estándar SENATI es 15 min; se toleran variaciones de redondeo).
 */
export function getBreakSlots(daySessions = []) {
  if (!daySessions.length) return [];
  const sorted = [...daySessions].sort(
    (a, b) => timeToMinutes(a.hora_ini) - timeToMinutes(b.hora_ini)
  );
  const busy = [];
  sorted.forEach((session) => {
    const start = timeToMinutes(session.hora_ini);
    const end = timeToMinutes(session.hora_fin);
    const last = busy[busy.length - 1];
    if (last && start <= last.end) {
      last.end = Math.max(last.end, end);
    } else {
      busy.push({ start, end });
    }
  });

  const breaks = [];
  for (let i = 0; i < busy.length - 1; i += 1) {
    const gap = busy[i + 1].start - busy[i].end;
    if (gap >= 15 && gap <= 30) {
      breaks.push({
        startMin: busy[i].end,
        endMin: busy[i + 1].start,
        minutes: gap,
        label: `Receso ${gap}m`,
      });
    }
  }
  return breaks;
}

/** Color estable y diferenciado por código de materia. */
export function getCourseColor(matCur, nombre = '') {
  if (!matCur && !nombre) {
    return {
      bg: 'hsl(215 25% 96%)',
      border: 'hsl(215 15% 65%)',
      text: 'hsl(215 25% 30%)',
      chip: 'hsl(215 15% 55%)',
    };
  }
  const color = getCourseColorEntry(nombre || matCur);
  const { hue } = color;
  return {
    hex: color.hex,
    bg: `hsl(${hue} 88% 96%)`,
    border: `hsl(${hue} 64% 52%)`,
    text: `hsl(${hue} 68% 27%)`,
    chip: `hsl(${hue} 68% 45%)`,
  };
}
