/**
 * Helpers y utilidades para Malla Curricular y Semestres
 */

// Normaliza y compara identificadores de semestre tanto romanos como arábigos ('III' == '3')
export const matchSemestre = (val1, val2) => {
    if (!val1 || !val2) return false;
    const s1 = String(val1).trim().toUpperCase().replace(/SEMESTRE\s*/i, '');
    const s2 = String(val2).trim().toUpperCase().replace(/SEMESTRE\s*/i, '');
    if (s1 === s2) return true;
    const mapa = {
        '1': 'I', 'I': '1',
        '2': 'II', 'II': '2',
        '3': 'III', 'III': '3',
        '4': 'IV', 'IV': '4',
        '5': 'V', 'V': '5',
        '6': 'VI', 'VI': '6'
    };
    return mapa[s1] === s2 || mapa[s2] === s1;
};

// Obtener etiqueta legible de turno
export const obtenerTextoTurno = (idTurno) => {
    const n = Number(idTurno);
    if (n === 1) return 'Turno 1';
    if (n === 2) return 'Turno 2';
    if (n === 3) return 'Turno 3';
    return `Turno ${idTurno}`;
};

// Obtener clase CSS para el badge de TIPO (TAL, TEC, TEC-TAL, EMP)
export const getClaseTipo = (curso) => {
    if (/seminario/i.test(curso?.nombre_curso || '')) return 'tal';
    const h = String(curso?.horario_sinfo || '').toUpperCase();
    if (h.includes('TEC-TAL')) return 'tec-tal';
    if (h.includes('TAL')) return 'tal';
    if (h.includes('TEC')) return 'tec';
    if (h.includes('EMP')) return 'emp';
    return 'tec';
};

// Calcula la distribución automática de horas según el tipo de horario SINFO
export const calcularDistribucionHorasAuto = (totalHoras, horarioSinfo) => {
    const total = Number(totalHoras) || 0;
    const horario = String(horarioSinfo || '').toUpperCase();
    let teoria = 0;
    let taller = 0;

    if (horario === 'TEC') {
        teoria = total;
        taller = 0;
    } else if (horario === 'TAL' || horario === 'EMP') {
        taller = total;
        teoria = 0;
    } else if (horario === 'TEC-TAL') {
        teoria = Math.floor(total * 0.4);
        taller = total - teoria;
    } else {
        teoria = total;
        taller = 0;
    }

    return {
        horas_teoria: teoria,
        horas_taller: taller,
        horas_virtual: 0,
        horas_evaluacion: 0,
        total_horas: total
    };
};

// Limpia recursivamente objetos vacíos o valores nulos/vacíos para comparaciones exactas de asignaciones
export const limpiarAsignaciones = (obj) => {
    if (!obj || typeof obj !== 'object') return {};
    const limpio = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v === 'object') {
            const subLimpio = limpiarAsignaciones(v);
            if (Object.keys(subLimpio).length > 0) {
                limpio[k] = subLimpio;
            }
        } else if (v !== undefined && v !== null && v !== '') {
            limpio[k] = String(v);
        }
    }
    return limpio;
};


