import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE_URL } from '../config/api';
import { authFetch } from '../lib/authFetch';
import './DocentesView.css';

const DIAS = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO'];
const ESTADOS = { A: 'Activo', I: 'Inactivo', V: 'Vacaciones' };
const MINUTOS = Array.from({ length: 68 }, (_, i) => 360 + i * 15);
const hora = (n) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
const convertir = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const horaVisible = (valor) => {
    const minutos = typeof valor === 'number' ? valor : convertir(valor);
    const horas = Math.floor(minutos / 60) % 24;
    return (horas % 12 || 12) + ':' + String(minutos % 60).padStart(2, '0') + (horas < 12 ? ' AM' : ' PM');
};
const normalizar = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const vacio = { nombres: '', apellidos: '', dni: '', especialidad: '', estado: 'A' };
const nombreAuditoria = (valor) => String(valor || '').replace(/^\s*\d+\s*:\s*/, '').trim() || 'Sin registrar';
const fechaVisible = (valor) => {
    if (!valor) return 'Sin registrar';
    const partes = String(valor).replace('T', ' ').split(' ');
    const fecha = partes[0].split('-');
    return fecha.length === 3 ? fecha.reverse().join('/') + (partes[1] ? ' · ' + partes[1].slice(0, 5) : '') : String(valor);
};

function validarCampo(evento) {
    const campo = evento.target;
    campo.setCustomValidity('');
    if (campo.validity.valueMissing) {
        const avisos = { nombreRegistro: 'Escribe los apellidos y nombres del instructor.', nombres: 'Escribe los nombres del docente.', apellidos: 'Escribe los apellidos del docente.' };
        campo.setCustomValidity(avisos[campo.name] || 'Completa este campo.');
    } else if (campo.validity.patternMismatch && ['dni', 'dniRegistro'].includes(campo.name)) {
        campo.setCustomValidity('El DNI debe tener 8 dígitos o quedar vacío.');
    } else if (!campo.validity.valid) {
        campo.setCustomValidity('Revisa el valor de este campo.');
    }
}

function limpiarAvisoCampo(evento) {
    if (typeof evento.target.setCustomValidity === 'function') evento.target.setCustomValidity('');
}

// Toda operación se realiza en la API real; no se crean instructores de ejemplo.
async function solicitarDocentes(ruta = '', metodo = 'GET', datos, periodo, senal) {
    const direccion = API_BASE_URL + '/api/docentes' + ruta + (ruta.includes('?') ? '&' : '?') + 'periodo=' + encodeURIComponent(periodo);
    let respuesta;
    try {
        respuesta = await authFetch(direccion, {
            method: metodo,
            ...(senal ? { signal: senal } : {}),
            headers: { 'Content-Type': 'application/json' },
            ...(datos === undefined ? {} : { body: JSON.stringify(datos) }),
        });
    } catch (fallo) {
        if (fallo.name === 'AbortError') throw fallo;
        throw new Error('No se pudo conectar con el backend. Comprueba que el servidor esté iniciado.', { cause: fallo });
    }
    const resultado = await respuesta.json().catch((fallo) => { if (fallo.name === 'AbortError') throw fallo; return null; });
    if (!respuesta.ok || !resultado) {
        throw new Error(resultado?.mensaje || (respuesta.status === 404
            ? 'No se encontró la API de docentes. Reinicia el backend después de guardar las rutas.'
            : 'No se pudo completar la operación de docentes.'));
    }
    return resultado;
}
function seleccionarFranjas(franjas) {
    const celdas = new Set();
    for (const f of franjas) {
        const dia = normalizar(f.dia_semana).toUpperCase().trim();
        const inicio = convertir(f.hora_inicio), fin = convertir(f.hora_fin);
        if (!DIAS.includes(dia) || !/^\d{2}:\d{2}(:00)?$/.test(f.hora_inicio) || !/^\d{2}:\d{2}(:00)?$/.test(f.hora_fin) || inicio % 15 || fin % 15 || inicio < 0 || fin > 1440 || fin <= inicio) throw new Error('Hay horarios incompatibles con los intervalos de 15 minutos. Revisa esos datos antes de editarlos.');
        for (let n = inicio; n < fin; n += 15) celdas.add(dia + ':' + n);
    }
    return celdas;
}
function obtenerFranjas(celdas) {
    const resultado = [];
    for (const dia of DIAS) {
        const minutos = [...celdas].filter((c) => c.startsWith(dia + ':')).map((c) => Number(c.split(':')[1])).sort((a, b) => a - b);
        const unidas = [];
        for (const minuto of minutos) {
            const ultima = unidas[unidas.length - 1];
            if (ultima && minuto - ultima.fin <= 45) ultima.fin = minuto + 15;
            else unidas.push({ inicio: minuto, fin: minuto + 15 });
        }
        unidas.forEach((f) => resultado.push({ dia_semana: dia, hora_inicio: hora(f.inicio) + ':00', hora_fin: hora(f.fin) + ':00' }));
    }
    return resultado;
}

