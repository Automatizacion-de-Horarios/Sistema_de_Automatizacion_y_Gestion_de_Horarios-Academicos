import { authFetch } from '../../lib/authFetch';
import { API_BASE_URL } from '../../config/api';

/**
 * Servicio API para Malla Curricular y Semestres (Equipo 4)
 * Centraliza todos los llamados HTTP a los endpoints de la API.
 */
export const mallaSemestreService = {
    /**
     * 1. GET /api/malla-semestre/:idCarrera/malla
     * Obtiene la carrera, semestres, cursos, docentes y programación guardada.
     */
    obtenerMalla: async (idCarrera) => {
        const res = await authFetch(`${API_BASE_URL}/api/malla-semestre/${encodeURIComponent(idCarrera)}/malla`);
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.mensaje || 'Error al obtener la malla curricular de la carrera.');
        }
        return data;
    },

    /**
     * 2. POST /api/malla-semestre/programacion
     * Guarda la asignación masiva de docentes por curso y turno (Bulk Insert).
     */
    guardarProgramacion: async (idCarrera, asignaciones) => {
        const res = await authFetch(`${API_BASE_URL}/api/malla-semestre/programacion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id_carrera: idCarrera,
                asignaciones
            })
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.mensaje || 'Error al guardar la programación.');
        }
        return data;
    },

    /**
     * 3. POST /api/malla-semestre/cursos
     * Crea un nuevo curso en un semestre.
     */
    crearCurso: async (datosCurso) => {
        const res = await authFetch(`${API_BASE_URL}/api/malla-semestre/cursos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(datosCurso)
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.mensaje || 'Error al guardar los datos del curso.');
        }
        return data;
    },

    /**
     * 4. PUT /api/malla-semestre/cursos/:idCurso
     * Actualiza los datos de un curso existente.
     */
    actualizarCurso: async (idCurso, datosCurso) => {
        const res = await authFetch(`${API_BASE_URL}/api/malla-semestre/cursos/${idCurso}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(datosCurso)
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.mensaje || 'Error al guardar los datos del curso.');
        }
        return data;
    },

    /**
     * 5. PUT /api/malla-semestre/cursos/:idCurso/estado
     * Activa o inactiva un curso individual.
     */
    cambiarEstadoCurso: async (idCurso, nuevoEstado) => {
        const res = await authFetch(`${API_BASE_URL}/api/malla-semestre/cursos/${idCurso}/estado`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: nuevoEstado })
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.mensaje || 'Error al actualizar estado del curso.');
        }
        return data;
    },

    /**
     * 6. PUT /api/malla-semestre/cursos/:idCurso/tipo
     * Cambia la categoría de un curso (Carrera vs Complementario).
     */
    cambiarTipoCurso: async (idCurso, nuevoValor) => {
        const res = await authFetch(`${API_BASE_URL}/api/malla-semestre/cursos/${idCurso}/tipo`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_carrera: nuevoValor })
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.mensaje || 'Error al actualizar tipo de curso.');
        }
        return data;
    },

    /**
     * 7. PUT /api/malla-semestre/semestres/:idSemestre/estado
     * Habilita o inhabilita un semestre completo.
     */
    cambiarEstadoSemestre: async (idSemestre, nuevoEstado) => {
        const res = await authFetch(`${API_BASE_URL}/api/malla-semestre/semestres/${idSemestre}/estado`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: nuevoEstado })
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.mensaje || 'Error al actualizar estado del semestre.');
        }
        return data;
    }
};

