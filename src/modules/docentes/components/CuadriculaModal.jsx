// frontend/src/modules/docentes/components/CuadriculaModal.jsx
import React, { useState, useEffect } from 'react';
import { docentesApi } from '../services/docentesApi';
import { franjasACeldas, celdasAFranjas, aHora } from '../utils/franjas';

export default function CuadriculaModal({ docente, onClose, onToast, abrirRango }) {
    const [celdas, setCeldas] = useState({});
    const [cargando, setCargando] = useState(true);
    const [guardando, setGuardando] = useState(false);
    const [isMouseDown, setIsMouseDown] = useState(false);
    const [modoArrastre, setModoArrastre] = useState(true); // true para marcar, false para desmarcar
    const [mensajeAviso, setMensajeAviso] = useState('Haz clic o arrastra para marcar o desmarcar celdas.');

    const horas = [];
    for (let h = 7; h <= 20; h++) {
        horas.push(`${h.toString().padStart(2, '0')}:00`);
    }

    const dias = [
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
                const mapa = franjasACeldas(res.data || []);
                setCeldas(mapa);
            } catch (err) {
                onToast('Error al cargar disponibilidad', 'error');
            } finally {
                setCargando(false);
            }
        }
        cargar();
    }, [docente]);

    function handleMouseDown(dia, hora) {
        const key = `${dia}-${hora}`;
        const nuevoEstado = !celdas[key];
        setModoArrastre(nuevoEstado);
        setCeldas(prev => ({ ...prev, [key]: nuevoEstado }));
        setIsMouseDown(true);
    }

    function handleMouseEnter(dia, hora) {
        if (!isMouseDown) return;
        const key = `${dia}-${hora}`;
        setCeldas(prev => ({ ...prev, [key]: modoArrastre }));
    }

    function handleMouseUp() {
        setIsMouseDown(false);
    }

    function atajoTodoDisponible() {
        const nuevo = {};
        dias.forEach(d => {
            horas.forEach(h => {
                nuevo[`${d.n}-${h}`] = true;
            });
        });
        setCeldas(nuevo);
        setMensajeAviso('Aplicado atajo: Todo Disponible');
    }

    function atajoLimpiar() {
        setCeldas({});
        setMensajeAviso('Aplicado atajo: Limpiar Todo');
    }

    function atajoHorario(inicioH, finH) {
        const nuevo = { ...celdas };
        dias.forEach(d => {
            horas.forEach(h => {
                const horaNum = parseInt(h.split(':')[0]);
                if (horaNum >= inicioH && horaNum < finH) {
                    nuevo[`${d.n}-${h}`] = true;
                }
            });
        });
        setCeldas(nuevo);
        setMensajeAviso(`Aplicado atajo horario`);
    }

    function atajoLunVie() {
        const nuevo = { ...celdas };
        for (let d = 1; d <= 5; d++) {
            horas.forEach(h => {
                const horaNum = parseInt(h.split(':')[0]);
                if (horaNum >= 7 && horaNum < 13) {
                    nuevo[`${d}-${h}`] = true;
                }
            });
        }
        setCeldas(nuevo);
        setMensajeAviso('Aplicado atajo: Lunes a Viernes Mañana');
    }

    async function handleGuardar() {
        setGuardando(true);
        try {
            const franjas = celdasAFranjas(celdas);
            await docentesApi.actualizarDisponibilidad(docente.id_docente, franjas);
            onToast('Cuadrícula de disponibilidad guardada exitosamente');
            onClose();
        } catch (err) {
            onToast(err.message, 'error');
        } finally {
            setGuardando(false);
        }
    }

    const totalHoras = Object.values(celdas).filter(Boolean).length;
    const diasActivos = new Set(Object.keys(celdas).filter(k => celdas[k]).map(k => k.split('-')[0])).size;

    return (
        <div onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
            {/* Línea reservada para avisos */}
            <div style={{ background: '#E6F4F1', color: '#0F766E', padding: '8px 12px', borderRadius: '8px', marginBottom: '12px', fontSize: '13px', fontWeight: '600' }}>
                <i className="fa-solid fa-circle-info"></i> {mensajeAviso}
            </div>

            {/* Atajos */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
                <button className="doc-btn doc-btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={atajoTodoDisponible}>Todo Disponible</button>
                <button className="doc-btn doc-btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={atajoLimpiar}>Limpiar Todo</button>
                <button className="doc-btn doc-btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => atajoHorario(7, 13)}>Mañana (07-13h)</button>
                <button className="doc-btn doc-btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => atajoHorario(13, 18)}>Tarde (13-18h)</button>
                <button className="doc-btn doc-btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => atajoHorario(18, 21)}>Noche (18-21h)</button>
                <button className="doc-btn doc-btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={atajoLunVie}>Lun-Vie Mañana</button>
            </div>

            {cargando ? (
                <p>Cargando cuadrícula...</p>
            ) : (
                <div style={{ overflowX: 'auto', maxHeight: '350px', border: '1px solid #D5E3E0', borderRadius: '12px', padding: '10px' }}>
                    <table className="doc-cuadricula-table">
                        <thead>
                            <tr>
                                <th style={{ fontSize: '12px', color: '#64748B' }}>Hora</th>
                                {dias.map(d => (
                                    <th key={d.n} style={{ fontSize: '12px', fontWeight: '700', color: '#0F766E' }}>{d.nombre}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {horas.map(h => (
                                <tr key={h}>
                                    <td className="doc-cell-hora">{h}</td>
                                    {dias.map(d => {
                                        const key = `${d.n}-${h}`;
                                        const activo = !!celdas[key];
                                        return (
                                            <td key={d.n}>
                                                <div
                                                    className={`doc-celda-slot ${activo ? 'activo' : ''}`}
                                                    onMouseDown={() => handleMouseDown(d.n, h)}
                                                    onMouseEnter={() => handleMouseEnter(d.n, h)}
                                                />
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
                <div style={{ fontSize: '13px', fontWeight: '600', color: '#475569' }}>
                    <span>{totalHoras} hrs seleccionadas</span> · <span>{diasActivos} días activos</span>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button className="doc-btn doc-btn-secondary" onClick={abrirRango}>
                        Ver Rango Horario (Foto)
                    </button>
                    <button className="doc-btn doc-btn-secondary" onClick={onClose}>Cancelar</button>
                    <button className="doc-btn doc-btn-primary" onClick={handleGuardar} disabled={guardando}>
                        {guardando ? 'Guardando...' : 'Guardar Cuadrícula'}
                    </button>
                </div>
            </div>
        </div>
    );
}