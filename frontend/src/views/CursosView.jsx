import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { API_BASE_URL } from '../config/api';
import { authFetch } from '../lib/authFetch';
import './CursosView.css';

//--------Estructura referencial del Excel de cursos aceptado - EQUIPO 4 SECCION CURSOS ---------------
// La fila 1 es un título general, la fila 2 son los encabezados y desde la fila 3 vienen los cursos.
const columnasExcelCursos = [
    { nombre: 'CODIGO', ejemplo: 'PIAD', omitida: false },
    { nombre: 'CATALOGO', ejemplo: '202610', omitida: false },
    { nombre: 'MAT CUR', ejemplo: 'SCIU-185', omitida: false },
    { nombre: 'HORARIO SINFO', ejemplo: 'TEC', omitida: false },
    { nombre: 'CLASIFICACIÓN BLACKBOARD', ejemplo: 'TEC', omitida: true },
    { nombre: 'SEMESTRE', ejemplo: 'I', omitida: false },
    { nombre: 'DESCRIPCIÓN DE CURSO', ejemplo: 'MATEMÁTICA', omitida: false },
    { nombre: 'SEMANAS', ejemplo: '16', omitida: false },
    { nombre: 'TEORÍA / TECNOLOGÍA', ejemplo: '64', omitida: false },
    { nombre: 'TALLER / EMPRESA', ejemplo: '—', omitida: false },
    { nombre: 'VIRTUAL', ejemplo: '16', omitida: false },
    { nombre: 'EVALUACIÓN SEMESTRAL', ejemplo: '5', omitida: false },
    { nombre: 'TOTAL HORAS', ejemplo: '85', omitida: false }
];
//------------------------------------------------------------------------------------------------------

/**
 * Vista de Cursos / Mallas Curriculares (Equipo 4)
 * Contiene el modal de importación de Excel, la vista previa de la estructura
 * aceptada y el panel flotante de progreso.
 *
 * El botón que abre el modal vive en CarrerasView, por eso se expone
 * `abrirImportacion` a través de ref.
 */
