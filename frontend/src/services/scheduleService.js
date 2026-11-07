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

function normalizarPeriodo(valor) {
  const digits = String(valor ?? '202620').replace(/\D/g, '');
  return digits ? Number(digits) : 202620;
}

export const DIAS = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO'];

export function obtenerClaveSesionHorario(fila) {
  return [
    fila.periodo,
    fila.bloque,
    fila.dia,
    fila.hora_ini,
    fila.hora_fin,
    fila.mat_cur,
    fila.actividad,
    fila.tipo_reunion,
    fila.edificio,
    fila.salon,
    fila.instructor,
    fila.semana_inicio ?? '',
    fila.semana_fin ?? '',
  ].join('|');
}

/** Whether a class's active date ranges include the specific calendar day. */
export function estaSesionActivaEnFecha(sesion, fecha) {
  if (!fecha || !sesion.ranges?.length) return true;
  return sesion.ranges.some((rango) =>
    (!rango.start || rango.start <= fecha) &&
    (!rango.end || rango.end >= fecha)
  );
}

export function noTieneDocenteAsignado(fila) {
  return String(fila?.edificio ?? '').trim().toUpperCase() === 'SV-EV' ||
    String(fila?.tipo_reunion ?? '').trim().toUpperCase() === 'VAEE';
}

/* ============================================================================
 * Feriados (desde la base de datos vía GET /api/feriados)
 * ========================================================================== */

const MESES = [
  'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE',
];

/** Descarga los feriados desde la base de datos. */
export async function obtenerFeriados(opciones = {}) {
  const respuesta = await authFetch(`${API_BASE_URL}/api/feriados`, opciones);
  if (!respuesta.ok) return [];
  return respuesta.json();
}

/**
 * Convierte las filas de `feriados` de la BD en un Map "MM-DD" -> info.
 * La BD expone `fecha` como "YYYY-MM-DD".
 */
