import React from 'react';

/**
 * Modal de confirmación al cambiar de carrera o salir al directorio (Equipo 4)
 */
export default function ModalConfirmarSalir({
    abierto,
    nombreCarrera,
    hayCambiosSinGuardar,
    onCerrar,
    onConfirmar
}) {
    if (!abierto) return null;

    return (
        <div className="eq4-modal-overlay" onClick={onCerrar}>
            <div className="eq4-modal-content-custom" onClick={(e) => e.stopPropagation()} style={{ width: '480px' }}>
                <div className="eq4-modal-header-custom">
                    <h3 style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#1e293b', margin: 0, fontSize: '16px', fontWeight: '700' }}>
                        <i className="fas fa-exclamation-triangle" style={{ color: '#f59e0b', fontSize: '18px' }}></i>
                        ¿Cambiar de carrera o salir?
                    </h3>
                    <button
                        type="button"
                        className="eq4-modal-close-btn"
                        onClick={onCerrar}
                        title="Cerrar ventana"
                    >
                        &times;
                    </button>
                </div>
                <div className="eq4-modal-body-custom" style={{ padding: '22px 24px' }}>
                    <p style={{ margin: 0, fontSize: '14px', color: '#334155', lineHeight: 1.5 }}>
                        Está a punto de salir de la gestión del programa académico:
                    </p>
                    <div style={{
                        marginTop: '8px',
                        padding: '10px 14px',
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        fontWeight: '700',
                        color: '#003B70',
                        fontSize: '14px'
                    }}>
                        <i className="fas fa-graduation-cap" style={{ marginRight: '8px', color: '#003B70' }}></i>
                        {nombreCarrera}
                    </div>

                    {hayCambiosSinGuardar ? (
                        <div style={{
                            background: '#fef2f2',
                            color: '#991b1b',
                            padding: '12px 14px',
                            borderRadius: '8px',
                            border: '1px solid #fecaca',
                            marginTop: '14px',
                            fontSize: '13px',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '10px'
                        }}>
                            <i className="fas fa-exclamation-circle" style={{ fontSize: '18px', color: '#dc2626', marginTop: '2px', flexShrink: 0 }}></i>
                            <div>
                                <strong>¡Atención! Tiene modificaciones sin guardar.</strong>
                                <div style={{ marginTop: '3px', lineHeight: 1.4 }}>
                                    Ha realizado asignaciones de docentes en los semestres que aún no se han persistido. Si sale ahora para cambiar de carrera, los cambios se perderán.
                                </div>
                            </div>
                        </div>
                    ) : (
                        <p style={{ color: '#64748b', fontSize: '13px', marginTop: '14px', marginBottom: 0, lineHeight: 1.4 }}>
                            Las asignaciones de docentes guardadas se encuentran seguras en la base de datos. ¿Desea volver al directorio institucional de carreras?
                        </p>
                    )}
                </div>
                <div className="eq4-modal-footer-custom" style={{ padding: '14px 24px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    <button
                        type="button"
                        className="eq4-btn eq4-btn-secondary"
                        onClick={onCerrar}
                    >
                        Seguir en esta carrera
                    </button>
                    <button
                        type="button"
                        className="eq4-btn eq4-btn-primary"
                        style={{ background: '#003B70' }}
                        onClick={onConfirmar}
                    >
                        <i className="fas fa-arrow-left"></i>
                        Sí, cambiar de carrera
                    </button>
                </div>
            </div>
        </div>
    );
}

