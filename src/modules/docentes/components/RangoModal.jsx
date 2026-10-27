// frontend/src/modules/docentes/components/RangoModal.jsx
import React, { useState, useEffect } from 'react';
import { docentesApi } from '../services/docentesApi';
import { franjasARango } from '../utils/franjas';

export default function RangoModal({ docente, onClose, onToast, abrirCuadricula }) {
    const [rangoDias, setRangoDias] = useState({});
    const [cargando, setCargando] = useState(true);
    const [guardando, setGuardando] = useState(false);

    const diasSemana = [
        { n: 1, nombre: 'Lunes' },
        { n: 2, nombre: 'Martes' },
        { n: 3, nombre: 'Miércoles' },
        { n: 4, nombre: 'Jueves' },
        { n: 5, nombre: 'Viernes' },
        { n: 6, nombre: 'Sábado' }
    ];

    useEffect(() => {
        async function cargar() {
            try {
                const res = await docentesApi.obtenerDisponibilidad(docente.id_docente);
                const rango = franjasARango(res.data || []);
                setRangoDias(rango);
            } catch (err) {
                onToast('Error al cargar disponibilidad', 'error');
            } finally {
                setCargando(false);
            }
        }
        cargar();
    }, [docente]);

    function handleChange(dia, campo, valor) {
        setRangoDias(prev => ({
            ...prev,
            [dia]: { ...prev[dia], [campo]: valor }
        }));
    }

    async function handleGuardar() {
        setGuardando(true);
        try {
            const franjas = [];
            for (let d = 1; d <= 6; d++) {
                const item = rangoDias[d];
                if (item && item.habilitado) {
                    franjas.push({
                        dia_semana: d,
                        hora_inicio: item.hora_inicio,
                        hora_fin: item.hora_fin
                    });
                }
            }
            await docentesApi.actualizarDisponibilidad(docente.id_docente, franjas);
            onToast('Disponibilidad actualizada exitosamente');
            onClose();
        } catch (err) {
            onToast(err.message, 'error');
        } finally {
            setGuardando(false);
        }
    }

    return (
        <div>
            {cargando ? (
                <p>Cargando rango horario...</p>
            ) : (
                <div>
                    <table className="doc-table" style={{ marginBottom: '16px' }}>
                        <thead>
                            <tr>
                                <th>Día</th>
                                <th>Habilitado</th>
                                <th>Hora Inicio</th>
                                <th>Hora Fin</th>
                            </tr>
                        </thead>
                        <tbody>
                            {diasSemana.map(d => {
                                const info = rangoDias[d.n] || { habilitado: false, hora_inicio: '08:00', hora_fin: '12:00', tieneHuecos: false };
                                return (
                                    <tr key={d.n}>
                                        <td style={{ fontWeight: '600' }}>{d.nombre}</td>
                                        <td>
                                            <input
                                                type="checkbox"
                                                checked={info.habilitado}
                                                onChange={(e) => handleChange(d.n, 'habilitado', e.target.checked)}
                                                style={{ width: '18px', height: '18px', accentColor: '#0F766E' }}
                                            />
                                        </td>
                                        <td>
                                            <input
                                                type="time"
                                                className="doc-input"
                                                value={info.hora_inicio}
                                                disabled={!info.habilitado}
                                                onChange={(e) => handleChange(d.n, 'hora_inicio', e.target.value)}
                                            />
                                        </td>
                                        <td>
                                            <input
                                                type="time"
                                                className="doc-input"
                                                value={info.hora_fin}
                                                disabled={!info.habilitado}
                                                onChange={(e) => handleChange(d.n, 'hora_fin', e.target.value)}
                                            />
                                            {info.tieneHuecos && (
                                                <div style={{ fontSize: '11px', color: '#D97706', marginTop: '4px' }}>
                                                    Este día tiene huecos, edítalo en la cuadrícula.
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <button className="doc-btn doc-btn-secondary" onClick={abrirCuadricula}>
                            <i className="fa-solid fa-table-cells"></i> Ver Cuadrícula (Nh)
                        </button>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button className="doc-btn doc-btn-secondary" onClick={onClose}>Cancelar</button>
                            <button className="doc-btn doc-btn-primary" onClick={handleGuardar} disabled={guardando}>
                                {guardando ? 'Guardando...' : 'Guardar Rango'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}