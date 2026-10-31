import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE_URL } from '../config/api';
import { authFetch } from '../lib/authFetch';
import './DocentesView.css';

const DIAS = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO'];
const ESTADOS = { A: 'Activo', I: 'Inactivo' };
const CONTRATOS = [
    { clave: 'TIEMPO_COMPLETO', tipo_contrato: 'TIEMPO_COMPLETO', horas_semanales_meta: 36, etiqueta: 'Tiempo completo · 36 h', etiquetaCorta: 'Tiempo completo · 36 h' },
    { clave: 'PARCIAL_19', tipo_contrato: 'TIEMPO_PARCIAL', horas_semanales_meta: 19, etiqueta: 'Tiempo parcial · Lunes a viernes (19 h)', etiquetaCorta: 'Parcial L-V · 19 h' },
    { clave: 'PARCIAL_23', tipo_contrato: 'TIEMPO_PARCIAL', horas_semanales_meta: 23, etiqueta: 'Tiempo parcial · Lunes a sábado (23 h)', etiquetaCorta: 'Parcial L-S · 23 h' },
];
const FILTROS_CONTRATO = [
    { clave: 'TODOS', etiqueta: 'Todos' },
    { clave: 'TIEMPO_COMPLETO_36', etiqueta: 'Tiempo Completo 36h' },
    { clave: 'TIEMPO_PARCIAL_23', etiqueta: 'Tiempo Parcial 23h' },
    { clave: 'TIEMPO_PARCIAL_19', etiqueta: 'Tiempo Parcial 19h' },
];
const coincideFiltroContrato = (docente, filtro) => {
    if (filtro === 'TODOS') return true;
    const tipo = docente?.tipo_contrato;
    const horas = Number(docente?.horas_semanales_meta);
    if (filtro === 'TIEMPO_COMPLETO_36') return tipo === 'TIEMPO_COMPLETO' && horas === 36;
    if (filtro === 'TIEMPO_PARCIAL_23') return tipo === 'TIEMPO_PARCIAL' && horas === 23;
    if (filtro === 'TIEMPO_PARCIAL_19') return tipo === 'TIEMPO_PARCIAL' && horas === 19;
    return true;
};
const claveContrato = (tipo, horas) => {
    const opcion = CONTRATOS.find((contrato) =>
        contrato.tipo_contrato === tipo && contrato.horas_semanales_meta === Number(horas)
    );
    return opcion?.clave || 'TIEMPO_COMPLETO';
};
const etiquetaContrato = (docente) => CONTRATOS.find((contrato) =>
    contrato.clave === claveContrato(docente.tipo_contrato, docente.horas_semanales_meta)
)?.etiquetaCorta || 'Tiempo completo · 36 h';
const restriccionActiva = (docente) =>
    docente?.tipo_contrato === 'TIEMPO_PARCIAL' || Number(docente?.usa_restriccion_horaria) === 1;
const estadoRestriccion = (docente) => {
    if (!restriccionActiva(docente)) {
        return {
            clase: 'doc-libre',
            texto: 'Libre',
            titulo: 'El solver asigna el horario dentro de la franja institucional sin usar la cuadrícula.',
        };
    }
    if (!docente?.franjas?.length) {
        return {
            clase: 'doc-pendiente',
            texto: 'Configurar',
            titulo: 'La restricción está activa pero no hay franjas marcadas. Configura la cuadrícula.',
        };
    }
    return {
        clase: 'doc-restringida',
        texto: 'Restringida',
        titulo: 'El solver respeta los días y horas marcados en la cuadrícula.',
    };
};

function BadgeRestriccion({ docente }) {
    const estado = estadoRestriccion(docente);
    return <span className={'doc-restriccion-badge ' + estado.clase} title={estado.titulo}>{estado.texto}</span>;
}
const hora = (n) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
const convertir = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
const horaVisible = (valor) => {
    const minutos = typeof valor === 'number' ? valor : convertir(valor);
    const horas = Math.floor(minutos / 60) % 24;
    return (horas % 12 || 12) + ':' + String(minutos % 60).padStart(2, '0') + (horas < 12 ? ' AM' : ' PM');
};
const normalizar = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const ordenarDocentes = (lista) => [...lista].sort((a, b) =>
    normalizar(a.apellidos + ' ' + a.nombres).localeCompare(normalizar(b.apellidos + ' ' + b.nombres), 'es')
    || Number(a.id_docente) - Number(b.id_docente)
);

