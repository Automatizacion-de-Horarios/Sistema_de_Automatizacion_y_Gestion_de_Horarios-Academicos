/**
 * scheduleService.js
 * -----------------------------------------------------------------------------
 * Capa de acceso y transformación de datos para la cuadrícula semanal.
 *
 * MODO ACTUAL: datos locales. Lee el horario validado por
 * `generar_horario.py`.
 *
 * PARA CONECTAR LA API EN EL FUTURO:
 *   Reemplaza `getScheduleSnapshot()` por una llamada a `fetch('/api/horarios')`
 *   (o al endpoint de Express/MySQL que corresponda). El resto de funciones de
 *   este archivo son puras y no dependen del origen de los datos, por lo que el
 *   componente no necesitará cambios.
 * -----------------------------------------------------------------------------
 */

import importedScheduleData from '../../../horarios_generados/horario_generado.json';
import coursesData from '../data/cursos.json';
import holidaysData from '../data/feriados.json';
import courseInstructorsData from '../../../json/curso_docentes.json';

function deriveBlockFromGeneratedRecord(record) {
  const candidate = String(record?.grupo ?? record?.seccion ?? record?.carrera ?? '').trim();
  const compact = candidate.toUpperCase().replace(/[^A-Z0-9]/g, '');

  const match = compact.match(/([A-Z]+)(\d{3})$/);
  if (match) {
    const career = match[1];
    const groupCode = match[2];
    return `56${career}E${groupCode}`;
  }

  const carreraCode = String(record?.carrera ?? 'GEN')
    .replace(/[^A-Z]/gi, '')
    .slice(0, 4)
    .toUpperCase() || 'GEN';

  const semestreRaw = String(record?.semestre ?? 1);
  const normalizedSemestre = semestreRaw.padStart(3, '0');
  return `56${carreraCode}E${normalizedSemestre}`;
}

function normalizePeriodo(value) {
  const digits = String(value ?? '202620').replace(/\D/g, '');
  return digits ? Number(digits) : 202620;
}

function normalizeGeneratedScheduleRecord(record) {
  const aula = record?.aula ?? record?.salon ?? '';
  const building = aula.includes(' · ') ? aula.split(' · ')[0] : (record?.edificio ?? '56P');
  const room = aula.includes(' · ') ? aula.split(' · ')[1] : (record?.salon ?? null);
  const hourIni = String(record?.hora_inicio ?? record?.hora_ini ?? '07:45');
  const hourFin = String(record?.hora_fin ?? record?.hora_fin ?? '10:00');

  return {
    ...record,
    periodo: normalizePeriodo(record?.periodo),
    parte_periodo: Number(record?.parte_periodo ?? 1),
    seccion: record?.seccion ?? record?.grupo ?? 1,
    camp: record?.camp ?? '56P',
    mat_cur: record?.mat_cur ?? '',
    actividad: record?.actividad ?? record?.tipo_clase ?? 'TEC',
    tipo_reunion: record?.tipo_reunion ?? (record?.docente ? 'CLAS' : 'VAEE'),
    edificio: building,
    salon: room,
    hora_ini: hourIni.includes(':') && hourIni.split(':').length === 2 ? `${hourIni}:00` : hourIni,
    hora_fin: hourFin.includes(':') && hourFin.split(':').length === 2 ? `${hourFin}:00` : hourFin,
    dia: record?.dia ?? 'LUNES',
    d_inicio: record?.d_inicio ?? record?.fecha_inicio ?? '2026-08-17',
    d_fin: record?.d_fin ?? record?.fecha_fin ?? '2026-09-18',
    instructor: record?.instructor ?? record?.docente ?? null,
    bloque: record?.bloque ?? deriveBlockFromGeneratedRecord(record),
  };
}

function normalizeGeneratedScheduleData(records) {
  if (!Array.isArray(records)) return [];
  return records.map(normalizeGeneratedScheduleRecord);
}

const scheduleData = normalizeGeneratedScheduleData(importedScheduleData);

export const DAYS = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO'];

/* ============================================================================
 * Catálogo de cursos (json/cursos.json)
 * Diccionario indexado por `mat_cur`, por lo que la búsqueda es O(1).
 * ========================================================================== */

/** Devuelve el diccionario completo de cursos. */
export function getCoursesSnapshot() {
  return coursesData;
}

/**
 * Busca un curso por su código `mat_cur`. Devuelve `null` si no existe.
 * Acepta el código tal cual viene en el horario (se normaliza a mayúsculas).
 */
export function getCourseByCode(matCur) {
  if (!matCur) return null;
  const key = String(matCur).trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(coursesData, key) ? coursesData[key] : null;
}

/**
 * Nombre visible del curso. Si el `mat_cur` no está en cursos.json,
 * hace fallback al código original.
 */
export function getCourseName(matCur) {
  return getCourseByCode(matCur)?.nombre || matCur || 'Curso sin código';
}

