// frontend/src/modules/docentes/components/AltaRapida.jsx
import React, { useState } from 'react';
import { docentesApi } from '../services/docentesApi';

export default function AltaRapida({ onCreado, onToast }) {
    const [codigo, setCodigo] = useState('');
    const [nombre, setNombre] = useState('');
    const [especialidad, setEspecialidad] = useState('');
    const [cargando, setCargando] = useState(false);

    async function handleSubmit(e) {
        e.preventDefault();
        if (!codigo || !nombre) {
            onToast('El código y el nombre son obligatorios', 'error');
            return;
        }
        if (!/^[0-9]{9}$/.test(codigo)) {
            onToast('El ID del instructor debe tener exactamente 9 dígitos numéricos', 'error');
            return;
        }

        setCargando(true);
        try {
            await docentesApi.crear({
                codigo_instructor: codigo,
                nombre_completo: nombre,
                especialidad: especialidad || 'GENERAL'
            });
            onToast('Instructor registrado exitosamente');
            setCodigo('');
            setNombre('');
            setEspecialidad('');
            onCreado();
        } catch (err) {
            onToast(err.message, 'error');
        } finally {
            setCargando(false);
        }
    }

    return (
        <form onSubmit={handleSubmit} className="doc-alta-form">
            <input
                type="text"
                className="doc-input doc-input-nombre"
                placeholder="Apellidos y Nombres del Instructor..."
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
            />
            <input
                type="text"
                className="doc-input doc-input-codigo"
                placeholder="ID (9 dígitos)"
                maxLength={9}
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
            />
            <input
                type="text"
                className="doc-input"
                placeholder="Especialidad"
                value={especialidad}
                onChange={(e) => setEspecialidad(e.target.value)}
                style={{ flex: 1, minWidth: '150px' }}
            />
            <button type="submit" className="doc-btn doc-btn-primary" disabled={cargando}>
                <i className="fa-solid fa-user-plus"></i> {cargando ? 'Registrando...' : 'Registrar Instructor'}
            </button>
        </form>
    );
}