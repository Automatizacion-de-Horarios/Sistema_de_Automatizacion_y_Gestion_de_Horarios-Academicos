import React, { useEffect, useMemo, useState } from 'react';
import {
  ACTIVITY_LABELS,
  DAY_LABELS,
  MEETING_LABELS,
  addDays,
  formatTime,
  formatWeekRange,
  fetchDraftSchedule,
  fetchHolidays,
  buildHolidaysMap,
  getBreakSlots,
  getCourseColor,
  getAcademicWeekNumber,
  getDefaultWeekStart,
  moveDraftSessions,
  changeScheduleState,
  getScheduleBounds,
  getWeekDays,
  getWeekSessions,
  isSessionActiveOnDate,
  layoutSessionsByDay,
  parseLocalDate,
  startOfWeekMonday,
  timeToMinutes,
  toISODate,
} from '../services/scheduleService';
import './WeeklyScheduleGrid.css';

const SLOT_MINUTES = 15;
const REQUIRED_BREAK_MINUTES = 15;
const SLOT_HEIGHT = 22;
const GRID_START_HOUR = 7;
const GRID_END_HOUR = 22;
const FIRST_MINUTE = GRID_START_HOUR * 60;

// Extraer semestre del bloque SENATI: "56PIADS201" -> después de S/E viene el dígito de semestre
const extractSemesterFromBloque = (bloque) => {
  if (!bloque || typeof bloque !== 'string') return null;
  // Buscar patrón: letras + S o E + dígito de semestre + 2 dígitos de grupo
  const match = bloque.match(/[A-Z]+([SE])(\d)\d{2}$/i);
  if (match) {
    return parseInt(match[2], 10);
  }
  // Fallback: buscar primer dígito después de S o E
  const altMatch = bloque.match(/[SE](\d)\d{2}$/i);
  if (altMatch) {
    return parseInt(altMatch[1], 10);
  }
  return null;
};

// Mapeo carrera -> semestres -> bloques
const buildCarreraMapping = (records, period) => {
  const map = {};
  records.forEach((r) => {
    if (period !== null && r.periodo !== period) return;
    if (!r.bloque) return;
    const bloque = r.bloque;
    
    let carrera;
    let semNum;
    if (
      r.carrera_codigo &&
      r.semestre_num !== null &&
      r.semestre_num !== undefined &&
      Number.isFinite(Number(r.semestre_num))
    ) {
      carrera = `${r.carrera_codigo} - ${r.carrera_nombre || r.carrera_codigo}`;
      semNum = Number(r.semestre_num);
    } else {
      carrera = 'Sin Carrera';
      if (bloque.includes('PIAD')) carrera = 'PIAD - Ingeniería de Software con IA';
      else if (bloque.includes('PCBD')) carrera = 'PCBD - Ingeniería en Ciberseguridad';
      else if (bloque.includes('PCID')) carrera = 'PCID - Computación e Informática';
      else if (bloque.includes('NAED')) carrera = 'NAED - Administración de Empresas';
      else if (bloque.includes('NAID')) carrera = 'NAID - Administración Industrial';
      else if (bloque.includes('NMGD')) carrera = 'NMGD - Marketing y Gestión Comercial';
      else if (bloque.includes('NCBD')) carrera = 'NCBD - Contabilidad';
      else if (bloque.includes('NSID')) carrera = 'NSID - Seguridad Industrial y Prevención de Riesgos';
      semNum = extractSemesterFromBloque(bloque);
    }
    if (!Number.isFinite(semNum)) return;
    
    const semestreKey = `Semestre ${semNum}`;
    if (!map[carrera]) map[carrera] = {};
    if (!map[carrera][semestreKey]) map[carrera][semestreKey] = new Set();
    map[carrera][semestreKey].add(bloque);
  });
  
  const result = {};
  Object.keys(map).sort().forEach(c => {
    result[c] = {};
    Object.keys(map[c]).sort((a,b) => {
      const na = parseInt(a.match(/\d+/)?.[0] || '0');
      const nb = parseInt(b.match(/\d+/)?.[0] || '0');
      return na - nb;
    }).forEach(s => {
      result[c][s] = Array.from(map[c][s]).sort();
    });
  });
  return result;
};

function createTimeSlots(startMinute, endMinute) {
  const slots = [];
  for (let minutes = startMinute; minutes < endMinute; minutes += SLOT_MINUTES) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const endMinutes = minutes + SLOT_MINUTES;
    const endHour = Math.floor(endMinutes / 60);
    const endMinute = endMinutes % 60;
    slots.push({
      minutes,
      label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
      endLabel: `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`,
      isHour: m === 0,
    });
  }
  return slots;
}

function getGridTimeBounds(franja) {
  const configuredStart = timeToMinutes(franja?.hora_inicio_mañana) ?? FIRST_MINUTE;
  const configuredEnd = timeToMinutes(franja?.hora_cierre_noche) ?? GRID_END_HOUR * 60;
  if (configuredEnd <= configuredStart) {
    return { start: FIRST_MINUTE, end: GRID_END_HOUR * 60 };
  }
  return {
    start: Math.floor(configuredStart / 60) * 60,
    end: Math.ceil(configuredEnd / 60) * 60,
    configuredStart,
    configuredEnd,
  };
}

function formatScheduleTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00`;
}

function formatConflictToast(reasons = []) {
  if (!reasons.length) return '';
  return reasons.map((entry) => `• ${entry.mensaje}`).join('\n');
}

function normalizeInstructor(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function buildDropValidation(valid, reasons) {
  return {
    valid,
    reasons,
    reason: reasons.map((entry) => entry.mensaje).join(' · '),
  };
}

function getDropValidation(
  session,
  day,
  slotMinutes,
  dayInfo,
  occupations,
  restrictions,
  periodStart,
  periodEnd,
  academicWeek,
  configuredStart,
  configuredEnd
) {
  if (dayInfo?.isHoliday) {
    return buildDropValidation(false, [
      { tipo: 'general', mensaje: 'No se pueden programar clases en un día feriado.' },
    ]);
  }
  if (
    (periodStart && dayInfo?.iso < periodStart) ||
    (periodEnd && dayInfo?.iso > periodEnd)
  ) {
    return buildDropValidation(false, [
      { tipo: 'general', mensaje: 'La fecha está fuera de los límites del periodo.' },
    ]);
  }

  const startMinutes = timeToMinutes(session.hora_ini);
  const endMinutes = timeToMinutes(session.hora_fin);
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return buildDropValidation(false, [
      { tipo: 'general', mensaje: 'No se pudo determinar la duración de la clase.' },
    ]);
  }

  const duration = endMinutes - startMinutes;
  const newEnd = slotMinutes + duration;
  const reasons = [];

  if (slotMinutes < configuredStart || newEnd > configuredEnd) {
    reasons.push({
      tipo: 'general',
      mensaje: 'La clase quedaría fuera de la franja horaria configurada.',
    });
  }

  const sessionIds = new Set(
    session.scheduleIds?.length
      ? session.scheduleIds.map(Number)
      : [Number(session.id_horario)].filter(Number.isFinite)
  );
  const instructorId = Number(session.id_docente) || null;
  const roomId = Number(session.id_ambiente) || null;
  const teacher = restrictions.docentes.find(
    (entry) => Number(entry.id_docente) === instructorId
  );
  const teacherAvailability = restrictions.disponibilidadDocentes.filter(
    (entry) => Number(entry.id_docente) === instructorId &&
      normalizeInstructor(entry.dia_semana) === day
  );
  if (teacher?.usa_restriccion_horaria && !teacherAvailability.some((entry) =>
    timeToMinutes(entry.hora_inicio) <= slotMinutes &&
    timeToMinutes(entry.hora_fin) >= newEnd
  )) {
    reasons.push({
      tipo: 'docente',
      mensaje: `El docente no tiene disponibilidad el ${DAY_LABELS[day]} entre ${formatTime(formatScheduleTime(slotMinutes))} y ${formatTime(formatScheduleTime(newEnd))}.`,
    });
  }

  if (roomId && !restrictions.ambientes.some((entry) =>
    Number(entry.id) === roomId &&
    ['A', 'ACTIVO', 'DISPONIBLE', 'OPERATIVO']
      .includes(String(entry.estado ?? '').trim().toUpperCase())
  )) {
    reasons.push({ tipo: 'salon', mensaje: 'El salón asignado no está operativo.' });
  }
  if (!roomId && !['VIR', 'EMP'].includes(session.actividad)) {
    reasons.push({ tipo: 'salon', mensaje: 'La clase no tiene un salón asignado.' });
  }

  const contexto = (other) => ({
    carrera: other.carrera_codigo || other.codigo_carrera || '',
    semestre: other.semestre || '',
    curso: other.mat_cur || other.codigo_curso || '',
    nombre_curso: other.nombre_curso || '',
    ambiente: other.ambiente || '',
    docente: other.instructor || '',
  });

  for (const other of occupations) {
    if (
      normalizeInstructor(other.dia) !== day ||
      sessionIds.has(Number(other.id_horario)) ||
      Number(other.semana_inicio) > Number(session.semana_fin) ||
      Number(other.semana_fin) < Number(session.semana_inicio)
    ) {
      continue;
    }

    const otherStart = timeToMinutes(other.hora_ini);
    const otherEnd = timeToMinutes(other.hora_fin);
    if (otherStart === null || otherEnd === null) {
      continue;
    }

    const overlaps = newEnd > otherStart && slotMinutes < otherEnd;
    const info = contexto(other);
    const ubicacion = `${info.carrera || '—'} · ${info.semestre || '—'}`;
    const detalleClase = `${info.nombre_curso || info.curso || 'curso'} ${formatTime(other.hora_ini)}–${formatTime(other.hora_fin)}`;

    const sectionNeedsBreak = other.codigo_cohorte === session.codigo_cohorte &&
      slotMinutes < otherEnd + REQUIRED_BREAK_MINUTES &&
      newEnd + REQUIRED_BREAK_MINUTES > otherStart;
    if (sectionNeedsBreak) {
      reasons.push({
        tipo: 'cohorte',
        ...info,
        mensaje: `La cohorte ${ubicacion} ya tiene clase (${detalleClase}); deja al menos 15 minutos entre clases.`,
      });
    }

    const sharesInstructor = instructorId &&
      Number(other.id_docente) === instructorId;
    const instructorNeedsBreak = sharesInstructor &&
      slotMinutes < otherEnd + REQUIRED_BREAK_MINUTES &&
      newEnd + REQUIRED_BREAK_MINUTES > otherStart;
    if (instructorNeedsBreak) {
      reasons.push({
        tipo: 'docente',
        ...info,
        mensaje: `El docente ${session.instructorName} necesita al menos 15 minutos de receso (${ubicacion}, ${detalleClase}).`,
      });
    }

    if (overlaps && roomId && Number(other.id_ambiente) === roomId) {
      reasons.push({
        tipo: 'salon',
        ...info,
        mensaje: `El salón ${session.ambiente || session.salon || ''} está ocupado por ${ubicacion} (${detalleClase}).`,
      });
    }
  }

  if (instructorId) {
    const firstWeek = Number(session.semana_inicio) || academicWeek;
    const lastWeek = Number(session.semana_fin) || academicWeek;
    for (let week = firstWeek; week <= lastWeek; week += 1) {
      const teacherDay = occupations
        .filter((other) =>
          Number(other.id_docente) === instructorId &&
          normalizeInstructor(other.dia) === day &&
          Number(other.semana_inicio) <= week &&
          Number(other.semana_fin) >= week &&
          !sessionIds.has(Number(other.id_horario))
        )
        .map((other) => ({
          start: timeToMinutes(other.hora_ini),
          end: timeToMinutes(other.hora_fin),
        }));
      teacherDay.push({ start: slotMinutes, end: newEnd });
      teacherDay.sort((left, right) => left.start - right.start);

      let continuousHours = (teacherDay[0].end - teacherDay[0].start) / 45;
      for (let index = 1; index < teacherDay.length; index += 1) {
        const previous = teacherDay[index - 1];
        const current = teacherDay[index];
        const gap = current.start - previous.end;
        if (continuousHours >= 5 && gap < 45) {
          reasons.push({
            tipo: 'docente',
            mensaje: 'El docente necesita 45 minutos de descanso después de 5 horas académicas continuas antes de continuar su jornada.',
          });
          break;
        }
        continuousHours = gap >= 45
          ? (current.end - current.start) / 45
          : continuousHours + (current.end - current.start) / 45;
      }
    }
  }

  return buildDropValidation(reasons.length === 0, reasons);
}

function getSessionGridPosition(session, firstMinute) {
  const startMin = timeToMinutes(session.hora_ini) ?? firstMinute;
  const endMin = timeToMinutes(session.hora_fin) ?? startMin + SLOT_MINUTES;
  const startSlot = Math.max(0, Math.floor((startMin - firstMinute) / SLOT_MINUTES));
  const endSlot = Math.max(startSlot + 1, Math.ceil((endMin - firstMinute) / SLOT_MINUTES));
  return {
    gridRow: `${startSlot + 2} / span ${endSlot - startSlot}`,
    startSlot,
    span: endSlot - startSlot,
    duration: Math.max(0, endMin - startMin),
  };
}

function getBreakGridPosition(breakSlot, firstMinute) {
  const startSlot = Math.max(0, Math.floor((breakSlot.startMin - firstMinute) / SLOT_MINUTES));
  const endSlot = Math.max(startSlot + 1, Math.ceil((breakSlot.endMin - firstMinute) / SLOT_MINUTES));
  return {
    gridRow: `${startSlot + 2} / span ${endSlot - startSlot}`,
    span: endSlot - startSlot,
  };
}

function formatRanges(ranges = []) {
  if (!ranges.length) return 'Sin rango de fechas';
  return ranges.slice(0, 3).map((range) => `${range.start} → ${range.end}`).join('\n');
}

function ClassCard({
  session,
  dayIndex,
  firstMinute,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  isDragging,
  isValidDrop,
  isOver,
}) {
  const color = getCourseColor(session.mat_cur, session.nombre_curso);
  const courseName = session.nombre_curso || session.mat_cur;
  const isVAEE = session.tipo_reunion === 'VAEE';
  const isRemote = session.tipo_reunion === 'REMT';
  const isEMP = session.actividad === 'EMP' || session.tipo_reunion === 'EMP';
  const isTheory = session.actividad === 'TEC';
  const isWorkshop = session.actividad === 'TAL';
  const activityColor = isTheory
    ? { background: '#DBEAFE', border: '#2563EB', text: '#1E3A8A', chip: '#2563EB' }
    : isWorkshop
      ? { background: '#CCFBF1', border: '#0F766E', text: '#134E4A', chip: '#0F766E' }
      : color;
  const position = getSessionGridPosition(session, firstMinute);
  const compact = position.duration < 45;
  const location = isEMP
    ? '00-EX'
    : session.ambiente || [session.edificio, session.salon].filter(Boolean).join(' · ');
  const instructorLabel = session.noAssignedInstructor
    ? ''
    : session.hasCatalogInstructor
      ? (session.instructorName
        ? [session.instructorName, session.instructor].filter((value, index) =>
          value && (index === 0 || value !== session.instructorName)
        ).join(' · ')
        : 'Docente no asignado')
      : session.instructor
        ? `Docente no identificado · ${session.instructor}`
        : 'Docente no asignado';

  const tooltip = [
    courseName,
    `${session.mat_cur} · ${ACTIVITY_LABELS[session.actividad] ?? session.actividad ?? 'S/A'}`,
    `Tipo: ${MEETING_LABELS[session.tipo_reunion] ?? session.tipo_reunion ?? 'No definido'}`,
    `Horario: ${formatTime(session.hora_ini)} – ${formatTime(session.hora_fin)}`,
    `Bloque: ${session.bloque}`,
    session.cohorte ? `Cohorte: ${session.cohorte}` : null,
    location ? `Locación: ${location}` : null,
    isEMP ? 'Empresa / Formación Práctica' : instructorLabel ? `Docente: ${instructorLabel}` : null,
    session.semana_inicio && session.semana_fin
      ? `Semana lectiva: ${session.semana_inicio}–${session.semana_fin}`
      : `Vigencia:\n${formatRanges(session.ranges)}`,
  ].filter(Boolean).join('\n');

  const laneStyle = session.laneCount > 1
    ? { width: `calc(${100 / session.laneCount}% - 4px)`, marginLeft: `calc(${(session.lane * 100) / session.laneCount}% + 2px)` }
    : {};

  return (
    <div
      draggable={Boolean(session.scheduleIds?.length)}
      className={[
        'schedule-class',
        isVAEE ? 'is-vaee' : '',
        isRemote ? 'is-remote' : '',
        isEMP ? 'is-emp' : '',
        compact ? 'is-compact' : '',
        isDragging ? 'is-dragging' : '',
        isOver && isValidDrop ? 'drop-valid' : '',
        isOver && !isValidDrop ? 'drop-invalid' : '',
      ].filter(Boolean).join(' ')}
      style={{
        gridRow: position.gridRow,
        gridColumn: dayIndex + 2,
        background: isEMP
          ? 'linear-gradient(135deg, #F0FDF4 0%, #DCFCE7 100%)'
          : isVAEE ? '#F8FAFC' : activityColor.background,
        borderLeftColor: isEMP ? '#22C55E' : activityColor.border,
        color: isEMP ? '#166534' : activityColor.text,
        ...laneStyle,
      }}
      title={tooltip}
      onDragStart={(e) => onDragStart && onDragStart(e, session)}
      onDragEnd={(e) => onDragEnd && onDragEnd(e)}
      onDragOver={(e) => onDragOver && onDragOver(e, session)}
      onDrop={(e) => onDrop && onDrop(e, session)}
    >
      <div className="schedule-class__top">
        <span className="schedule-class__name" title={courseName}>{courseName}</span>
        <span
          className="schedule-class__activity"
          style={{ background: isEMP ? '#22C55E' : activityColor.chip, color: '#fff' }}
        >
          {isEMP ? 'EMP' : (session.actividad || '—')}
        </span>
      </div>

      <div className="schedule-class__time">
        <span className="schedule-class__code">{session.mat_cur}</span>
        <span>{formatTime(session.hora_ini)} – {formatTime(session.hora_fin)}</span>
      </div>

      <div className="schedule-class__badges">
        <span className={`meeting-badge ${isEMP ? 'meeting-badge--emp' : (isVAEE ? 'meeting-badge--vaee' : isRemote ? 'meeting-badge--remt' : 'meeting-badge--clas')}`}>
          {isEMP ? 'EMP' : (session.tipo_reunion || 'S/T')}
        </span>
        {location && (
          <span className="schedule-class__location">{location}</span>
        )}
      </div>

      {!isEMP && instructorLabel && (
        <div className="schedule-class__instructor">{instructorLabel}</div>
      )}
      {isEMP && (
        <div className="schedule-class__instructor">🏢 Formación en Empresa</div>
      )}
    </div>
  );
}

function WeeklyScheduleGrid() {
  const selectedPeriod = 202620;
  const [selectedCarrera, setSelectedCarrera] = useState('');
  const [selectedSemestre, setSelectedSemestre] = useState('');
  const [selectedBlock, setSelectedBlock] = useState('');
  const [weekStart, setWeekStart] = useState(() => getDefaultWeekStart());
  const [periodWeeks, setPeriodWeeks] = useState(18);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [restrictions, setRestrictions] = useState({
    ocupaciones: [],
    disponibilidadDocentes: [],
    docentes: [],
    ambientes: [],
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  
  // Drag & Drop state
  const [draggedSession, setDraggedSession] = useState(null);
  const [dragOverSlot, setDragOverSlot] = useState(null);
  const [toast, setToast] = useState('');
  const [savingMove, setSavingMove] = useState(false);
  const [scheduleState, setScheduleState] = useState('BORRADOR');
  const [changingState, setChangingState] = useState(false);
  const [holidaysMap, setHolidaysMap] = useState(new Map());

  const [records, setRecords] = useState([]);
  const [operatingHours, setOperatingHours] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    fetchHolidays({ signal: controller.signal })
      .then((feriados) => {
        if (!controller.signal.aborted) setHolidaysMap(buildHolidaysMap(feriados));
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const cargarHorario = async () => {
      try {
        const resultado = await fetchDraftSchedule(String(selectedPeriod), {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        setRecords(resultado.bloques);
        setOperatingHours(resultado.franja);
        setScheduleState(resultado.estado || 'BORRADOR');
        setPeriodWeeks(resultado.semanas);
        const bounds = getScheduleBounds(resultado.bloques);
        const inicioPeriodo = resultado.fechaInicio ||
          (bounds ? toISODate(bounds.min) : '');
        const finPeriodo = resultado.fechaFin ||
          (bounds ? toISODate(bounds.max) : '');
        setPeriodStart(inicioPeriodo);
        setPeriodEnd(finPeriodo);
        setRestrictions(resultado.restricciones);
        setWeekStart(getDefaultWeekStart(
          resultado.bloques,
          inicioPeriodo,
          finPeriodo
        ));
        setLoadError('');

        const mapping = buildCarreraMapping(resultado.bloques, selectedPeriod);
        const carrera = Object.keys(mapping).sort()[0] || '';
        const semestre = carrera
          ? Object.keys(mapping[carrera]).sort((a, b) =>
            Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0)
          )[0] || ''
          : '';
        const bloque = carrera && semestre ? mapping[carrera][semestre][0] || '' : '';
        setSelectedCarrera(carrera);
        setSelectedSemestre(semestre);
        setSelectedBlock(bloque);
      } catch (error) {
        if (!controller.signal.aborted) {
          setRecords([]);
          setLoadError(error.message || 'No se pudo cargar el horario borrador.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    cargarHorario();
    return () => controller.abort();
  }, [selectedPeriod]);
  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(''), 4200);
    return () => window.clearTimeout(timeout);
  }, [toast]);
  const carreraMap = useMemo(() => buildCarreraMapping(records, selectedPeriod), [records, selectedPeriod]);
  const carreras = useMemo(() => Object.keys(carreraMap).sort(), [carreraMap]);
  
  const semestres = useMemo(() => {
    if (!selectedCarrera || !carreraMap[selectedCarrera]) return [];
    return Object.keys(carreraMap[selectedCarrera]).sort((a,b) => {
      const na = parseInt(a.match(/\d+/)?.[0] || '0');
      const nb = parseInt(b.match(/\d+/)?.[0] || '0');
      return na - nb;
    });
  }, [carreraMap, selectedCarrera]);
  
  const bloques = useMemo(() => {
    if (!selectedCarrera || !selectedSemestre || !carreraMap[selectedCarrera]) return [];
    return carreraMap[selectedCarrera][selectedSemestre] || [];
  }, [carreraMap, selectedCarrera, selectedSemestre]);

  const selectedAcademicWeek = periodStart
    ? Math.max(1, Math.min(
      periodWeeks,
      getAcademicWeekNumber(weekStart, periodStart)
    ))
    : 1;

  // Actualizar cascada cuando cambian filtros
  const handleCarreraChange = (e) => {
    const carrera = e.target.value;
    setSelectedCarrera(carrera);
    const sems = Object.keys(carreraMap[carrera] || {}).sort((a,b) => {
      const na = parseInt(a.match(/\d+/)?.[0] || '0');
      const nb = parseInt(b.match(/\d+/)?.[0] || '0');
      return na - nb;
    });
    if (sems.length > 0) {
      setSelectedSemestre(sems[0]);
      const blks = carreraMap[carrera][sems[0]] || [];
      if (blks.length > 0) setSelectedBlock(blks[0]);
    }
  };

  const handleSemestreChange = (e) => {
    const semestre = e.target.value;
    setSelectedSemestre(semestre);
    const blks = carreraMap[selectedCarrera]?.[semestre] || [];
    if (blks.length > 0) setSelectedBlock(blks[0]);
  };

  const weekSessions = useMemo(
    () => getWeekSessions(records, { period: selectedPeriod, block: selectedBlock, weekStart })
      .filter((session) => {
        const start = Number(session.semana_inicio);
        const end = Number(session.semana_fin);
        return !Number.isFinite(start) || !Number.isFinite(end) ||
          (selectedAcademicWeek >= start && selectedAcademicWeek <= end);
      }),
    [records, selectedPeriod, selectedBlock, weekStart, selectedAcademicWeek]
  );

  // Días de la semana visible + feriados (desde la base de datos).
  const weekDays = useMemo(() => getWeekDays(weekStart, holidaysMap), [weekStart, holidaysMap]);
  const occupations = restrictions.ocupaciones;
  const periodBounds = useMemo(() => {
    const min = parseLocalDate(periodStart);
    const max = parseLocalDate(periodEnd);
    return {
      firstWeek: min ? toISODate(startOfWeekMonday(min)) : '',
      lastWeek: max ? toISODate(startOfWeekMonday(max)) : '',
    };
  }, [periodStart, periodEnd]);
  const sessionsByDay = useMemo(() => Object.fromEntries(
    weekDays.map((dayInfo) => [
      dayInfo.day,
      layoutSessionsByDay(
        weekSessions.filter((session) =>
          session.dia === dayInfo.day &&
          (!periodStart || dayInfo.iso >= periodStart) &&
          (!periodEnd || dayInfo.iso <= periodEnd) &&
          isSessionActiveOnDate(session, dayInfo.iso)
        )
      )[dayInfo.day],
    ])
  ), [weekDays, weekSessions, periodStart, periodEnd]);
  const gridTimeBounds = useMemo(
    () => getGridTimeBounds(operatingHours),
    [operatingHours]
  );
  const timeSlots = useMemo(
    () => createTimeSlots(gridTimeBounds.start, gridTimeBounds.end),
    [gridTimeBounds]
  );
  const holidaysInWeek = useMemo(
    () => weekDays.filter((dayInfo) => dayInfo.isHoliday),
    [weekDays]
  );
  const dropValidationBySlot = useMemo(() => {
    if (!draggedSession) return new Map();
    const results = new Map();
    weekDays.forEach((dayInfo) => {
      timeSlots.forEach((slot) => {
        results.set(
          `${dayInfo.day}|${slot.minutes}`,
          getDropValidation(
            draggedSession,
            dayInfo.day,
            slot.minutes,
            dayInfo,
            occupations,
            restrictions,
            periodStart,
            periodEnd,
            selectedAcademicWeek,
            gridTimeBounds.configuredStart ?? gridTimeBounds.start,
            gridTimeBounds.configuredEnd ?? gridTimeBounds.end
          )
        );
      });
    });
    return results;
  }, [
    draggedSession,
    weekDays,
    timeSlots,
    gridTimeBounds,
    occupations,
    restrictions,
    periodStart,
    periodEnd,
    selectedAcademicWeek,
  ]);

  const courses = useMemo(() => {
    const map = new Map();
    weekSessions.forEach((session) => {
      const entry = map.get(session.mat_cur) ?? {
        mat_cur: session.mat_cur,
        name: session.nombre_curso || session.mat_cur,
        career: session.carrera_nombre || null,
        semester: session.semestre_num ?? null,
        color: getCourseColor(session.mat_cur, session.nombre_curso),
        count: 0,
      };
      entry.count += 1;
      map.set(session.mat_cur, entry);
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [weekSessions]);

  const totalMinutes = useMemo(
    () => weekSessions.reduce((acc, session) => {
      const start = timeToMinutes(session.hora_ini) ?? 0;
      const end = timeToMinutes(session.hora_fin) ?? 0;
      return acc + Math.max(0, end - start);
    }, 0),
    [weekSessions]
  );

  const handleDragStart = (e, session) => {
    if (savingMove) {
      e.preventDefault();
      return;
    }
    if (scheduleState === 'CONFIRMADO') {
      e.preventDefault();
      setToast('El horario está confirmado; cámbialo a Borrador para mover clases.');
      return;
    }
    if (!session.scheduleIds?.length) {
      e.preventDefault();
      setToast('Esta clase no tiene un registro editable en el borrador.');
      return;
    }
    setDraggedSession(session);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', session.key);
  };

  const handleDragEnd = () => {
    setDraggedSession(null);
    setDragOverSlot(null);
  };

  const handleDragOver = (e, day, slotMinutes) => {
    e.preventDefault();
    if (!draggedSession) return;
    const validation = dropValidationBySlot.get(`${day}|${slotMinutes}`) ?? {
      valid: false,
      reasons: [{ tipo: 'general', mensaje: 'No se pudo validar este espacio.' }],
      reason: 'No se pudo validar este espacio.',
    };
    setDragOverSlot({
      day,
      slotMinutes,
      valid: validation.valid,
      reason: validation.reason,
      reasons: validation.reasons,
    });
    e.dataTransfer.dropEffect = validation.valid ? 'move' : 'none';
  };

  const handleDrop = async (e, day, slotMinutes) => {
    e.preventDefault();
    if (!draggedSession || savingMove) return;
    const currentStart = timeToMinutes(draggedSession.hora_ini);
    if (draggedSession.dia === day && currentStart === slotMinutes) {
      handleDragEnd();
      return;
    }
    const dayInfo = weekDays.find((entry) => entry.day === day);
    const validation = getDropValidation(
      draggedSession,
      day,
      slotMinutes,
      dayInfo,
      occupations,
      restrictions,
      periodStart,
      periodEnd,
      selectedAcademicWeek,
      gridTimeBounds.configuredStart ?? gridTimeBounds.start,
      gridTimeBounds.configuredEnd ?? gridTimeBounds.end
    );
    if (!validation.valid) {
      setToast(`No se puede mover:\n${formatConflictToast(validation.reasons)}`);
      handleDragEnd();
      return;
    }

    const duration = timeToMinutes(draggedSession.hora_fin) - currentStart;
    const newStart = formatScheduleTime(slotMinutes);
    const newEnd = formatScheduleTime(slotMinutes + duration);
    const scheduleIds = draggedSession.scheduleIds ?? [];
    const hasMatchingRecords = scheduleIds.length > 0 && records.some(
      (record) => scheduleIds.includes(Number(record.id_horario))
    );
    if (!hasMatchingRecords) {
      setToast('No se pudo mover: no se encontraron los registros originales de la clase.');
      handleDragEnd();
      return;
    }
    setSavingMove(true);
    try {
      const resultado = await moveDraftSessions(
        String(selectedPeriod),
        scheduleIds,
        day,
        newStart.slice(0, 5)
      );
      const ids = new Set(
        (resultado?.ids?.length ? resultado.ids : scheduleIds).map(Number)
      );
      const updateMoved = (record) => ids.has(Number(record.id_horario))
        ? {
          ...record,
          dia: day,
          dia_semana: day,
          hora_ini: newStart,
          hora_inicio: newStart,
          hora_fin: newEnd,
        }
        : record;
      setRecords((currentRecords) => currentRecords.map(updateMoved));
      setRestrictions((current) => ({
        ...current,
        ocupaciones: current.ocupaciones.map(updateMoved),
      }));
      setToast(
        `Clase movida a ${DAY_LABELS[day]} ${newStart.slice(0, 5)}–${newEnd.slice(0, 5)} en todas las semanas del curso.`
      );
    } catch (error) {
      if (Array.isArray(error.conflictos) && error.conflictos.length) {
        setToast(`No se puede mover:\n${formatConflictToast(error.conflictos)}`);
      } else {
        setToast(`No se pudo guardar el cambio: ${error.message}`);
      }
    } finally {
      setSavingMove(false);
      handleDragEnd();
    }
  };

  const getCardDropSlot = (e, session) => {
    const bounds = e.currentTarget.getBoundingClientRect();
    const start = timeToMinutes(session.hora_ini) ?? FIRST_MINUTE;
    const end = timeToMinutes(session.hora_fin) ?? start + SLOT_MINUTES;
    const position = Math.max(0, Math.min(1, (e.clientY - bounds.top) / bounds.height));
    return Math.floor((start + (end - start) * position) / SLOT_MINUTES) * SLOT_MINUTES;
  };

  const handleCardDragOver = (e, session) => {
    handleDragOver(e, session.dia, getCardDropSlot(e, session));
  };

  const handleCardDrop = (e, session) => {
    handleDrop(e, session.dia, getCardDropSlot(e, session));
  };

  const handleWeekChange = (offset) => {
    const current = parseLocalDate(weekStart);
    if (!current) return;
    const next = toISODate(addDays(current, offset * 7));
    if (
      (periodBounds.firstWeek && next < periodBounds.firstWeek) ||
      (periodBounds.lastWeek && next > periodBounds.lastWeek)
    ) return;
    setWeekStart(next);
  };

  const handleDatePick = (event) => {
    const picked = parseLocalDate(event.target.value);
    if (!picked) return;
    if (
      (periodStart && toISODate(picked) < periodStart) ||
      (periodEnd && toISODate(picked) > periodEnd)
    ) return;
    setWeekStart(toISODate(startOfWeekMonday(picked)));
  };

  const goToCurrentWeek = () => {
    setWeekStart(getDefaultWeekStart(records, periodStart, periodEnd));
  };

  const handleChangeState = async (nuevoEstado) => {
    if (!nuevoEstado || nuevoEstado === scheduleState || changingState) return;
    setChangingState(true);
    try {
      await changeScheduleState(String(selectedPeriod), nuevoEstado);
      setScheduleState(nuevoEstado);
      setToast(`Estado del horario actualizado a ${nuevoEstado === 'CONFIRMADO' ? 'Confirmado' : 'Borrador'}.`);
    } catch (error) {
      setToast(`No se pudo cambiar el estado: ${error.message}`);
    } finally {
      setChangingState(false);
    }
  };
  const datePickerValue = periodStart && weekStart < periodStart
    ? periodStart
    : periodEnd && weekStart > periodEnd
      ? periodEnd
      : weekStart;

  return (
    <div className="weekly-schedule-container">
      <header className="schedule-header">
        <div>
          <h1 className="schedule-title">
            <i className="far fa-calendar-alt" aria-hidden="true" /> Cuadrícula Semanal de Horarios
          </h1>
        </div>

        <div className="schedule-summary">
          <div className="schedule-state" role="group" aria-label="Estado del horario">
            <button
              type="button"
              className={`state-button ${scheduleState === 'BORRADOR' ? 'is-active' : ''}`}
              onClick={() => handleChangeState('BORRADOR')}
              disabled={changingState}
            >
              Borrador
            </button>
            <button
              type="button"
              className={`state-button ${scheduleState === 'CONFIRMADO' ? 'is-active' : ''}`}
              onClick={() => handleChangeState('CONFIRMADO')}
              disabled={changingState}
            >
              Confirmado
            </button>
          </div>
          <div className="summary-chip">
            <span className="summary-chip__value">{weekSessions.length}</span>
            <span className="summary-chip__label">sesiones</span>
          </div>
          <div className="summary-chip">
            <span className="summary-chip__value">{courses.length}</span>
            <span className="summary-chip__label">cursos</span>
          </div>
          <div className="summary-chip">
            <span className="summary-chip__value">{(totalMinutes/60).toLocaleString('es-PE',{maximumFractionDigits:1})}</span>
            <span className="summary-chip__label">horas</span>
          </div>
        </div>
      </header>

      {/* COMBOBOXES EN CADENA */}
      <div className="schedule-toolbar">
        <div className="toolbar-group">
          <label className="toolbar-field toolbar-field--wide" htmlFor="carrera-select">
            <span>1. Seleccionar Carrera</span>
            <select id="carrera-select" value={selectedCarrera} onChange={handleCarreraChange}>
              {carreras.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
          </label>

          <label className="toolbar-field" htmlFor="semestre-select">
            <span>2. Seleccionar Semestre</span>
            <select id="semestre-select" value={selectedSemestre} onChange={handleSemestreChange}>
              {semestres.map((s) => (<option key={s} value={s}>{s}</option>))}
            </select>
          </label>

          <label className="toolbar-field" htmlFor="bloque-select">
            <span>3. Seleccionar Bloque</span>
            <select id="bloque-select" value={selectedBlock} onChange={(e) => setSelectedBlock(e.target.value)}>
              {bloques.map((b) => (<option key={b} value={b}>{b}</option>))}
            </select>
          </label>

        </div>

        <div className="week-navigator">
          <button
            type="button"
            className="nav-button"
            onClick={() => handleWeekChange(-1)}
            aria-label="Semana anterior"
            disabled={Boolean(periodBounds.firstWeek && weekStart <= periodBounds.firstWeek)}
          >
            <i className="fas fa-chevron-left" />
          </button>
          <div className="week-navigator__center">
            <span className="week-label">
              Semana {selectedAcademicWeek}
            </span>
            <span className="week-label">
              {formatWeekRange(weekStart)}
            </span>
            <input
              type="date"
              className="week-date-input"
              value={datePickerValue}
              min={periodStart || undefined}
              max={periodEnd || undefined}
              onChange={handleDatePick}
              aria-label="Elegir una fecha del periodo"
            />
          </div>
          <button
            type="button"
            className="nav-button"
            onClick={() => handleWeekChange(1)}
            aria-label="Semana siguiente"
            disabled={Boolean(periodBounds.lastWeek && weekStart >= periodBounds.lastWeek)}
          >
            <i className="fas fa-chevron-right" />
          </button>
          <button type="button" className="today-button" onClick={goToCurrentWeek}>Hoy</button>
        </div>
      </div>

      {loading && (
        <div className="schedule-empty-banner" role="status">
          <i className="fas fa-spinner" aria-hidden="true" />
          <div><strong>Cargando horario borrador.</strong><span>Consultando el periodo {selectedPeriod}.</span></div>
        </div>
      )}

      {!loading && loadError && (
        <div className="schedule-empty-banner" role="alert">
          <i className="fas fa-exclamation-circle" aria-hidden="true" />
          <div><strong>No se pudo cargar el horario.</strong><span>{loadError}</span></div>
        </div>
      )}

      {!loading && !loadError && weekSessions.length === 0 && (
        <div className="schedule-empty-banner">
          <i className="far fa-calendar-times" />
          <div><strong>Sin sesiones para esta semana lectiva.</strong><span>{holidaysInWeek.length ? `${holidaysInWeek.map((h) => `Feriado: ${h.holiday.mes} ${h.holiday.dia}`).join(' · ')} • ` : ''}Prueba otra semana o selecciona otra cohorte.</span></div>
        </div>
      )}

      <div className="schedule-grid-wrapper">
        {toast && (
          <div className="schedule-toast" role="status" aria-live="polite">
            <i className="fas fa-exclamation-circle" aria-hidden="true" />
            <span>{toast}</span>
            <button type="button" aria-label="Cerrar notificación" onClick={() => setToast('')}>
              ×
            </button>
          </div>
        )}
        {savingMove && (
          <div className="schedule-saving" role="status" aria-live="polite">
            Guardando el cambio de horario…
          </div>
        )}
        {draggedSession && dragOverSlot && (
          <div
            className={`drop-feedback ${dragOverSlot.valid ? 'is-valid' : 'is-invalid'}`}
            role="status"
            aria-live="polite"
          >
            <strong>
              {dragOverSlot.valid ? 'Espacio disponible' : 'No disponible'}
            </strong>
            <span>
              {DAY_LABELS[dragOverSlot.day]} · {formatTime(formatScheduleTime(dragOverSlot.slotMinutes))}
              {dragOverSlot.reason ? ` — ${dragOverSlot.reason}` : ''}
            </span>
          </div>
        )}
        <div className="schedule-grid" style={{ gridTemplateColumns: `68px repeat(7, minmax(148px, 1fr))`, gridTemplateRows: `48px repeat(${timeSlots.length}, ${SLOT_HEIGHT}px)` }}>
          <div className="grid-corner" style={{ gridRow: 1, gridColumn: 1 }}>
            <span className="corner-pc">DE</span>
            <span className="corner-a">A</span>
          </div>
          {weekDays.map((dayInfo, index) => (
            <div
              key={dayInfo.day}
              className={[
                'grid-day-header',
                dayInfo.day === 'DOMINGO' ? 'is-sunday' : '',
                dayInfo.isHoliday ? 'is-holiday' : '',
              ].filter(Boolean).join(' ')}
              style={{ gridRow: 1, gridColumn: index + 2 }}
              title={dayInfo.isHoliday ? `Feriado: ${dayInfo.holiday.mes} ${dayInfo.holiday.dia}` : `${DAY_LABELS[dayInfo.day]} ${dayInfo.label}`}
            >
              <span className="grid-day-header__long">
                {DAY_LABELS[dayInfo.day]}
                {dayInfo.isHoliday ? <span className="holiday-badge">FERIADO</span> : null}
              </span>
              <span className="grid-day-header__short">
                {dayInfo.day.slice(0, 3)}
                {dayInfo.isHoliday ? ' • F' : ''}
              </span>
              <span className="grid-day-header__date">{dayInfo.label}</span>
            </div>
          ))}

          {timeSlots.map((slot, index) => (
            <React.Fragment key={slot.minutes}>
              <div className="grid-time time-15" style={{ gridRow: index + 2, gridColumn: 1 }}>
                <span className="time-pc">{slot.label}</span>
                <span className="time-a">{slot.endLabel}</span>
              </div>
              {weekDays.map((dayInfo, dayIndex) => {
                const isHoliday = dayInfo.isHoliday;
                const validation = dropValidationBySlot.get(`${dayInfo.day}|${slot.minutes}`);
                const fueraDelPeriodo = Boolean(
                  (periodStart && dayInfo.iso < periodStart) ||
                  (periodEnd && dayInfo.iso > periodEnd)
                );
                return (
                  <div
                    key={`${dayInfo.day}-${slot.minutes}`}
                    className={[
                      'grid-slot',
                      slot.isHour ? 'is-hour' : '',
                      dayInfo.day === 'DOMINGO' ? 'is-sunday' : '',
                      isHoliday ? 'is-holiday' : '',
                      fueraDelPeriodo ? 'is-outside-period' : '',
                      draggedSession ? 'drag-active' : '',
                      draggedSession ? (validation?.valid ? 'slot-valid' : 'slot-invalid') : '',
                      dragOverSlot?.day === dayInfo.day && dragOverSlot?.slotMinutes === slot.minutes ? 'is-drop-target' : '',
                    ].filter(Boolean).join(' ')}
                    style={{ gridRow: index + 2, gridColumn: dayIndex + 2 }}
                    data-day={dayInfo.day}
                    data-slot-minutes={slot.minutes}
                    title={isHoliday
                      ? `Día feriado - ${dayInfo.holiday.mes} ${dayInfo.holiday.dia} • Sin clases`
                      : fueraDelPeriodo
                        ? 'Fuera de los límites del periodo.'
                      : draggedSession && validation && !validation.valid
                        ? validation.reason
                        : undefined}
                    onDragOver={(e) => handleDragOver(e, dayInfo.day, slot.minutes)}
                    onDrop={(e) => handleDrop(e, dayInfo.day, slot.minutes)}
                  />
                );
              })}
            </React.Fragment>
          ))}

          {weekDays.map((dayInfo, dayIndex) => {
            if (dayInfo.isHoliday) {
              return (
                <div
                  key={`holiday-overlay-${dayInfo.day}`}
                  className="holiday-overlay"
                  style={{ gridRow: `2 / span ${timeSlots.length}`, gridColumn: dayIndex + 2 }}
                  title={`Día feriado - ${dayInfo.holiday.mes} ${dayInfo.holiday.dia}`}
                >
                  <div className="holiday-overlay__content">
                    <span className="holiday-overlay__title">FERIADO</span>
                    <span className="holiday-overlay__subtitle">{dayInfo.holiday.mes} {dayInfo.holiday.dia} • No hay clases</span>
                  </div>
                </div>
              );
            }
            return (sessionsByDay[dayInfo.day] ?? []).map((session) => (
              <ClassCard
                key={`${dayInfo.day}-${session.key}`}
                session={session}
                dayIndex={dayIndex}
                firstMinute={gridTimeBounds.start}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragOver={handleCardDragOver}
                onDrop={handleCardDrop}
                isDragging={draggedSession?.key === session.key}
                isOver={dragOverSlot?.day === dayInfo.day}
                isValidDrop={dragOverSlot?.valid}
              />
            ));
          })}

          {weekDays.map((dayInfo, dayIndex) => {
            if (dayInfo.isHoliday) return null;
            return getBreakSlots(sessionsByDay[dayInfo.day] ?? []).map((breakSlot) => {
              const position = getBreakGridPosition(breakSlot, gridTimeBounds.start);
              return (
                <div
                  key={`break-${dayInfo.day}-${breakSlot.startMin}`}
                  className={`schedule-break ${position.span > 1 ? 'is-tall' : ''}`}
                  style={{ gridRow: position.gridRow, gridColumn: dayIndex + 2 }}
                  title={`Receso (${breakSlot.minutes} min)`}
                >
                  <span>Receso ({breakSlot.minutes} min)</span>
                </div>
              );
            });
          })}
        </div>
      </div>

      <footer className="schedule-legend">
        <section className="legend-block">
          <h2 className="legend-title">Cursos en la semana</h2>
          {courses.length > 0 ? (
            <div className="legend-items">
              {courses.map((course) => (
                <span key={course.mat_cur} className="legend-course" title={course.name}>
                  <span className="legend-swatch" style={{ background: course.color.bg, borderColor: course.color.border }} />
                  <strong>{course.name}</strong>
                  <span className="legend-course-code">{course.mat_cur}</span>
                  {course.career && <span className="legend-course-meta">{course.career} · S{course.semester ?? '—'}</span>}
                  <span className="legend-count">{course.count}</span>
                </span>
              ))}
            </div>
          ) : <p className="legend-empty">No hay cursos en la semana seleccionada.</p>}
        </section>

        <section className="legend-block">
          <h2 className="legend-title">Tipo de sesión</h2>
          <div className="legend-items">
            <span className="legend-item"><span className="legend-swatch legend-swatch--clas" /><strong>CLAS</strong> · con docente</span>
            <span className="legend-item"><span className="legend-swatch legend-swatch--vaee" /><strong>VAEE</strong> · virtual / sin docente</span>
            <span className="legend-item"><span className="legend-swatch legend-swatch--emp" /><strong>EMP</strong> · formación en empresa</span>
            <span className="legend-item"><span className="legend-swatch legend-swatch--break" /><strong>Receso (15–30 min)</strong></span>
          </div>
        </section>

        <section className="legend-block legend-block--activities">
          <h2 className="legend-title">Validación Drag & Drop</h2>
          <div className="legend-items">
            <span className="legend-item"><span className="legend-validation legend-validation--valid" /> Espacio libre (Verde)</span>
            <span className="legend-item"><span className="legend-validation legend-validation--invalid" /> Conflicto/Choque (Rojo)</span>
          </div>
        </section>
      </footer>
    </div>
  );
}

export default WeeklyScheduleGrid;