const CursosView = forwardRef(function CursosView({ onRegistrarCarrera, onProcesandoChange }, ref) {
    const [modalAbierto, setModalAbierto] = useState(false);
    const [archivoSeleccionado, setArchivoSeleccionado] = useState(null);
    const [arrastrandoArchivo, setArrastrandoArchivo] = useState(false);
    const [cargandoProceso, setCargandoProceso] = useState(false);
    const [resultadoImportacion, setResultadoImportacion] = useState(null);
    const [errorImportacion, setErrorImportacion] = useState(null);

    // Progreso real de la importación (job + polling al backend) - Equipo 4
    const [progresoImportacion, setProgresoImportacion] = useState(null);
    const [panelProgresoVisible, setPanelProgresoVisible] = useState(false);
    const intervaloProgresoRef = useRef(null);

    // Panel de clasificación de prefijos (aparece al seleccionar archivo)
    const [panelClasificacionVisible, setPanelClasificacionVisible] = useState(false);
    const [prefijosEncontrados, setPrefijosEncontrados] = useState([]); // [{ prefijo, esCarreraForzado, yaEsCarreraEnBD, seleccion }]
    const [analizandoPrefijos, setAnalizandoPrefijos] = useState(false);

    const detenerPollingProgreso = () => {
        if (intervaloProgresoRef.current) {
            clearInterval(intervaloProgresoRef.current);
            intervaloProgresoRef.current = null;
        }
    };

    // Limpia el intervalo si el componente se desmonta
    useEffect(() => {
        return () => detenerPollingProgreso();
    }, []);

    // Informa al padre si hay una importación en curso (para bloquear el botón)
    useEffect(() => {
        if (typeof onProcesandoChange === 'function') {
            onProcesandoChange(cargandoProceso);
        }
    }, [cargandoProceso, onProcesandoChange]);

    // Manejador de selección de archivo mediante el botón de examinar
    const manejarCambioArchivo = (e) => {
        if (e.target.files && e.target.files[0]) {
            setArchivoSeleccionado(e.target.files[0]);
            setResultadoImportacion(null);
            setErrorImportacion(null);
            analizarPrefijosArchivo(e.target.files[0]);
        }
    };

    // Manejadores para arrastrar y soltar (Drag and Drop)
    const manejarArrastreSobre = (e) => {
        e.preventDefault();
        setArrastrandoArchivo(true);
    };

    const manejarSalidaArrastre = () => {
        setArrastrandoArchivo(false);
    };

    const manejarSoltarArchivo = (e) => {
        e.preventDefault();
        setArrastrandoArchivo(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            setArchivoSeleccionado(e.dataTransfer.files[0]);
            setResultadoImportacion(null);
            setErrorImportacion(null);
            analizarPrefijosArchivo(e.dataTransfer.files[0]);
        }
    };

    // Analiza los prefijos del archivo seleccionado llamando al backend
    const analizarPrefijosArchivo = async (archivo) => {
        if (!archivo) return;
        setAnalizandoPrefijos(true);
        setPanelClasificacionVisible(false);
        setPrefijosEncontrados([]);

        const form = new FormData();
        form.append('archivo', archivo);

        try {
            const respuesta = await authFetch(`${API_BASE_URL}/api/mallas/analizar-prefijos`, {
                method: 'POST',
                body: form
            });
            const datos = await respuesta.json();

            if (respuesta.ok && datos.prefijos) {
                // Asignamos selección inicial: si es forzado o ya estaba como carrera → 'carrera', sino 'complementario'
                const conSeleccion = datos.prefijos.map((p) => ({
                    ...p,
                    seleccion: (p.esCarreraForzado || p.yaEsCarreraEnBD) ? 'carrera' : 'complementario'
                }));
                setPrefijosEncontrados(conSeleccion);
                setPanelClasificacionVisible(true);
            }
        } catch (err) {
            console.error('Error al analizar prefijos:', err);
        } finally {
            setAnalizandoPrefijos(false);
        }
    };

    // Cambia la selección de un prefijo en el panel (solo los no forzados)
    const cambiarSeleccionPrefijo = (prefijo, valor) => {
        setPrefijosEncontrados((prev) =>
            prev.map((p) => (p.prefijo === prefijo ? { ...p, seleccion: valor } : p))
        );
    };

    // Consulta periódicamente el avance de la importación hasta que termine.
    const seguirProgresoImportacion = (jobId) => {
        return new Promise((resolve) => {
            const consultar = async () => {
                try {
                    const respuesta = await authFetch(`${API_BASE_URL}/api/mallas/importar-excel/progreso/${jobId}`);
                    const datos = await respuesta.json();

                    if (!respuesta.ok) {
                        detenerPollingProgreso();
                        setErrorImportacion({
                            mensaje: datos.mensaje || 'No se pudo consultar el avance de la importación.'
                        });
                        setCargandoProceso(false);
                        resolve();
                        return;
                    }

                    const trabajo = datos.trabajo;

                    setProgresoImportacion({
                        porcentaje: trabajo.porcentaje || 0,
                        paso: trabajo.paso || 'Procesando',
                        mensaje: trabajo.mensaje || '',
                        datos: trabajo.datos || {}
                    });

                    if (trabajo.estado === 'completado') {
                        detenerPollingProgreso();
                        setResultadoImportacion(trabajo.resultado);
                        setCargandoProceso(false);
                        resolve();
                        return;
                    }

                    if (trabajo.estado === 'error') {
                        detenerPollingProgreso();
                        setErrorImportacion(trabajo.error || {
                            mensaje: trabajo.mensaje || 'Error al procesar el archivo.'
                        });
                        setCargandoProceso(false);
                        resolve();
                    }
                } catch (error) {
                    detenerPollingProgreso();
                    console.error('Error al consultar el progreso:', error);
                    setErrorImportacion({
                        mensaje: 'Se perdió la conexión con el servidor mientras se procesaba el archivo.'
                    });
                    setCargandoProceso(false);
                    resolve();
                }
            };

            consultar();
            intervaloProgresoRef.current = setInterval(consultar, 500);
        });
    };

    // Enviar el archivo Excel al backend para que lo lea en memoria y lo inserte
    const subirArchivoExcel = async () => {
        if (!archivoSeleccionado) return;

        detenerPollingProgreso();
        setCargandoProceso(true);
        setErrorImportacion(null);
        setResultadoImportacion(null);
        setPanelProgresoVisible(true);
        setPanelClasificacionVisible(false);
        setProgresoImportacion({
            porcentaje: 0,
            paso: 'Subiendo archivo',
            mensaje: `Enviando "${archivoSeleccionado.name}" al servidor...`,
            datos: {}
        });

        // Construir mapa de clasificaciones manuales desde el panel
        const clasificacionesObj = {};
        for (const p of prefijosEncontrados) {
            if (!p.esCarreraForzado) {
                clasificacionesObj[p.prefijo] = p.seleccion === 'carrera' ? 1 : 0;
            }
        }

        const datosFormulario = new FormData();
        datosFormulario.append('archivo', archivoSeleccionado);
        datosFormulario.append('clasificaciones', JSON.stringify(clasificacionesObj));

        try {
            const respuesta = await authFetch(`${API_BASE_URL}/api/mallas/importar-excel?progreso=1`, {
                method: 'POST',
                body: datosFormulario
            });

            const datos = await respuesta.json();

            if (!respuesta.ok || !datos.jobId) {
                setPanelProgresoVisible(false);
                setErrorImportacion({
                    mensaje: datos.mensaje || 'Error al procesar el archivo',
                    detalle: datos.detalle,
                    tipo: datos.tipo,
                    carrerasFaltantes: datos.carrerasFaltantes || []
                });
                setCargandoProceso(false);
                return;
            }

            // El modal se cierra y el avance sigue visible en el panel flotante.
            setModalAbierto(false);
            await seguirProgresoImportacion(datos.jobId);
        } catch (error) {
            console.error('Error al subir archivo:', error);
            detenerPollingProgreso();
            setPanelProgresoVisible(false);
            setErrorImportacion({
                mensaje: error.message || 'No se pudo conectar con el servidor.'
            });
            setCargandoProceso(false);
        }
    };

    // Abre el modal de importación limpio (no permite abrirlo mientras hay un proceso activo)
    const abrirImportacion = () => {
        if (cargandoProceso) return;

        setArchivoSeleccionado(null);
        setResultadoImportacion(null);
        setErrorImportacion(null);
        setProgresoImportacion(null);
        setPanelProgresoVisible(false);
        setPanelClasificacionVisible(false);
        setPrefijosEncontrados([]);
        setModalAbierto(true);
    };

    useImperativeHandle(ref, () => ({ abrirImportacion }));

    // Cierra el modal. Si hay una importación en curso, el panel flotante sigue visible.
    const cerrarModal = () => {
        setModalAbierto(false);
        setPanelClasificacionVisible(false);

        if (!cargandoProceso) {
            detenerPollingProgreso();
            setArchivoSeleccionado(null);
            setResultadoImportacion(null);
            setErrorImportacion(null);
            setProgresoImportacion(null);
            setPanelProgresoVisible(false);
            setPrefijosEncontrados([]);
        }
    };

    // Cierra el panel flotante cuando la importación ya terminó (éxito o error).
    const cerrarPanelProgreso = () => {
        if (cargandoProceso) return;

        detenerPollingProgreso();
        setPanelProgresoVisible(false);
        setArchivoSeleccionado(null);
        setResultadoImportacion(null);
        setErrorImportacion(null);
        setProgresoImportacion(null);
    };

    // ---------Datos derivados para el panel flotante de progreso - Equipo 4 SECCION CURSOS)------------------------------------------------------------
    const datosProgreso = (progresoImportacion && progresoImportacion.datos) || {};
    const porcentajeProgreso = Math.max(0, Math.min(100, progresoImportacion?.porcentaje ?? (resultadoImportacion ? 100 : 0)));
    const panelConError = !cargandoProceso && !!errorImportacion;
    const panelCompletado = !cargandoProceso && !!resultadoImportacion;
    // ----------------------------------------------------------------------------------------------------------------------------------

    return (
        <>
            {/* ================================================================= */}
            {/*        MODAL DE IMPORTACIÓN DRAG & DROP (EXCEL) - EQUIPO 4      */}
            {/* ================================================================= */}
            {modalAbierto && (
                <div className="eq4-modal-overlay" onClick={cerrarModal}>
                    <div className="eq4-modal-content-custom" onClick={(e) => e.stopPropagation()}>
                        <div className="eq4-modal-header-custom">
                            <h3>
                                <i className="fas fa-file-excel cursos-modal-excel-icon"></i>
                                Importar y Depurar Tabla Excel
                            </h3>
                            <button className="eq4-modal-close-btn" onClick={cerrarModal}>
                                <i className="fas fa-times"></i>
                            </button>
                        </div>

                        <div className="eq4-modal-body-custom">
                            {!resultadoImportacion ? (
                                <>
                                    <div className="cursos-field-margin">
                                        <label className="cursos-label">
                                            Estructura / Tabla Destino
                                        </label>
                                        <select
                                            className="cursos-input"
                                            defaultValue="mallas"
                                        >
                                            <option value="mallas">Cargar Mallas Curriculares</option>
                                            <option value="docentes" disabled>Cargar Instructores (Docentes)</option>
                                            <option value="aulas" disabled>Cargar Ambientes (Aulas/Laboratorios)</option>
                                        </select>
                                    </div>

                                    {/* Zona Drag and Drop para arrastrar y soltar */}
                                    <div
                                        className={`eq4-upload-zone-custom ${arrastrandoArchivo ? 'eq4-dragover' : ''} ${cargandoProceso ? 'cursos-upload-zone-disabled' : ''}`}
                                        onDragOver={manejarArrastreSobre}
                                        onDragLeave={manejarSalidaArrastre}
                                        onDrop={manejarSoltarArchivo}
                                        onClick={() => document.getElementById('input-archivo-excel').click()}
                                    >
                                        <i className="fas fa-cloud-upload-alt eq4-upload-icon-custom"></i>
                                        <span className="eq4-upload-title-custom">Arrastre el archivo (.xlsx / .csv) aquí</span>
                                        <span className="eq4-upload-subtitle-custom">o haga clic para examinar sus archivos</span>
                                        <input
                                            type="file"
                                            id="input-archivo-excel"
                                            accept=".xlsx, .xls, .csv"
                                            className="cursos-hidden"
                                            onChange={manejarCambioArchivo}
                                        />
                                    </div>

                                    {/* Vista previa de la estructura del Excel aceptado - Equipo 4 */}
                                    <div className="cursos-table-wrapper">
                                        <div className="cursos-table-header">
                                            <strong className="cursos-table-title">
                                                <i className="fas fa-table cursos-table-icon"></i>
                                                Vista previa de la estructura aceptada
                                            </strong>
                                            <span className="cursos-table-count">
                                                Fila 1: título · Fila 2: encabezados · Fila 3 en adelante: cursos
                                            </span>
                                        </div>

                                        <div className="cursos-table-scroll">
                                            <table className="cursos-table">
                                                <thead>
                                                    <tr>
                                                        {columnasExcelCursos.map((columna) => (
                                                            <th
                                                                key={columna.nombre}
                                                                className={`cursos-tabla-encabezado ${columna.omitida ? 'cursos-tabla-encabezado-omitida' : 'cursos-tabla-encabezado-normal'}`}
                                                            >
                                                                <span className={columna.omitida ? 'cursos-tabla-encabezado-texto-omitida' : 'cursos-tabla-encabezado-texto'}>
                                                                    {columna.nombre}
                                                                </span>
                                                                {columna.omitida && (
                                                                    <span className="cursos-omitida-etiqueta">
                                                                        SE OMITIRÁ
                                                                    </span>
                                                                )}
                                                            </th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    <tr>
                                                        {columnasExcelCursos.map((columna) => (
                                                            <td
                                                                key={columna.nombre}
                                                                className={`cursos-tabla-celda ${columna.omitida ? 'cursos-tabla-celda-omitida' : 'cursos-tabla-celda-normal'}`}
                                                            >
                                                                {columna.ejemplo}
                                                            </td>
                                                        ))}
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>

                                        <div className="cursos-table-note">
                                            <i className="fas fa-info-circle cursos-note-icon"></i>
                                            <span>
                                                La columna <strong>CATALOGO</strong> sí se guarda en la base de datos. La columna <strong>CLASIFICACIÓN BLACKBOARD</strong> puede venir en el Excel, pero el sistema <strong>no la insertará</strong>. Los cursos se leen desde la <strong>fila 3</strong>.
                                                <br />
                                                <span className="cursos-note-orange">Desliza horizontalmente la tabla para ver todas las columnas.</span>
                                            </span>
                                        </div>
                                    </div>

                                    {archivoSeleccionado && (
                                        <div className="eq4-file-selected-badge cursos-file-badge">
                                            <span className="cursos-file-badge-info">
                                                <i className="fas fa-file-excel cursos-file-icon"></i>
                                                <span className="cursos-file-name">{archivoSeleccionado.name} ({(archivoSeleccionado.size / 1024).toFixed(1)} KB)</span>
                                            </span>
                                            <span className="cursos-file-ready">
                                                <i className="fas fa-check-circle"></i> Listo para procesar
                                            </span>
                                        </div>
                                    )}

                                    {errorImportacion && (
                                        <div className="cursos-error-box">
                                            <div className="cursos-error-content">
                                                <i className="fas fa-exclamation-triangle cursos-error-icon"></i>
                                                <div className="cursos-error-body">
                                                    <strong>{errorImportacion.mensaje || errorImportacion}</strong>
                                                    {errorImportacion.detalle && (
                                                        <p className="cursos-error-text">
                                                            {errorImportacion.detalle}
                                                        </p>
                                                    )}
                                                    {errorImportacion.carrerasFaltantes && errorImportacion.carrerasFaltantes.length > 0 && (
                                                        <button
                                                            type="button"
                                                            className="eq4-btn eq4-btn-sm eq4-btn-primary cursos-mt-4"
                                                            onClick={() => {
                                                                if (typeof onRegistrarCarrera === 'function') {
                                                                    onRegistrarCarrera(errorImportacion.carrerasFaltantes[0] || '');
                                                                }
                                                                cerrarModal();
                                                            }}
                                                        >
                                                            <i className="fas fa-plus"></i> Registrar Carrera {errorImportacion.carrerasFaltantes[0]} Ahora
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div>
                                    <div className="cursos-success-box">
                                        <strong className="cursos-success-title">
                                            <i className="fas fa-check-circle cursos-success-icon"></i> {resultadoImportacion.mensaje}
                                        </strong>
                                        <p className="cursos-success-text">
                                            Archivo procesado: <strong>{resultadoImportacion.nombreArchivo}</strong>
                                        </p>
                                    </div>

                                    <div className="cursos-report-box">
                                        <div className="cursos-report-grid">
                                            <div>Filas leídas: <strong>{resultadoImportacion.reporte?.totalFilasLeidas}</strong></div>
                                            <div>Carreras verificadas: <strong>{resultadoImportacion.reporte?.carrerasVerificadas}</strong></div>
                                            <div>Semestres nuevos: <strong>{resultadoImportacion.reporte?.semestresCreados}</strong></div>
                                            <div>Cursos insertados: <strong style={{ color: '#059669' }}>{resultadoImportacion.reporte?.cursosInsertados}</strong></div>
                                            <div>Catálogo / tipo actualizado: <strong style={{ color: '#1D4ED8' }}>{resultadoImportacion.reporte?.cursosActualizados || 0}</strong></div>
                                            <div>Duplicados por carrera ignorados: <strong style={{ color: '#D97706' }}>{resultadoImportacion.reporte?.filasIgnoradasPorRepetido}</strong></div>
                                        </div>
                                        <div style={{ marginTop: '12px', fontSize: '11px', color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: '8px', lineHeight: '1.5' }}>
                                            <i className="fas fa-shield-alt"></i> Se ignoró automáticamente la columna: <strong>CLASIFICACION BLACKBOARD</strong>. El campo <strong>IS_CARRERA</strong> se calcula solo: 1 si el código del curso inicia con una carrera registrada o con <strong>NCCU</strong>, y 0 si es un curso complementario.
                                            <br />
                                            <i className="fas fa-copy"></i> {resultadoImportacion.reglaDuplicados || 'Un mismo curso se registra una sola vez por carrera, pero sí puede pertenecer a carreras diferentes.'}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="eq4-modal-footer-custom">
                            <button className="eq4-btn eq4-btn-secondary" onClick={cerrarModal}>
                                {resultadoImportacion ? 'Cerrar' : 'Cancelar'}
                            </button>
                            {!resultadoImportacion && (
                                <button
                                    className="eq4-btn eq4-btn-primary"
                                    disabled={!archivoSeleccionado || cargandoProceso}
                                    onClick={subirArchivoExcel}
                                >
                                    <i className={cargandoProceso ? "fas fa-spinner fa-spin" : "fas fa-sync-alt"}></i>
                                    {cargandoProceso
                                        ? `Procesando... ${progresoImportacion?.porcentaje || 0}%`
                                        : 'Analizar y Cargar Datos'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ================================================================= */}
            {/*   PANEL FLOTANTE DE PROGRESO DE IMPORTACIÓN - EQUIPO 4            */}
            {/*   Se mantiene abajo a la derecha aunque se cierre el modal.       */}
            {/* ================================================================= */}

            {/* ================================================================= */}
            {/*   PANEL DE CLASIFICACIÓN DE ASIGNATURAS - EQUIPO 4                */}
            {/*   Aparece a la derecha del modal cuando se selecciona un archivo. */}
            {/* ================================================================= */}
            {panelClasificacionVisible && modalAbierto && (
                <div className="cursos-clasificacion-panel">
                    <div className="cursos-clasificacion-header">
                        <span className="cursos-clasificacion-header-title">
                            <i className="fas fa-tags"></i> Clasificación de Asignaturas
                        </span>
                        <button
                            type="button"
                            className="cursos-clasificacion-close"
                            onClick={() => setPanelClasificacionVisible(false)}
                            title="Cerrar panel"
                        >
                            <i className="fas fa-times"></i>
                        </button>
                    </div>
                    <p className="cursos-clasificacion-desc">
                        Revisa y ajusta cómo se clasificará cada asignatura encontrada en el archivo.
                    </p>
                    {analizandoPrefijos ? (
                        <div className="cursos-clasificacion-cargando">
                            <i className="fas fa-spinner fa-spin"></i> Analizando archivo...
                        </div>
                    ) : (
                        <table className="cursos-clasificacion-tabla">
                            <thead>
                                <tr>
                                    <th className="cursos-clas-th-asig">Asignatura</th>
                                    <th className="cursos-clas-th-radio">De Carrera</th>
                                    <th className="cursos-clas-th-radio">Complementario</th>
                                </tr>
                            </thead>
                            <tbody>
                                {prefijosEncontrados.map((item) => (
                                    <tr key={item.prefijo} className={item.esCarreraForzado ? 'cursos-clas-row-forzado' : ''}>
                                        <td className="cursos-clas-td-asig">
                                            <strong>{item.prefijo}</strong>
                                            {item.esCarreraForzado && (
                                                <span className="cursos-clas-badge-forzado" title="Este prefijo pertenece a una carrera registrada y no puede modificarse">
                                                    <i className="fas fa-lock"></i>
                                                </span>
                                            )}
                                        </td>
                                        <td className="cursos-clas-td-radio">
                                            {item.esCarreraForzado ? (
                                                <i className="fas fa-check-circle cursos-clas-icon-forzado" title="De carrera (forzado)"></i>
                                            ) : (
                                                <input
                                                    type="radio"
                                                    name={`clas-${item.prefijo}`}
                                                    value="carrera"
                                                    checked={item.seleccion === 'carrera'}
                                                    onChange={() => cambiarSeleccionPrefijo(item.prefijo, 'carrera')}
                                                    className="cursos-clas-radio"
                                                />
                                            )}
                                        </td>
                                        <td className="cursos-clas-td-radio">
                                            {item.esCarreraForzado ? (
                                                <span className="cursos-clas-icon-vacio">—</span>
                                            ) : (
                                                <input
                                                    type="radio"
                                                    name={`clas-${item.prefijo}`}
                                                    value="complementario"
                                                    checked={item.seleccion === 'complementario'}
                                                    onChange={() => cambiarSeleccionPrefijo(item.prefijo, 'complementario')}
                                                    className="cursos-clas-radio"
                                                />
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    <div className="cursos-clasificacion-footer">
                        <span className="cursos-clas-hint">
                            <i className="fas fa-info-circle"></i>
                            Los prefijos con <i className="fas fa-lock"></i> coinciden con una carrera registrada y siempre serán <strong>De Carrera</strong>.
                        </span>
                    </div>
                </div>
            )}            
            {panelProgresoVisible && !modalAbierto && (
                <div className="cursos-progress-panel">
                    <div className={`cursos-progress-header ${panelConError ? 'cursos-progress-header-error' : panelCompletado ? 'cursos-progress-header-success' : 'cursos-progress-header-normal'}`}>
                        <div className="cursos-progress-header-left">
                            <i className={
                                cargandoProceso
                                    ? 'fas fa-circle-notch fa-spin'
                                    : panelCompletado
                                        ? 'fas fa-check-circle'
                                        : 'fas fa-exclamation-triangle'
                            }></i>
                            {cargandoProceso
                                ? 'Importando cursos...'
                                : panelCompletado
                                    ? 'Importación completada'
                                    : 'Importación con errores'}
                        </div>
                        {!cargandoProceso && (
                            <button
                                type="button"
                                onClick={cerrarPanelProgreso}
                                title="Cerrar panel"
                                className="cursos-progress-close"
                            >
                                <i className="fas fa-times"></i>
                            </button>
                        )}
                    </div>

                    <div className="cursos-progress-body">
                        <div className="cursos-progress-row">
                            <span className="cursos-progress-label">
                                <i className="fas fa-tasks cursos-progress-label-icon"></i>
                                {progresoImportacion?.paso || (panelCompletado ? 'Finalizado' : 'Procesando')}
                            </span>
                            <span className={`cursos-progress-percent ${panelConError ? 'cursos-progress-percent-error' : panelCompletado ? 'cursos-progress-percent-success' : 'cursos-progress-percent-normal'}`}>
                                {porcentajeProgreso}%
                            </span>
                        </div>

                        <div className="cursos-progress-bar-bg">
                            <div
                                className={`cursos-progress-bar-fill ${panelConError ? 'cursos-progress-bar-error' : panelCompletado ? 'cursos-progress-bar-success' : 'cursos-progress-bar-normal'}`}
                                style={{ width: `${porcentajeProgreso}%` }}
                            ></div>
                        </div>

                        <p className="cursos-progress-message">
                            {progresoImportacion?.mensaje || (panelCompletado ? 'El archivo fue procesado correctamente.' : 'Preparando el proceso...')}
                        </p>

                        {cargandoProceso && (
                            <div className="cursos-progress-info">
                                <i className="fas fa-info-circle cursos-progress-info-icon"></i>
                                <span>El proceso continúa en segundo plano. Puedes seguir usando el sistema mientras termina.</span>
                            </div>
                        )}

                        {datosProgreso.totalFilas > 0 && !panelCompletado && !panelConError && (
                            <div className="cursos-progress-details">
                                <span>Filas revisadas: <strong>{datosProgreso.filasProcesadas || 0} / {datosProgreso.totalFilas || 0}</strong></span>
                                <span>Cursos insertados: <strong style={{ color: '#059669' }}>{datosProgreso.cursosInsertados || 0}</strong></span>
                                <span>Cursos actualizados: <strong style={{ color: '#1D4ED8' }}>{datosProgreso.cursosActualizados || 0}</strong></span>
                                <span>Duplicados ignorados: <strong style={{ color: '#D97706' }}>{datosProgreso.filasIgnoradas || 0}</strong></span>
                                <span>Semestres nuevos: <strong>{datosProgreso.semestresCreados || 0}</strong></span>
                            </div>
                        )}

                        {panelCompletado && (
                            <div style={{ marginTop: '11px', paddingTop: '10px', borderTop: '1px solid var(--border)' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 12px', fontSize: '11px', color: 'var(--text-normal)' }}>
                                    <span>Cursos insertados: <strong style={{ color: '#059669' }}>{resultadoImportacion.reporte?.cursosInsertados}</strong></span>
                                    <span>Cursos actualizados: <strong style={{ color: '#1D4ED8' }}>{resultadoImportacion.reporte?.cursosActualizados || 0}</strong></span>
                                    <span>Duplicados ignorados: <strong style={{ color: '#D97706' }}>{resultadoImportacion.reporte?.filasIgnoradasPorRepetido}</strong></span>
                                    <span>Semestres nuevos: <strong>{resultadoImportacion.reporte?.semestresCreados}</strong></span>
                                    <span>Filas leídas: <strong>{resultadoImportacion.reporte?.totalFilasLeidas}</strong></span>
                                </div>
                                <div className="cursos-progress-footer">
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => setModalAbierto(true)}
                                    >
                                        <i className="fas fa-list-alt"></i> Ver detalle
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-primary btn-sm"
                                        onClick={cerrarPanelProgreso}
                                    >
                                        <i className="fas fa-check"></i> Cerrar
                                    </button>
                                </div>
                            </div>
                        )}

                        {panelConError && (
                            <div className="cursos-progress-error-box">
                                <p className="cursos-progress-error-title">
                                    {errorImportacion.mensaje}
                                </p>
                                {errorImportacion.detalle && (
                                    <p className="cursos-progress-error-detail">
                                        {errorImportacion.detalle}
                                    </p>
                                )}
                                {errorImportacion.carrerasFaltantes && errorImportacion.carrerasFaltantes.length > 0 && (
                                    <p className="cursos-progress-error-hint">
                                        <strong>Carreras no registradas:</strong> {errorImportacion.carrerasFaltantes.join(', ')}
                                    </p>
                                )}
                                <div className="cursos-progress-footer">
                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => setModalAbierto(true)}
                                    >
                                        <i className="fas fa-list-alt"></i> Ver detalle
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-primary btn-sm"
                                        onClick={cerrarPanelProgreso}
                                    >
                                        <i className="fas fa-times"></i> Cerrar
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
});

export default CursosView;