// Conserva el listado mientras se navega a otra sección y se vuelve a Docentes.
const cacheDocentes = new Map();

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

function seleccionarFranjas(franjas, horario) {
    const celdas = new Set();
    const limiteInicio = convertir(horario.hora_inicio), limiteFin = convertir(horario.hora_fin);
    for (const f of franjas) {
        const dia = normalizar(f.dia_semana).toUpperCase().trim();
        const inicio = convertir(f.hora_inicio), fin = convertir(f.hora_fin);
        if (!DIAS.includes(dia) || !/^\d{2}:\d{2}(:00)?$/.test(f.hora_inicio) || !/^\d{2}:\d{2}(:00)?$/.test(f.hora_fin) || inicio % 15 || fin % 15 || inicio < limiteInicio || fin > limiteFin || fin <= inicio) {
            throw new Error('Hay disponibilidad fuera del horario configurado o incompatible con intervalos de 15 minutos. Revisa esos datos antes de editarlos.');
        }
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

const CeldaDisponible = memo(function CeldaDisponible({ clave, dia, minuto, marcada, ocupado, pintarRef, tipoEntradaRef, alternar }) {
    return <td><button type="button" disabled={ocupado} aria-label={dia + ' ' + horaVisible(minuto) + ' a ' + horaVisible(minuto + 15)} aria-pressed={marcada} className={marcada ? 'doc-disponible' : ''}
        onPointerDown={(evento) => {
            tipoEntradaRef.current = evento.pointerType;
            if (evento.pointerType !== 'mouse' || evento.button !== 0) return;
            evento.preventDefault();
            pintarRef.current = !marcada;
            alternar(clave, !marcada);
        }}
        onPointerEnter={(evento) => {
            if (!ocupado && (evento.buttons & 1) && pintarRef.current !== null) alternar(clave, pintarRef.current);
        }}
        onClick={(evento) => {
            if (evento.detail === 0 || tipoEntradaRef.current !== 'mouse') alternar(clave);
        }}>{marcada ? '✓' : '—'}</button></td>;
});

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
    return <div className="doc-fondo"><section className={'doc-modal' + (amplio ? ' doc-modal-amplio' : '')} ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={titulo}>
        <header><div><h2>{titulo}</h2>{subtitulo && <p className="doc-modal-subtitulo">{subtitulo}</p>}</div><button type="button" className="doc-cerrar" aria-label="Cerrar" onClick={onCerrar}>×</button></header>
        {children}
    </section></div>;
}

export default function DocentesView({ periodo, triggerToast }) {
    const [docentes, setDocentes] = useState(() => cacheDocentes.get(periodo)?.docentes || []);
    const [configuracion, setConfiguracion] = useState(() => cacheDocentes.get(periodo)?.configuracion || null);
    const [busqueda, setBusqueda] = useState('');
    const [filtroContrato, setFiltroContrato] = useState('TODOS');
    const [cargando, setCargando] = useState(() => !cacheDocentes.has(periodo));
    const [ocupado, setOcupado] = useState(false);
    const [ventana, setVentana] = useState(null);
    const [docente, setDocente] = useState(null);
    const [formulario, setFormulario] = useState({ nombres: '', apellidos: '', especialidad: '', tipo_contrato: 'TIEMPO_COMPLETO', horas_semanales_meta: 36 });
    const [estadoOcupado, setEstadoOcupado] = useState(null);
    const [contratoOcupado, setContratoOcupado] = useState(null);
    const [disponibilidadCargando, setDisponibilidadCargando] = useState(null);
    const [celdas, setCeldas] = useState(new Set());
    const [restriccion, setRestriccion] = useState(1);
    const pintarRef = useRef(null);
    const tipoEntradaRef = useRef(null);
    const versionLocal = useRef(0);
    const api = useCallback((ruta = '', metodo = 'GET', datos, opciones = {}) => solicitarDocentes(ruta, metodo, datos, periodo, opciones.signal), [periodo]);
    const notificar = useCallback((texto) => {
        if (texto && typeof triggerToast === 'function') triggerToast(texto);
    }, [triggerToast]);

    const minutosHorario = useMemo(() => {
        if (!configuracion?.horario) return [];
        const inicio = convertir(configuracion.horario.hora_inicio), fin = convertir(configuracion.horario.hora_fin);
        return Array.from({ length: Math.max(0, Math.floor((fin - inicio) / 15)) }, (_, i) => inicio + i * 15);
    }, [configuracion]);
    const docentesVisibles = useMemo(() => {
        const texto = normalizar(busqueda.trim());
        return docentes.filter((d) => {
            if (!coincideFiltroContrato(d, filtroContrato)) return false;
            return !texto || normalizar(d.apellidos + ' ' + d.nombres).includes(texto);
        });
    }, [docentes, busqueda, filtroContrato]);
    const franjas = useMemo(() => obtenerFranjas(celdas), [celdas]);
    const horasDisponibles = franjas.reduce((n, f) => n + (convertir(f.hora_fin) - convertir(f.hora_inicio)) / 60, 0);

    async function recargar() {
        const version = versionLocal.current;
        setCargando(true);
        try {
            const resultado = await api();
            setConfiguracion(resultado.configuracion);
            if (version === versionLocal.current) setDocentes(resultado.docentes);
        } catch (fallo) {
            notificar(fallo.message);
        } finally {
            setCargando(false);
        }
    }

    useEffect(() => {
        let cancelado = false;
        const version = versionLocal.current;
        api().then((resultado) => {
            if (!cancelado) {
                setConfiguracion(resultado.configuracion);
                if (version === versionLocal.current) setDocentes(resultado.docentes);
            }
        }).catch((fallo) => {
            if (!cancelado) notificar(fallo.message);
        }).finally(() => {
            if (!cancelado) setCargando(false);
        });
        return () => { cancelado = true; };
    }, [api, notificar]);

    useEffect(() => {
        if (configuracion) cacheDocentes.set(periodo, { docentes, configuracion });
    }, [docentes, configuracion, periodo]);

    useEffect(() => {
        const terminar = () => { pintarRef.current = null; };
        window.addEventListener('pointerup', terminar);
        window.addEventListener('pointercancel', terminar);
        return () => { window.removeEventListener('pointerup', terminar); window.removeEventListener('pointercancel', terminar); };
    }, []);

    function abrirRegistro() {
        setDocente(null);
        setFormulario({ nombres: '', apellidos: '', especialidad: '', tipo_contrato: 'TIEMPO_COMPLETO', horas_semanales_meta: 36 });
        setVentana('registrar');
    }

    function abrirEdicion(d) {
        setDocente(d);
        setFormulario({
            nombres: d.nombres || '',
            apellidos: d.apellidos || '',
            especialidad: d.especialidad || '',
            tipo_contrato: d.tipo_contrato || 'TIEMPO_COMPLETO',
            horas_semanales_meta: Number(d.horas_semanales_meta) || 36,
        });
        setVentana('editar');
    }

    async function abrirDisponibilidad(d) {
        const horario = configuracion?.horario;
        if (!horario) {
            notificar('No está disponible la configuración horaria de este periodo.');
            return;
        }

        const mostrar = (filas, bandera) => {
            try {
                setCeldas(seleccionarFranjas(filas, horario));
                setRestriccion(
                    d.tipo_contrato === 'TIEMPO_PARCIAL' || Number(bandera) === 1 ? 1 : 0
                );
                setDocente(d);
                setVentana('disponibilidad');
            } catch (fallo) {
                notificar(fallo.message);
            }
        };

        // El listado ya trae la disponibilidad: abrir la cuadrícula no hace otra consulta.
        if (Array.isArray(d.franjas)) {
            mostrar(d.franjas, d.usa_restriccion_horaria);
            return;
        }

        setDisponibilidadCargando(d.id_docente);
        try {
            const resultado = await api('/' + d.id_docente + '/disponibilidad');
            versionLocal.current += 1;
            setDocentes((actual) => actual.map((doc) =>
                doc.id_docente === d.id_docente
                    ? { ...doc, franjas: resultado.franjas, usa_restriccion_horaria: resultado.usa_restriccion_horaria }
                    : doc
            ));
            mostrar(resultado.franjas, resultado.usa_restriccion_horaria);
        } catch (fallo) {
            notificar(fallo.message);
        } finally {
            setDisponibilidadCargando(null);
        }
    }

    async function alternarEstado(d) {
        if (estadoOcupado !== null) return;
        const anterior = d.estado === 'A' ? 'A' : 'I';
        const nuevo = anterior === 'A' ? 'I' : 'A';
        setEstadoOcupado(d.id_docente);
        versionLocal.current += 1;
        setDocentes((actual) => actual.map((doc) =>
            doc.id_docente === d.id_docente ? { ...doc, estado: nuevo } : doc
        ));

        try {
            const resultado = await api('/' + d.id_docente + '/estado', 'PATCH', { estado: nuevo });
            notificar(resultado.mensaje);
        } catch (fallo) {
            setDocentes((actual) => actual.map((doc) =>
                doc.id_docente === d.id_docente ? { ...doc, estado: anterior } : doc
            ));
            notificar(fallo.message);
        } finally {
            setEstadoOcupado(null);
        }
    }

    async function actualizarContrato(d, clave) {
        if (contratoOcupado !== null) return;
        const opcion = CONTRATOS.find((contrato) => contrato.clave === clave);
        if (!opcion) return;

        const anteriorTipo = d.tipo_contrato;
        const anteriorHoras = d.horas_semanales_meta;
        const anteriorRestriccion = restriccionActiva(d) ? 1 : 0;
        const siguienteRestriccion = opcion.tipo_contrato === 'TIEMPO_PARCIAL'
            ? 1
            : anteriorTipo === 'TIEMPO_PARCIAL'
                ? 0
                : anteriorRestriccion;
        const actualizado = {
            ...d,
            tipo_contrato: opcion.tipo_contrato,
            horas_semanales_meta: opcion.horas_semanales_meta,
            usa_restriccion_horaria: siguienteRestriccion,
        };

        setContratoOcupado(d.id_docente);
        versionLocal.current += 1;
        setDocentes((actual) => actual.map((doc) =>
            doc.id_docente === d.id_docente ? actualizado : doc
        ));

        try {
            const resultado = await api('/' + d.id_docente + '/contrato', 'PATCH', {
                tipo_contrato: opcion.tipo_contrato,
                horas_semanales_meta: opcion.horas_semanales_meta,
            });
            const bandera = Number(resultado.usa_restriccion_horaria) === 1 ? 1 : 0;
            const final = { ...actualizado, usa_restriccion_horaria: bandera };
            versionLocal.current += 1;
            setDocentes((actual) => actual.map((doc) =>
                doc.id_docente === d.id_docente ? final : doc
            ));

            const requiereCuadricula = opcion.tipo_contrato === 'TIEMPO_PARCIAL' && !d.franjas?.length;
            notificar(resultado.mensaje + (requiereCuadricula
                ? ' Configura la cuadrícula para el tiempo parcial.'
                : ''));
            if (requiereCuadricula) await abrirDisponibilidad(final);
        } catch (fallo) {
            setDocentes((actual) => actual.map((doc) =>
                doc.id_docente === d.id_docente
                    ? {
                        ...doc,
                        tipo_contrato: anteriorTipo,
                        horas_semanales_meta: anteriorHoras,
                        usa_restriccion_horaria: anteriorRestriccion,
                    }
                    : doc
            ));
            notificar(fallo.message);
        } finally {
            setContratoOcupado(null);
        }
    }

    function cerrar() {
        if (!ocupado) setVentana(null);
    }

    async function guardar(evento) {
        evento.preventDefault();
        setOcupado(true);
        try {
            let resultado;
            let documentoParaCuadricula = null;
            if (ventana === 'registrar') {
                resultado = await api('', 'POST', { ...formulario, estado: 'A' });
                const nuevo = {
                    id_docente: resultado.id_docente,
                    nombres: formulario.nombres,
                    apellidos: formulario.apellidos,
                    especialidad: null,
                    tipo_contrato: formulario.tipo_contrato,
                    horas_semanales_meta: formulario.horas_semanales_meta,
                    usa_restriccion_horaria: Number(resultado.usa_restriccion_horaria) === 1 ? 1 : 0,
                    estado: 'A',
                    minutos_disponibles: 0,
                    franjas: [],
                };
                versionLocal.current += 1;
                setDocentes((actual) => ordenarDocentes([...actual, nuevo]));
                if (formulario.tipo_contrato === 'TIEMPO_PARCIAL') documentoParaCuadricula = nuevo;
            }
            if (ventana === 'editar') {
                resultado = await api('/' + docente.id_docente, 'PUT', formulario);
                const bandera = Number(resultado.usa_restriccion_horaria) === 1 ? 1 : 0;
                const actualizado = {
                    ...docente,
                    nombres: formulario.nombres,
                    apellidos: formulario.apellidos,
                    especialidad: formulario.especialidad || null,
                    tipo_contrato: formulario.tipo_contrato,
                    horas_semanales_meta: formulario.horas_semanales_meta,
                    usa_restriccion_horaria: bandera,
                };
                versionLocal.current += 1;
                setDocentes((actual) => ordenarDocentes(actual.map((doc) =>
                    doc.id_docente === docente.id_docente ? actualizado : doc
                )));
                if (formulario.tipo_contrato === 'TIEMPO_PARCIAL' && !docente.franjas?.length) {
                    documentoParaCuadricula = actualizado;
                }
            }
            if (ventana === 'disponibilidad') {
                if (restriccion === 1 && franjas.length === 0) {
                    throw new Error('Marca al menos una franja para activar la restricción horaria.');
                }
                resultado = await api('/' + docente.id_docente + '/disponibilidad', 'PUT', {
                    franjas,
                    usa_restriccion_horaria: restriccion,
                });
                const minutos = resultado.franjas.reduce((total, f) =>
                    total + convertir(f.hora_fin) - convertir(f.hora_inicio), 0);
                const bandera = Number(resultado.usa_restriccion_horaria) === 1 ? 1 : 0;
                versionLocal.current += 1;
                setDocentes((actual) => actual.map((doc) =>
                    doc.id_docente === docente.id_docente
                        ? {
                            ...doc,
                            minutos_disponibles: minutos,
                            franjas: resultado.franjas,
                            usa_restriccion_horaria: bandera,
                        }
                        : doc
                ));
            }
            setVentana(null);
            if (documentoParaCuadricula) {
                notificar(resultado.mensaje + ' Configura la cuadrícula para el tiempo parcial.');
                await abrirDisponibilidad(documentoParaCuadricula);
            } else {
                notificar(resultado.mensaje);
            }
        } catch (fallo) {
            notificar(fallo.message);
        } finally {
            setOcupado(false);
        }
    }

    const alternarCelda = useCallback((clave, valor) => {
        setCeldas((actual) => {
            const copia = new Set(actual);
            if (valor ?? !copia.has(clave)) copia.add(clave);
            else copia.delete(clave);
            return copia;
        });
    }, []);

    function alternarDia(dia) {
        setCeldas((actual) => {
            const copia = new Set(actual);
            const completo = minutosHorario.length > 0 && minutosHorario.every((n) => actual.has(dia + ':' + n));
            minutosHorario.forEach((n) => {
                if (completo) copia.delete(dia + ':' + n);
                else copia.add(dia + ':' + n);
            });
            return copia;
        });
    }

    const cambiar = (evento) => setFormulario((actual) => ({ ...actual, [evento.target.name]: evento.target.value }));
    const cambiarContratoFormulario = (evento) => {
        const opcion = CONTRATOS.find((contrato) => contrato.clave === evento.target.value);
        if (opcion) {
            setFormulario((actual) => ({
                ...actual,
                tipo_contrato: opcion.tipo_contrato,
                horas_semanales_meta: opcion.horas_semanales_meta,
            }));
        }
    };
    const titulos = { registrar: 'Registrar instructor', editar: 'Editar docente', disponibilidad: 'Cuadrícula de disponibilidad' };
    const textosGuardar = { registrar: 'Registrar instructor', editar: 'Guardar cambios', disponibilidad: 'Guardar disponibilidad' };

    return <div className="doc-panel" lang="es">
        <h1>Gestión de docentes</h1>
        <p className="doc-subtitulo">Administra docentes, estados y disponibilidad horaria.</p>
        <div className="doc-tarjeta">
            <div className="doc-barra">
                <input type="search" aria-label="Buscar docentes por nombre" placeholder="Buscar docente por nombre o apellido…" value={busqueda} onChange={(evento) => setBusqueda(evento.target.value)} />
                <button className="doc-azul" type="button" disabled={ocupado} onClick={abrirRegistro}>+ Registrar instructor</button>
            </div>
            <div className="doc-filtros" role="group" aria-label="Filtrar docentes por tipo de contrato">
                {FILTROS_CONTRATO.map((filtro) => <button key={filtro.clave} type="button" className={'doc-filtro' + (filtroContrato === filtro.clave ? ' doc-filtro-activo' : '')} aria-pressed={filtroContrato === filtro.clave} onClick={() => setFiltroContrato(filtro.clave)}>{filtro.etiqueta}</button>)}
            </div>
            <div className="doc-tabla-contenedor"><table className="doc-tabla">
                <thead><tr><th>Instructor</th><th>Especialidad</th><th>Contrato</th><th>Disponibilidad</th><th>Estado</th><th>Editar</th></tr></thead>
                <tbody>
                    {cargando && !docentes.length && <tr><td colSpan={6}>Cargando docentes…</td></tr>}
                    {docentesVisibles.map((d) => <tr key={d.id_docente}>
                        <td><strong>{d.apellidos}, {d.nombres}</strong></td>
                        <td>{d.especialidad || '—'}</td>
                        <td><select className={'doc-contrato-select doc-' + (d.tipo_contrato === 'TIEMPO_PARCIAL' ? 'parcial' : 'completo')} aria-label={'Tipo de contrato de ' + d.nombres + ' ' + d.apellidos} aria-busy={contratoOcupado === d.id_docente} title={etiquetaContrato(d)} value={claveContrato(d.tipo_contrato, d.horas_semanales_meta)} disabled={ocupado || contratoOcupado !== null} onChange={(evento) => actualizarContrato(d, evento.target.value)}>{CONTRATOS.map((contrato) => <option key={contrato.clave} value={contrato.clave}>{contrato.etiquetaCorta}</option>)}</select></td>
                        <td><div className="doc-disponibilidad-celda"><button disabled={ocupado || disponibilidadCargando === d.id_docente} onClick={() => abrirDisponibilidad(d)}>{disponibilidadCargando === d.id_docente ? 'Cargando…' : 'Cuadrícula · ' + (Number(d.minutos_disponibles || 0) / 60).toLocaleString('es-PE') + ' h'}</button><BadgeRestriccion docente={d} /></div></td>
                        <td><button className={'doc-estado doc-' + (d.estado === 'A' ? 'A' : 'I')} disabled={ocupado || estadoOcupado !== null} aria-busy={estadoOcupado === d.id_docente} title={'Cambiar a ' + (d.estado === 'A' ? 'Inactivo' : 'Activo')} onClick={() => alternarEstado(d)}>{ESTADOS[d.estado] || 'Inactivo'}</button></td>
                        <td><button aria-label={'Editar a ' + d.nombres + ' ' + d.apellidos} disabled={ocupado} onClick={() => abrirEdicion(d)}>⚙</button></td>
                    </tr>)}
                    {!cargando && docentesVisibles.length === 0 && <tr><td colSpan={6}>{busqueda || filtroContrato !== 'TODOS' ? 'No se encontraron docentes con ese nombre o filtro.' : 'No hay docentes registrados.'}</td></tr>}
                </tbody>
            </table></div>
            <footer className="doc-pie"><span>{docentesVisibles.length} {docentesVisibles.length === 1 ? 'docente' : 'docentes'}</span><button disabled={ocupado || cargando} onClick={recargar}>{cargando ? 'Actualizando…' : 'Actualizar listado'}</button></footer>
        </div>
        {ventana && <Modal titulo={titulos[ventana]} subtitulo={docente ? docente.apellidos + ', ' + docente.nombres : ''} onCerrar={cerrar} amplio={ventana === 'disponibilidad'}>
            <form onSubmit={guardar}>
                <div className="doc-cuerpo">
                    {ventana === 'registrar' && <fieldset disabled={ocupado} className="doc-formulario">
                        <label>Nombres<input required name="nombres" maxLength={100} value={formulario.nombres} onChange={cambiar} /></label>
                        <label>Apellidos<input required name="apellidos" maxLength={100} value={formulario.apellidos} onChange={cambiar} /></label>
                        <label>Tipo de contrato<select name="contrato" value={claveContrato(formulario.tipo_contrato, formulario.horas_semanales_meta)} onChange={cambiarContratoFormulario}>{CONTRATOS.map((contrato) => <option key={contrato.clave} value={contrato.clave}>{contrato.etiqueta}</option>)}</select></label>
                    </fieldset>}
                    {ventana === 'editar' && <fieldset disabled={ocupado} className="doc-formulario">
                        <label>Nombres<input required name="nombres" maxLength={100} value={formulario.nombres} onChange={cambiar} /></label>
                        <label>Apellidos<input required name="apellidos" maxLength={100} value={formulario.apellidos} onChange={cambiar} /></label>
                        <label>Especialidad<input name="especialidad" maxLength={100} value={formulario.especialidad} onChange={cambiar} /></label>
                        <label>Tipo de contrato<select name="contrato" value={claveContrato(formulario.tipo_contrato, formulario.horas_semanales_meta)} onChange={cambiarContratoFormulario}>{CONTRATOS.map((contrato) => <option key={contrato.clave} value={contrato.clave}>{contrato.etiqueta}</option>)}</select></label>
                    </fieldset>}
                    {ventana === 'disponibilidad' && <fieldset disabled={ocupado}>
                        <div className="doc-resumen-horario"><strong>{horasDisponibles.toLocaleString('es-PE')} h</strong><span>Meta semanal: {docente?.horas_semanales_meta || 36} h</span><button type="button" onClick={() => setCeldas(new Set())}>Limpiar selección</button></div>
                        <label className={'doc-restriccion' + (docente?.tipo_contrato === 'TIEMPO_PARCIAL' ? ' doc-restriccion-obligatoria' : '')}>
                            <input
                                type="checkbox"
                                checked={restriccion === 1}
                                disabled={ocupado || docente?.tipo_contrato === 'TIEMPO_PARCIAL'}
                                onChange={(evento) => setRestriccion(evento.target.checked ? 1 : 0)}
                            />
                            <span>
                                <strong>Usar restricción horaria</strong>
                                <small>{docente?.tipo_contrato === 'TIEMPO_PARCIAL'
                                    ? 'Obligatorio para tiempo parcial: Solo se asignarán clases dentro de las franjas marcadas.'
                                    : restriccion === 1
                                        ? 'Se respetarán los días y horas marcados en la cuadrícula.'
                                        : 'Se asignará que siempre tiene disponibilidad y no tomará en cuenta esta cuadrícula.'}</small>
                            </span>
                        </label>
                        {restriccion === 1 && celdas.size === 0 && <p className="doc-aviso-restriccion">Marca al menos una franja para poder guardar con la restricción activa.</p>}
                        <div className="doc-grid-contenedor"><table className="doc-grid">
                            <thead><tr><th>Hora</th>{DIAS.map((dia) => <th key={dia}><button type="button" aria-label={'Seleccionar todo el ' + dia} onClick={() => alternarDia(dia)}>{dia}</button></th>)}</tr></thead>
                            <tbody>{minutosHorario.map((minuto) => <tr key={minuto}>
                                <th>{horaVisible(minuto)}–{horaVisible(minuto + 15)}</th>
                                {DIAS.map((dia) => {
                                    const clave = dia + ':' + minuto;
                                    return <CeldaDisponible key={dia} clave={clave} dia={dia} minuto={minuto} marcada={celdas.has(clave)} ocupado={ocupado} pintarRef={pintarRef} tipoEntradaRef={tipoEntradaRef} alternar={alternarCelda} />;
                                })}
                            </tr>)}</tbody>
                        </table></div>
                    </fieldset>}
                </div>
                <footer className="doc-modal-pie"><button type="button" disabled={ocupado} onClick={cerrar}>Cancelar</button><button className="doc-azul" disabled={ocupado || (ventana === 'disponibilidad' && !minutosHorario.length)}>{ocupado ? 'Guardando…' : textosGuardar[ventana]}</button></footer>
            </form>
        </Modal>}
    </div>;
}
