import React from 'react';
import { obtenerTextoTurno, getClaseTipo } from './mallaSemestre.helpers';

/**
 * Tabla y tarjetas de cursos por semestre y turno (Equipo 4)
 * - Muestra la lista de cursos del ciclo seleccionado
 * - Selectores globales de docente para TEC y docente para TAL por turno
 * - Asignación individual para cursos complementarios
 * - Botones de acción: Editar y Activar/Inactivar curso (sin emojis)
 */
export default function TablaCursosTurno({
    semestres,
    turnoActivo,
    asignacionesDocentes,
    asignacionesCursos,
    mapaDocentesPorId,
    listaDocentes,
    onToggleEstadoSemestre,
    onAbrirModalCrearCurso,
    onCambiarDocente,
    onCambiarDocenteCurso,
    onCambiarTipoCurso,
    onAbrirModalEditarCurso,
    onToggleEstadoCurso,
    onAbrirImportacion,
    procesandoImportacion
}) {
    if (!semestres || semestres.length === 0) {
        return (
            <div className="workspace-card" style={{ textAlign: 'center', padding: '50px 20px' }}>
                <i className="fas fa-folder-open" style={{ fontSize: '32px', color: '#94a3b8', marginBottom: '12px' }}></i>
                <h2>No se encontraron semestres registrados (II al VI)</h2>
                <p>Esta carrera aún no cuenta con asignaturas registradas para los ciclos formativos.</p>
                {typeof onAbrirImportacion === 'function' && (
                    <button
                        type="button"
                        className="eq4-btn eq4-btn-primary"
                        onClick={onAbrirImportacion}
                        disabled={procesandoImportacion}
                        style={{ marginTop: '16px' }}
                    >
                        <i className="fas fa-file-excel" style={{ color: '#A7F3D0' }}></i> Cargar Mallas Curriculares (Excel)
                    </button>
                )}
            </div>
        );
    }

    return (
        <>
            {semestres.map((semestre) => {
                const cursosDelCiclo = semestre.cursos || [];
                const totalHorasCiclo = semestre.total_horas || 0;

                // Asignaciones del turno activo para este ciclo
                const asignacionTurno = asignacionesDocentes[semestre.semestre]?.[turnoActivo] || {};
                const docenteTecAsignado = mapaDocentesPorId.get(String(asignacionTurno.tec));
                const docenteTalAsignado = mapaDocentesPorId.get(String(asignacionTurno.tal));

                const tieneTecTal = cursosDelCiclo.some((c) => String(c.horario_sinfo || '').toUpperCase() === 'TEC-TAL');

                return (
                    <div
                        key={semestre.id_semestre || semestre.semestre}
                        id={`semestre-card-${String(semestre.semestre).trim().toUpperCase()}`}
                        className="malla-semester-card"
                    >
                        {/* Encabezado de la tarjeta del semestre */}
                        <div className="malla-semester-card-header">
                            <div>
                                <h3 className="malla-semester-card-title">
                                    Semestre {semestre.semestre}
                                </h3>
                                <p className="malla-semester-card-subtitle">
                                    {cursosDelCiclo.length} cursos
                                </p>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                                <button
                                    type="button"
                                    className={`malla-btn-toggle-semestre ${semestre.estado === 'I' ? 'inactivo' : 'activo'}`}
                                    onClick={() => onToggleEstadoSemestre(semestre)}
                                    title={semestre.estado === 'I' ? 'Semestre inhabilitado. Clic para habilitar' : 'Semestre habilitado. Clic para inhabilitar'}
                                >
                                    <i className={`fas ${semestre.estado === 'I' ? 'fa-lock' : 'fa-lock-open'}`}></i>
                                    <span>{semestre.estado === 'I' ? 'Inhabilitado' : 'Habilitado'}</span>
                                </button>
                                <button
                                    type="button"
                                    className="malla-btn-agregar-curso"
                                    onClick={() => onAbrirModalCrearCurso(semestre)}
                                    title={`Agregar nuevo curso al Semestre ${semestre.semestre}`}
                                >
                                    <i className="fas fa-plus"></i>
                                    <span>Agregar Curso</span>
                                </button>
                                <span className="malla-badge-meta">
                                    {totalHorasCiclo} H
                                </span>
                            </div>
                        </div>

                        {semestre.estado === 'I' && (
                            <div className="malla-semestre-inhabilitado-banner">
                                <i className="fas fa-lock" style={{ fontSize: '15px' }}></i>
                                <span><strong>Semestre Inhabilitado:</strong> Este ciclo se encuentra pausado y fuera de la programación activa de horarios. Puede habilitarlo en cualquier momento usando el botón de la cabecera.</span>
                            </div>
                        )}

                        {/* Selectores de docentes para TEC y TAL en este turno */}
                        <div className="malla-docentes-selectores-bar">
                            <div className="malla-docente-select-group">
                                <label htmlFor={`doc-tec-${semestre.semestre}`}>
                                    docente para TEC:
                                </label>
                                <select
                                    id={`doc-tec-${semestre.semestre}`}
                                    className="malla-docente-combobox"
                                    value={asignacionTurno.tec || ''}
                                    onChange={(e) => onCambiarDocente(semestre.semestre, 'tec', e.target.value)}
                                >
                                    <option value="">-- Seleccionar docente para TEC --</option>
                                    {listaDocentes.map((d) => (
                                        <option key={d.id_docente} value={d.id_docente}>
                                            {d.nombre_completo} ({d.especialidad})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="malla-docente-select-group">
                                <label htmlFor={`doc-tal-${semestre.semestre}`}>
                                    docente para TAL:
                                    {tieneTecTal && <span style={{ fontSize: '10px', color: '#0284c7', marginLeft: '4px' }}>(Sincronizado TEC-TAL)</span>}
                                </label>
                                <select
                                    id={`doc-tal-${semestre.semestre}`}
                                    className="malla-docente-combobox"
                                    value={asignacionTurno.tal || ''}
                                    onChange={(e) => onCambiarDocente(semestre.semestre, 'tal', e.target.value)}
                                >
                                    <option value="">-- Seleccionar docente para TAL --</option>
                                    {listaDocentes.map((d) => (
                                        <option key={d.id_docente} value={d.id_docente}>
                                            {d.nombre_completo} ({d.especialidad})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Tabla de asignaturas del semestre */}
                        {cursosDelCiclo.length > 0 ? (
                            <div style={{ overflowX: 'auto' }}>
                                <table className="malla-clean-table">
                                    <thead>
                                        <tr>
                                            <th>MAT CUR</th>
                                            <th>CATÁLOGO</th>
                                            <th>CURSO</th>
                                            <th>TIPO HORARIO</th>
                                            <th>CATEGORÍA</th>
                                            <th>DOCENTE ASIGNADO ({obtenerTextoTurno(turnoActivo)})</th>
                                            <th className="center">SEMANAS</th>
                                            <th className="center">TOTAL HORAS</th>
                                            <th className="center" style={{ width: '135px' }}>ACCIONES</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {cursosDelCiclo.map((curso) => {
                                            const esSeminario = /seminario/i.test(curso.nombre_curso || '');
                                            const esEmpresa = String(curso.horario_sinfo || '').toUpperCase().includes('EMP');
                                            const esDeCarrera = Number(curso.is_carrera) === 1;
                                            const esInactivo = curso.estado === 'I';

                                            const esTaller = String(curso.horario_sinfo || '').toUpperCase().includes('TAL') || esSeminario;
                                            const docenteAsignadoCarrera = esTaller ? docenteTalAsignado : docenteTecAsignado;

                                            return (
                                                <tr key={curso.id_curso || curso.mat_cur} className={esInactivo ? 'malla-row-inactivo' : ''}>
                                                    <td>
                                                        <span className="malla-badge-matcur-blue">
                                                            {curso.mat_cur}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <span className="malla-badge-catalogo">
                                                            {curso.catalogo || '—'}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <span className="malla-curso-nombre-bold">
                                                            {curso.nombre_curso}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <span className={`malla-badge-tipo ${getClaseTipo(curso)}`}>
                                                            {esSeminario ? 'SEMINARIO' : (curso.horario_sinfo || 'TEC')}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <select
                                                            className={`malla-select-is-carrera ${esDeCarrera ? 'carrera' : 'complementario'} ${esInactivo ? 'disabled' : ''}`}
                                                            value={esDeCarrera ? '1' : '0'}
                                                            onChange={(e) => onCambiarTipoCurso(curso.id_curso, Number(e.target.value))}
                                                            disabled={esInactivo}
                                                            title={esInactivo ? "Curso inactivo (no editable)" : "Seleccione si el curso es de Carrera o Complementario"}
                                                        >
                                                            <option value="1">Carrera</option>
                                                            <option value="0">Complementario</option>
                                                        </select>
                                                    </td>
                                                    <td>
                                                        {esEmpresa ? (
                                                            <span className="malla-docente-asignado-pill empresa">
                                                                <i className="fas fa-building" style={{ color: '#ca8a04' }}></i>
                                                                Empresa Formadora (Sin docente)
                                                            </span>
                                                        ) : esDeCarrera ? (
                                                            docenteAsignadoCarrera ? (
                                                                <span className="malla-docente-asignado-pill">
                                                                    <i className="fas fa-user-check" style={{ color: '#059669' }}></i>
                                                                    {docenteAsignadoCarrera.nombre_completo}
                                                                </span>
                                                            ) : (
                                                                <span className="malla-docente-asignado-pill sin-asignar">
                                                                    Por asignar ({esTaller ? 'Docente TAL' : 'Docente TEC'})
                                                                </span>
                                                            )
                                                        ) : (
                                                            <select
                                                                className={`malla-docente-row-combobox ${esInactivo ? 'disabled' : ''}`}
                                                                value={asignacionesCursos[curso.id_curso]?.[turnoActivo] || ''}
                                                                onChange={(e) => onCambiarDocenteCurso(curso.id_curso, turnoActivo, e.target.value)}
                                                                disabled={esInactivo}
                                                                title={esInactivo ? "Curso inactivo (no editable)" : "Seleccionar docente complementario"}
                                                            >
                                                                <option value="">-- Seleccionar docente complementario --</option>
                                                                {listaDocentes.map((d) => (
                                                                    <option key={d.id_docente} value={d.id_docente}>
                                                                        {d.nombre_completo} ({d.especialidad})
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        )}
                                                    </td>
                                                    <td className="center">
                                                        {curso.semanas ?? '—'}
                                                    </td>
                                                    <td className="center">
                                                        <span className="malla-horas-bold">
                                                            {curso.total_horas || 0}
                                                        </span>
                                                    </td>
                                                    <td className="center">
                                                        <div className="malla-row-actions">
                                                            <button
                                                                type="button"
                                                                className={`malla-action-btn edit ${esInactivo ? 'disabled' : ''}`}
                                                                onClick={() => !esInactivo && onAbrirModalEditarCurso(curso, semestre)}
                                                                disabled={esInactivo}
                                                                title={esInactivo ? "Curso inactivo (habilítelo para editar)" : `Editar curso: ${curso.nombre_curso}`}
                                                            >
                                                                <i className="fas fa-pencil-alt"></i>
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className={`malla-btn-estado-curso ${curso.estado === 'I' ? 'inactivo' : 'activo'}`}
                                                                onClick={() => onToggleEstadoCurso(curso, semestre)}
                                                                title={curso.estado === 'I' ? `Curso inactivo. Clic para activar: ${curso.nombre_curso}` : `Curso activo. Clic para desactivar: ${curso.nombre_curso}`}
                                                            >
                                                                <span>{curso.estado === 'I' ? 'Inactivo' : 'Activo'}</span>
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="malla-semester-empty">
                                No hay cursos registrados para el Semestre {semestre.semestre} en la base de datos.
                            </div>
                        )}
                    </div>
                );
            })}
        </>
    );
}

