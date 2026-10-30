import React, { useEffect, useMemo, useState } from 'react';
import {
  ACTIVITY_LABELS,
  DAY_LABELS,
  MEETING_LABELS,
  addDays,
  formatTime,
  formatWeekRange,
  getBreakSlots,
  getCourseByCode,
  getCourseColor,
  getCourseInstructor,
  getDefaultWeekStart,
  getPeriods,
  getScheduleSnapshot,
  getScheduleSessionKey,
  hasNoAssignedInstructor,
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

const RECORDS = getScheduleSnapshot();
const INITIAL_PERIOD = getPeriods(RECORDS)[0] ?? null;

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
    
    // Mapear por patrones conocidos
    let carrera = 'Sin Carrera';
    if (bloque.includes('PIAD')) carrera = 'PIAD - Ingeniería de Software con IA';
    else if (bloque.includes('PCBD')) carrera = 'PCBD - Ingeniería en Ciberseguridad';
    else if (bloque.includes('PCID')) carrera = 'PCID - Computación e Informática';
    else if (bloque.includes('NAED')) carrera = 'NAED - Administración de Empresas';
    else if (bloque.includes('NAID')) carrera = 'NAID - Administración Industrial';
    else if (bloque.includes('NMGD')) carrera = 'NMGD - Marketing y Gestión Comercial';
    else if (bloque.includes('NCBD')) carrera = 'NCBD - Contabilidad';
    else if (bloque.includes('NSID')) carrera = 'NSID - Seguridad Industrial y Prevención de Riesgos';
    
    const semNum = extractSemesterFromBloque(bloque);
    if (semNum === null) return;
    
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

const CARRERA_MAP = buildCarreraMapping(RECORDS, INITIAL_PERIOD);
const INITIAL_CARRERA = Object.keys(CARRERA_MAP).includes('PIAD - Ingeniería de Software con IA') 
  ? 'PIAD - Ingeniería de Software con IA' 
  : Object.keys(CARRERA_MAP)[0] || '';
const INITIAL_SEMESTRE = INITIAL_CARRERA && CARRERA_MAP[INITIAL_CARRERA] 
  ? Object.keys(CARRERA_MAP[INITIAL_CARRERA])[0] || '' 
  : '';
const INITIAL_BLOQUE = INITIAL_CARRERA && INITIAL_SEMESTRE && CARRERA_MAP[INITIAL_CARRERA][INITIAL_SEMESTRE]
  ? CARRERA_MAP[INITIAL_CARRERA][INITIAL_SEMESTRE][0] || ''
  : '';

const INITIAL_WEEK = getDefaultWeekStart(RECORDS);

// Slots de 15 minutos
const TIME_SLOTS = [];
for (let minutes = GRID_START_HOUR * 60; minutes < GRID_END_HOUR * 60; minutes += SLOT_MINUTES) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const endMinutes = minutes + SLOT_MINUTES;
  const endHour = Math.floor(endMinutes / 60);
  const endMinute = endMinutes % 60;
  TIME_SLOTS.push({
    minutes,
    label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
    endLabel: `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`,
    isHour: m === 0,
  });
}
const FIRST_MINUTE = GRID_START_HOUR * 60;

function formatScheduleTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00`;
}

function normalizeInstructor(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function getInstructorKeys(session) {
  if (session.noAssignedInstructor) return [];
  if (session.hasCatalogInstructor) {
    return session.instructorName ? [normalizeInstructor(session.instructorName)] : [];
  }
  return [normalizeInstructor(session.instructorName || session.instructor)].filter(Boolean);
}

function getRoomKey(session) {
  const building = normalizeInstructor(session.edificio);
  const room = normalizeInstructor(session.salon);
  return building && room && building !== 'SV EV' ? `${building}|${room}` : '';
}

function getDropValidation(session, day, slotMinutes, dayInfo, records) {
  if (dayInfo?.isHoliday) {
    return { valid: false, reason: 'No se pueden programar clases en un día feriado.' };
  }

  const startMinutes = timeToMinutes(session.hora_ini);
  const endMinutes = timeToMinutes(session.hora_fin);
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return { valid: false, reason: 'No se pudo determinar la duración de la clase.' };
  }

  const duration = endMinutes - startMinutes;
  const newEnd = slotMinutes + duration;
  if (slotMinutes < FIRST_MINUTE || newEnd > GRID_END_HOUR * 60) {
    return { valid: false, reason: 'La clase quedaría fuera del horario visible.' };
  }

  const instructorKeys = new Set(getInstructorKeys(session));
  const roomKey = getRoomKey(session);

  for (const other of records) {
    if (
      other.dia !== day ||
      other.periodo !== session.periodo ||
      getScheduleSessionKey(other) === session.key ||
      (other.d_inicio && dayInfo?.iso < other.d_inicio) ||
      (other.d_fin && dayInfo?.iso > other.d_fin)
    ) {
      continue;
    }

    const otherStart = timeToMinutes(other.hora_ini);
    const otherEnd = timeToMinutes(other.hora_fin);
    if (otherStart === null || otherEnd === null) {
      continue;
    }

    const overlaps = newEnd > otherStart && slotMinutes < otherEnd;
    const sectionNeedsBreak = other.bloque === session.bloque &&
      slotMinutes < otherEnd + REQUIRED_BREAK_MINUTES &&
      newEnd + REQUIRED_BREAK_MINUTES > otherStart;
    if (sectionNeedsBreak) {
      return {
        valid: false,
        reason: `La sección ${session.bloque} necesita al menos 15 minutos de receso entre clases.`,
      };
    }

    const otherInstructorKeys = new Set(getInstructorKeys({
      ...other,
      noAssignedInstructor: hasNoAssignedInstructor(other),
    }));
    const sharesInstructor = [...instructorKeys].some((key) => otherInstructorKeys.has(key));
    const instructorNeedsBreak = sharesInstructor &&
      slotMinutes < otherEnd + REQUIRED_BREAK_MINUTES &&
      newEnd + REQUIRED_BREAK_MINUTES > otherStart;
    if (instructorNeedsBreak) {
      return {
        valid: false,
        reason: `El docente ${session.instructorName} necesita al menos 15 minutos de receso entre clases.`,
      };
    }

    const otherRoom = getRoomKey(other);
    if (overlaps && roomKey && roomKey === otherRoom) {
      return {
        valid: false,
        reason: `El salón ${session.edificio} · ${session.salon} ya está ocupado en ese horario.`,
      };
    }
  }

  return { valid: true, reason: '' };
}

function getSessionGridPosition(session) {
  const startMin = timeToMinutes(session.hora_ini) ?? FIRST_MINUTE;
  const endMin = timeToMinutes(session.hora_fin) ?? startMin + SLOT_MINUTES;
  const startSlot = Math.max(0, Math.floor((startMin - FIRST_MINUTE) / SLOT_MINUTES));
  const endSlot = Math.max(startSlot + 1, Math.ceil((endMin - FIRST_MINUTE) / SLOT_MINUTES));
  return {
    gridRow: `${startSlot + 2} / span ${endSlot - startSlot}`,
    startSlot,
    span: endSlot - startSlot,
    duration: Math.max(0, endMin - startMin),
  };
}

function getBreakGridPosition(breakSlot) {
  const startSlot = Math.max(0, Math.floor((breakSlot.startMin - FIRST_MINUTE) / SLOT_MINUTES));
  const endSlot = Math.max(startSlot + 1, Math.ceil((breakSlot.endMin - FIRST_MINUTE) / SLOT_MINUTES));
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
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  isDragging,
  isValidDrop,
  isOver,
}) {
  const color = getCourseColor(session.mat_cur);
  const course = getCourseByCode(session.mat_cur);
  const courseName = course?.nombre || session.mat_cur;
  const isVAEE = session.tipo_reunion === 'VAEE';
  const isRemote = session.tipo_reunion === 'REMT';
  const isEMP = session.actividad === 'EMP' || session.tipo_reunion === 'EMP';
  const position = getSessionGridPosition(session);
  const compact = position.duration < 45;
  const location = isEMP ? '00-EX' : [session.edificio, session.salon].filter(Boolean).join(' · ');
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
    location ? `Locación: ${location}` : null,
    isEMP ? 'Empresa / Formación Práctica' : instructorLabel ? `Docente: ${instructorLabel}` : null,
    `Vigencia:\n${formatRanges(session.ranges)}`,
  ].filter(Boolean).join('\n');

  const laneStyle = session.laneCount > 1
    ? { width: `calc(${100 / session.laneCount}% - 4px)`, marginLeft: `calc(${(session.lane * 100) / session.laneCount}% + 2px)` }
    : {};

  return (
    <div
      draggable={!isEMP}
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
        background: isEMP ? 'linear-gradient(135deg, #F0FDF4 0%, #DCFCE7 100%)' : (isVAEE ? '#F8FAFC' : color.bg),
        borderLeftColor: isEMP ? '#22C55E' : (isVAEE ? color.border : color.border),
        color: isEMP ? '#166534' : color.text,
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
          style={{ background: isEMP ? '#22C55E' : color.chip, color: '#fff' }}
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
  const [selectedPeriod] = useState(INITIAL_PERIOD);
  const [selectedCarrera, setSelectedCarrera] = useState(INITIAL_CARRERA);
  const [selectedSemestre, setSelectedSemestre] = useState(INITIAL_SEMESTRE);
  const [selectedBlock, setSelectedBlock] = useState(INITIAL_BLOQUE);
  const [weekStart, setWeekStart] = useState(INITIAL_WEEK);
  
  // Drag & Drop state
  const [draggedSession, setDraggedSession] = useState(null);
  const [dragOverSlot, setDragOverSlot] = useState(null);
  const [toast, setToast] = useState('');

  const [records, setRecords] = useState(() => RECORDS);
  const validationRecords = useMemo(
    () => records.map((record) => {
      const assignment = getCourseInstructor(record.mat_cur, record.bloque);
      return {
        ...record,
        instructorName: hasNoAssignedInstructor(record)
          ? ''
          : assignment.found ? assignment.name : record.instructor ?? '',
        hasCatalogInstructor: assignment.found,
        noAssignedInstructor: hasNoAssignedInstructor(record),
      };
    }),
    [records]
  );
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
    () => getWeekSessions(records, { period: selectedPeriod, block: selectedBlock, weekStart }),
    [records, selectedPeriod, selectedBlock, weekStart]
  );

  // Días de la semana visible + feriados (búsqueda O(1) contra el Map interno).
  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);
  const sessionsByDay = useMemo(() => Object.fromEntries(
    weekDays.map((dayInfo) => [
      dayInfo.day,
      layoutSessionsByDay(
        weekSessions.filter((session) =>
          session.dia === dayInfo.day && isSessionActiveOnDate(session, dayInfo.iso)
        )
      )[dayInfo.day],
    ])
  ), [weekDays, weekSessions]);
  const holidaysInWeek = useMemo(
    () => weekDays.filter((dayInfo) => dayInfo.isHoliday),
    [weekDays]
  );
  const dropValidationBySlot = useMemo(() => {
    if (!draggedSession) return new Map();
    const results = new Map();
    weekDays.forEach((dayInfo) => {
      TIME_SLOTS.forEach((slot) => {
        results.set(
          `${dayInfo.day}|${slot.minutes}`,
          getDropValidation(draggedSession, dayInfo.day, slot.minutes, dayInfo, validationRecords)
        );
      });
    });
    return results;
  }, [draggedSession, validationRecords, weekDays]);

  const courses = useMemo(() => {
    const map = new Map();
    weekSessions.forEach((session) => {
      const course = getCourseByCode(session.mat_cur);
      const entry = map.get(session.mat_cur) ?? {
        mat_cur: session.mat_cur,
        name: course?.nombre || session.mat_cur,
        career: course?.carrera ?? null,
        semester: course?.semestre ?? null,
        color: getCourseColor(session.mat_cur),
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
    if (session.actividad === 'EMP' || session.tipo_reunion === 'EMP') {
      e.preventDefault();
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
    const validation = dropValidationBySlot.get(`${day}|${slotMinutes}`) ?? { valid: false };
    setDragOverSlot({ day, slotMinutes, valid: validation.valid });
    e.dataTransfer.dropEffect = validation.valid ? 'move' : 'none';
  };

  const handleDrop = (e, day, slotMinutes) => {
    e.preventDefault();
    if (!draggedSession) return;
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
      validationRecords
    );
    if (!validation.valid) {
      setToast(`No se puede mover: ${validation.reason}`);
      handleDragEnd();
      return;
    }

    const duration = timeToMinutes(draggedSession.hora_fin) - currentStart;
    const newStart = formatScheduleTime(slotMinutes);
    const newEnd = formatScheduleTime(slotMinutes + duration);
    const hasMatchingRecords = records.some(
      (record) => getScheduleSessionKey(record) === draggedSession.key
    );
    if (!hasMatchingRecords) {
      setToast('No se pudo mover: no se encontraron los registros originales de la clase.');
      handleDragEnd();
      return;
    }
    setRecords((currentRecords) => currentRecords.map((record) => {
      if (getScheduleSessionKey(record) !== draggedSession.key) return record;
      return { ...record, dia: day, hora_ini: newStart, hora_fin: newEnd };
    }));
    handleDragEnd();
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
    setWeekStart(toISODate(addDays(current, offset * 7)));
  };

  const handleDatePick = (event) => {
    const picked = parseLocalDate(event.target.value);
    if (!picked) return;
    setWeekStart(toISODate(startOfWeekMonday(picked)));
  };

  const goToCurrentWeek = () => {
    setWeekStart(getDefaultWeekStart(records));
  };

  return (
    <div className="weekly-schedule-container">
      <header className="schedule-header">
        <div>
          <div className="schedule-kicker">
            <span className="mock-badge">
              <span className="mock-dot" /> Datos simulados · JSON local
            </span>
          </div>
          <h1 className="schedule-title">
            <i className="far fa-calendar-alt" aria-hidden="true" /> Cuadrícula Semanal de Horarios
          </h1>
          <p className="schedule-subtitle">
            Grilla 15 minutos • Lunes a Domingo • Drag & Drop con validación • Recesos intermedios
          </p>
        </div>

        <div className="schedule-summary">
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
          <button type="button" className="nav-button" onClick={() => handleWeekChange(-1)} aria-label="Semana anterior"><i className="fas fa-chevron-left" /></button>
          <div className="week-navigator__center">
            <span className="week-label">{formatWeekRange(weekStart)}</span>
            <input type="date" className="week-date-input" value={weekStart} onChange={handleDatePick} />
          </div>
          <button type="button" className="nav-button" onClick={() => handleWeekChange(1)} aria-label="Semana siguiente"><i className="fas fa-chevron-right" /></button>
          <button type="button" className="today-button" onClick={goToCurrentWeek}>Hoy</button>
        </div>
      </div>

      {weekSessions.length === 0 && (
        <div className="schedule-empty-banner">
          <i className="far fa-calendar-times" />
          <div><strong>Sin sesiones para esta semana.</strong><span>{holidaysInWeek.length ? `${holidaysInWeek.map((h) => `Feriado: ${h.holiday.mes} ${h.holiday.dia}`).join(' · ')} • ` : ''}Prueba con otra semana o selecciona otro bloque/carrera.</span></div>
        </div>
      )}

      {holidaysInWeek.length > 0 && weekSessions.length > 0 && (
        <div className="holiday-alert-banner">
          <i className="fas fa-exclamation-triangle" />
          <div><strong>Día feriado en esta semana.</strong><span>{holidaysInWeek.map((h) => `${h.holiday.mes} ${h.holiday.dia}`).join(' · ')} • Marcado en rojo. No hay clases programadas.</span></div>
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
        <div className="schedule-grid" style={{ gridTemplateColumns: `68px repeat(7, minmax(148px, 1fr))`, gridTemplateRows: `48px repeat(${TIME_SLOTS.length}, ${SLOT_HEIGHT}px)` }}>
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

          {TIME_SLOTS.map((slot, index) => (
            <React.Fragment key={slot.minutes}>
              <div className="grid-time time-15" style={{ gridRow: index + 2, gridColumn: 1 }}>
                <span className="time-pc">{slot.label}</span>
                <span className="time-a">{slot.endLabel}</span>
              </div>
              {weekDays.map((dayInfo, dayIndex) => {
                const isHoliday = dayInfo.isHoliday;
                const validation = dropValidationBySlot.get(`${dayInfo.day}|${slot.minutes}`);
                return (
                  <div
                    key={`${dayInfo.day}-${slot.minutes}`}
                    className={[
                      'grid-slot',
                      slot.isHour ? 'is-hour' : '',
                      dayInfo.day === 'DOMINGO' ? 'is-sunday' : '',
                      isHoliday ? 'is-holiday' : '',
                      draggedSession ? 'drag-active' : '',
                      draggedSession ? (validation?.valid ? 'slot-valid' : 'slot-invalid') : '',
                      dragOverSlot?.day === dayInfo.day && dragOverSlot?.slotMinutes === slot.minutes ? 'is-drop-target' : '',
                    ].filter(Boolean).join(' ')}
                    style={{ gridRow: index + 2, gridColumn: dayIndex + 2 }}
                    data-day={dayInfo.day}
                    data-slot-minutes={slot.minutes}
                    title={isHoliday
                      ? `Día feriado - ${dayInfo.holiday.mes} ${dayInfo.holiday.dia} • Sin clases`
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
                  style={{ gridRow: '2 / span 60', gridColumn: dayIndex + 2 }}
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
              const position = getBreakGridPosition(breakSlot);
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