function Modal({ titulo, subtitulo, onCerrar, children, amplio = false }) {
    const panel = useRef(null);
    const cerrar = useRef(onCerrar);
    useEffect(() => { cerrar.current = onCerrar; }, [onCerrar]);
    useEffect(() => {
        const anterior = document.activeElement;
        const contenido = panel.current;
        const elementos = () => [...contenido.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')].filter((e) => e.getClientRects().length);
        (elementos()[0] || contenido).focus();
        const tecla = (e) => {
            if (e.key === 'Escape') cerrar.current();
            if (e.key !== 'Tab') return;
            const lista = elementos(), primero = lista[0], ultimo = lista[lista.length - 1];
            if (!primero) { e.preventDefault(); contenido.focus(); }
            else if (e.shiftKey && (document.activeElement === primero || !lista.includes(document.activeElement))) { e.preventDefault(); ultimo.focus(); }
            else if (!e.shiftKey && (document.activeElement === ultimo || !lista.includes(document.activeElement))) { e.preventDefault(); primero.focus(); }
        };
        document.addEventListener('keydown', tecla);
        return () => { document.removeEventListener('keydown', tecla); if (anterior?.isConnected) anterior.focus(); };
    }, []);
    return <div className="doc-fondo"><section className={'doc-modal' + (amplio ? ' doc-modal-amplio' : '')} ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={titulo}><header><div><h2>{titulo}</h2>{subtitulo && <p className="doc-modal-subtitulo">{subtitulo}</p>}</div><button type="button" className="doc-cerrar" aria-label="Cerrar" onClick={onCerrar}>×</button></header>{children}</section></div>;
}

export default function DocentesView({ periodo }) {
    const [docentes, setDocentes] = useState([]);
    const [configuracion, setConfiguracion] = useState({ preparado: false, tiene_dni: false, periodo: null });
    const [estadoNuevo, setEstadoNuevo] = useState('A');
    const [ficha, setFicha] = useState(null);
    const [diaNuevo, setDiaNuevo] = useState('LUNES');
    const [inicioNuevo, setInicioNuevo] = useState(360);
    const [finNuevo, setFinNuevo] = useState(720);
    const [cargando, setCargando] = useState(true);
    const [ocupado, setOcupado] = useState(false);
    const [error, setError] = useState('');
    const [mensaje, setMensaje] = useState('');
    const [nombreRegistro, setNombreRegistro] = useState('');
    const [dniRegistro, setDniRegistro] = useState('');
    const [docenteEncontrado, setDocenteEncontrado] = useState(null);
    const [buscandoDocente, setBuscandoDocente] = useState(false);
    const [buscandoNombre, setBuscandoNombre] = useState(false);
    const [coincidenciasNombre, setCoincidenciasNombre] = useState([]);
    const [mostrarCoincidencias, setMostrarCoincidencias] = useState(false);
    const [conflictoDni, setConflictoDni] = useState(false);
    const seleccionActual = useRef(null);
    const [ventana, setVentana] = useState(null);
    const [docente, setDocente] = useState(null);
    const [formulario, setFormulario] = useState(vacio);
    const [cursos, setCursos] = useState([]);
    const [seleccionados, setSeleccionados] = useState(new Set());
    const [carrera, setCarrera] = useState('');
    const [semestre, setSemestre] = useState('');
    const [tipo, setTipo] = useState('');
    const [buscarCurso, setBuscarCurso] = useState('');
    const [soloSeleccionados, setSoloSeleccionados] = useState(false);
    const [celdas, setCeldas] = useState(new Set());
    const [verTramos, setVerTramos] = useState(false);
    const contenedorGrid = useRef(null);
    const filaSeis = useRef(null);
    const pintar = useRef(null);
    const tipoEntrada = useRef(null);

    const api = useCallback((ruta = '', metodo = 'GET', datos, opciones = {}) => solicitarDocentes(ruta, metodo, datos, periodo, opciones.signal), [periodo]);
    const periodoAbierto = configuracion.periodo?.estado === 'A';
    const seleccionarExistente = useCallback((registro) => {
        seleccionActual.current = registro;
        setDocenteEncontrado(registro);
        setNombreRegistro(registro.apellidos + ', ' + registro.nombres);
        setDniRegistro(registro.dni || '');
        setCoincidenciasNombre([]); setMostrarCoincidencias(false);
        setBuscandoNombre(false); setBuscandoDocente(false); setConflictoDni(false);
        setError(''); setMensaje('');
    }, []);

    useEffect(() => {
        let cancelado = false;
        api().then((r) => { if (!cancelado) { setDocentes(r.docentes); setConfiguracion(r.configuracion); } })
            .catch((e) => { if (!cancelado) setError(e.message); })
            .finally(() => { if (!cancelado) setCargando(false); });
        return () => { cancelado = true; };
    }, [api]);
    useEffect(() => {
        if (dniRegistro.length !== 8 || !configuracion.preparado || seleccionActual.current?.dni === dniRegistro) return;
        const controlador = new AbortController();
        api('/buscar-dni?dni=' + encodeURIComponent(dniRegistro), 'GET', undefined, { signal: controlador.signal })
            .then((resultado) => {
                if (controlador.signal.aborted) return;
                if (!resultado.docente) { setConflictoDni(false); return; }
                if (seleccionActual.current && seleccionActual.current.id_docente !== resultado.docente.id_docente) {
                    setConflictoDni(true);
                    setError('Ese DNI pertenece a otro docente.');
                    return;
                }
                seleccionarExistente(resultado.docente);
            })
            .catch((fallo) => { if (fallo.name !== 'AbortError') { setError(fallo.message); setConflictoDni(true); } })
            .finally(() => { if (!controlador.signal.aborted) setBuscandoDocente(false); });
        return () => controlador.abort();
    }, [api, dniRegistro, configuracion.preparado, seleccionarExistente]);

    useEffect(() => {
        if (docenteEncontrado || nombreRegistro.trim().length < 2 || !configuracion.preparado) return;
        const controlador = new AbortController();
        const espera = setTimeout(() => {
            api('/buscar-nombre?nombre=' + encodeURIComponent(nombreRegistro.trim()), 'GET', undefined, { signal: controlador.signal })
                .then((resultado) => {
                    if (controlador.signal.aborted || seleccionActual.current) return;
                    setCoincidenciasNombre(Array.isArray(resultado.docentes) ? resultado.docentes : []);
                    setMostrarCoincidencias(true);
                })
                .catch((fallo) => { if (fallo.name !== 'AbortError') setError(fallo.message); })
                .finally(() => { if (!controlador.signal.aborted) setBuscandoNombre(false); });
        }, 220);
        return () => { clearTimeout(espera); controlador.abort(); };
    }, [api, nombreRegistro, docenteEncontrado, configuracion.preparado]);

    useEffect(() => {
        if (ventana === 'disponibilidad' && !verTramos && contenedorGrid.current && filaSeis.current) contenedorGrid.current.scrollTop = filaSeis.current.offsetTop - 40;
    }, [ventana, verTramos]);
    useEffect(() => {
        const terminar = () => { pintar.current = null; };
        window.addEventListener('pointerup', terminar); window.addEventListener('pointercancel', terminar);
        return () => { window.removeEventListener('pointerup', terminar); window.removeEventListener('pointercancel', terminar); };
    }, []);

    const carreras = useMemo(() => [...new Map(cursos.map((c) => [String(c.id_carrera), c.codigo_carrera + ' — ' + c.nombre_carrera])).entries()], [cursos]);
    const cursosVisibles = useMemo(() => cursos.filter((c) => (!carrera || String(c.id_carrera) === carrera) && (!semestre || c.semestre === semestre) && (tipo === '' || String(Number(c.is_carrera)) === tipo) && (!soloSeleccionados || seleccionados.has(c.id_curso)) && normalizar(c.mat_cur + ' ' + c.nombre_curso).includes(normalizar(buscarCurso).trim())), [cursos, carrera, semestre, tipo, soloSeleccionados, seleccionados, buscarCurso]);
    const franjas = useMemo(() => obtenerFranjas(celdas), [celdas]);
    const horas = franjas.reduce((n, f) => n + (convertir(f.hora_fin) - convertir(f.hora_inicio)) / 60, 0);
    const diasActivos = new Set(franjas.map((franja) => franja.dia_semana)).size;

    async function recargar() {
        setCargando(true); setError('');
        try { const resultado = await api(); setDocentes(resultado.docentes); setConfiguracion(resultado.configuracion); } catch (e) { setError(e.message); }
        finally { setCargando(false); }
    }
    function limpiarRegistro() {
        seleccionActual.current = null;
        setDocenteEncontrado(null); setNombreRegistro(''); setDniRegistro('');
        setCoincidenciasNombre([]); setMostrarCoincidencias(false);
        setBuscandoNombre(false); setBuscandoDocente(false); setConflictoDni(false);
        setError(''); setMensaje('');
    }
    function cambiarNombreRegistro(evento) {
        if (seleccionActual.current) setDniRegistro('');
        seleccionActual.current = null;
        setDocenteEncontrado(null);
        setNombreRegistro(evento.target.value);
        setCoincidenciasNombre([]); setMostrarCoincidencias(true);
        setBuscandoNombre(evento.target.value.trim().length >= 2);
        setBuscandoDocente(false); setConflictoDni(false);
        setError(''); setMensaje('');
    }
    function cambiarDniRegistro(evento) {
        const valor = evento.target.value.replace(/\D/g, '').slice(0, 8);
        setDniRegistro(valor);
        setError(''); setMensaje(''); setConflictoDni(false);
        setBuscandoDocente(valor.length === 8 && seleccionActual.current?.dni !== valor);
    }
    async function registrarDesdeBarra(evento) {
        evento.preventDefault();
        if (ocupado || cargando || buscandoDocente || buscandoNombre || conflictoDni || !configuracion.preparado) return;
        setError(''); setMensaje('');
        if (dniRegistro && !/^\d{8}$/.test(dniRegistro)) {
            setError('El DNI debe tener 8 dígitos o quedar vacío.');
            return;
        }
        let datosNuevos = null;
        if (!docenteEncontrado) {
            const partes = nombreRegistro.split(',');
            if (partes.length !== 2 || !partes[0].trim() || !partes[1].trim()) {
                setError('Para un docente nuevo escribe Apellidos, Nombres. También puedes seleccionar uno existente.');
                return;
            }
            const apellidos = partes[0].trim(), nombres = partes[1].trim();
            if (apellidos.length > 100 || nombres.length > 100) {
                setError('Los nombres y los apellidos admiten hasta 100 caracteres cada uno.');
                return;
            }
            datosNuevos = { nombres, apellidos, dni: dniRegistro.trim() || null, especialidad: '', estado: 'A' };
        }
        setOcupado(true);
        try {
            const resultado = docenteEncontrado
                ? await api('/' + docenteEncontrado.id_docente + '/registrar', 'POST', { dni: dniRegistro.trim() || null })
                : await api('', 'POST', datosNuevos);
            limpiarRegistro();
            await recargar();
            setMensaje(resultado.mensaje);
        } catch (fallo) {
            setError(fallo.message);
        } finally {
            setOcupado(false);
        }
    }
    async function abrir(tipoVentana, d = null) {
        const mostrarRango = tipoVentana === 'rango';
        if (mostrarRango) tipoVentana = 'disponibilidad';
        setError(''); setMensaje(''); setDocente(d);
        if (tipoVentana === 'estado') setEstadoNuevo(d.estado);
        if (tipoVentana === 'editar' && !d) return;
        if (tipoVentana === 'editar') { setFormulario(d ? { ...vacio, ...d, dni: d.dni || '', especialidad: d.especialidad || '' } : { ...vacio }); setVentana('editar'); return; }
        if (['cursos', 'disponibilidad', 'ficha'].includes(tipoVentana)) {
            setOcupado(true);
            try {
                if (tipoVentana === 'ficha') {
                    setFicha(await api('/' + d.id_docente + '/ficha'));
                } else if (tipoVentana === 'cursos') {
                    const r = await api('/' + d.id_docente + '/cursos');
                    setCursos(r.cursos); setSeleccionados(new Set(r.cursos.filter((c) => Number(c.seleccionado) === 1).map((c) => c.id_curso)));
                    setCarrera(''); setSemestre(''); setTipo(''); setBuscarCurso(''); setSoloSeleccionados(false);
                } else { const r = await api('/' + d.id_docente + '/disponibilidad'); setCeldas(seleccionarFranjas(r.franjas)); setVerTramos(mostrarRango); }
                setVentana(tipoVentana);
            } catch (e) { setError(e.message); } finally { setOcupado(false); }
        } else setVentana(tipoVentana);
    }
    function cerrar() { if (!ocupado) { setVentana(null); setError(''); } }
    async function guardar(e) {
        e.preventDefault(); setOcupado(true); setError('');
        try {
            let r;
            if (ventana === 'editar') r = await api('/' + docente.id_docente, 'PUT', formulario);
            if (ventana === 'estado') r = await api('/' + docente.id_docente + '/estado', 'PATCH', { estado: estadoNuevo });
            if (ventana === 'cursos') r = await api('/' + docente.id_docente + '/cursos', 'PUT', { ids_cursos: [...seleccionados] });
            if (ventana === 'disponibilidad') r = await api('/' + docente.id_docente + '/disponibilidad', 'PUT', { franjas });
            setVentana(null); setMensaje(r.mensaje); await recargar();
        } catch (fallo) { setError(fallo.message); } finally { setOcupado(false); }
    }
    function alternarCurso(id) { setSeleccionados((actual) => { const copia = new Set(actual); if (copia.has(id)) copia.delete(id); else copia.add(id); return copia; }); }
    function marcarCursos(valor) { setSeleccionados((actual) => { const copia = new Set(actual); cursosVisibles.forEach((c) => { if (valor && Number(c.habilitado) === 1) copia.add(c.id_curso); else if (!valor) copia.delete(c.id_curso); }); return copia; }); }
    function alternarCelda(clave, valor) { setCeldas((actual) => { const copia = new Set(actual); if (valor ?? !copia.has(clave)) copia.add(clave); else copia.delete(clave); return copia; }); }
    function alternarDia(dia) { setCeldas((actual) => { const copia = new Set(actual), completo = MINUTOS.every((n) => actual.has(dia + ':' + n)); MINUTOS.forEach((n) => { if (completo) copia.delete(dia + ':' + n); else copia.add(dia + ':' + n); }); return copia; }); }
    const cambiar = (e) => setFormulario((actual) => ({ ...actual, [e.target.name]: e.target.value }));
    function agregarTramo() {
        if (finNuevo <= inicioNuevo) { setError('La hora final debe ser posterior al inicio.'); return; }
        setError('');
        setCeldas((actual) => { const copia = new Set(actual); for (let minuto = inicioNuevo; minuto < finNuevo; minuto += 15) copia.add(diaNuevo + ':' + minuto); return copia; });
    }
    function quitarTramo(franja) {
        setCeldas((actual) => { const copia = new Set(actual); for (let minuto = convertir(franja.hora_inicio); minuto < convertir(franja.hora_fin); minuto += 15) copia.delete(franja.dia_semana + ':' + minuto); return copia; });
    }
    function marcarTurno(inicio, fin) {
        setCeldas((actual) => { const copia = new Set(actual); for (const dia of DIAS.slice(0, 6)) for (let minuto = inicio; minuto < fin; minuto += 15) copia.add(dia + ':' + minuto); return copia; });
    }
    const docenteDelModal = ventana === 'ficha' && ficha ? ficha.docente : docente;
    const textoGuardar = { editar: 'Guardar datos', estado: 'Guardar estado', cursos: 'Guardar asignaciones', disponibilidad: 'Guardar disponibilidad' };
    const titulos = { editar: 'Editar datos del docente', estado: 'Cambiar estado operativo', cursos: 'Asignación de cursos y competencias', disponibilidad: verTramos ? 'Rango horario semanal' : 'Cuadrícula semanal de disponibilidad', acciones: 'Gestión del instructor', ficha: 'Ficha completa del docente', auditoria: 'Último cambio registrado', clases: 'Horario visual semanal' };

    return <div className="doc-panel" lang="es" onInvalid={validarCampo} onInput={limpiarAvisoCampo}>
        <h1>Gestión de Instructores y Docentes</h1><p className="doc-subtitulo">Control de disponibilidad, estado operativo (A/I/V) y auditoría de cambios.</p>
        <div className="doc-tarjeta">
            <form className="doc-barra" onSubmit={registrarDesdeBarra}>
                <div className="doc-id-registro"><input aria-label="ID del docente" placeholder="ID auto." value={docenteEncontrado?.id_docente || ''} readOnly title="El ID del docente nuevo se genera al guardar" />{docenteEncontrado && <button type="button" aria-label="Limpiar docente seleccionado" onClick={limpiarRegistro}>×</button>}</div>
                <div className="doc-buscar-registro" onBlur={(evento) => { if (!evento.currentTarget.contains(evento.relatedTarget)) setMostrarCoincidencias(false); }}>
                    <input name="nombreRegistro" role="combobox" aria-label="Apellidos, Nombres del instructor" aria-autocomplete="list" aria-controls="doc-coincidencias" aria-expanded={mostrarCoincidencias && coincidenciasNombre.length > 0} placeholder={buscandoDocente ? 'Buscando docente…' : 'Apellidos, Nombres del Instructor…'} maxLength={201} autoComplete="off" required value={nombreRegistro} disabled={ocupado || !configuracion.preparado} onChange={cambiarNombreRegistro} onFocus={() => { if (!docenteEncontrado && coincidenciasNombre.length) setMostrarCoincidencias(true); }} onKeyDown={(evento) => { if (evento.key === 'Escape') setMostrarCoincidencias(false); if (evento.key === 'ArrowDown' && mostrarCoincidencias) { evento.preventDefault(); evento.currentTarget.parentElement.querySelector('.doc-opcion-registro')?.focus(); } }} />
                    {mostrarCoincidencias && coincidenciasNombre.length > 0 && <ul id="doc-coincidencias" className="doc-coincidencias" role="listbox" aria-label="Docentes existentes">{coincidenciasNombre.map((registro) => <li key={registro.id_docente}><button className="doc-opcion-registro" role="option" aria-selected={docenteEncontrado?.id_docente === registro.id_docente} type="button" onClick={() => seleccionarExistente(registro)}><span className="doc-id-badge">#{registro.id_docente}</span><span><strong>{registro.apellidos}, {registro.nombres}</strong><small>{registro.dni || 'Sin DNI'}</small></span></button></li>)}</ul>}
                </div>
                <input name="dniRegistro" aria-label="DNI del instructor" inputMode="numeric" maxLength={8} pattern="[0-9]{8}" placeholder="DNI (opcional)" value={dniRegistro} disabled={ocupado || !configuracion.preparado} readOnly={Boolean(docenteEncontrado?.dni)} onChange={cambiarDniRegistro} />
                <button className="doc-azul" type="submit" disabled={ocupado || cargando || buscandoDocente || buscandoNombre || conflictoDni || !configuracion.preparado}>{ocupado && !ventana ? 'Guardando…' : '+ Registrar Instructor'}</button>
            </form>
            {!cargando && !error && !configuracion.preparado && <div className="doc-preparacion" role="status"><strong>Falta preparar el registro real.</strong> Ejecuta el archivo database/grupo1_docentes_real.sql en HeidiSQL y pulsa “Actualizar listado”. El panel no modifica el esquema automáticamente.</div>}
            {error && !ventana && <p role="alert" className="doc-error">{error}</p>}{mensaje && <p role="status" className="doc-exito">{mensaje}</p>}{ocupado && !ventana && <p role="status">Cargando…</p>}
            <div className="doc-tabla-contenedor"><table className="doc-tabla"><thead><tr><th>ID</th><th>Instructor</th><th>Especialidad / competencias</th><th>Disponibilidad</th><th>Estado operativo</th><th>Auditoría</th><th>Acciones</th></tr></thead><tbody>
                {cargando ? <tr><td colSpan={7}>Cargando docentes…</td></tr> : docentes.map((d) => <tr key={d.id_docente}>
                    <td><span className="doc-id-badge">#{d.id_docente}</span></td>
                    <td><strong>{d.apellidos}, {d.nombres}</strong><small>DNI: {d.dni || 'Sin registrar'}</small></td>
                    <td>{d.especialidad || 'Sin especialidad'}<button className="doc-cursos" disabled={ocupado} onClick={() => abrir('cursos', d)}>▣ {d.cursos_asignados ?? '—'} asignadas</button></td>
                    <td><div className="doc-opciones"><button disabled={ocupado} onClick={() => abrir('rango', d)}>◷ Rango</button><button className="doc-azul" disabled={ocupado} onClick={() => abrir('disponibilidad', d)}>▦ Cuadrícula ({(d.minutos_disponibles / 60).toLocaleString('es-PE')}h)</button><button disabled={ocupado} onClick={() => abrir('clases', d)}>▤ Clases</button></div></td>
                    <td><button className={'doc-estado doc-' + d.estado} disabled={ocupado} onClick={() => abrir('estado', d)}>{ESTADOS[d.estado]} ({d.estado})</button></td>
                    <td><button className="doc-auditoria" disabled={ocupado} onClick={() => abrir('auditoria', d)}>{nombreAuditoria(d.usuario_modificacion)}<small>{fechaVisible(d.fecha_modificacion)}</small></button></td>
                    <td><button aria-label={'Gestionar a ' + d.nombres + ' (ID ' + d.id_docente + ')'} disabled={ocupado} onClick={() => abrir('acciones', d)}>⚙</button></td>
                </tr>)}{!cargando && !docentes.length && <tr><td colSpan={7}>Sin instructores registrados.</td></tr>}
            </tbody></table></div><footer className="doc-pie"><span>{docentes.length + (docentes.length === 1 ? ' instructor en sistema' : ' instructores en sistema')}</span><button disabled={ocupado || cargando} onClick={recargar}>Actualizar listado</button></footer>
        </div>
        {ventana && <Modal titulo={titulos[ventana]} subtitulo={docenteDelModal ? docenteDelModal.apellidos + ', ' + docenteDelModal.nombres : ''} onCerrar={cerrar} amplio={['cursos','disponibilidad','clases','ficha'].includes(ventana)}><form onSubmit={guardar}>
            <div className="doc-cuerpo">{error && <p role="alert" className="doc-error">{error}</p>}
                {ventana === 'editar' && <fieldset disabled={ocupado} className="doc-formulario">
                    <label>Nombres<input required name="nombres" maxLength={100} value={formulario.nombres} onChange={cambiar} /></label><label>Apellidos<input required name="apellidos" maxLength={100} value={formulario.apellidos} onChange={cambiar} /></label>
                    <label>DNI (opcional)<input disabled={ocupado || !configuracion.tiene_dni} name="dni" inputMode="numeric" maxLength={8} pattern="[0-9]{8}" value={formulario.dni} onChange={cambiar} /></label><label>Especialidad<input name="especialidad" maxLength={100} value={formulario.especialidad} onChange={cambiar} /></label>
                </fieldset>}
                {ventana === 'estado' && <fieldset disabled={ocupado} className="doc-formulario"><label>Nuevo estado<select value={estadoNuevo} onChange={(evento) => setEstadoNuevo(evento.target.value)}><option value="A">Activo (A)</option><option value="I">Inactivo (I)</option><option value="V">Vacaciones (V)</option></select></label></fieldset>}
                {ventana === 'cursos' && <fieldset disabled={ocupado}>
                    <div className="doc-periodo-modal">Periodo <strong>{configuracion.periodo?.descripcion}</strong>{!periodoAbierto && <span className="doc-periodo-cerrado">Cerrado</span>}</div>
                    <div className="doc-filtros"><input aria-label="Buscar curso" placeholder="Código o nombre del curso…" value={buscarCurso} onChange={(e) => setBuscarCurso(e.target.value)} /><select aria-label="Carrera" value={carrera} onChange={(e) => setCarrera(e.target.value)}><option value="">TODAS LAS CARRERAS</option>{carreras.map(([id, nombre]) => <option key={id} value={id}>{nombre.toLocaleUpperCase('es-PE')}</option>)}</select><select aria-label="Tipo de curso" value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">CARRERA Y COMPLEMENTARIOS</option><option value="1">CURSOS DE CARRERA</option><option value="0">CURSOS COMPLEMENTARIOS</option></select></div>
                    <div className="doc-semestres" role="group" aria-label="Filtrar por semestre"><button type="button" className={!semestre ? 'activo' : ''} onClick={() => setSemestre('')}>Todos los semestres</button>{['I','II','III','IV','V','VI'].map((ciclo) => <button type="button" key={ciclo} className={semestre === ciclo ? 'activo' : ''} onClick={() => setSemestre(ciclo)}>Semestre {ciclo}</button>)}</div>
                    <div className="doc-seleccion"><strong>{seleccionados.size} asignadas</strong><label><input type="checkbox" checked={soloSeleccionados} onChange={(e) => setSoloSeleccionados(e.target.checked)} /> Solo seleccionados</label><button type="button" disabled={!periodoAbierto} onClick={() => marcarCursos(true)}>Marcar visibles</button><button type="button" disabled={!periodoAbierto} onClick={() => marcarCursos(false)}>Desmarcar visibles</button></div>
                    <div className="doc-lista-cursos">{cursosVisibles.map((c) => <label className={'doc-curso ' + (seleccionados.has(c.id_curso) ? 'doc-elegido' : '')} key={c.id_curso}><input type="checkbox" checked={seleccionados.has(c.id_curso)} disabled={ocupado || !periodoAbierto || (Number(c.habilitado) !== 1 && !seleccionados.has(c.id_curso))} onChange={() => alternarCurso(c.id_curso)} /><span><small>{String(c.codigo_carrera).toLocaleUpperCase('es-PE')} · SEMESTRE {c.semestre} · {String(c.mat_cur).toLocaleUpperCase('es-PE')} · {Number(c.is_carrera) ? 'CARRERA' : 'COMPLEMENTARIO'}</small><strong>{String(c.nombre_curso).toLocaleUpperCase('es-PE')}</strong><small>{c.horario_sinfo} · {c.total_horas} horas curriculares</small><small>Teoría: {c.horas_teoria} h · Taller: {c.horas_taller} h · Virtual: {c.horas_virtual} h · Evaluación: {c.horas_evaluacion} h{Number(c.habilitado) !== 1 ? ' · Inactivo' : ''}</small></span></label>)}</div>{!cursosVisibles.length && <p>No hay cursos para estos filtros.</p>}
                </fieldset>}
                {ventana === 'disponibilidad' && <fieldset disabled={ocupado}>
                    <div className="doc-seleccion"><div className="doc-resumen-horario"><strong>{horas.toLocaleString('es-PE')} h</strong><span>{diasActivos} {diasActivos === 1 ? 'día' : 'días'}</span><span className="doc-receso" title="Se unen separaciones de hasta 45 minutos. Las de 60 minutos quedan separadas.">Recesos automáticos</span></div><button type="button" onClick={() => setVerTramos(!verTramos)}>{verTramos ? 'Ver cuadrícula' : 'Ver rango'}</button><button type="button" onClick={() => setCeldas(new Set())}>Limpiar selección</button></div>
                    {!verTramos && <div className="doc-turnos"><button type="button" onClick={() => marcarTurno(360, 1380)}>Todo disponible (6 AM–11 PM)</button><button type="button" onClick={() => marcarTurno(360, 780)}>Mañana (6 AM–1 PM)</button><button type="button" onClick={() => marcarTurno(780, 1080)}>Tarde (1 PM–6 PM)</button><button type="button" onClick={() => marcarTurno(1080, 1380)}>Noche (6 PM–11 PM)</button></div>}
                    {verTramos && <div className="doc-agregar-tramo"><label>Día<select value={diaNuevo} onChange={(evento) => setDiaNuevo(evento.target.value)}>{DIAS.map((dia) => <option key={dia} value={dia}>{dia}</option>)}</select></label><label>Desde<select value={inicioNuevo} onChange={(evento) => setInicioNuevo(Number(evento.target.value))}>{MINUTOS.map((minuto) => <option key={minuto} value={minuto}>{horaVisible(minuto)}</option>)}</select></label><label>Hasta<select value={finNuevo} onChange={(evento) => setFinNuevo(Number(evento.target.value))}>{MINUTOS.map((minuto) => minuto + 15).map((minuto) => <option key={minuto} value={minuto}>{horaVisible(minuto)}</option>)}</select></label><button type="button" onClick={agregarTramo}>+ Agregar tramo</button></div>}
                    {verTramos ? <table className="doc-tabla"><thead><tr><th>Día</th><th>Desde</th><th>Hasta</th><th></th></tr></thead><tbody>{franjas.map((f) => <tr key={f.dia_semana + f.hora_inicio}><td>{f.dia_semana}</td><td>{horaVisible(f.hora_inicio)}</td><td>{horaVisible(f.hora_fin)}</td><td><button type="button" onClick={() => quitarTramo(f)}>Quitar tramo</button></td></tr>)}{!franjas.length && <tr><td colSpan={4}>Sin horarios registrados.</td></tr>}</tbody></table> :
                    <div className="doc-grid-contenedor" ref={contenedorGrid}><table className="doc-grid"><thead><tr><th>Hora</th>{DIAS.map((dia) => <th key={dia}><button type="button" onClick={() => alternarDia(dia)}>{dia}</button></th>)}</tr></thead><tbody>{MINUTOS.map((n) => <tr key={n} ref={n === 360 ? filaSeis : null}><th>{horaVisible(n)}–{horaVisible(n+15)}</th>{DIAS.map((dia) => { const clave = dia + ':' + n, marcada = celdas.has(clave); return <td key={dia}><button type="button" disabled={ocupado} aria-label={dia + ' ' + horaVisible(n) + ' a ' + horaVisible(n+15)} aria-pressed={marcada} className={marcada ? 'doc-disponible' : ''}
                        onPointerDown={(e) => { tipoEntrada.current = e.pointerType; if (e.pointerType !== 'mouse' || e.button !== 0) return; e.preventDefault(); pintar.current = !marcada; alternarCelda(clave, !marcada); }}
                        onPointerEnter={(e) => { if (!ocupado && (e.buttons & 1) && pintar.current !== null) alternarCelda(clave, pintar.current); }}
                        onClick={(e) => { if (e.detail === 0 || tipoEntrada.current !== 'mouse') alternarCelda(clave); }}>{marcada ? '✓ Disp.' : '—'}</button></td>; })}</tr>)}</tbody></table></div>}
                </fieldset>}
                {ventana === 'acciones' && <div className="doc-menu"><button type="button" disabled={ocupado} onClick={() => abrir('editar', docente)}>✎ Editar datos del docente</button><button type="button" disabled={ocupado} onClick={() => abrir('ficha', docente)}>▤ Ver ficha completa y auditoría</button></div>}
                {ventana === 'ficha' && ficha && <div className="doc-ficha"><dl><dt>DNI</dt><dd>{ficha.docente.dni || 'Sin registrar'}</dd><dt>Especialidad</dt><dd>{ficha.docente.especialidad || 'Sin registrar'}</dd><dt>Estado</dt><dd>{ESTADOS[ficha.docente.estado]}</dd><dt>Fecha de registro</dt><dd>{fechaVisible(ficha.docente.fecha_registro)}</dd></dl><div className="doc-ficha-auditoria"><strong>Último cambio registrado</strong><p>Modificado por: {nombreAuditoria(ficha.docente.usuario_modificacion)}<br />Fecha y hora: {fechaVisible(ficha.docente.fecha_modificacion)}</p></div><h3>Cursos asignados · {ficha.periodo.descripcion}</h3>{ficha.cursos.length ? <ul>{ficha.cursos.map((curso) => <li key={curso.id_curso}>{String(curso.mat_cur).toLocaleUpperCase('es-PE')} — {String(curso.nombre_curso).toLocaleUpperCase('es-PE')}</li>)}</ul> : <p>Sin cursos asignados.</p>}<h3>Disponibilidad semanal</h3>{ficha.disponibilidad.length ? <ul>{ficha.disponibilidad.map((franja, indice) => <li key={indice}>{franja.dia_semana}: {horaVisible(franja.hora_inicio)}–{horaVisible(franja.hora_fin)}</li>)}</ul> : <p>Sin horarios registrados.</p>}</div>}
                {ventana === 'auditoria' && <div><p><strong>Modificado por:</strong> {nombreAuditoria(docente.usuario_modificacion)}</p><p><strong>Fecha y hora:</strong> {fechaVisible(docente.fecha_modificacion)}</p><p><strong>Estado:</strong> {ESTADOS[docente.estado]}</p></div>}
                {ventana === 'clases' && <><div className="doc-periodo-modal">Periodo <strong>{configuracion.periodo?.descripcion}</strong></div><div className="doc-semana-clases">{['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'].map((dia) => <section key={dia}><h3>{dia}</h3><p>Sin clases</p></section>)}</div></>}
            </div>
            <footer className="doc-modal-pie"><button type="button" disabled={ocupado} onClick={cerrar}>{['editar','estado','cursos','disponibilidad'].includes(ventana) ? 'Cancelar' : 'Cerrar'}</button>{['editar','estado','cursos','disponibilidad'].includes(ventana) && <button className="doc-azul" disabled={ocupado || (ventana === 'cursos' && !periodoAbierto)}>{ocupado ? 'Guardando…' : textoGuardar[ventana]}</button>}</footer>
        </form></Modal>}
    </div>;
}
