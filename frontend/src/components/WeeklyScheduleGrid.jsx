import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ETIQUETAS_ACTIVIDAD,
  ETIQUETAS_DIAS,
  ETIQUETAS_REUNION,
  agregarDias,
  formatearHora,
  formatearRangoSemana,
  obtenerHorarioBorrador,
  obtenerFeriados,
  construirMapaFeriados,
  obtenerIntervalosReceso,
  obtenerColorCurso,
  obtenerNumeroSemanaAcademica,
  obtenerInicioSemanaPredeterminado,
  moverSesionesBorrador,
  cambiarEstadoHorario,
  descargarHorariosZip,
  obtenerAulasPorSede,
  cambiarAulaHorario,
  listarBorradoresPeriodo,
  eliminarBorradorPeriodo,
  generarBorradorPeriodo,
  obtenerEstadoSolver,
  cancelarSolver,
  obtenerLimitesHorario,
  obtenerDiasSemana,
  obtenerSesionesSemana,
  estaSesionActivaEnFecha,
  distribuirSesionesPorDia,
  analizarFechaLocal,
  inicioSemanaLunes,
  convertirHoraAMinutos,
  convertirAFechaISO,
} from '../services/scheduleService';
import './WeeklyScheduleGrid.css';

const MINUTOS_INTERVALO = 15;
const MINUTOS_RECESO_REQUERIDOS = 15;
const ALTURA_INTERVALO = 22;
const HORA_INICIO_CUADRICULA = 7;
const HORA_FIN_CUADRICULA = 22;
const PRIMER_MINUTO = HORA_INICIO_CUADRICULA * 60;

// Extraer semestre del bloque SENATI: "56PIADS201" -> después de S/E viene el dígito de semestre
const extraerSemestreDelBloque = (bloque) => {
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
const construirMapaCarreras = (registros, periodo) => {
  const mapa = {};
  registros.forEach((r) => {
    if (periodo !== null && r.periodo !== periodo) return;
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
      semNum = extraerSemestreDelBloque(bloque);
    }
    if (!Number.isFinite(semNum)) return;
    
    const semestreKey = `Semestre ${semNum}`;
    if (!mapa[carrera]) mapa[carrera] = {};
    if (!mapa[carrera][semestreKey]) mapa[carrera][semestreKey] = new Set();
    mapa[carrera][semestreKey].add(bloque);
  });
  
  const resultado = {};
  Object.keys(mapa).sort().forEach(c => {
    resultado[c] = {};
    Object.keys(mapa[c]).sort((a,b) => {
      const na = parseInt(a.match(/\d+/)?.[0] || '0');
      const nb = parseInt(b.match(/\d+/)?.[0] || '0');
      return na - nb;
    }).forEach(s => {
      resultado[c][s] = Array.from(mapa[c][s]).sort();
    });
  });
  return resultado;
};

function crearIntervalosHorario(inicioMinuto, finMinuto) {
  const intervalos = [];
  for (let minutos = inicioMinuto; minutos < finMinuto; minutos += MINUTOS_INTERVALO) {
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    const finMinutos = minutos + MINUTOS_INTERVALO;
    const finHora = Math.floor(finMinutos / 60);
    const finMinuto = finMinutos % 60;
    intervalos.push({
      minutes: minutos,
      label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
      endLabel: `${String(finHora).padStart(2, '0')}:${String(finMinuto).padStart(2, '0')}`,
      isHour: m === 0,
    });
  }
  return intervalos;
}

function obtenerLimitesCuadriculaHorario(franja) {
  const configuredStart = convertirHoraAMinutos(franja?.hora_inicio_mañana) ?? PRIMER_MINUTO;
  const configuredEnd = convertirHoraAMinutos(franja?.hora_cierre_noche) ?? HORA_FIN_CUADRICULA * 60;
  if (configuredEnd <= configuredStart) {
    return { start: PRIMER_MINUTO, end: HORA_FIN_CUADRICULA * 60 };
  }
  return {
    start: Math.floor(configuredStart / 60) * 60,
    end: Math.ceil(configuredEnd / 60) * 60,
    configuredStart,
    configuredEnd,
  };
}

