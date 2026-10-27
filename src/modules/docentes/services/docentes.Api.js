// frontend/src/modules/docentes/services/docentesApi.js
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/docentes';

async function request(endpoint = '', options = {}) {
    const url = endpoint ? `${API_URL}${endpoint}` : API_URL;
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };

    try {
        const response = await fetch(url, { ...options, headers });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.mensaje || 'Error en la petición al servidor');
        }
        return data;
    } catch (error) {
        throw new Error(error.message || 'No se pudo conectar con el servidor');
    }
}

export const docentesApi = {
    listar: (params = {}) => {
        const query = new URLSearchParams();
        if (params.q) query.append('q', params.q);
        if (params.estado) query.append('estado', params.estado);
        if (params.carrera) query.append('carrera', params.carrera);
        const search = query.toString();
        return request(search ? `?${search}` : '');
    },
    obtenerPorId: (id) => request(`/${id}`),
    crear: (body, usuario = 'sistema') => request('', {
        method: 'POST',
        headers: { 'x-usuario': usuario },
        body: JSON.stringify(body)
    }),
    actualizar: (id, body, usuario = 'sistema') => request(`/${id}`, {
        method: 'PUT',
        headers: { 'x-usuario': usuario },
        body: JSON.stringify(body)
    }),
    actualizarEstado: (id, estado, usuario = 'sistema') => request(`/${id}/estado`, {
        method: 'PATCH',
        headers: { 'x-usuario': usuario },
        body: JSON.stringify({ estado })
    }),
    obtenerAuditoria: (id) => request(`/${id}/auditoria`),
    obtenerDisponibilidad: (id) => request(`/${id}/disponibilidad`),
    actualizarDisponibilidad: (id, franjas, usuario = 'sistema') => request(`/${id}/disponibilidad`, {
        method: 'PUT',
        headers: { 'x-usuario': usuario },
        body: JSON.stringify({ franjas })
    }),
    obtenerCatalogoCursos: () => request('/catalogo-cursos'),
    obtenerCatalogoCarreras: () => request('/catalogo-carreras'),
    obtenerBloques: (id) => request(`/${id}/bloques`),
    actualizarBloques: (id, bloques, usuario = 'sistema') => request(`/${id}/bloques`, {
        method: 'PUT',
        headers: { 'x-usuario': usuario },
        body: JSON.stringify({ bloques })
    }),
    obtenerCompetencias: (id) => request(`/${id}/competencias`),
    actualizarCompetencias: (id, curso_ids, usuario = 'sistema') => request(`/${id}/competencias`, {
        method: 'PUT',
        headers: { 'x-usuario': usuario },
        body: JSON.stringify({ curso_ids })
    }),
    obtenerClases: (id) => request(`/${id}/clases`)
};