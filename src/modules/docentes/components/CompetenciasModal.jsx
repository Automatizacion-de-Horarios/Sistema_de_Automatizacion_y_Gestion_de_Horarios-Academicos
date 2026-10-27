// frontend/src/modules/docentes/components/CompetenciasModal.jsx
import React, { useState, useEffect } from 'react';
import { docentesApi } from '../services/docentesApi';

export default function CompetenciasModal({ docente, onClose, onToast }) {
    const [cursosCatalogo, setCursosCatalogo] = useState([]);
    const [seleccionados, setSeleccionados] = useState(new Set());
    const [cargando, setCargando] = useState(true);
    const [guardando, setGuardando] = useState(false);
    const [filtroTexto, setFiltroTexto] = useState('');

    useEffect(() => {
        async function cargarDatos() {
            try {
                const [catRes, compRes] = await Promise.all([
                    docentesApi.obtenerCatalogoCursos(),
                    docentesApi.obtenerCompetencias(docente.id_docente)
                ]);
                setCursosCatalogo(catRes.data || []);
                const idsActuales = new Set((compRes.data || []).map(c => c.id_curso));
                setSeleccionados(idsActuales);
            } catch (err) {
                onToast('Error al cargar competencias', 'error');
            } finally {
                setCargando(false);
            }
        }
        cargarDatos();
    }, [docente]);

    function toggleCurso(id) {
        const nuevaSel = new Set(seleccionados);
        if (nuevaSel.has(id)) nuevaSel.delete(id);
        else nuevaSel.add(id);
        setSeleccionados(nuevaSel);
    }

    async function handleGuardar() {
        setGuardando(true);
        try {
            await docentesApi.actualizarCompetencias(docente.id_docente, Array.from(seleccionados));
            onToast('Competencias actualizadas exitosamente');
            onClose();
        } catch (err) {
            onToast(err.message, 'error');
        } finally {
            setGuardando(false);
        }
    }

    const cursosFiltrados = cursosCatalogo.filter(c => 
        c.nombre_curso.toLowerCase().includes(filtroTexto.toLowerCase())
    );

    return (
        <div>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                <input
                    type="text"
                    className="doc-input"
                    placeholder="Buscar curso..."
                    value={filtroTexto}
                    onChange={(e) => setFiltroTexto(e.target.value)}
                    style={{ flex: 1 }}
                />
                <button className="doc-btn doc-btn-secondary" onClick={() => setSeleccionados(new Set(cursosCatalogo.map(c => c.id_curso)))}>
                    Marcar Visibles
                </button>
                <button className="doc-btn doc-btn-secondary" onClick={() => setSeleccionados(new Set())}>
                    Desmarcar Todo
                </button>
            </div>

            {cargando ? (
                <p>Cargando cursos...</p>
            ) : (
                <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #D5E3E0', borderRadius: '12px', padding: '12px' }}>
                    {cursosFiltrados.map(curso => (
                        <label key={curso.id_curso} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px', cursor: 'pointer', borderBottom: '1px solid #F1F5F9' }}>
                            <input
                                type="checkbox"
                                checked={seleccionados.has(curso.id_curso)}
                                onChange={() => toggleCurso(curso.id_curso)}
                                style={{ width: '18px', height: '18px', accentColor: '#0F766E' }}
                            />
                            <span>{curso.nombre_curso}</span>
                        </label>
                    ))}
                </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px' }}>
                <span style={{ fontWeight: '600', color: '#0F766E' }}>{seleccionados.size} asignadas</span>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button className="doc-btn doc-btn-secondary" onClick={onClose}>Cancelar</button>
                    <button className="doc-btn doc-btn-primary" onClick={handleGuardar} disabled={guardando}>
                        {guardando ? 'Guardando...' : 'Guardar Competencias Asignadas'}
                    </button>
                </div>
            </div>
        </div>
    );
}