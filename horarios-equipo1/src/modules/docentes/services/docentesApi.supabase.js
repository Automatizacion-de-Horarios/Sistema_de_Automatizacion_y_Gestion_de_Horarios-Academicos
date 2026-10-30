import { supabase } from '../../../lib/supabaseClient';
import { TABLAS as T, USUARIO_ACTUAL } from '../../../config/app';
import { filasASlots, slotsAFilas, formatearFecha, normalizarHora } from '../utils/disponibilidad';

// Convierte errores de Supabase en mensajes entendibles para el usuario.
function lanzar(error, contexto = '') {
  let msg = error.message || 'Error desconocido';
  if (error.code === '23505') msg = 'Ya existe un registro con ese valor único (por ejemplo, el DNI).';
  else if (error.code === '42501' || /row-level security/i.test(msg))
    msg = 'Supabase bloqueó la operación por las políticas RLS. Revisa los permisos de la tabla.';
  else if (error.code === 'PGRST204' || /column/i.test(msg))
    msg = `Falta una columna en la tabla (${msg}). Revisa supabase/ajustes_opcionales.sql.`;
  throw new Error(contexto ? `${contexto}: ${msg}` : msg);
}

const ahora = () => new Date().toISOString();

function normalizarDocente(row, filasDisp, cursoIds) {
  const apellidos = (row.apellidos || '').trim();
  const nombres = (row.nombres || '').trim();
  return {
    id: row.id,
    nombres,
    apellidos,
    nombre: [apellidos, nombres].filter(Boolean).join(', ').toUpperCase(),
    dni: row.dni || '',
    especialidad: row.especialidad || 'General',
    horasContrato: Number(row.horas_semanales_contrato) || 0,
    estado: row.estado || 'A',
    usuarioModificacion: row.usuario_modificacion || '—',
    fechaModificacion: formatearFecha(row.fecha_modificacion || row.updated_at || row.created_at),
    slots: filasASlots(filasDisp),
    cursosPermitidos: cursoIds
  };
}

// Tablas de otros equipos: si todavía no existen, devolvemos [] sin romper la pantalla.
async function leerOpcional(tabla, columnas = '*') {
  const { data, error } = await supabase.from(tabla).select(columnas);
  if (error) {
    console.warn(`[Equipo 1] No se pudo leer "${tabla}":`, error.message);
    return [];
  }
  return data || [];
}

async function tocar(docenteId) {
  await supabase
    .from(T.docentes)
    .update({ usuario_modificacion: USUARIO_ACTUAL, fecha_modificacion: ahora() })
    .eq('id', docenteId);
}

