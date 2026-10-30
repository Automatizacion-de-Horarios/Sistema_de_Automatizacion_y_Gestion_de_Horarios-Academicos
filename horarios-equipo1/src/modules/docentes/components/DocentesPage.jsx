import React, { useMemo, useRef, useState } from 'react';
import { useDocentes } from '../hooks/useDocentes';
import { MODO_DEMO } from '../services/docentesService';
import DocenteForm from './DocenteForm';
import DocentesTable from './DocentesTable';
import CentroControlModal from './CentroControlModal';
import EstadoModal from './EstadoModal';
import CompetenciasModal from './CompetenciasModal';
import DisponibilidadCuadriculaModal from './DisponibilidadCuadriculaModal';
import DisponibilidadRangoModal from './DisponibilidadRangoModal';
import HorarioDocenteModal from './HorarioDocenteModal';
import EditarDocenteModal from './EditarDocenteModal';
import Toast from './Toast';

// Pantalla principal del Equipo 1: Gestión de Instructores y Docentes.
export default function DocentesPage() {
  const dc = useDocentes();
  const [modal, setModal] = useState(null); // { tipo, id }
  const [busqueda, setBusqueda] = useState('');
  const [toast, setToast] = useState(null);
  const temporizador = useRef(null);

  const avisar = (msg, tipo = 'success') => {
    setToast({ msg, tipo });
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => setToast(null), 4500);
  };
  const abrir = (tipo) => (id) => setModal({ tipo, id });
  const cerrar = () => setModal(null);
  const docente = modal ? dc.getDocenteById(modal.id) : null;

  const filtrados = useMemo(() => {
    const q = busqueda.toLowerCase().trim();
    if (!q) return dc.docentes;
    return dc.docentes.filter((d) => `${d.nombre} ${d.dni} ${d.especialidad}`.toLowerCase().includes(q));
  }, [dc.docentes, busqueda]);

  // ----- Acciones (los errores se propagan al modal/formulario que las llamó) -----
  const crear = async (datos) => {
    await dc.crear(datos);
    avisar(`Instructor ${datos.apellidos}, ${datos.nombres} registrado exitosamente.`);
  };
  const actualizar = async (datos) => {
    await dc.actualizar(modal.id, datos);
    cerrar();
    avisar('Datos del instructor actualizados.');
  };
  const guardarEstado = async (id, estado) => {
    try {
      await dc.cambiarEstado(id, estado);
      cerrar();
      avisar('Estado operativo y auditoría actualizados.');
    } catch (e) {
      avisar(e.message, 'error');
    }
  };
  const guardarDisponibilidad = async (id, slots) => {
    await dc.guardarDisponibilidad(id, slots);
    cerrar();
    avisar(`Disponibilidad guardada (${slots.length} horas semanales).`);
  };
  const guardarCompetencias = async (id, cursoIds) => {
    await dc.guardarCompetencias(id, cursoIds);
    cerrar();
    avisar('Competencias actualizadas.');
  };

  return (
    <>
      <header className="view-header">
        <div className="header-title-area">
          <h1>Gestión de Instructores y Docentes</h1>
          <p className="subtitle">Control de disponibilidad, estado operativo (A/I/V) y auditoría de cambios.</p>
        </div>
      </header>

      {MODO_DEMO && (
        <div className="demo-banner">
          <i className="fas fa-flask"></i> <strong>Modo demo:</strong> faltan SUPABASE_URL y SUPABASE_ANON_KEY en el archivo .env.
          Los cambios se guardan solo en memoria y se pierden al recargar.
        </div>
      )}
      {dc.error && (
        <div className="form-error" style={{ marginBottom: 12 }}>
          <i className="fas fa-exclamation-circle"></i> {dc.error}{' '}
          <button className="btn btn-secondary btn-sm" onClick={() => dc.refetch()}>Reintentar</button>
        </div>
      )}

      <div className="card">
        <DocenteForm onGuardar={crear} />

        <div className="search-box" style={{ margin: '16px 0' }}>
          <i className="fas fa-search"></i>
          <input type="text" placeholder="Buscar por nombre, DNI o especialidad..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>

        <DocentesTable
          docentes={filtrados}
          loading={dc.loading}
          onEstado={abrir('estado')}
          onCompetencias={abrir('competencias')}
          onRango={abrir('rango')}
          onCuadricula={abrir('cuadricula')}
          onClases={abrir('clases')}
          onCentro={abrir('centro')}
        />
        <div className="table-footer">
          <span>{filtrados.length} {filtrados.length === 1 ? 'instructor' : 'instructores'}</span>
        </div>
      </div>

      {docente && modal.tipo === 'centro' && (
        <CentroControlModal
          docente={docente}
          onClose={cerrar}
          onEditar={() => setModal({ tipo: 'editar', id: docente.id })}
          onAccion={(accion) => setModal({ tipo: accion, id: docente.id })}
        />
      )}
      {docente && modal.tipo === 'editar' && <EditarDocenteModal docente={docente} onGuardar={actualizar} onClose={cerrar} />}
      {docente && modal.tipo === 'estado' && <EstadoModal docente={docente} onGuardar={guardarEstado} onClose={cerrar} />}
      {docente && modal.tipo === 'competencias' && (
        <CompetenciasModal docente={docente} cursos={dc.cursos} onGuardar={guardarCompetencias} onClose={cerrar} />
      )}
      {docente && modal.tipo === 'cuadricula' && (
        <DisponibilidadCuadriculaModal
          docente={docente}
          onGuardar={guardarDisponibilidad}
          onVerRango={() => setModal({ tipo: 'rango', id: docente.id })}
          onClose={cerrar}
        />
      )}
      {docente && modal.tipo === 'rango' && (
        <DisponibilidadRangoModal
          docente={docente}
          onGuardar={guardarDisponibilidad}
          onVerCuadricula={() => setModal({ tipo: 'cuadricula', id: docente.id })}
          onClose={cerrar}
        />
      )}
      {docente && modal.tipo === 'clases' && (
        <HorarioDocenteModal docente={docente} cargarClases={dc.listarClasesDocente} onClose={cerrar} />
      )}

      <Toast toast={toast} />
    </>
  );
}