const COURSE_INSTRUCTORS_BY_SECTION = new Map(
  courseInstructorsData.map((assignment) => [
    `${assignment.mat_cur}|${assignment.seccion}`,
    assignment.docente,
  ])
);

const COURSE_INSTRUCTORS_BY_COURSE = new Map();
courseInstructorsData.forEach((assignment) => {
  const instructors = COURSE_INSTRUCTORS_BY_COURSE.get(assignment.mat_cur) ?? [];
  instructors.push(assignment.docente);
  COURSE_INSTRUCTORS_BY_COURSE.set(assignment.mat_cur, instructors);
});

function getSectionCodeFromBlock(block) {
  const normalizedBlock = String(block ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (const section of COURSE_INSTRUCTORS_BY_SECTION.keys()) {
    const sectionCode = section.slice(section.indexOf('|') + 1);
    const match = sectionCode.match(/^([A-Z]+)-(\d{3})$/);
    if (!match) continue;
    const [, careerCode, levelCode] = match;
    if (
      normalizedBlock.endsWith(`${careerCode}${levelCode}`) ||
      normalizedBlock.endsWith(`${careerCode}S${levelCode}`) ||
      normalizedBlock.endsWith(`${careerCode}E${levelCode}`) ||
      normalizedBlock.endsWith(`${careerCode}F${levelCode}`)
    ) {
      return sectionCode;
    }
  }
  return null;
}

/** Resolves the catalog instructor by course and, when possible, schedule block. */
export function getCourseInstructor(matCur, block) {
  if (!matCur) return { found: false, name: '' };
  const section = getSectionCodeFromBlock(block);
  if (section) {
    const key = `${String(matCur).trim().toUpperCase()}|${section}`;
    if (COURSE_INSTRUCTORS_BY_SECTION.has(key)) {
      return { found: true, name: COURSE_INSTRUCTORS_BY_SECTION.get(key) ?? '' };
    }
  }

  const instructors = COURSE_INSTRUCTORS_BY_COURSE.get(String(matCur).trim().toUpperCase());
  const uniqueInstructors = [...new Set(instructors ?? [])];
  if (uniqueInstructors.length === 1) {
    return { found: true, name: uniqueInstructors[0] };
  }
  return { found: false, name: '' };
}

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
 * Feriados (json/feriados.json)
 * Se indexan por "MM-DD" en un Map para consultas O(1).
 * ========================================================================== */

export function getHolidaysSnapshot() {
  return holidaysData;
}

const HOLIDAYS_BY_MMDD = new Map(
  holidaysData.map((holiday) => [holiday.fecha_formatted, holiday])
);

/** Devuelve la info del feriado para una fecha, o `null` si no es feriado. */
export function getHoliday(value) {
  const mmdd = toMonthDay(value);
  return mmdd ? HOLIDAYS_BY_MMDD.get(mmdd) ?? null : null;
}

/** `true` si la fecha (Date, "YYYY-MM-DD" o "MM-DD") es feriado. */
export function isHoliday(value) {
  return Boolean(getHoliday(value));
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

/** Devuelve el snapshot local. Punto único de cambio para migrar a la API. */
export function getScheduleSnapshot() {
  return scheduleData;
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
export function getWeekDays(weekStart) {
  const start = parseLocalDate(weekStart);
  if (!start) return [];
  return DAYS.map((day, index) => {
    const date = addDays(start, index);
    const mmdd = toMonthDay(date);
    const holiday = HOLIDAYS_BY_MMDD.get(mmdd) ?? null;
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
export function getDefaultWeekStart(records = []) {
  const bounds = getScheduleBounds(records);
  const today = new Date();
  const reference = bounds && today >= bounds.min && today <= bounds.max ? today : bounds?.min ?? today;
  return toISODate(startOfWeekMonday(reference));
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
    const courseInstructor = getCourseInstructor(row.mat_cur, row.bloque);
    const noAssignedInstructor = hasNoAssignedInstructor(row);
    const instructorName = noAssignedInstructor
      ? ''
      : courseInstructor.found
        ? courseInstructor.name
        : row.instructor ?? '';

    if (!unique.has(key)) {
      unique.set(key, {
        ...row,
        key,
        instructorName,
        hasCatalogInstructor: courseInstructor.found,
        noAssignedInstructor,
        ranges: [],
      });
    }
    const session = unique.get(key);
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
export function getCourseColor(matCur) {
  if (!matCur) {
    return {
      bg: 'hsl(215 25% 96%)',
      border: 'hsl(215 15% 65%)',
      text: 'hsl(215 25% 30%)',
      chip: 'hsl(215 15% 55%)',
    };
  }
  const course = getCourseByCode(matCur);
  const color = getCourseColorEntry(course?.nombre || matCur);
  const { hue } = color;
  return {
    hex: color.hex,
    bg: `hsl(${hue} 88% 96%)`,
    border: `hsl(${hue} 64% 52%)`,
    text: `hsl(${hue} 68% 27%)`,
    chip: `hsl(${hue} 68% 45%)`,
  };
}