export const docentesApiSupabase = {
  async listarDocentes() {
    const { data, error } = await supabase.from(T.docentes).select('*').order('apellidos', { ascending: true });
    if (error) lanzar(error, 'No se pudieron cargar los docentes');
    const [disp, comp] = await Promise.all([leerOpcional(T.disponibilidad), leerOpcional(T.competencias)]);
    return (data || []).map((row) =>
      normalizarDocente(
        row,
        disp.filter((f) => f.docente_id === row.id),
        comp.filter((c) => c.docente_id === row.id).map((c) => c.curso_id)
      )
    );
  },

  async listarCursos() {
    const filas = await leerOpcional(T.cursos);
    return filas.map((c) => ({
      id: c.id,
      codigo: c.codigo || c.mat_cur || '',
      nombre: c.nombre_curso || c.nombre || `Curso ${c.id}`,
      horas: Number(c.horas_semanales) || 0,
      ciclo: c.semestre_id ?? c.semestre ?? null
    }));
  },

  async crearDocente({ nombres, apellidos, dni, especialidad, horasContrato }) {
    const { error } = await supabase.from(T.docentes).insert({
      nombres,
      apellidos,
      dni,
      especialidad: especialidad || 'General',
      horas_semanales_contrato: horasContrato || 0,
      estado: 'A',
      usuario_modificacion: USUARIO_ACTUAL,
      fecha_modificacion: ahora()
    });
    if (error) lanzar(error, 'No se pudo registrar al instructor');
  },

  async actualizarDocente(id, { nombres, apellidos, dni, especialidad, horasContrato }) {
    const { error } = await supabase
      .from(T.docentes)
      .update({
        nombres,
        apellidos,
        dni,
        especialidad,
        horas_semanales_contrato: horasContrato,
        usuario_modificacion: USUARIO_ACTUAL,
        fecha_modificacion: ahora()
      })
      .eq('id', id);
    if (error) lanzar(error, 'No se pudo actualizar al instructor');
  },

  async cambiarEstado(id, estado) {
    const { error } = await supabase
      .from(T.docentes)
      .update({ estado, usuario_modificacion: USUARIO_ACTUAL, fecha_modificacion: ahora() })
      .eq('id', id);
    if (error) lanzar(error, 'No se pudo cambiar el estado');
  },

  // Reemplaza toda la disponibilidad del docente. Si falla la inserción, restaura lo anterior.
  async guardarDisponibilidad(docenteId, slots) {
    const { data: previas, error: e0 } = await supabase.from(T.disponibilidad).select('*').eq('docente_id', docenteId);
    if (e0) lanzar(e0, 'No se pudo leer la disponibilidad actual');

    const { error: e1 } = await supabase.from(T.disponibilidad).delete().eq('docente_id', docenteId);
    if (e1) lanzar(e1, 'No se pudo limpiar la disponibilidad anterior');

    const filas = slotsAFilas(docenteId, slots);
    if (filas.length) {
      const { error: e2 } = await supabase.from(T.disponibilidad).insert(filas);
      if (e2) {
        if (previas?.length) {
          await supabase.from(T.disponibilidad).insert(previas.map(({ id, ...resto }) => resto));
        }
        lanzar(e2, 'No se pudo guardar la disponibilidad');
      }
    }
    await tocar(docenteId);
  },

  async guardarCompetencias(docenteId, cursoIds) {
    const { data: previas, error: e0 } = await supabase.from(T.competencias).select('*').eq('docente_id', docenteId);
    if (e0) lanzar(e0, 'No se pudieron leer las competencias');

    const { error: e1 } = await supabase.from(T.competencias).delete().eq('docente_id', docenteId);
    if (e1) lanzar(e1, 'No se pudieron limpiar las competencias');

    if (cursoIds.length) {
      const { error: e2 } = await supabase
        .from(T.competencias)
        .insert(cursoIds.map((curso_id) => ({ docente_id: docenteId, curso_id })));
      if (e2) {
        if (previas?.length) {
          await supabase.from(T.competencias).insert(previas.map(({ id, ...resto }) => resto));
        }
        lanzar(e2, 'No se pudieron guardar las competencias');
      }
    }
    await tocar(docenteId);
  },

  // Solo lectura: clases del docente en horarios_asignados (Equipo 4)
  async listarClasesDocente(docenteId) {
    const { data, error } = await supabase.from(T.horarios).select('*').eq('docente_id', docenteId);
    if (error) {
      console.warn('[Equipo 1] No se pudo leer horarios_asignados:', error.message);
      return [];
    }
    const [cursos, ambientes] = await Promise.all([this.listarCursos(), leerOpcional(T.ambientes)]);
    return (data || []).map((h) => {
      const curso = cursos.find((c) => c.id === h.curso_id);
      const amb = ambientes.find((a) => a.id === h.ambiente_id);
      return {
        id: h.id,
        dia: h.dia_semana,
        inicio: normalizarHora(h.bloque_hora_inicio),
        fin: normalizarHora(h.bloque_hora_fin),
        curso: curso ? curso.nombre : `Curso ${h.curso_id}`,
        ambiente: amb ? amb.codigo_ambiente : ''
      };
    });
  }
};
