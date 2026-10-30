import { useCallback, useEffect, useMemo, useState } from 'react';
import { docentesService as api } from '../services/docentesService';
import { docenteDisponibleEn } from '../utils/disponibilidad';

/**
 * Hook REUTILIZABLE del Equipo 1 (lo consume el Equipo 4 en la Matriz de Horarios).
 *
 * const { docentesActivos, esDocenteDisponible, getDisponibilidad } = useDocentes();
 *
 * Devuelve:
 *  - docentes, docentesActivos (estado 'A'), cursos, loading, error, refetch()
 *  - getDocenteById(id), getDisponibilidad(id) -> ["1-08:00", "1-09:00", ...]
 *  - esDocenteDisponible(id, dia, "08:00", "10:00") -> true/false (dia: 1=Lunes ... 6=Sábado)
 *  - crear(datos), actualizar(id, datos), cambiarEstado(id, 'A'|'I'|'V')
 *  - guardarDisponibilidad(id, slots), guardarCompetencias(id, cursoIds)
 */
export function useDocentes() {
  const [docentes, setDocentes] = useState([]);
  const [cursos, setCursos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refetch = useCallback(async ({ silencioso = false } = {}) => {
    if (!silencioso) setLoading(true);
    setError(null);
    try {
      const [d, c] = await Promise.all([api.listarDocentes(), api.listarCursos()]);
      setDocentes(d);
      setCursos(c);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // Ejecuta una escritura y refresca los datos sin parpadeo
  const mutar = useCallback(
    async (fn) => {
      const resultado = await fn();
      await refetch({ silencioso: true });
      return resultado;
    },
    [refetch]
  );

  const docentesActivos = useMemo(() => docentes.filter((d) => d.estado === 'A'), [docentes]);
  const getDocenteById = useCallback((id) => docentes.find((d) => d.id === id) || null, [docentes]);
  const getDisponibilidad = useCallback((id) => getDocenteById(id)?.slots ?? [], [getDocenteById]);
  const esDocenteDisponible = useCallback(
    (id, dia, horaInicio, horaFin) => docenteDisponibleEn(getDocenteById(id), dia, horaInicio, horaFin),
    [getDocenteById]
  );

  return {
    docentes,
    docentesActivos,
    cursos,
    loading,
    error,
    refetch,
    getDocenteById,
    getDisponibilidad,
    esDocenteDisponible,
    crear: (datos) => mutar(() => api.crearDocente(datos)),
    actualizar: (id, datos) => mutar(() => api.actualizarDocente(id, datos)),
    cambiarEstado: (id, estado) => mutar(() => api.cambiarEstado(id, estado)),
    guardarDisponibilidad: (id, slots) => mutar(() => api.guardarDisponibilidad(id, slots)),
    guardarCompetencias: (id, cursoIds) => mutar(() => api.guardarCompetencias(id, cursoIds)),
    listarClasesDocente: (id) => api.listarClasesDocente(id)
  };
}
