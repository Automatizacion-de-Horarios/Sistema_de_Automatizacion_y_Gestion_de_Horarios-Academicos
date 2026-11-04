import { useState } from 'react';
import { mallaSemestreService } from '../mallaSemestre.service';

/**
 * Sub-Hook: useMallaCursoModal (Equipo 4)
 * Encapsula la apertura, edición, cálculo de horas y guardado de cursos mediante ModalCurso.
 */
export function useMallaCursoModal({ triggerToast, onCursoGuardado }) {
    const [modalCursoAbierto, setModalCursoAbierto] = useState(false);
    const [modoModalCurso, setModoModalCurso] = useState('crear');
    const [semestreModal, setSemestreModal] = useState(null);
    const [guardandoCurso, setGuardandoCurso] = useState(false);
    const [errorModalCurso, setErrorModalCurso] = useState(null);

    const [formCurso, setFormCurso] = useState({
        id_curso: null,
        mat_cur: '',
        catalogo: '',
        nombre_curso: '',
        horario_sinfo: 'TEC',
        is_carrera: 1,
        semanas: 16,
        horas_teoria: 0,
        horas_taller: 0,
        horas_virtual: 0,
        horas_evaluacion: 0,
        total_horas: 0,
        horas_semestre_meta: 510
    });

    // Abrir modal de creación de curso
    const abrirModalCrearCurso = (semestre) => {
        setSemestreModal(semestre);
        setModoModalCurso('crear');
        setErrorModalCurso(null);
        setFormCurso({
            id_curso: null,
            mat_cur: '',
            catalogo: '',
            nombre_curso: '',
            horario_sinfo: 'TEC',
            is_carrera: 1,
            semanas: 16,
            horas_teoria: 0,
            horas_taller: 0,
            horas_virtual: 0,
            horas_evaluacion: 0,
            total_horas: 0,
            horas_semestre_meta: semestre.horas_meta || 510
        });
        setModalCursoAbierto(true);
    };

    // Abrir modal de edición de curso
    const abrirModalEditarCurso = (curso, semestre) => {
        setSemestreModal(semestre);
        setModoModalCurso('editar');
        setErrorModalCurso(null);
        const esSeminario = /seminario/i.test(curso.nombre_curso || '');
        setFormCurso({
            id_curso: curso.id_curso,
            mat_cur: curso.mat_cur || '',
            catalogo: curso.catalogo || '',
            nombre_curso: curso.nombre_curso || '',
            horario_sinfo: esSeminario ? 'TAL' : (curso.horario_sinfo || 'TEC'),
            is_carrera: curso.is_carrera !== undefined ? Number(curso.is_carrera) : 1,
            semanas: curso.semanas || 16,
            horas_teoria: esSeminario ? 0 : (Number(curso.horas_teoria) || 0),
            horas_taller: esSeminario ? (Number(curso.total_horas) || 0) : (Number(curso.horas_taller) || 0),
            horas_virtual: Number(curso.horas_virtual) || 0,
            horas_evaluacion: Number(curso.horas_evaluacion) || 0,
            total_horas: Number(curso.total_horas) || 0,
            horas_semestre_meta: semestre.horas_meta || 510
        });
        setModalCursoAbierto(true);
    };

    // Recalcular horas del formulario cuando se edita un campo
    const handleActualizarHoras = (campo, valor) => {
        const valNum = Math.max(0, parseInt(valor, 10) || 0);
        setFormCurso((prev) => {
            const nuevo = { ...prev, [campo]: valNum };
            nuevo.total_horas = (nuevo.horas_teoria || 0) + (nuevo.horas_taller || 0) + (nuevo.horas_virtual || 0) + (nuevo.horas_evaluacion || 0);
            return nuevo;
        });
    };

    // Guardar formulario de curso (Crear o Editar)
    const guardarCursoForm = async (e) => {
        e.preventDefault();
        if (!formCurso.mat_cur.trim() || !formCurso.nombre_curso.trim()) {
            setErrorModalCurso('Debe ingresar el código MAT CUR y el nombre del curso.');
            return;
        }

        if (formCurso.total_horas <= 0) {
            setErrorModalCurso('El total de horas del curso debe ser mayor a 0.');
            return;
        }

        setGuardandoCurso(true);
        setErrorModalCurso(null);

        try {
            const esSeminario = /seminario/i.test(formCurso.nombre_curso || '');
            const formAEnviar = {
                ...formCurso,
                horario_sinfo: esSeminario ? 'TAL' : formCurso.horario_sinfo,
                horas_teoria: esSeminario ? 0 : formCurso.horas_teoria,
                horas_taller: esSeminario ? formCurso.total_horas : formCurso.horas_taller,
                id_semestre: semestreModal?.id_semestre
            };

            if (modoModalCurso === 'crear') {
                await mallaSemestreService.crearCurso(formAEnviar);
            } else {
                await mallaSemestreService.actualizarCurso(formCurso.id_curso, formAEnviar);
            }

            if (typeof triggerToast === 'function') {
                triggerToast(modoModalCurso === 'crear' ? '¡Curso agregado exitosamente!' : '¡Curso actualizado correctamente!');
            }

            setModalCursoAbierto(false);
            if (typeof onCursoGuardado === 'function') {
                await onCursoGuardado();
            }
        } catch (err) {
            console.error('Error al guardar curso:', err);
            setErrorModalCurso(err.message);
        } finally {
            setGuardandoCurso(false);
        }
    };

    return {
        modalCursoAbierto,
        setModalCursoAbierto,
        modoModalCurso,
        semestreModal,
        guardandoCurso,
        errorModalCurso,
        formCurso,
        setFormCurso,
        abrirModalCrearCurso,
        abrirModalEditarCurso,
        handleActualizarHoras,
        guardarCursoForm
    };
}