export function construirMapaFeriados(feriados = []) {
  const mapa = new Map();
  feriados.forEach((feriado) => {
    const fecha = String(feriado?.fecha ?? '');
    const partes = fecha.split('-').map(Number);
    if (partes.length < 3 || !partes[1] || !partes[2]) return;
    const mes = partes[1];
    const dia = partes[2];
    const mmdd = `${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    mapa.set(mmdd, {
      mes: MESES[mes - 1] ?? String(mes),
      dia,
      fecha_formatted: mmdd,
    });
  });
  return mapa;
}

/** Normaliza Date / "YYYY-MM-DD" / "MM-DD" a "MM-DD". */
function obtenerMesDia(valor) {
  if (!valor) return null;
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return `${String(valor.getMonth() + 1).padStart(2, '0')}-${String(valor.getDate()).padStart(2, '0')}`;
  }
  const match = String(valor).match(/(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : null;
}

export const ETIQUETAS_DIAS = {
  LUNES: 'Lunes',
  MARTES: 'Martes',
  MIERCOLES: 'Miércoles',
  JUEVES: 'Jueves',
  VIERNES: 'Viernes',
  SABADO: 'Sábado',
  DOMINGO: 'Domingo',
};

export const ETIQUETAS_ACTIVIDAD = {
  TEC: 'Teoría',
  TAL: 'Taller',
  ACT: 'Actividad',
  EMP: 'Empresa',
};

export const ETIQUETAS_REUNION = {
  CLAS: 'Con docente',
  VAEE: 'Virtual / sin docente',
  REMT: 'Remota',
};

const PALETA_COLORES_CURSO = [
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

function normalizarNombreCurso(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function obtenerEntradaColorCurso(valor) {
  const clave = normalizarNombreCurso(valor);
  let huella = 0;
  for (let indice = 0; indice < clave.length; indice += 1) {
    huella = clave.charCodeAt(indice) + ((huella << 5) - huella);
  }
  return PALETA_COLORES_CURSO[Math.abs(huella) % PALETA_COLORES_CURSO.length];
}

function normalizarRegistroHorarioBorrador(registro) {
  const dia = String(registro?.dia ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  const modalidad = String(registro?.tipo_modalidad ?? '').toUpperCase();

  return {
    ...registro,
    periodo: normalizarPeriodo(registro?.periodo),
    bloque: registro?.codigo_cohorte,
    cohorte: registro?.cohorte,
    carrera_codigo: registro?.codigo_carrera,
    carrera_nombre: registro?.nombre_carrera,
    semestre_num: Number(registro?.semestre_num) || null,
    mat_cur: registro?.codigo_curso ?? '',
    nombre_curso: registro?.nombre_curso ?? '',
    actividad: modalidad,
    tipo_reunion: modalidad === 'VIR' ? 'VAEE' : modalidad === 'EMP' ? 'EMP' : 'CLAS',
    dia,
    hora_ini: registro?.hora_inicio ?? '',
    hora_fin: registro?.hora_fin ?? '',
    instructor: registro?.docente ?? null,
    ambiente: registro?.ambiente ?? null,
    semana_inicio: Number(registro?.semana_inicio),
    semana_fin: Number(registro?.semana_fin),
  };
}

export async function obtenerHorarioBorrador(periodo = '202620', opciones = {}) {
  const respuesta = await authFetch(
    `${API_BASE_URL}/api/horarios/borradores?periodo=${encodeURIComponent(periodo)}`,
    opciones
  );
  const resultado = await respuesta.json();
  if (!respuesta.ok || !resultado?.success) {
    throw new Error(resultado?.message || 'No se pudo cargar el horario borrador.');
  }

  return {
    periodo: resultado.data.codigo,
    estado: resultado.data.estado,
    semanas: Number(resultado.data.semanas) || 18,
    fechaInicio: resultado.data.fecha_inicio ?? null,
    fechaFin: resultado.data.fecha_fin ?? null,
    franja: resultado.data.franja ?? null,
    restricciones: {
      ocupaciones: Array.isArray(resultado.data.restricciones?.ocupaciones)
        ? resultado.data.restricciones.ocupaciones.map(normalizarRegistroHorarioBorrador)
        : [],
      disponibilidadDocentes: Array.isArray(resultado.data.restricciones?.disponibilidad_docentes)
        ? resultado.data.restricciones.disponibilidad_docentes
        : [],
      docentes: Array.isArray(resultado.data.restricciones?.docentes)
        ? resultado.data.restricciones.docentes
        : [],
      ambientes: Array.isArray(resultado.data.restricciones?.ambientes)
        ? resultado.data.restricciones.ambientes
        : [],
    },
    bloques: Array.isArray(resultado.data.bloques)
      ? resultado.data.bloques.map(normalizarRegistroHorarioBorrador)
      : [],
  };
}

export async function moverSesionesBorrador(periodo, identificadores, dia, inicioTiempo, opciones = {}) {
  const respuesta = await authFetch(
    `${API_BASE_URL}/api/horarios/borradores/${encodeURIComponent(periodo)}/mover`,
    {
      ...opciones,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...opciones.headers,
      },
      body: JSON.stringify({ ids: identificadores, dia: dia, hora_inicio: inicioTiempo }),
    }
  );
  const resultado = await respuesta.json();
  if (!respuesta.ok || !resultado?.success) {
    const error = new Error(resultado?.message || 'No se pudo guardar el cambio de horario.');
    error.conflictos = Array.isArray(resultado?.conflictos) ? resultado.conflictos : [];
    throw error;
  }
  return resultado.data;
}

export async function cambiarEstadoHorario(periodo, estado, opciones = {}) {
  const respuesta = await authFetch(
    `${API_BASE_URL}/api/horarios/borradores/${encodeURIComponent(periodo)}/estado`,
    {
      ...opciones,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...opciones.headers,
      },
      body: JSON.stringify({ estado }),
    }
  );
  const resultado = await respuesta.json();
  if (!respuesta.ok || !resultado?.success) {
    throw new Error(resultado?.message || 'No se pudo cambiar el estado del horario.');
  }
  return resultado.data;
}

/** Convierte "HH:MM:SS" a minutos desde medianoche. */
export function convertirHoraAMinutos(tiempo) {
  if (!tiempo || typeof tiempo !== 'string') return null;
  const [h, m] = tiempo.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/** Formatea "HH:MM:SS" como "HH:MM". */
export function formatearHora(tiempo) {
  if (!tiempo) return '';
  return tiempo.slice(0, 5);
}

/** Parsea "YYYY-MM-DD" como fecha local (evita desfases de zona horaria). */
export function analizarFechaLocal(valor) {
  if (!valor || typeof valor !== 'string') return null;
  const match = valor.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const fecha = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

export function agregarDias(fecha, cantidad) {
  const siguiente = new Date(fecha);
  siguiente.setDate(siguiente.getDate() + cantidad);
  return siguiente;
}

/** Devuelve el lunes de la semana que contiene la fecha. */
export function inicioSemanaLunes(fecha) {
  const resultado = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  const dia = resultado.getDay(); // 0 = domingo
  const diferencia = dia === 0 ? -6 : 1 - dia;
  return agregarDias(resultado, diferencia);
}

export function convertirAFechaISO(fecha) {
  if (!fecha) return '';
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatearRangoSemana(semanaInicio) {
  const inicio = analizarFechaLocal(semanaInicio);
  if (!inicio) return '';
  const fin = agregarDias(inicio, 6);
  const monthShort = (fecha) =>
    fecha.toLocaleDateString('es-PE', { month: 'short' }).replace('.', '');
  const mismoMes = inicio.getMonth() === fin.getMonth();
  const izquierda = `${inicio.getDate()} ${monthShort(inicio)}`;
  const derecha = mismoMes ? `${fin.getDate()}` : `${fin.getDate()} ${monthShort(fin)}`;
  return `${izquierda} – ${derecha} ${fin.getFullYear()}`;
}

/**
 * Datos de los 7 días de la semana seleccionada, incluyendo si es feriado.
 * El lunes es el índice 0 (coincide con el orden de `DAYS`).
 */
export function obtenerDiasSemana(semanaInicio, feriadosMapa = new Map()) {
  const inicio = analizarFechaLocal(semanaInicio);
  if (!inicio) return [];
  return DIAS.map((dia, indice) => {
    const fecha = agregarDias(inicio, indice);
    const mmdd = obtenerMesDia(fecha);
    const feriado = feriadosMapa.get(mmdd) ?? null;
    return {
      day: dia,
      date: fecha,
      iso: convertirAFechaISO(fecha),
      mmdd,
      holiday: feriado,
      isHoliday: Boolean(feriado),
      label: fecha.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }).replace('.', ''),
    };
  });
}

/** Fila válida para pintar en la cuadrícula. */
export function esSesionRepresentable(fila) {
  return Boolean(
    fila &&
      fila.dia &&
      DIAS.includes(fila.dia) &&
      fila.hora_ini &&
      fila.hora_fin &&
      fila.bloque &&
      fila.mat_cur
  );
}

/** Periodos disponibles, más reciente primero. */
export function obtenerPeriodos(registros = []) {
  return [...new Set(registros.map((r) => r.periodo).filter((p) => Number.isFinite(p)))].sort(
    (a, b) => Number(b) - Number(a)
  );
}

/** Bloques/carreras disponibles para un periodo. */
export function obtenerBloques(registros = [], periodo) {
  return [
    ...new Set(
      registros
        .filter((r) => esSesionRepresentable(r) && (periodo === null || r.periodo === periodo))
        .map((r) => r.bloque)
    ),
  ].sort((a, b) => String(a).localeCompare(String(b), 'es'));
}

/** Límites de fechas del dataset completo. */
export function obtenerLimitesHorario(registros = []) {
  const inicios = [];
  const finales = [];
  registros.forEach((r) => {
    const inicio = analizarFechaLocal(r.d_inicio);
    const fin = analizarFechaLocal(r.d_fin);
    if (inicio) inicios.push(inicio);
    if (fin) finales.push(fin);
  });
  if (!inicios.length || !finales.length) return null;
  return {
    min: new Date(Math.min(...inicios.map((d) => d.getTime()))),
    max: new Date(Math.max(...finales.map((d) => d.getTime()))),
  };
}

/** Semana inicial: la actual si cae dentro del calendario; si no, la primera. */
export function obtenerInicioSemanaPredeterminado(registros = [], inicioPeriodo = null, finPeriodo = null) {
  const bounds = obtenerLimitesHorario(registros);
  const hoy = new Date();
  const startLimit = analizarFechaLocal(inicioPeriodo);
  const endLimit = analizarFechaLocal(finPeriodo);
  if (startLimit) {
    const referencia = hoy < startLimit
      ? startLimit
      : endLimit && hoy > endLimit
        ? endLimit
        : hoy;
    return convertirAFechaISO(inicioSemanaLunes(referencia));
  }
  const referencia = bounds && hoy >= bounds.min && hoy <= bounds.max ? hoy : bounds?.min ?? hoy;
  return convertirAFechaISO(inicioSemanaLunes(referencia));
}

export function obtenerNumeroSemanaAcademica(semanaInicio, inicioPeriodo) {
  const inicio = analizarFechaLocal(semanaInicio);
  const primerDia = analizarFechaLocal(inicioPeriodo);
  if (!inicio || !primerDia) return 1;
  const calendarStart = inicioSemanaLunes(inicio);
  const periodoSemanaInicio = inicioSemanaLunes(primerDia);
  return Math.floor((calendarStart - periodoSemanaInicio) / (7 * 24 * 60 * 60 * 1000)) + 1;
}

/**
 * Sesiones de un bloque en una semana concreta.
 * - Filtra por periodo, bloque y solapamiento con [lunes, domingo].
 * - Deduplica el mismo slot repetido en varios rangos de fechas (módulos).
 */
export function obtenerSesionesSemana(registros = [], { period: periodo, block: bloque, weekStart: semanaInicio }) {
  if (!bloque) return [];
  const inicio = analizarFechaLocal(semanaInicio);
  if (!inicio) return [];
  const fin = agregarDias(inicio, 6);

  const superpuesto = registros.filter((fila) => {
    if (!esSesionRepresentable(fila)) return false;
    if (periodo !== null && fila.periodo !== periodo) return false;
    if (fila.bloque !== bloque) return false;
    const filaInicio = analizarFechaLocal(fila.d_inicio);
    const filaFin = analizarFechaLocal(fila.d_fin);
    if (!filaInicio || !filaFin) return true;
    return filaInicio <= fin && filaFin >= inicio;
  });

  const unico = new Map();
  superpuesto.forEach((fila) => {
    const clave = obtenerClaveSesionHorario(fila);
    const noAssignedInstructor = noTieneDocenteAsignado(fila);
    const docenteNombre = noAssignedInstructor ? '' : (fila.instructor || '');

    if (!unico.has(clave)) {
      unico.set(clave, {
        ...fila,
        key: clave,
        instructorName: docenteNombre,
        hasCatalogInstructor: Boolean(docenteNombre),
        noAssignedInstructor,
        ranges: [],
        scheduleIds: [],
      });
    }
    const sesion = unico.get(clave);
    if (fila.id_horario != null && !sesion.scheduleIds.includes(Number(fila.id_horario))) {
      sesion.scheduleIds.push(Number(fila.id_horario));
    }
    if (fila.d_inicio && fila.d_fin) {
      const rangoClave = `${fila.d_inicio}|${fila.d_fin}`;
      if (!sesion.ranges.some((r) => `${r.start}|${r.end}` === rangoClave)) {
        sesion.ranges.push({ start: fila.d_inicio, end: fila.d_fin });
      }
    }
  });

  return [...unico.values()];
}

/**
 * Agrupa por día y calcula carriles para sesiones que se solapan.
 * Devuelve { LUNES: [session...], ... } con `lane` y `laneCount`.
 */
export function distribuirSesionesPorDia(sesiones = []) {
  const porDia = {};
  DIAS.forEach((dia) => {
    porDia[dia] = [];
  });
  sesiones.forEach((sesion) => {
    if (porDia[sesion.dia]) porDia[sesion.dia].push(sesion);
  });

  DIAS.forEach((dia) => {
    const list = [...porDia[dia]].sort(
      (a, b) => convertirHoraAMinutos(a.hora_ini) - convertirHoraAMinutos(b.hora_ini) ||
        convertirHoraAMinutos(a.hora_fin) - convertirHoraAMinutos(b.hora_fin)
    );

    let grupo = [];
    let grupoFin = -1;

    const cerrar = () => {
      if (!grupo.length) return;
      const carrilFinales = [];
      const carriles = new Map();

      grupo.forEach((sesion) => {
        const inicio = convertirHoraAMinutos(sesion.hora_ini);
        const fin = convertirHoraAMinutos(sesion.hora_fin);
        let carril = carrilFinales.findIndex((carrilFin) => carrilFin <= inicio);
        if (carril === -1) {
          carril = carrilFinales.length;
          carrilFinales.push(fin);
        } else {
          carrilFinales[carril] = fin;
        }
        carriles.set(sesion.key, carril);
      });

      grupo.forEach((sesion) => {
        sesion.lane = carriles.get(sesion.key) ?? 0;
        sesion.laneCount = carrilFinales.length;
      });

      grupo = [];
      grupoFin = -1;
    };

    list.forEach((sesion) => {
      const inicio = convertirHoraAMinutos(sesion.hora_ini);
      const fin = convertirHoraAMinutos(sesion.hora_fin);
      if (grupo.length && inicio >= grupoFin) cerrar();
      grupo.push(sesion);
      grupoFin = Math.max(grupoFin, fin);
    });
    cerrar();
  });

  return porDia;
}

/**
 * Recesos entre bloques ocupados. Se consideran recesos los huecos de 15 a 30
 * minutos (el estándar SENATI es 15 min; se toleran variaciones de redondeo).
 */
export function obtenerIntervalosReceso(diaSesiones = []) {
  if (!diaSesiones.length) return [];
  const ordenado = [...diaSesiones].sort(
    (a, b) => convertirHoraAMinutos(a.hora_ini) - convertirHoraAMinutos(b.hora_ini)
  );
  const ocupado = [];
  ordenado.forEach((sesion) => {
    const inicio = convertirHoraAMinutos(sesion.hora_ini);
    const fin = convertirHoraAMinutos(sesion.hora_fin);
    const ultimo = ocupado[ocupado.length - 1];
    if (ultimo && inicio <= ultimo.end) {
      ultimo.end = Math.max(ultimo.end, fin);
    } else {
      ocupado.push({ start: inicio, end: fin });
    }
  });

  const recesos = [];
  for (let i = 0; i < ocupado.length - 1; i += 1) {
    const separacion = ocupado[i + 1].start - ocupado[i].end;
    if (separacion >= 15 && separacion <= 30) {
      recesos.push({
        startMin: ocupado[i].end,
        endMin: ocupado[i + 1].start,
        minutes: separacion,
        label: `Receso ${separacion}m`,
      });
    }
  }
  return recesos;
}

/** Color estable y diferenciado por código de materia. */
export function obtenerColorCurso(matCur, nombre = '') {
  if (!matCur && !nombre) {
    return {
      bg: 'hsl(215 25% 96%)',
      border: 'hsl(215 15% 65%)',
      text: 'hsl(215 25% 30%)',
      chip: 'hsl(215 15% 55%)',
    };
  }
  const color = obtenerEntradaColorCurso(nombre || matCur);
  const { hue } = color;
  return {
    hex: color.hex,
    bg: `hsl(${hue} 88% 96%)`,
    border: `hsl(${hue} 64% 52%)`,
    text: `hsl(${hue} 68% 27%)`,
    chip: `hsl(${hue} 68% 45%)`,
  };
}