function formatearHoraHorario(minutos) {
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}:00`;
}

function formatearAvisoConflicto(motivos = []) {
  if (!motivos.length) return '';
  return motivos.map((entry) => `• ${entry.mensaje}`).join('\n');
}

function normalizarDocente(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function construirValidacionMovimiento(valid, motivos) {
  return {
    valid,
    reasons: motivos,
    reason: motivos.map((entry) => entry.mensaje).join(' · '),
  };
}

function obtenerValidacionMovimiento(
  sesion,
  dia,
  intervaloMinutos,
  diaInformacion,
  occupations,
  restrictions,
  inicioPeriodo,
  finPeriodo,
  academicoSemana,
  configuredStart,
  configuredEnd
) {
  if (diaInformacion?.isHoliday) {
    return construirValidacionMovimiento(false, [
      { tipo: 'general', mensaje: 'No se pueden programar clases en un día feriado.' },
    ]);
  }
  if (
    (inicioPeriodo && diaInformacion?.iso < inicioPeriodo) ||
    (finPeriodo && diaInformacion?.iso > finPeriodo)
  ) {
    return construirValidacionMovimiento(false, [
      { tipo: 'general', mensaje: 'La fecha está fuera de los límites del periodo.' },
    ]);
  }

  const inicioMinutos = convertirHoraAMinutos(sesion.hora_ini);
  const finMinutos = convertirHoraAMinutos(sesion.hora_fin);
  if (inicioMinutos === null || finMinutos === null || finMinutos <= inicioMinutos) {
    return construirValidacionMovimiento(false, [
      { tipo: 'general', mensaje: 'No se pudo determinar la duración de la clase.' },
    ]);
  }

  const duracion = finMinutos - inicioMinutos;
  const nuevoFin = intervaloMinutos + duracion;
  const motivos = [];

  if (intervaloMinutos < configuredStart || nuevoFin > configuredEnd) {
    motivos.push({
      tipo: 'general',
      mensaje: 'La clase quedaría fuera de la franja horaria configurada.',
    });
  }

  const sesionIdentificadores = new Set(
    sesion.scheduleIds?.length
      ? sesion.scheduleIds.map(Number)
      : [Number(sesion.id_horario)].filter(Number.isFinite)
  );
  const docenteIdentificador = Number(sesion.id_docente) || null;
  const ambienteIdentificador = Number(sesion.id_ambiente) || null;
  const docente = restrictions.docentes.find(
    (entry) => Number(entry.id_docente) === docenteIdentificador
  );
  const docenteDisponibilidad = restrictions.disponibilidadDocentes.filter(
    (entry) => Number(entry.id_docente) === docenteIdentificador &&
      normalizarDocente(entry.dia_semana) === dia
  );
  if (docente?.usa_restriccion_horaria && !docenteDisponibilidad.some((entry) =>
    convertirHoraAMinutos(entry.hora_inicio) <= intervaloMinutos &&
    convertirHoraAMinutos(entry.hora_fin) >= nuevoFin
  )) {
    motivos.push({
      tipo: 'docente',
      mensaje: `El docente no tiene disponibilidad el ${ETIQUETAS_DIAS[dia]} entre ${formatearHora(formatearHoraHorario(intervaloMinutos))} y ${formatearHora(formatearHoraHorario(nuevoFin))}.`,
    });
  }

  if (ambienteIdentificador && !restrictions.ambientes.some((entry) =>
    Number(entry.id) === ambienteIdentificador &&
    ['A', 'ACTIVO', 'DISPONIBLE', 'OPERATIVO']
      .includes(String(entry.estado ?? '').trim().toUpperCase())
  )) {
    motivos.push({ tipo: 'salon', mensaje: 'El salón asignado no está operativo.' });
  }
  if (!ambienteIdentificador && !['VIR', 'EMP'].includes(sesion.actividad)) {
    motivos.push({ tipo: 'salon', mensaje: 'La clase no tiene un salón asignado.' });
  }

  const contexto = (otro) => ({
    carrera: otro.carrera_codigo || otro.codigo_carrera || '',
    semestre: otro.semestre || '',
    curso: otro.mat_cur || otro.codigo_curso || '',
    nombre_curso: otro.nombre_curso || '',
    ambiente: otro.ambiente || '',
    docente: otro.instructor || '',
  });

  for (const otro of occupations) {
    if (
      normalizarDocente(otro.dia) !== dia ||
      sesionIdentificadores.has(Number(otro.id_horario)) ||
      Number(otro.semana_inicio) > Number(sesion.semana_fin) ||
      Number(otro.semana_fin) < Number(sesion.semana_inicio)
    ) {
      continue;
    }

    const otroInicio = convertirHoraAMinutos(otro.hora_ini);
    const otroFin = convertirHoraAMinutos(otro.hora_fin);
    if (otroInicio === null || otroFin === null) {
      continue;
    }

    const solapan = nuevoFin > otroInicio && intervaloMinutos < otroFin;
    const informacion = contexto(otro);
    const ubicacion = `${informacion.carrera || '—'} · ${informacion.semestre || '—'}`;
    const detalleClase = `${informacion.nombre_curso || informacion.curso || 'curso'} ${formatearHora(otro.hora_ini)}–${formatearHora(otro.hora_fin)}`;

    const seccionNecesitaReceso = otro.codigo_cohorte === sesion.codigo_cohorte &&
      intervaloMinutos < otroFin + MINUTOS_RECESO_REQUERIDOS &&
      nuevoFin + MINUTOS_RECESO_REQUERIDOS > otroInicio;
    if (seccionNecesitaReceso) {
      motivos.push({
        tipo: 'cohorte',
        ...informacion,
        mensaje: `La cohorte ${ubicacion} ya tiene clase (${detalleClase}); deja al menos 15 minutos entre clases.`,
      });
    }

    const sharesInstructor = docenteIdentificador &&
      Number(otro.id_docente) === docenteIdentificador;
    const docenteNecesitaReceso = sharesInstructor &&
      intervaloMinutos < otroFin + MINUTOS_RECESO_REQUERIDOS &&
      nuevoFin + MINUTOS_RECESO_REQUERIDOS > otroInicio;
    if (docenteNecesitaReceso) {
      motivos.push({
        tipo: 'docente',
        ...informacion,
        mensaje: `El docente ${sesion.instructorName} necesita al menos 15 minutos de receso (${ubicacion}, ${detalleClase}).`,
      });
    }

    if (solapan && ambienteIdentificador && Number(otro.id_ambiente) === ambienteIdentificador) {
      motivos.push({
        tipo: 'salon',
        ...informacion,
        mensaje: `El salón ${sesion.ambiente || sesion.salon || ''} está ocupado por ${ubicacion} (${detalleClase}).`,
      });
    }
  }

  if (docenteIdentificador) {
    const primerSemana = Number(sesion.semana_inicio) || academicoSemana;
    const ultimoSemana = Number(sesion.semana_fin) || academicoSemana;
    let faltaDescansoDocente = false;
    for (let semana = primerSemana; semana <= ultimoSemana; semana += 1) {
      const docenteDia = occupations
        .filter((otro) =>
          Number(otro.id_docente) === docenteIdentificador &&
          normalizarDocente(otro.dia) === dia &&
          Number(otro.semana_inicio) <= semana &&
          Number(otro.semana_fin) >= semana &&
          !sesionIdentificadores.has(Number(otro.id_horario))
        )
        .map((otro) => ({
          start: convertirHoraAMinutos(otro.hora_ini),
          end: convertirHoraAMinutos(otro.hora_fin),
        }));
      docenteDia.push({ start: intervaloMinutos, end: nuevoFin });
      docenteDia.sort((izquierda, derecha) => izquierda.start - derecha.start);

      let continuasHoras = (docenteDia[0].end - docenteDia[0].start) / 45;
      for (let indice = 1; indice < docenteDia.length; indice += 1) {
        const anterior = docenteDia[indice - 1];
        const actual = docenteDia[indice];
        const separacion = actual.start - anterior.end;
        if (continuasHoras >= 5 && separacion < 45) {
          faltaDescansoDocente = true;
          break;
        }
        continuasHoras = separacion >= 45
          ? (actual.end - actual.start) / 45
          : continuasHoras + (actual.end - actual.start) / 45;
      }
      if (faltaDescansoDocente) break;
    }
    if (faltaDescansoDocente) {
      motivos.push({
        tipo: 'docente',
        mensaje: 'El docente necesita 45 minutos de descanso después de 5 horas académicas continuas antes de continuar su jornada.',
      });
    }
  }

  return construirValidacionMovimiento(motivos.length === 0, motivos);
}

function obtenerPosicionCuadriculaSesion(sesion, primerMinuto) {
  const inicioMinimo = convertirHoraAMinutos(sesion.hora_ini) ?? primerMinuto;
  const finMinimo = convertirHoraAMinutos(sesion.hora_fin) ?? inicioMinimo + MINUTOS_INTERVALO;
  const inicioIntervalo = Math.max(0, Math.floor((inicioMinimo - primerMinuto) / MINUTOS_INTERVALO));
  const finIntervalo = Math.max(inicioIntervalo + 1, Math.ceil((finMinimo - primerMinuto) / MINUTOS_INTERVALO));
  return {
    gridRow: `${inicioIntervalo + 2} / span ${finIntervalo - inicioIntervalo}`,
    startSlot: inicioIntervalo,
    span: finIntervalo - inicioIntervalo,
    duration: Math.max(0, finMinimo - inicioMinimo),
  };
}

function obtenerPosicionCuadriculaReceso(recesoIntervalo, primerMinuto) {
  const inicioIntervalo = Math.max(0, Math.floor((recesoIntervalo.startMin - primerMinuto) / MINUTOS_INTERVALO));
  const finIntervalo = Math.max(inicioIntervalo + 1, Math.ceil((recesoIntervalo.endMin - primerMinuto) / MINUTOS_INTERVALO));
  return {
    gridRow: `${inicioIntervalo + 2} / span ${finIntervalo - inicioIntervalo}`,
    span: finIntervalo - inicioIntervalo,
  };
}

function formatearRangos(rangos = []) {
  if (!rangos.length) return 'Sin rango de fechas';
  return rangos.slice(0, 3).map((rango) => `${rango.start} → ${rango.end}`).join('\n');
}

function TarjetaClase({
  sesion,
  diaIndice,
  primerMinuto,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onDoubleClick,
  estaArrastrando,
  movimientoValido,
  estaSobre,
}) {
  const color = obtenerColorCurso(sesion.mat_cur, sesion.nombre_curso);
  const cursoNombre = sesion.nombre_curso || sesion.mat_cur;
  const isVAEE = sesion.tipo_reunion === 'VAEE';
  const esRemota = sesion.tipo_reunion === 'REMT';
  const isEMP = sesion.actividad === 'EMP' || sesion.tipo_reunion === 'EMP';
  const posicion = obtenerPosicionCuadriculaSesion(sesion, primerMinuto);
  const compacto = posicion.duration < 45;
  const ubicacion = isEMP
    ? '00-EX'
    : sesion.ambiente || [sesion.edificio, sesion.salon].filter(Boolean).join(' · ');
  const etiquetaDocente = sesion.noAssignedInstructor
    ? ''
    : sesion.hasCatalogInstructor
      ? (sesion.instructorName
        ? [sesion.instructorName, sesion.instructor].filter((valor, indice) =>
          valor && (indice === 0 || valor !== sesion.instructorName)
        ).join(' · ')
        : 'Docente no asignado')
      : sesion.instructor
        ? `Docente no identificado · ${sesion.instructor}`
        : 'Docente no asignado';

  const ayuda = [
    cursoNombre,
    `${sesion.mat_cur} · ${ETIQUETAS_ACTIVIDAD[sesion.actividad] ?? sesion.actividad ?? 'S/A'}`,
    `Tipo: ${ETIQUETAS_REUNION[sesion.tipo_reunion] ?? sesion.tipo_reunion ?? 'No definido'}`,
    `Horario: ${formatearHora(sesion.hora_ini)} – ${formatearHora(sesion.hora_fin)}`,
    `Bloque: ${sesion.bloque}`,
    sesion.cohorte ? `Cohorte: ${sesion.cohorte}` : null,
    ubicacion ? `Locación: ${ubicacion}` : null,
    isEMP ? 'Empresa / Formación Práctica' : etiquetaDocente ? `Docente: ${etiquetaDocente}` : null,
    sesion.semana_inicio && sesion.semana_fin
      ? `Semana lectiva: ${sesion.semana_inicio}–${sesion.semana_fin}`
      : `Vigencia:\n${formatearRangos(sesion.ranges)}`,
  ].filter(Boolean).join('\n');

  const carrilEstilo = sesion.laneCount > 1
    ? { width: `calc(${100 / sesion.laneCount}% - 4px)`, marginLeft: `calc(${(sesion.lane * 100) / sesion.laneCount}% + 2px)` }
    : {};

  return (
    <div
      draggable={Boolean(sesion.scheduleIds?.length)}
      onDoubleClick={onDoubleClick}
      className={[
        'schedule-class',
        isVAEE ? 'is-vaee' : '',
        esRemota ? 'is-remote' : '',
        isEMP ? 'is-emp' : '',
        compacto ? 'is-compact' : '',
        estaArrastrando ? 'is-dragging' : '',
        estaSobre && movimientoValido ? 'drop-valid' : '',
        estaSobre && !movimientoValido ? 'drop-invalid' : '',
      ].filter(Boolean).join(' ')}
      style={{
        gridRow: posicion.gridRow,
        gridColumn: diaIndice + 2,
        background: isEMP
          ? 'linear-gradient(135deg, #F0FDF4 0%, #DCFCE7 100%)'
          : color.bg,
        borderLeftColor: isEMP ? '#22C55E' : color.border,
        color: isEMP ? '#166534' : color.text,
        ...carrilEstilo,
      }}
      title={ayuda}
      onDragStart={(e) => onDragStart && onDragStart(e, sesion)}
      onDragEnd={(e) => onDragEnd && onDragEnd(e)}
      onDragOver={(e) => onDragOver && onDragOver(e, sesion)}
      onDrop={(e) => onDrop && onDrop(e, sesion)}
    >
      <div className="schedule-class__top">
        <span className="schedule-class__name" title={cursoNombre}>{cursoNombre}</span>
        <span
          className="schedule-class__activity"
          style={{ background: isEMP ? '#22C55E' : color.chip, color: '#fff' }}
        >
          {isEMP ? 'EMP' : (sesion.actividad || '—')}
        </span>
      </div>

      <div className="schedule-class__time">
        <span className="schedule-class__code">{sesion.mat_cur}</span>
        <span>{formatearHora(sesion.hora_ini)} – {formatearHora(sesion.hora_fin)}</span>
      </div>

      <div className="schedule-class__badges">
        <span className={`meeting-badge ${isEMP ? 'meeting-badge--emp' : (isVAEE ? 'meeting-badge--vaee' : esRemota ? 'meeting-badge--remt' : 'meeting-badge--clas')}`}>
          {isEMP ? 'EMP' : (sesion.tipo_reunion || 'S/T')}
        </span>
        {ubicacion && (
          <span className="schedule-class__location">{ubicacion}</span>
        )}
      </div>

      {!isEMP && etiquetaDocente && (
        <div className="schedule-class__instructor">{etiquetaDocente}</div>
      )}
      {isEMP && (
        <div className="schedule-class__instructor">Formación en Empresa</div>
      )}
    </div>
  );
}

function CuadriculaSemanalHorarios({ periodo = 202620 }) {
  const periodoSeleccionado = Number(periodo) || 202620;
  const [carreraSeleccionada, setSelectedCarrera] = useState('');
  const [semestreSeleccionado, setSelectedSemestre] = useState('');
  const [bloqueSeleccionado, establecerSeleccionadoBloque] = useState('');
  const [semanaInicio, establecerSemanaInicio] = useState(() => obtenerInicioSemanaPredeterminado());
  const [semanasPeriodo, establecerPeriodoSemanas] = useState(18);
  const [inicioPeriodo, establecerPeriodoInicio] = useState('');
  const [finPeriodo, establecerPeriodoFin] = useState('');
  const [restrictions, setRestrictions] = useState({
    ocupaciones: [],
    disponibilidadDocentes: [],
    docentes: [],
    ambientes: [],
  });
  const [cargando, establecerCargando] = useState(true);
  const [cargarError, establecerCargarError] = useState('');
  
  // Drag & Drop state
  const [sesionArrastrada, establecerArrastradoSesion] = useState(null);
  const [intervaloArrastre, setDragOverSlot] = useState(null);
  const [toast, setToast] = useState('');
  const [savingMove, setSavingMove] = useState(false);
  const [estadoHorario, establecerHorarioEstado] = useState('BORRADOR');
  const [changingState, setChangingState] = useState(false);
  const [descargandoZip, setDescargandoZip] = useState(false);
  const [feriadosMapa, establecerFeriadosMapa] = useState(new Map());
  const [borradores, establecerBorradores] = useState([]);
  const [borradorSeleccionado, establecerBorradorSeleccionado] = useState(null);
  const [cargandoBorradores, establecerCargandoBorradores] = useState(true);
  const [generandoBorrador, establecerGenerandoBorrador] = useState(false);
  const [cancelandoGeneracion, establecerCancelandoGeneracion] = useState(false);
  const [progresoGeneracion, establecerProgresoGeneracion] = useState('');
  const [progresoSolver, establecerProgresoSolver] = useState(0);
  const [tiempoRestanteSolver, establecerTiempoRestanteSolver] = useState(0);
  const [hitoSolver, establecerHitoSolver] = useState('');
  const [lineasSolver, establecerLineasSolver] = useState([]);
  const [eliminandoBorrador, establecerEliminandoBorrador] = useState(null);
  const [borradorPendienteEliminacion, establecerBorradorPendienteEliminacion] = useState(null);
  const [aulaModal, establecerAulaModal] = useState(null);

  const [registros, establecerRegistros] = useState([]);
  const [horariosOperativos, setOperatingHours] = useState(null);
  useEffect(() => {
    const controlador = new AbortController();
    obtenerFeriados({ signal: controlador.signal })
      .then((feriados) => {
        if (!controlador.signal.aborted) establecerFeriadosMapa(construirMapaFeriados(feriados));
      })
      .catch(() => {});
    return () => controlador.abort();
  }, [periodoSeleccionado]);
  const cargarBorradores = useCallback(async ({ signal, seleccionar } = {}) => {
    const resultado = await listarBorradoresPeriodo(
      String(periodoSeleccionado),
      signal ? { signal } : {}
    );
    if (signal?.aborted) return null;

    const lista = resultado.borradores;
    establecerBorradores(lista);
    establecerBorradorSeleccionado((actual) => {
      const preferido = seleccionar ?? actual;
      if (
        preferido !== null &&
        preferido !== undefined &&
        lista.some((borrador) => borrador.id_borrador === Number(preferido))
      ) {
        return Number(preferido);
      }
      return lista[0]?.id_borrador ?? null;
    });
    return lista;
  }, [periodoSeleccionado]);

  useEffect(() => {
    const controlador = new AbortController();
    establecerCargando(true);
    establecerCargandoBorradores(true);
    establecerBorradores([]);
    establecerBorradorSeleccionado(null);

    cargarBorradores({ signal: controlador.signal })
      .catch((error) => {
        if (!controlador.signal.aborted) {
          establecerCargarError(
            error.message || 'No se pudieron cargar los borradores del periodo.'
          );
          establecerCargando(false);
        }
      })
      .finally(() => {
        if (!controlador.signal.aborted) establecerCargandoBorradores(false);
      });

    return () => controlador.abort();
  }, [cargarBorradores]);

  useEffect(() => {
    if (cargandoBorradores) return undefined;

    if (!borradorSeleccionado) {
      const controlador = new AbortController();
      const cargarPeriodo = async () => {
        establecerCargando(true);
        try {
          const resultado = await obtenerHorarioBorrador(
            String(periodoSeleccionado),
            null,
            { signal: controlador.signal }
          );
          if (controlador.signal.aborted) return;

          establecerRegistros([]);
          setOperatingHours(resultado.franja);
          establecerHorarioEstado(resultado.estado || 'BORRADOR');
          establecerPeriodoSemanas(resultado.semanas);
          const inicio = resultado.fechaInicio || '';
          const fin = resultado.fechaFin || '';
          establecerPeriodoInicio(inicio);
          establecerPeriodoFin(fin);
          setRestrictions(resultado.restricciones);
          establecerSemanaInicio(obtenerInicioSemanaPredeterminado([], inicio, fin));
          establecerCargarError('');
        } catch (error) {
          if (!controlador.signal.aborted) {
            establecerRegistros([]);
            establecerCargarError(
              error.message || 'No se pudo cargar la configuración del periodo.'
            );
          }
        } finally {
          if (!controlador.signal.aborted) establecerCargando(false);
        }
      };

      cargarPeriodo();
      return () => controlador.abort();
    }

    const controlador = new AbortController();
    const cargarHorario = async () => {
      establecerCargando(true);
      try {
        const resultado = await obtenerHorarioBorrador(
          String(periodoSeleccionado),
          borradorSeleccionado,
          { signal: controlador.signal }
        );
        if (controlador.signal.aborted) return;

        establecerRegistros(resultado.bloques);
        setOperatingHours(resultado.franja);
        establecerHorarioEstado(resultado.estado || 'BORRADOR');
        establecerPeriodoSemanas(resultado.semanas);
        const bounds = obtenerLimitesHorario(resultado.bloques);
        const inicioPeriodo = resultado.fechaInicio ||
          (bounds ? convertirAFechaISO(bounds.min) : '');
        const finPeriodo = resultado.fechaFin ||
          (bounds ? convertirAFechaISO(bounds.max) : '');
        establecerPeriodoInicio(inicioPeriodo);
        establecerPeriodoFin(finPeriodo);
        setRestrictions(resultado.restricciones);
        establecerSemanaInicio(obtenerInicioSemanaPredeterminado(
          resultado.bloques,
          inicioPeriodo,
          finPeriodo
        ));
        establecerCargarError('');

        const mapping = construirMapaCarreras(resultado.bloques, periodoSeleccionado);
        const carrera = Object.keys(mapping).sort()[0] || '';
        const semestre = carrera
          ? Object.keys(mapping[carrera]).sort((a, b) =>
            Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0)
          )[0] || ''
          : '';
        const bloque = carrera && semestre ? mapping[carrera][semestre][0] || '' : '';
        setSelectedCarrera(carrera);
        setSelectedSemestre(semestre);
        establecerSeleccionadoBloque(bloque);
      } catch (error) {
        if (!controlador.signal.aborted) {
          establecerRegistros([]);
          const mensaje = error.message || 'No se pudo cargar el horario borrador.';
          establecerCargarError(mensaje);
          if (mensaje.includes('No existe el borrador')) {
            try {
              const lista = await cargarBorradores();
              establecerBorradorSeleccionado(lista?.[0]?.id_borrador ?? null);
            } catch {
              // Ignorar errores secundarios al recargar borradores.
            }
          }
        }
      } finally {
        if (!controlador.signal.aborted) establecerCargando(false);
      }
    };

    cargarHorario();
    return () => controlador.abort();
  }, [periodoSeleccionado, borradorSeleccionado, cargandoBorradores]);
  useEffect(() => {
    if (!toast) return undefined;
    const esAvisoDeCruce = /no se puede mover|no se pudo mover|no se pudo guardar el cambio/i.test(toast);
    if (esAvisoDeCruce) return undefined;
    const timeout = window.setTimeout(() => setToast(''), 4200);
    return () => window.clearTimeout(timeout);
  }, [toast]);
  const carreraMap = useMemo(() => construirMapaCarreras(registros, periodoSeleccionado), [registros, periodoSeleccionado]);
  const carreras = useMemo(() => Object.keys(carreraMap).sort(), [carreraMap]);
  
  const semestres = useMemo(() => {
    if (!carreraSeleccionada || !carreraMap[carreraSeleccionada]) return [];
    return Object.keys(carreraMap[carreraSeleccionada]).sort((a,b) => {
      const na = parseInt(a.match(/\d+/)?.[0] || '0');
      const nb = parseInt(b.match(/\d+/)?.[0] || '0');
      return na - nb;
    });
  }, [carreraMap, carreraSeleccionada]);
  
  const bloques = useMemo(() => {
    if (!carreraSeleccionada || !semestreSeleccionado || !carreraMap[carreraSeleccionada]) return [];
    return carreraMap[carreraSeleccionada][semestreSeleccionado] || [];
  }, [carreraMap, carreraSeleccionada, semestreSeleccionado]);

  const seleccionadoAcademicoSemana = inicioPeriodo
    ? Math.max(1, Math.min(
      semanasPeriodo,
      obtenerNumeroSemanaAcademica(semanaInicio, inicioPeriodo)
    ))
    : 1;

  // Actualizar cascada cuando cambian filtros
  const cambiarCarreraSeleccionada = (e) => {
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
      if (blks.length > 0) establecerSeleccionadoBloque(blks[0]);
    }
  };

  const cambiarSemestreSeleccionado = (e) => {
    const semestre = e.target.value;
    setSelectedSemestre(semestre);
    const blks = carreraMap[carreraSeleccionada]?.[semestre] || [];
    if (blks.length > 0) establecerSeleccionadoBloque(blks[0]);
  };

  const semanaSesiones = useMemo(
    () => obtenerSesionesSemana(registros, { period: periodoSeleccionado, block: bloqueSeleccionado, weekStart: semanaInicio })
      .filter((sesion) => {
        const inicio = Number(sesion.semana_inicio);
        const fin = Number(sesion.semana_fin);
        return !Number.isFinite(inicio) || !Number.isFinite(fin) ||
          (seleccionadoAcademicoSemana >= inicio && seleccionadoAcademicoSemana <= fin);
      }),
    [registros, periodoSeleccionado, bloqueSeleccionado, semanaInicio, seleccionadoAcademicoSemana]
  );

  // Días de la semana visible + feriados (desde la base de datos).
  const diasSemana = useMemo(() => obtenerDiasSemana(semanaInicio, feriadosMapa), [semanaInicio, feriadosMapa]);
  const occupations = restrictions.ocupaciones;
  const limitesPeriodo = useMemo(() => {
    const minimo = analizarFechaLocal(inicioPeriodo);
    const maximo = analizarFechaLocal(finPeriodo);
    return {
      firstWeek: minimo ? convertirAFechaISO(inicioSemanaLunes(minimo)) : '',
      lastWeek: maximo ? convertirAFechaISO(inicioSemanaLunes(maximo)) : '',
    };
  }, [inicioPeriodo, finPeriodo]);
  const sesionesPorDia = useMemo(() => Object.fromEntries(
    diasSemana.map((diaInformacion) => [
      diaInformacion.day,
      distribuirSesionesPorDia(
        semanaSesiones.filter((sesion) =>
          sesion.dia === diaInformacion.day &&
          (!inicioPeriodo || diaInformacion.iso >= inicioPeriodo) &&
          (!finPeriodo || diaInformacion.iso <= finPeriodo) &&
          estaSesionActivaEnFecha(sesion, diaInformacion.iso)
        )
      )[diaInformacion.day],
    ])
  ), [diasSemana, semanaSesiones, inicioPeriodo, finPeriodo]);
  const gridTimeBounds = useMemo(
    () => obtenerLimitesCuadriculaHorario(horariosOperativos),
    [horariosOperativos]
  );
  const intervalosHorario = useMemo(
    () => crearIntervalosHorario(gridTimeBounds.start, gridTimeBounds.end),
    [gridTimeBounds]
  );
  const feriadosDeLaSemana = useMemo(
    () => diasSemana.filter((diaInformacion) => diaInformacion.isHoliday),
    [diasSemana]
  );
  const validacionesMovimientoPorIntervalo = useMemo(() => {
    if (!sesionArrastrada) return new Map();
    const results = new Map();
    diasSemana.forEach((diaInformacion) => {
      intervalosHorario.forEach((intervalo) => {
        results.set(
          `${diaInformacion.day}|${intervalo.minutes}`,
          obtenerValidacionMovimiento(
            sesionArrastrada,
            diaInformacion.day,
            intervalo.minutes,
            diaInformacion,
            occupations,
            restrictions,
            inicioPeriodo,
            finPeriodo,
            seleccionadoAcademicoSemana,
            gridTimeBounds.configuredStart ?? gridTimeBounds.start,
            gridTimeBounds.configuredEnd ?? gridTimeBounds.end
          )
        );
      });
    });
    return results;
  }, [
    sesionArrastrada,
    diasSemana,
    intervalosHorario,
    gridTimeBounds,
    occupations,
    restrictions,
    inicioPeriodo,
    finPeriodo,
    seleccionadoAcademicoSemana,
  ]);

  const cursos = useMemo(() => {
    const mapa = new Map();
    semanaSesiones.forEach((sesion) => {
      const entry = mapa.get(sesion.mat_cur) ?? {
        mat_cur: sesion.mat_cur,
        name: sesion.nombre_curso || sesion.mat_cur,
        career: sesion.carrera_nombre || null,
        semester: sesion.semestre_num ?? null,
        color: obtenerColorCurso(sesion.mat_cur, sesion.nombre_curso),
        count: 0,
      };
      entry.count += 1;
      mapa.set(sesion.mat_cur, entry);
    });
    return [...mapa.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [semanaSesiones]);

  const totalMinutos = useMemo(
    () => semanaSesiones.reduce((acc, sesion) => {
      const inicio = convertirHoraAMinutos(sesion.hora_ini) ?? 0;
      const fin = convertirHoraAMinutos(sesion.hora_fin) ?? 0;
      return acc + Math.max(0, fin - inicio);
    }, 0),
    [semanaSesiones]
  );

  const iniciarArrastre = (e, sesion) => { //la variable
    if (savingMove) {
      e.preventDefault();
      return;
    }
    if (estadoHorario === 'CONFIRMADO') {
      e.preventDefault();
      setToast('El horario está confirmado; cámbialo a Borrador para mover clases.');
      return;
    }
    if (!sesion.scheduleIds?.length) {
      e.preventDefault();
      setToast('Esta clase no tiene un registro editable en el borrador.');
      return;
    }
    establecerArrastradoSesion(sesion);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', sesion.key);
  };

  const finalizarArrastre = () => {
    establecerArrastradoSesion(null);
    setDragOverSlot(null);
  };

  const arrastrarSobre = (e, dia, intervaloMinutos) => {
    e.preventDefault();
    if (!sesionArrastrada) return;
    const validacion = validacionesMovimientoPorIntervalo.get(`${dia}|${intervaloMinutos}`) ?? {
      valid: false,
      reasons: [{ tipo: 'general', mensaje: 'No se pudo validar este espacio.' }],
      reason: 'No se pudo validar este espacio.',
    };
    setDragOverSlot({
      day: dia,
      slotMinutes: intervaloMinutos,
      valid: validacion.valid,
      reason: validacion.reason,
      reasons: validacion.reasons,
    });
    e.dataTransfer.dropEffect = validacion.valid ? 'move' : 'none';
  };

  const soltarElemento = async (e, dia, intervaloMinutos) => {
    if (generandoBorrador) return;
    e.preventDefault();
    if (!sesionArrastrada || savingMove) return;
    const actualInicio = convertirHoraAMinutos(sesionArrastrada.hora_ini);
    if (sesionArrastrada.dia === dia && actualInicio === intervaloMinutos) {
      finalizarArrastre();
      return;
    }
    const diaInformacion = diasSemana.find((entry) => entry.day === dia);
    const validacion = obtenerValidacionMovimiento(
      sesionArrastrada,
      dia,
      intervaloMinutos,
      diaInformacion,
      occupations,
      restrictions,
      inicioPeriodo,
      finPeriodo,
      seleccionadoAcademicoSemana,
      gridTimeBounds.configuredStart ?? gridTimeBounds.start,
      gridTimeBounds.configuredEnd ?? gridTimeBounds.end
    );
    if (!validacion.valid) {
      setToast(`No se puede mover:\n${formatearAvisoConflicto(validacion.reasons)}`);
      finalizarArrastre();
      return;
    }

    const duracion = convertirHoraAMinutos(sesionArrastrada.hora_fin) - actualInicio;
    const nuevoInicio = formatearHoraHorario(intervaloMinutos);
    const nuevoFin = formatearHoraHorario(intervaloMinutos + duracion);
    const horarioIdentificadores = sesionArrastrada.scheduleIds ?? [];
    const hasMatchingRecords = horarioIdentificadores.length > 0 && registros.some(
      (registro) => horarioIdentificadores.includes(Number(registro.id_horario))
    );
    if (!hasMatchingRecords) {
      setToast('No se pudo mover: no se encontraron los registros originales de la clase.');
      finalizarArrastre();
      return;
    }
    setSavingMove(true);
    try {
      const resultado = await moverSesionesBorrador(
        String(periodoSeleccionado),
        horarioIdentificadores,
        dia,
        nuevoInicio.slice(0, 5),
        borradorSeleccionado
      );
      const identificadores = new Set(
        (resultado?.ids?.length ? resultado.ids : horarioIdentificadores).map(Number)
      );
      const updateMoved = (registro) => identificadores.has(Number(registro.id_horario))
        ? {
          ...registro,
          dia: dia,
          dia_semana: dia,
          hora_ini: nuevoInicio,
          hora_inicio: nuevoInicio,
          hora_fin: nuevoFin,
        }
        : registro;
      establecerRegistros((actualRegistros) => actualRegistros.map(updateMoved));
      setRestrictions((actual) => ({
        ...actual,
        ocupaciones: actual.ocupaciones.map(updateMoved),
      }));
      setToast(
        `Clase movida a ${ETIQUETAS_DIAS[dia]} ${nuevoInicio.slice(0, 5)}–${nuevoFin.slice(0, 5)} en todas las semanas del curso.`
      );
    } catch (error) {
      if (Array.isArray(error.conflictos) && error.conflictos.length) {
        setToast(`No se puede mover:\n${formatearAvisoConflicto(error.conflictos)}`);
      } else {
        setToast(`No se pudo guardar el cambio: ${error.message}`);
      }
    } finally {
      setSavingMove(false);
      finalizarArrastre();
    }
  };

  const getCardDropSlot = (e, sesion) => {
    const bounds = e.currentTarget.getBoundingClientRect();
    const inicio = convertirHoraAMinutos(sesion.hora_ini) ?? PRIMER_MINUTO;
    const fin = convertirHoraAMinutos(sesion.hora_fin) ?? inicio + MINUTOS_INTERVALO;
    const posicion = Math.max(0, Math.min(1, (e.clientY - bounds.top) / bounds.height));
    return Math.floor((inicio + (fin - inicio) * posicion) / MINUTOS_INTERVALO) * MINUTOS_INTERVALO;
  };

  const handleCardDragOver = (e, sesion) => {
    arrastrarSobre(e, sesion.dia, getCardDropSlot(e, sesion));
  };

  const handleCardDrop = (e, sesion) => {
    soltarElemento(e, sesion.dia, getCardDropSlot(e, sesion));
  };

  const cambiarSemana = (offset) => {
    const actual = analizarFechaLocal(semanaInicio);
    if (!actual) return;
    const siguiente = convertirAFechaISO(agregarDias(actual, offset * 7));
    if (
      (limitesPeriodo.firstWeek && siguiente < limitesPeriodo.firstWeek) ||
      (limitesPeriodo.lastWeek && siguiente > limitesPeriodo.lastWeek)
    ) return;
    establecerSemanaInicio(siguiente);
  };

  const seleccionarFecha = (event) => {
    const seleccionado = analizarFechaLocal(event.target.value);
    if (!seleccionado) return;
    if (
      (inicioPeriodo && convertirAFechaISO(seleccionado) < inicioPeriodo) ||
      (finPeriodo && convertirAFechaISO(seleccionado) > finPeriodo)
    ) return;
    establecerSemanaInicio(convertirAFechaISO(inicioSemanaLunes(seleccionado)));
  };

  const irASemanaActual = () => {
    establecerSemanaInicio(obtenerInicioSemanaPredeterminado(registros, inicioPeriodo, finPeriodo));
  };

  const manejarCambioEstadoHorario = async (nuevoEstado) => {
    if (!nuevoEstado || nuevoEstado === estadoHorario || changingState) return;
    setChangingState(true);
    try {
      await cambiarEstadoHorario(
        String(periodoSeleccionado),
        nuevoEstado,
        borradorSeleccionado
      );
      establecerHorarioEstado(nuevoEstado);
      establecerBorradores((actual) =>
        actual.map((borrador) =>
          borrador.id_borrador === Number(borradorSeleccionado)
            ? { ...borrador, estado: nuevoEstado }
            : borrador
        )
      );
      setToast(`Estado del horario actualizado a ${nuevoEstado === 'CONFIRMADO' ? 'Confirmado' : 'Borrador'}.`);
    } catch (error) {
      setToast(`No se pudo cambiar el estado: ${error.message}`);
    } finally {
      setChangingState(false);
    }
  };
  const descargarZipHorarios = async () => {
    if (descargandoZip) return;
    if (!borradorSeleccionado) {
      setToast('Selecciona un borrador antes de descargar el ZIP.');
      return;
    }
    setDescargandoZip(true);
    try {
      const { blob, nombreArchivo } = await descargarHorariosZip(
        String(periodoSeleccionado),
        borradorSeleccionado
      );
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = nombreArchivo;
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setToast('Se descargó el ZIP del borrador actual.');
    } catch (error) {
      setToast(`No se pudo descargar el ZIP: ${error.message}`);
    } finally {
      setDescargandoZip(false);
    }
  };

  const esperarSolver = async (jobId) => {
    while (true) {
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
      const estado = await obtenerEstadoSolver(jobId);
      establecerProgresoSolver(Number(estado?.progreso) || 0);
      establecerTiempoRestanteSolver(Number(estado?.tiempo_restante_seg) || 0);
      establecerHitoSolver(estado?.hito || '');
      establecerLineasSolver(Array.isArray(estado?.lineas) ? estado.lineas : []);
      establecerProgresoGeneracion(
        estado?.estado === 'COMPLETADO'
          ? 'Completado.'
          : estado?.estado === 'CANCELADO'
          ? 'Cancelado.'
          : estado?.error
          ? estado.error
          : estado?.estado === 'EJECUTANDO'
          ? 'Generando horario...'
          : `Estado: ${estado?.estado || 'desconocido'}`
      );

      if (estado?.estado === 'COMPLETADO') return estado;
      if (estado?.estado === 'CANCELADO') {
        throw new Error('La generación fue cancelada.');
      }
      if (estado?.estado === 'ERROR') {
        throw new Error(estado.error || 'El solver terminó con error.');
      }
    }
  };

  const generarOtroBorrador = async () => {
    if (generandoBorrador) return;
    establecerGenerandoBorrador(true);
    establecerProgresoGeneracion('Iniciando solver...');
    try {
      const job = await generarBorradorPeriodo(String(periodoSeleccionado));
      if (!job?.jobId) {
        throw new Error('No se recibió el identificador de la ejecución.');
      }
      establecerProgresoGeneracion('Generando horario...');
      const resultado = await esperarSolver(job.jobId);
      const idBorrador = Number(resultado.id_borrador);
      await cargarBorradores({ seleccionar: idBorrador });
      if (idBorrador) establecerBorradorSeleccionado(idBorrador);
      setToast('Se generó un nuevo borrador del periodo.');
    } catch (error) {
      setToast(`No se pudo generar el borrador: ${error.message}`);
      try {
        const lista = await cargarBorradores();
        establecerBorradorSeleccionado(lista?.[0]?.id_borrador ?? null);
      } catch {
        // Ignorar errores secundarios al recargar la lista.
      }
    } finally {
      establecerGenerandoBorrador(false);
      establecerCancelandoGeneracion(false);
      establecerProgresoGeneracion('');
      establecerProgresoSolver(0);
      establecerTiempoRestanteSolver(0);
      establecerHitoSolver('');
      establecerLineasSolver([]);
    }
  };

  const cancelarGeneracion = async () => {
    if (!generandoBorrador || cancelandoGeneracion) return;
    establecerCancelandoGeneracion(true);
    try {
      await cancelarSolver();
      setToast('Cancelación solicitada.');
    } catch (error) {
      setToast(`No se pudo cancelar: ${error.message}`);
    } finally {
      establecerCancelandoGeneracion(false);
    }
  };

  const aulaEstaOcupada = (aulaId, sesion, occupations, ids) => {
    const idsSet = new Set((ids || []).map(Number));
    return (occupations || []).some((ocupacion) => {
      if (Number(ocupacion.id_ambiente) !== Number(aulaId)) return false;
      if (String(ocupacion.dia ?? '').toUpperCase() !== String(sesion.dia ?? '').toUpperCase()) {
        return false;
      }
      const inicioActual = convertirHoraAMinutos(sesion.hora_ini);
      const finActual = convertirHoraAMinutos(sesion.hora_fin);
      const inicioOtro = convertirHoraAMinutos(ocupacion.hora_ini);
      const finOtro = convertirHoraAMinutos(ocupacion.hora_fin);
      if (inicioActual === null || finActual === null || inicioOtro === null || finOtro === null) {
        return false;
      }
      if (!(inicioActual < finOtro && finActual > inicioOtro)) return false;

      const semInicioActual = Number(sesion.semana_inicio);
      const semFinActual = Number(sesion.semana_fin);
      const semInicioOtro = Number(ocupacion.semana_inicio);
      const semFinOtro = Number(ocupacion.semana_fin);
      if (!(semInicioActual <= semFinOtro && semFinActual >= semInicioOtro)) {
        return false;
      }

      return !idsSet.has(Number(ocupacion.id_horario));
    });
  };

  const abrirModalAula = async (sesion) => {
    if (generandoBorrador || !borradorSeleccionado) return;
    if (!sesion?.id_ambiente || !sesion?.id_sede) {
      setToast('Este bloque no usa un aula asignada.');
      return;
    }
    try {
      const aulas = await obtenerAulasPorSede(sesion.id_sede);
      if (!aulas.some((aula) => aula.id === Number(sesion.id_ambiente))) {
        setToast('Este bloque usa un laboratorio; no se puede cambiar el aula.');
        return;
      }
      const ids = sesion.scheduleIds?.length
        ? sesion.scheduleIds
        : [sesion.id_horario];
      const aulasConEstado = aulas.map((aula) => ({
        ...aula,
        disponible: !aulaEstaOcupada(aula.id, sesion, restrictions.ocupaciones, ids),
      }));
      establecerAulaModal({
        sesion,
        aulas: aulasConEstado,
        seleccionada: Number(sesion.id_ambiente),
        guardando: false,
      });
    } catch (error) {
      setToast(`No se pudieron cargar las aulas: ${error.message}`);
    }
  };

  const confirmarCambioAula = async () => {
    if (!aulaModal) return;
    const { sesion, seleccionada } = aulaModal;
    const ids = sesion.scheduleIds?.length ? sesion.scheduleIds : [sesion.id_horario];
    establecerAulaModal((actual) => (actual ? { ...actual, guardando: true } : actual));
    try {
      await cambiarAulaHorario(
        String(periodoSeleccionado),
        ids,
        seleccionada,
        borradorSeleccionado
      );
      establecerAulaModal(null);
      const nuevaAula = aulaModal.aulas.find((aula) => aula.id === Number(seleccionada));
      const codigo = nuevaAula?.codigo_ambiente ?? sesion.ambiente;
      const update = (registro) =>
        ids.includes(Number(registro.id_horario))
          ? { ...registro, id_ambiente: seleccionada, ambiente: codigo }
          : registro;
      establecerRegistros((actual) => actual.map(update));
      setRestrictions((actual) => ({
        ...actual,
        ocupaciones: actual.ocupaciones.map(update),
      }));
      setToast('Aula actualizada.');
    } catch (error) {
      setToast(`No se pudo cambiar el aula: ${error.message}`);
      establecerAulaModal((actual) => (actual ? { ...actual, guardando: false } : actual));
    }
  };

  const solicitarEliminacionBorrador = (borrador) => {
    if (!borrador || generandoBorrador || eliminandoBorrador) return;
    if (borrador.estado === 'CONFIRMADO') {
      setToast('No se puede eliminar un borrador confirmado.');
      return;
    }
    establecerBorradorPendienteEliminacion(borrador);
  };

  const confirmarEliminacionBorrador = async () => {
    const borrador = borradorPendienteEliminacion;
    if (!borrador) return;
    establecerBorradorPendienteEliminacion(null);
    establecerEliminandoBorrador(borrador.id_borrador);
    try {
      await eliminarBorradorPeriodo(
        String(periodoSeleccionado),
        borrador.id_borrador
      );
      const eraActual = borrador.id_borrador === Number(borradorSeleccionado);
      const lista = await cargarBorradores();
      if (eraActual) {
        const siguiente = lista?.[0]?.id_borrador ?? null;
        establecerBorradorSeleccionado(siguiente);
      }
      setToast('Borrador eliminado.');
    } catch (error) {
      setToast(`No se pudo eliminar el borrador: ${error.message}`);
    } finally {
      establecerEliminandoBorrador(null);
    }
  };

  const hoyISO = convertirAFechaISO(new Date());
  const inicioSemanaVisible = analizarFechaLocal(semanaInicio);
  const finSemanaVisible = inicioSemanaVisible
    ? convertirAFechaISO(agregarDias(inicioSemanaVisible, 6))
    : '';
  const hoyEstaEnSemanaVisible = Boolean(
    hoyISO && semanaInicio && finSemanaVisible &&
    hoyISO >= semanaInicio && hoyISO <= finSemanaVisible
  );
  const hoyEstaDentroDelPeriodo = Boolean(
    (!inicioPeriodo || hoyISO >= inicioPeriodo) &&
    (!finPeriodo || hoyISO <= finPeriodo)
  );
  const datePickerValue = hoyEstaEnSemanaVisible && hoyEstaDentroDelPeriodo
    ? hoyISO
    : limitesPeriodo.firstWeek && semanaInicio === limitesPeriodo.firstWeek && inicioPeriodo
      ? inicioPeriodo
      : limitesPeriodo.lastWeek && semanaInicio === limitesPeriodo.lastWeek && finPeriodo
        ? finPeriodo
        : semanaInicio;

  return (
    <div className="weekly-schedule-page">
      <aside className="schedule-drafts-sidebar" aria-label="Borradores del periodo">
        <div className="drafts-sidebar__header">
          <div>
            <span className="drafts-sidebar__kicker">Periodo {periodoSeleccionado}</span>
            <h2>Borradores</h2>
          </div>
          <button
            type="button"
            className="drafts-new-button"
            onClick={generandoBorrador ? cancelarGeneracion : generarOtroBorrador}
            disabled={cancelandoGeneracion}
            title={generandoBorrador ? 'Cancelar generación' : 'Generar un nuevo borrador del mismo periodo'}
          >
            <i
              className={
                cancelandoGeneracion
                  ? 'fas fa-spinner fa-spin'
                  : generandoBorrador
                  ? 'fas fa-stop'
                  : 'fas fa-plus'
              }
              aria-hidden="true"
            />
            {cancelandoGeneracion
              ? 'Cancelando...'
              : generandoBorrador
              ? 'Cancelar'
              : 'Nuevo'}
          </button>
        </div>

        {generandoBorrador && (
          <div className="drafts-progress" role="status">
            <i className="fas fa-spinner fa-spin" aria-hidden="true" />
            <span>{progresoGeneracion || 'Generando borrador...'}</span>
            <div className="solver-progress">
              <div
                className="solver-progress__bar"
                style={{ width: `${progresoSolver}%` }}
              />
            </div>
            <span className="solver-progress__time">
              Tiempo restante: {Math.floor(tiempoRestanteSolver / 60)} min{' '}
              {Math.round(tiempoRestanteSolver % 60)} s
            </span>
            {hitoSolver && (
              <span className="solver-progress__hito">{hitoSolver}</span>
            )}
          </div>
        )}

        {generandoBorrador && (
          <div className="solver-steps" role="status">
            {[
              { clave: 'INICIANDO', texto: 'Conectando a la base de datos' },
              { clave: 'VALIDANDO', texto: 'Validando la oferta académica' },
              { clave: 'RESOLVIENDO', texto: 'Resolviendo el horario' },
              { clave: 'GUARDANDO', texto: 'Guardando el borrador' },
            ].map((paso) => {
              const hitoActual = hitoSolver || 'INICIANDO';
              const orden = ['INICIANDO', 'VALIDANDO', 'RESOLVIENDO', 'GUARDANDO'];
              const indiceActual = orden.indexOf(hitoActual === 'EJECUTANDO' ? 'RESOLVIENDO' : hitoActual);
              const indicePaso = orden.indexOf(paso.clave);
              const estadoPaso =
                indicePaso < indiceActual
                  ? 'done'
                  : indicePaso === indiceActual
                  ? 'active'
                  : 'pending';
              return (
                <div
                  key={paso.clave}
                  className={`solver-step solver-step--${estadoPaso}`}
                >
                  <span className="solver-step__icon">
                    {estadoPaso === 'done' ? '✓' : estadoPaso === 'active' ? '●' : '○'}
                  </span>
                  <span>{paso.texto}</span>
                </div>
              );
            })}
          </div>
        )}

        {generandoBorrador && lineasSolver.length > 0 && (
          <details className="solver-log">
            <summary>Ver detalles técnicos</summary>
            <pre>{lineasSolver.join('\\n')}</pre>
          </details>
        )}

        {cargandoBorradores ? (
          <div className="drafts-empty">
            <i className="fas fa-spinner fa-spin" aria-hidden="true" />
            <span>Cargando borradores...</span>
          </div>
        ) : borradores.length === 0 ? (
          <div className="drafts-empty">
            <i className="far fa-folder-open" aria-hidden="true" />
            <span>No hay borradores. Genera el primero.</span>
          </div>
        ) : (
          <ul className="drafts-list">
            {borradores.map((borrador) => {
              const activo = borrador.id_borrador === Number(borradorSeleccionado);
              const eliminando = eliminandoBorrador === borrador.id_borrador;
              return (
                <li
                  key={borrador.id_borrador}
                  className={`draft-item ${activo ? 'is-active' : ''}`}
                >
                  <button
                    type="button"
                    className="draft-item__select"
                    onClick={() => establecerBorradorSeleccionado(borrador.id_borrador)}
                  >
                    <span className="draft-item__name">{borrador.nombre}</span>
                    <span className="draft-item__meta">
                      {Number(borrador.total) || 0} bloques · {borrador.estado}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="draft-item__delete"
                    onClick={() => solicitarEliminacionBorrador(borrador)}
                    disabled={
                      generandoBorrador ||
                      eliminando ||
                      borrador.estado === 'CONFIRMADO'
                    }
                    title={
                      borrador.estado === 'CONFIRMADO'
                        ? 'No se puede eliminar un borrador confirmado'
                        : 'Eliminar borrador'
                    }
                  >
                    <i
                      className={
                        eliminando
                          ? 'fas fa-spinner fa-spin'
                          : 'fas fa-trash-alt'
                      }
                      aria-hidden="true"
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="drafts-sidebar__hint">
          El ZIP descarga solo el borrador seleccionado.
        </p>

        {(sesionArrastrada && intervaloArrastre) || toast ? (
          <section className="drafts-alerts" aria-label="Avisos" aria-live="polite">
            <h3 className="drafts-alerts__title">
              <i className="fas fa-bell" aria-hidden="true" />
              Avisos
            </h3>

            {sesionArrastrada && intervaloArrastre && (
              <article
                className={[
                  'drafts-alert',
                  intervaloArrastre.valid ? 'drafts-alert--success' : 'drafts-alert--danger',
                ].join(' ')}
                role="status"
              >
                <header className="drafts-alert__header">
                  <i
                    className={intervaloArrastre.valid ? 'fas fa-check-circle' : 'fas fa-exclamation-triangle'}
                    aria-hidden="true"
                  />
                  <span>{intervaloArrastre.valid ? 'Espacio disponible' : 'No disponible'}</span>
                </header>
                <p className="drafts-alert__when">
                  {ETIQUETAS_DIAS[intervaloArrastre.day]} · {formatearHora(formatearHoraHorario(intervaloArrastre.slotMinutes))}
                </p>
                {intervaloArrastre.reasons?.length ? (
                  <ul className="drafts-alert__list">
                    {intervaloArrastre.reasons.map((motivo, indice) => (
                      <li key={`${motivo.tipo || 'motivo'}-${indice}`}>{motivo.mensaje}</li>
                    ))}
                  </ul>
                ) : intervaloArrastre.reason ? (
                  <p className="drafts-alert__reason">{intervaloArrastre.reason}</p>
                ) : null}
              </article>
            )}

            {toast && (
              <article className="drafts-alert drafts-alert--danger" role="status">
                <header className="drafts-alert__header">
                  <i className="fas fa-exclamation-circle" aria-hidden="true" />
                  <span>Aviso</span>
                  <button
                    type="button"
                    className="drafts-alert__close"
                    aria-label="Cerrar notificación"
                    onClick={() => setToast('')}
                  >
                    ×
                  </button>
                </header>
                <p className="drafts-alert__reason">{toast}</p>
              </article>
            )}
          </section>
        ) : null}
      </aside>

      <div className="weekly-schedule-container">
      <header className="schedule-header">
        <div>
          <h1 className="schedule-title">
            <i className="far fa-calendar-alt" aria-hidden="true" /> Cuadrícula Semanal de Horarios
          </h1>
        </div>

        <div className="schedule-summary">
          <button
            type="button"
            className="generate-draft-button"
            onClick={generandoBorrador ? cancelarGeneracion : generarOtroBorrador}
            disabled={cancelandoGeneracion}
            title={generandoBorrador ? 'Cancelar generación' : 'Generar otro borrador del mismo periodo'}
          >
            <i
              className={
                cancelandoGeneracion
                  ? 'fas fa-spinner fa-spin'
                  : generandoBorrador
                  ? 'fas fa-stop'
                  : 'fas fa-plus'
              }
              aria-hidden="true"
            />
            {cancelandoGeneracion
              ? 'Cancelando...'
              : generandoBorrador
              ? 'Cancelar'
              : 'Generar borrador'}
          </button>
          <button
            type="button"
            className="export-schedule-button"
            onClick={descargarZipHorarios}
            disabled={descargandoZip || generandoBorrador || !borradorSeleccionado}
            title="Descargar el ZIP del borrador actual"
          >
            <i className={descargandoZip ? 'fas fa-spinner fa-spin' : 'fas fa-file-archive'} aria-hidden="true" />
            {descargandoZip ? 'Generando ZIP…' : 'Descargar ZIP'}
          </button>
          <div className="schedule-state" role="group" aria-label="Estado del horario">
            <button
              type="button"
              className={`state-button ${estadoHorario === 'BORRADOR' ? 'is-active' : ''}`}
              onClick={() => manejarCambioEstadoHorario('BORRADOR')}
              disabled={changingState || generandoBorrador}
            >
              Borrador
            </button>
            <button
              type="button"
              className={`state-button ${estadoHorario === 'CONFIRMADO' ? 'is-active' : ''}`}
              onClick={() => manejarCambioEstadoHorario('CONFIRMADO')}
              disabled={changingState || generandoBorrador}
            >
              Confirmado
            </button>
          </div>
          <div className="summary-chip">
            <span className="summary-chip__value">{semanaSesiones.length}</span>
            <span className="summary-chip__label">sesiones</span>
          </div>
          <div className="summary-chip">
            <span className="summary-chip__value">{cursos.length}</span>
            <span className="summary-chip__label">cursos</span>
          </div>
          <div className="summary-chip">
            <span className="summary-chip__value">{(totalMinutos/60).toLocaleString('es-PE',{maximumFractionDigits:1})}</span>
            <span className="summary-chip__label">horas</span>
          </div>
        </div>
      </header>

      {/* COMBOBOXES EN CADENA */}
      <div className="schedule-toolbar">
        <div className="toolbar-group">
          <label className="toolbar-field toolbar-field--wide" htmlFor="carrera-select">
            <span>1. Seleccionar Carrera</span>
            <select id="carrera-select" value={carreraSeleccionada} onChange={cambiarCarreraSeleccionada}>
              {carreras.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
          </label>

          <label className="toolbar-field" htmlFor="semestre-select">
            <span>2. Seleccionar Semestre</span>
            <select id="semestre-select" value={semestreSeleccionado} onChange={cambiarSemestreSeleccionado}>
              {semestres.map((s) => (<option key={s} value={s}>{s}</option>))}
            </select>
          </label>

          <label className="toolbar-field" htmlFor="bloque-select">
            <span>3. Seleccionar Bloque</span>
            <select id="bloque-select" value={bloqueSeleccionado} onChange={(e) => establecerSeleccionadoBloque(e.target.value)}>
              {bloques.map((b) => (<option key={b} value={b}>{b}</option>))}
            </select>
          </label>

        </div>

        <div className="week-navigator">
          <button
            type="button"
            className="nav-button"
            onClick={() => cambiarSemana(-1)}
            aria-label="Semana anterior"
            disabled={Boolean(limitesPeriodo.firstWeek && semanaInicio <= limitesPeriodo.firstWeek)}
          >
            <i className="fas fa-chevron-left" />
          </button>
          <div className="week-navigator__center">
            <span className="week-label">
              Semana {seleccionadoAcademicoSemana}
            </span>
            <span className="week-label">
              {formatearRangoSemana(semanaInicio)}
            </span>
            <input
              type="date"
              className="week-date-input"
              value={datePickerValue}
              min={inicioPeriodo || undefined}
              max={finPeriodo || undefined}
              onChange={seleccionarFecha}
              aria-label="Elegir una fecha del periodo"
            />
          </div>
          <button
            type="button"
            className="nav-button"
            onClick={() => cambiarSemana(1)}
            aria-label="Semana siguiente"
            disabled={Boolean(limitesPeriodo.lastWeek && semanaInicio >= limitesPeriodo.lastWeek)}
          >
            <i className="fas fa-chevron-right" />
          </button>
          <button type="button" className="today-button" onClick={irASemanaActual}>Hoy</button>
        </div>
      </div>

      {cargando && (
        <div className="schedule-empty-banner" role="status">
          <i className="fas fa-spinner" aria-hidden="true" />
          <div><strong>Cargando horario borrador.</strong><span>Consultando el periodo {periodoSeleccionado}.</span></div>
        </div>
      )}

      {!cargando && cargarError && (
        <div className="schedule-empty-banner" role="alert">
          <i className="fas fa-exclamation-circle" aria-hidden="true" />
          <div><strong>No se pudo cargar el horario.</strong><span>{cargarError}</span></div>
        </div>
      )}

      {!cargando && !cargarError && semanaSesiones.length === 0 && (
        <div className="schedule-empty-banner">
          <i className="far fa-calendar-times" />
          <div><strong>Sin sesiones para esta semana lectiva.</strong><span>{feriadosDeLaSemana.length ? `${feriadosDeLaSemana.map((h) => `Feriado: ${h.holiday.mes} ${h.holiday.dia}`).join(' · ')} • ` : ''}Prueba otra semana o selecciona otra cohorte.</span></div>
        </div>
      )}

      <div className="schedule-grid-wrapper">
        {savingMove && (
          <div className="schedule-saving" role="status" aria-live="polite">
            Guardando el cambio de horario…
          </div>
        )}
        <div className="schedule-grid" style={{ gridTemplateColumns: `68px repeat(7, minmax(148px, 1fr))`, gridTemplateRows: `48px repeat(${intervalosHorario.length}, ${ALTURA_INTERVALO}px)` }}>
          <div className="grid-corner" style={{ gridRow: 1, gridColumn: 1 }}>
            <span className="corner-pc">DE</span>
            <span className="corner-a">A</span>
          </div>
          {diasSemana.map((diaInformacion, indice) => (
            <div
              key={diaInformacion.day}
              className={[
                'grid-day-header',
                diaInformacion.day === 'DOMINGO' ? 'is-sunday' : '',
                diaInformacion.isHoliday ? 'is-holiday' : '',
              ].filter(Boolean).join(' ')}
              style={{ gridRow: 1, gridColumn: indice + 2 }}
              title={diaInformacion.isHoliday ? `Feriado: ${diaInformacion.holiday.mes} ${diaInformacion.holiday.dia}` : `${ETIQUETAS_DIAS[diaInformacion.day]} ${diaInformacion.label}`}
            >
              <span className="grid-day-header__long">
                {ETIQUETAS_DIAS[diaInformacion.day]}
                {diaInformacion.isHoliday ? <span className="holiday-badge">FERIADO</span> : null}
              </span>
              <span className="grid-day-header__short">
                {diaInformacion.day.slice(0, 3)}
                {diaInformacion.isHoliday ? ' • F' : ''}
              </span>
              <span className="grid-day-header__date">{diaInformacion.label}</span>
            </div>
          ))}

          {intervalosHorario.map((intervalo, indice) => (
            <React.Fragment key={intervalo.minutes}>
              <div className="grid-time time-15" style={{ gridRow: indice + 2, gridColumn: 1 }}>
                <span className="time-pc">{intervalo.label}</span>
                <span className="time-a">{intervalo.endLabel}</span>
              </div>
              {diasSemana.map((diaInformacion, diaIndice) => {
                const esFeriado = diaInformacion.isHoliday;
                const validacion = validacionesMovimientoPorIntervalo.get(`${diaInformacion.day}|${intervalo.minutes}`);
                const fueraDelPeriodo = Boolean(
                  (inicioPeriodo && diaInformacion.iso < inicioPeriodo) ||
                  (finPeriodo && diaInformacion.iso > finPeriodo)
                );
                return (
                  <div
                    key={`${diaInformacion.day}-${intervalo.minutes}`}
                    className={[
                      'grid-slot',
                      intervalo.isHour ? 'is-hour' : '',
                      diaInformacion.day === 'DOMINGO' ? 'is-sunday' : '',
                      esFeriado ? 'is-holiday' : '',
                      fueraDelPeriodo ? 'is-outside-period' : '',
                      sesionArrastrada ? 'drag-active' : '',
                      sesionArrastrada ? (validacion?.valid ? 'slot-valid' : 'slot-invalid') : '',
                      intervaloArrastre?.day === diaInformacion.day && intervaloArrastre?.slotMinutes === intervalo.minutes ? 'is-drop-target' : '',
                    ].filter(Boolean).join(' ')}
                    style={{ gridRow: indice + 2, gridColumn: diaIndice + 2 }}
                    data-day={diaInformacion.day}
                    data-slot-minutes={intervalo.minutes}
                    title={esFeriado
                      ? `Día feriado - ${diaInformacion.holiday.mes} ${diaInformacion.holiday.dia} • Sin clases`
                      : fueraDelPeriodo
                        ? 'Fuera de los límites del periodo.'
                      : sesionArrastrada && validacion && !validacion.valid
                        ? validacion.reason
                        : undefined}
                    onDragOver={(e) => arrastrarSobre(e, diaInformacion.day, intervalo.minutes)}
                    onDrop={(e) => soltarElemento(e, diaInformacion.day, intervalo.minutes)}
                  />
                );
              })}
            </React.Fragment>
          ))}

          {diasSemana.map((diaInformacion, diaIndice) => {
            if (diaInformacion.isHoliday) {
              return (
                <div
                  key={`holiday-overlay-${diaInformacion.day}`}
                  className="holiday-overlay"
                  style={{ gridRow: `2 / span ${intervalosHorario.length}`, gridColumn: diaIndice + 2 }}
                  title={`Día feriado - ${diaInformacion.holiday.mes} ${diaInformacion.holiday.dia}`}
                >
                  <div className="holiday-overlay__content">
                    <span className="holiday-overlay__title">FERIADO</span>
                    <span className="holiday-overlay__subtitle">{diaInformacion.holiday.mes} {diaInformacion.holiday.dia} • No hay clases</span>
                  </div>
                </div>
              );
            }
            return (sesionesPorDia[diaInformacion.day] ?? []).map((sesion) => (
              <TarjetaClase
                key={`${diaInformacion.day}-${sesion.key}`}
                sesion={sesion}
                diaIndice={diaIndice}
                primerMinuto={gridTimeBounds.start}
                onDragStart={iniciarArrastre}
                onDragEnd={finalizarArrastre}
                onDragOver={handleCardDragOver}
                onDrop={handleCardDrop}
                onDoubleClick={() => abrirModalAula(sesion)}
                estaArrastrando={sesionArrastrada?.key === sesion.key}
                estaSobre={intervaloArrastre?.day === diaInformacion.day}
                movimientoValido={intervaloArrastre?.valid}
              />
            ));
          })}

          {diasSemana.map((diaInformacion, diaIndice) => {
            if (diaInformacion.isHoliday) return null;
            return obtenerIntervalosReceso(sesionesPorDia[diaInformacion.day] ?? []).map((recesoIntervalo) => {
              const posicion = obtenerPosicionCuadriculaReceso(recesoIntervalo, gridTimeBounds.start);
              return (
                <div
                  key={`break-${diaInformacion.day}-${recesoIntervalo.startMin}`}
                  className={`schedule-break ${posicion.span > 1 ? 'is-tall' : ''}`}
                  style={{ gridRow: posicion.gridRow, gridColumn: diaIndice + 2 }}
                  title={`Receso (${recesoIntervalo.minutes} min)`}
                >
                  <span>Receso ({recesoIntervalo.minutes} min)</span>
                </div>
              );
            });
          })}
        </div>
      </div>

      <footer className="schedule-legend">
        <section className="legend-block">
          <h2 className="legend-title">Cursos en la semana</h2>
          {cursos.length > 0 ? (
            <div className="legend-items">
              {cursos.map((curso) => (
                <span key={curso.mat_cur} className="legend-course" title={curso.name}>
                  <span className="legend-swatch" style={{ background: curso.color.bg, borderColor: curso.color.border }} />
                  <strong>{curso.name}</strong>
                  <span className="legend-course-code">{curso.mat_cur}</span>
                  {curso.career && <span className="legend-course-meta">{curso.career} · S{curso.semester ?? '—'}</span>}
                  <span className="legend-count">{curso.count}</span>
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
    {borradorPendienteEliminacion && (
      <div className="delete-modal-overlay" role="dialog" aria-modal="true">
        <div className="delete-modal">
          <h3>Eliminar borrador</h3>
          <p>
            ¿Eliminar <strong>{borradorPendienteEliminacion.nombre}</strong>? Esta
            acción no se puede deshacer.
          </p>
          <div className="delete-modal__actions">
            <button
              type="button"
              className="delete-modal__cancel"
              onClick={() => establecerBorradorPendienteEliminacion(null)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="delete-modal__confirm"
              onClick={confirmarEliminacionBorrador}
            >
              Eliminar
            </button>
          </div>
        </div>
      </div>
    )}

    {aulaModal && (
      <div className="delete-modal-overlay" role="dialog" aria-modal="true">
        <div className="delete-modal">
          <h3>Cambiar aula</h3>
          <p>
            Selecciona el aula para{' '}
            <strong>{aulaModal.sesion.nombre_curso || aulaModal.sesion.mat_cur}</strong>.
          </p>
          <select
            value={aulaModal.seleccionada}
            onChange={(e) =>
              establecerAulaModal((actual) =>
                actual ? { ...actual, seleccionada: Number(e.target.value) } : actual
              )
            }
            style={{ width: '100%', padding: '8px', marginBottom: '16px' }}
          >
            {aulaModal.aulas.map((aula) => (
              <option
                key={aula.id}
                value={aula.id}
                disabled={!aula.disponible}
                style={{ color: aula.disponible ? undefined : '#dc2626' }}
              >
                {aula.codigo_ambiente}
                {aula.disponible ? '' : ' (ocupada)'}
              </option>
            ))}
          </select>
          <div className="delete-modal__actions">
            <button
              type="button"
              className="delete-modal__cancel"
              onClick={() => establecerAulaModal(null)}
              disabled={aulaModal.guardando}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="delete-modal__confirm"
              onClick={confirmarCambioAula}
              disabled={
                aulaModal.guardando ||
                !aulaModal.aulas.find((aula) => aula.id === aulaModal.seleccionada)
                  ?.disponible
              }
            >
              {aulaModal.guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    )}
    </div>
  );
}

export default CuadriculaSemanalHorarios;
