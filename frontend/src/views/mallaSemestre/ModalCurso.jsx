import React from 'react';

/**
 * Modal para Crear y Editar Curso en un Semestre (Equipo 4)
 */
export default function ModalCurso({
    abierto,
    modo,
    semestre,
    formCurso,
    setFormCurso,
    error,
    guardando,
    onActualizarHoras,
    onSubmit,
    onCerrar
}) {
    if (!abierto) return null;

    return (
        <div className="eq4-modal-overlay" onClick={onCerrar}>
            <div className="eq4-modal-content-custom" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '680px', width: '95%' }}>
                <div className="eq4-modal-header-custom">
                    <h3>
                        <i className="fas fa-book" style={{ color: 'var(--senati-blue)', marginRight: '8px' }}></i>
                        {modo === 'crear' ? 'Agregar Nuevo Curso' : 'Editar Curso'}
                        {semestre ? ` · Semestre ${semestre.semestre}` : ''}
                    </h3>
                    <button className="eq4-modal-close-btn" onClick={onCerrar}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <form onSubmit={onSubmit}>
                    <div className="eq4-modal-body-custom">
                        {error && (
                            <div style={{
                                padding: '10px 14px',
                                borderRadius: '8px',
                                marginBottom: '16px',
                                fontSize: '13px',
                                background: '#FEF2F2',
                                border: '1px solid #FECACA',
                                color: '#991B1B'
                            }}>
                                <i className="fas fa-exclamation-triangle" style={{ marginRight: '6px' }}></i>
                                {error}
                            </div>
                        )}

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-dark)', marginBottom: '6px' }}>
                                    Código MAT CUR *
                                </label>
                                <input
                                    type="text"
                                    placeholder="Ej. PIAD-525"
                                    value={formCurso.mat_cur}
                                    onChange={(e) => setFormCurso({ ...formCurso, mat_cur: e.target.value.toUpperCase() })}
                                    style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px' }}
                                    required
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-dark)', marginBottom: '6px' }}>
                                    Catálogo / Malla
                                </label>
                                <input
                                    type="text"
                                    placeholder="Ej. 202610, 202310"
                                    value={formCurso.catalogo}
                                    onChange={(e) => setFormCurso({ ...formCurso, catalogo: e.target.value })}
                                    style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px' }}
                                />
                            </div>
                        </div>

                        <div style={{ marginBottom: '14px' }}>
                            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-dark)', marginBottom: '6px' }}>
                                Nombre de la Asignatura / Curso *
                            </label>
                            <input
                                type="text"
                                placeholder="Ej. DISEÑO Y DESARROLLO DE APLICACIONES MÓVILES"
                                value={formCurso.nombre_curso}
                                onChange={(e) => setFormCurso({ ...formCurso, nombre_curso: e.target.value.toUpperCase() })}
                                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px' }}
                                required
                            />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-dark)', marginBottom: '6px' }}>
                                    Tipo Horario (SINFO)
                                </label>
                                <select
                                    value={formCurso.horario_sinfo}
                                    onChange={(e) => setFormCurso({ ...formCurso, horario_sinfo: e.target.value })}
                                    style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px', background: '#fff' }}
                                >
                                    <option value="TEC">TEC (Tecnología / Teoría)</option>
                                    <option value="TAL">TAL (Taller / Práctica)</option>
                                    <option value="TEC-TAL">TEC-TAL (Tecnología y Taller)</option>
                                    <option value="EMP">EMP (Formación en Empresa)</option>
                                </select>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-dark)', marginBottom: '6px' }}>
                                    Categoría de Curso
                                </label>
                                <select
                                    value={formCurso.is_carrera}
                                    onChange={(e) => setFormCurso({ ...formCurso, is_carrera: Number(e.target.value) })}
                                    style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px', background: '#fff' }}
                                >
                                    <option value={1}>Carrera</option>
                                    <option value={0}>Complementario</option>
                                </select>
                            </div>
                        </div>

                        <div style={{ marginBottom: '14px' }}>
                            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-dark)', marginBottom: '6px' }}>
                                Duración (Semanas)
                            </label>
                            <input
                                type="number"
                                min="1"
                                max="24"
                                value={formCurso.semanas}
                                onChange={(e) => setFormCurso({ ...formCurso, semanas: Number(e.target.value) })}
                                style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '13px' }}
                            />
                        </div>

                        {/* Desglose oficial de horas curriculares */}
                        <div style={{ marginBottom: '14px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '12px', alignItems: 'end' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                                    <label style={{ minHeight: '28px', display: 'flex', alignItems: 'flex-end', fontSize: '11px', fontWeight: '700', color: '#1e293b', marginBottom: '6px', textTransform: 'uppercase', lineHeight: '1.25' }}>
                                        TEORÍA / TECNOLOGÍA
                                    </label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={formCurso.horas_teoria}
                                        onChange={(e) => onActualizarHoras('horas_teoria', e.target.value)}
                                        style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', background: '#ffffff', boxSizing: 'border-box' }}
                                    />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                                    <label style={{ minHeight: '28px', display: 'flex', alignItems: 'flex-end', fontSize: '11px', fontWeight: '700', color: '#1e293b', marginBottom: '6px', textTransform: 'uppercase', lineHeight: '1.25' }}>
                                        TALLER / EMPRESA
                                    </label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={formCurso.horas_taller}
                                        onChange={(e) => onActualizarHoras('horas_taller', e.target.value)}
                                        style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', background: '#ffffff', boxSizing: 'border-box' }}
                                    />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                                    <label style={{ minHeight: '28px', display: 'flex', alignItems: 'flex-end', fontSize: '11px', fontWeight: '700', color: '#1e293b', marginBottom: '6px', textTransform: 'uppercase', lineHeight: '1.25' }}>
                                        VIRTUAL
                                    </label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={formCurso.horas_virtual}
                                        onChange={(e) => onActualizarHoras('horas_virtual', e.target.value)}
                                        style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', background: '#ffffff', boxSizing: 'border-box' }}
                                    />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                                    <label style={{ minHeight: '28px', display: 'flex', alignItems: 'flex-end', fontSize: '11px', fontWeight: '700', color: '#1e293b', marginBottom: '6px', textTransform: 'uppercase', lineHeight: '1.25' }}>
                                        EVALUACIÓN SEMESTRAL
                                    </label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={formCurso.horas_evaluacion}
                                        onChange={(e) => onActualizarHoras('horas_evaluacion', e.target.value)}
                                        style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px', background: '#ffffff', boxSizing: 'border-box' }}
                                    />
                                </div>
                            </div>

                            {/* Card resumen: TOTAL HORAS ASIGNATURA y HORAS TOTALES SEMESTRE */}
                            <div style={{
                                background: '#f8fafc',
                                border: '1px solid #e2e8f0',
                                borderRadius: '10px',
                                padding: '12px 16px',
                                display: 'grid',
                                gridTemplateColumns: '1fr 1fr',
                                gap: '16px',
                                alignItems: 'center'
                            }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '11px', fontWeight: '800', color: '#003B70', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                                        TOTAL HORAS ASIGNATURA
                                    </label>
                                    <input
                                        type="number"
                                        value={formCurso.total_horas}
                                        readOnly
                                        style={{
                                            width: '100%',
                                            padding: '9px 12px',
                                            borderRadius: '8px',
                                            border: '1px solid #cbd5e1',
                                            fontSize: '15px',
                                            fontWeight: '700',
                                            color: '#003B70',
                                            background: '#ffffff',
                                            boxSizing: 'border-box'
                                        }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#334155', marginBottom: '6px', textTransform: 'uppercase' }}>
                                        HORAS TOTALES SEMESTRE
                                    </label>
                                    <input
                                        type="number"
                                        value={formCurso.horas_semestre_meta}
                                        onChange={(e) => setFormCurso({ ...formCurso, horas_semestre_meta: Number(e.target.value) })}
                                        style={{
                                            width: '100%',
                                            padding: '9px 12px',
                                            borderRadius: '8px',
                                            border: '1px solid #cbd5e1',
                                            fontSize: '14px',
                                            color: '#334155',
                                            background: '#ffffff',
                                            boxSizing: 'border-box'
                                        }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="eq4-modal-footer-custom">
                        <button
                            type="button"
                            className="eq4-btn eq4-btn-secondary"
                            onClick={onCerrar}
                            disabled={guardando}
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            className="eq4-btn eq4-btn-primary"
                            disabled={guardando}
                        >
                            <i className={guardando ? 'fas fa-spinner fa-spin' : (modo === 'crear' ? 'fas fa-plus' : 'fas fa-save')}></i>
                            <span>{guardando ? 'Guardando...' : (modo === 'crear' ? 'Registrar Curso' : 'Guardar Cambios')}</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

