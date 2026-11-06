const db = require('../config/db');
const {
    bloquesQueSolapanRangos,
    hora,
    mismaClase,
    rangosDeBloques,
    semanasDeBloques,
} = require('../utils/horarioMovimiento');

const SEMESTRES = {
    I: 1,
    II: 2,
    III: 3,
    IV: 4,
    V: 5,
    VI: 6,
    VII: 7,
    VIII: 8,
    IX: 9,
    X: 10,
};

const DIAS_DB = {
    LUNES: 'LUNES',
    MARTES: 'MARTES',
    MIERCOLES: 'MIÉRCOLES',
    JUEVES: 'JUEVES',
    VIERNES: 'VIERNES',
    SABADO: 'SÁBADO',
    DOMINGO: 'DOMINGO',
};

const diaNormalizado = (valor) => String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

const minutos = (valor) => {
    const [hora, minuto] = String(valor ?? '').split(':').map(Number);
    return hora * 60 + minuto;
};

const fechaPeriodo = (periodo, nombres) => {
    const nombre = nombres.find((candidato) => periodo[candidato] != null);
    if (!nombre) return null;
    const valor = periodo[nombre];
    return valor instanceof Date
        ? valor.toISOString().slice(0, 10)
        : String(valor).slice(0, 10);
};

let disponibilidadTieneEstado;

async function filtrarDisponibilidadActiva(conexion) {
    if (!disponibilidadTieneEstado) {
        disponibilidadTieneEstado = conexion.query(
            'SELECT COUNT(*) AS cantidad FROM information_schema.COLUMNS ' +
            'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
            ['disponibilidad_docentes', 'estado']
        ).then(([filas]) => Number(filas[0]?.cantidad) > 0)
            .catch((error) => {
                disponibilidadTieneEstado = undefined;
                throw error;
            });
    }
    return (await disponibilidadTieneEstado) ? " AND estado = 'A'" : '';
}

function exigir(condicion, mensaje, status = 409) {
    if (condicion) return;
    const error = new Error(mensaje);
    error.status = status;
    throw error;
}

const Horario = {
    async listarBorradores(codigoPeriodo) {
        const [periodos] = await db.query(
            'SELECT * FROM periodos WHERE codigo_periodo = ?',
            [codigoPeriodo]
        );
        if (!periodos.length) return null;

        const periodo = periodos[0];
        const [franjas] = await db.query(
            `SELECT TIME_FORMAT(hora_inicio_mañana, '%H:%i:%s') AS hora_inicio_mañana,
                    TIME_FORMAT(hora_cierre_noche, '%H:%i:%s') AS hora_cierre_noche,
                    incluir_domingo
             FROM configuracion_franja_horaria
             WHERE id_periodo = ?`,
            [periodo.id_periodo]
        );
        const [bloques] = await db.query(
            `SELECT
                hg.id_horario,
                hg.id_periodo,
                p.codigo_periodo AS periodo,
                hg.id_programacion,
                hg.id_ambiente,
                hg.id_docente,
                hg.tipo_modalidad,
                hg.dia_semana AS dia,
                TIME_FORMAT(hg.hora_inicio, '%H:%i:%s') AS hora_inicio,
                TIME_FORMAT(hg.hora_fin, '%H:%i:%s') AS hora_fin,
                hg.semana_inicio,
                hg.semana_fin,
                c.mat_cur AS codigo_curso,
                c.nombre_curso,
                NULLIF(TRIM(CONCAT_WS(' ', d.nombres, d.apellidos)), '') AS docente,
                CONCAT(
                    ca.codigo_carrera, ' · ', s.semestre,
                    ' · Turno ', pa.id_turno,
                    ' · Grupo ', pa.grupo
                ) AS cohorte,
                CONCAT(
                    '56', ca.codigo_carrera, COALESCE(ca.sector, 'S'),
                    CASE s.semestre
                        WHEN 'I' THEN '1' WHEN 'II' THEN '2' WHEN 'III' THEN '3'
                        WHEN 'IV' THEN '4' WHEN 'V' THEN '5' WHEN 'VI' THEN '6'
                        WHEN 'VII' THEN '7' WHEN 'VIII' THEN '8'
                        WHEN 'IX' THEN '9' WHEN 'X' THEN '10'
                        ELSE '0'
                    END,
                    LPAD(pa.id_turno, 2, '0')
                ) AS codigo_cohorte,
                ca.codigo_carrera,
                ca.nombre_carrera,
                s.semestre,
                pa.id_turno AS turno,
                pa.grupo,
                pa.id_sede,
                a.codigo_ambiente AS ambiente
            FROM horarios_generados hg
            INNER JOIN periodos p ON p.id_periodo = hg.id_periodo
            INNER JOIN programacion_academica pa
                ON pa.id_programacion = hg.id_programacion
            INNER JOIN cursos c ON c.id_curso = pa.id_curso
            INNER JOIN semestres s ON s.id_semestre = c.id_semestre
            INNER JOIN carreras ca ON ca.id_carrera = s.id_carrera
            LEFT JOIN docentes d ON d.id_docente = hg.id_docente
            LEFT JOIN ambientes a ON a.id = hg.id_ambiente
            WHERE p.codigo_periodo = ?
              AND hg.estado IN ('BORRADOR', 'CONFIRMADO')
            ORDER BY
                ca.codigo_carrera,
                s.semestre,
                pa.id_turno,
                pa.grupo,
                FIELD(
                    hg.dia_semana,
                    'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES',
                    'VIERNES', 'SÁBADO', 'DOMINGO'
                ),
                hg.hora_inicio,
                c.mat_cur`,
            [codigoPeriodo]
        );
        const [ocupaciones] = await db.query(
            `SELECT
                hg.id_horario,
                hg.id_programacion,
                hg.id_ambiente,
                hg.id_docente,
                hg.tipo_modalidad,
                hg.dia_semana AS dia,
                TIME_FORMAT(hg.hora_inicio, '%H:%i:%s') AS hora_inicio,
                TIME_FORMAT(hg.hora_fin, '%H:%i:%s') AS hora_fin,
                hg.semana_inicio,
                hg.semana_fin,
                hg.estado,
                pa.id_sede,
                pa.id_turno,
                pa.grupo,
                c.id_semestre,
                ca.id_carrera,
                ca.codigo_carrera,
                s.semestre AS semestre,
                c.mat_cur AS codigo_curso,
                c.nombre_curso,
                a.codigo_ambiente AS ambiente,
                NULLIF(TRIM(CONCAT_WS(' ', d.nombres, d.apellidos)), '') AS docente,
                CONCAT(
                    '56', ca.codigo_carrera, COALESCE(ca.sector, 'S'),
                    CASE s.semestre
                        WHEN 'I' THEN '1' WHEN 'II' THEN '2' WHEN 'III' THEN '3'
                        WHEN 'IV' THEN '4' WHEN 'V' THEN '5' WHEN 'VI' THEN '6'
                        WHEN 'VII' THEN '7' WHEN 'VIII' THEN '8'
                        WHEN 'IX' THEN '9' WHEN 'X' THEN '10'
                        ELSE '0'
                    END,
                    LPAD(pa.id_turno, 2, '0')
                ) AS codigo_cohorte
            FROM horarios_generados hg
            INNER JOIN programacion_academica pa
                ON pa.id_programacion = hg.id_programacion
            INNER JOIN cursos c ON c.id_curso = pa.id_curso
            INNER JOIN semestres s ON s.id_semestre = c.id_semestre
            INNER JOIN carreras ca ON ca.id_carrera = s.id_carrera
            LEFT JOIN ambientes a ON a.id = hg.id_ambiente
            LEFT JOIN docentes d ON d.id_docente = hg.id_docente
            WHERE hg.id_periodo = ?
              AND hg.estado IN ('BORRADOR', 'CONFIRMADO')`,
            [periodo.id_periodo]
        );
        const [disponibilidadDocentes] = await db.query(
            `SELECT dd.id_docente, dd.dia_semana,
                    TIME_FORMAT(dd.hora_inicio, '%H:%i:%s') AS hora_inicio,
                    TIME_FORMAT(dd.hora_fin, '%H:%i:%s') AS hora_fin
             FROM disponibilidad_docentes dd
             WHERE 1 = 1${await filtrarDisponibilidadActiva(db)}`
        );
        const [docentes] = await db.query(
            `SELECT DISTINCT d.id_docente, d.usa_restriccion_horaria
             FROM docentes d
             INNER JOIN programacion_academica pa
                ON d.id_docente IN (pa.id_docente_tec, pa.id_docente_tal)
             WHERE pa.id_periodo = ?`,
            [periodo.id_periodo]
        );
        const [ambientes] = await db.query(
            'SELECT id, estado FROM ambientes'
        );
        const [estados] = await db.query(
            'SELECT DISTINCT estado FROM horarios_generados WHERE id_periodo = ?',
            [periodo.id_periodo]
        );
        const estado = estados.some((fila) => fila.estado === 'CONFIRMADO')
            ? 'CONFIRMADO'
            : 'BORRADOR';

        return {
            estado,
            periodo: {
                codigo: periodo.codigo_periodo,
                semanas: Number(periodo.cantidad_semanas),
                fecha_inicio: fechaPeriodo(periodo, [
                    'fecha_inicio', 'fecha_inicio_periodo', 'inicio_periodo',
                    'fecha_ini', 'fecha_desde', 'limite_inicio',
                ]),
                fecha_fin: fechaPeriodo(periodo, [
                    'fecha_fin', 'fecha_fin_periodo', 'fin_periodo',
                    'fecha_termino', 'fecha_hasta', 'limite_fin',
                ]),
                franja: franjas[0] ?? null,
            },
            bloques: bloques.map((bloque) => ({
                ...bloque,
                semestre_num: SEMESTRES[bloque.semestre] ?? null,
            })),
            restricciones: {
                ocupaciones,
                disponibilidad_docentes: disponibilidadDocentes,
                docentes: docentes.map((docente) => ({
                    ...docente,
                    usa_restriccion_horaria: Boolean(
                        Number(docente.usa_restriccion_horaria)
                    ),
                })),
                ambientes,
            },
        };
    },

    async moverBorradores(codigoPeriodo, ids, movimiento) {
        const conexion = await db.getConnection();
        try {
            await conexion.beginTransaction();
            const placeholders = ids.map(() => '?').join(', ');
            const [bloques] = await conexion.query(
                `SELECT hg.id_horario, hg.id_periodo, hg.id_programacion,
                        hg.id_ambiente, hg.id_docente, hg.tipo_modalidad,
                        hg.dia_semana, TIME_FORMAT(hg.hora_inicio, '%H:%i:%s') AS hora_inicio,
                        TIME_FORMAT(hg.hora_fin, '%H:%i:%s') AS hora_fin,
                        hg.semana_inicio, hg.semana_fin,
                        pa.id_sede, pa.id_turno, pa.grupo, c.id_semestre,
                        ca.id_carrera,
                        d.usa_restriccion_horaria
                 FROM horarios_generados hg
                 INNER JOIN periodos p ON p.id_periodo = hg.id_periodo
                 INNER JOIN programacion_academica pa
                    ON pa.id_programacion = hg.id_programacion
                 INNER JOIN cursos c ON c.id_curso = pa.id_curso
                 INNER JOIN semestres s ON s.id_semestre = c.id_semestre
                 INNER JOIN carreras ca ON ca.id_carrera = s.id_carrera
                 LEFT JOIN docentes d ON d.id_docente = hg.id_docente
                 WHERE p.codigo_periodo = ?
                   AND hg.estado = 'BORRADOR'
                   AND hg.id_horario IN (${placeholders})
                 FOR UPDATE`,
                [codigoPeriodo, ...ids]
            );
            exigir(
                bloques.length === ids.length,
                'Una o más clases ya no están disponibles para editar.',
                409
            );

            const base = bloques[0];
            const duracion = minutos(base.hora_fin) - minutos(base.hora_inicio);
            exigir(duracion > 0, 'La duración del bloque no es válida.');
            exigir(
                bloques.every((bloque) =>
                    mismaClase(bloque, base) &&
                    minutos(bloque.hora_fin) - minutos(bloque.hora_inicio) === duracion
                ),
                'Los bloques seleccionados no forman una misma clase.',
                400
            );

            const inicio = minutos(movimiento.hora_inicio);
            const fin = inicio + duracion;
            const diaDb = DIAS_DB[movimiento.dia];
            const [[franja]] = await conexion.query(
                `SELECT hora_inicio_mañana, hora_cierre_noche
                 FROM configuracion_franja_horaria
                 WHERE id_periodo = ?`,
                [base.id_periodo]
            );
            const limiteInicio = franja ? minutos(franja.hora_inicio_mañana) : 7 * 60;
            const limiteFin = franja ? minutos(franja.hora_cierre_noche) : 22 * 60;
            exigir(
                inicio >= limiteInicio && fin <= limiteFin,
                'El bloque quedaría fuera de la franja horaria configurada.'
            );

            if (base.tipo_modalidad !== 'VIR' && base.tipo_modalidad !== 'EMP') {
                exigir(base.id_ambiente, 'La clase no tiene un salón asignado.');
                const [[ambiente]] = await conexion.query(
                    'SELECT estado FROM ambientes WHERE id = ?',
                    [base.id_ambiente]
                );
                exigir(
                    ambiente && ['A', 'ACTIVO', 'DISPONIBLE', 'OPERATIVO']
                        .includes(String(ambiente.estado ?? '').trim().toUpperCase()),
                    'El salón asignado no está disponible.'
                );
            }

            if (base.id_docente && Number(base.usa_restriccion_horaria)) {
                const filtroActivo = await filtrarDisponibilidadActiva(conexion);
                const [franjas] = await conexion.query(
                    `SELECT dia_semana, hora_inicio, hora_fin
                     FROM disponibilidad_docentes
                     WHERE id_docente = ?${filtroActivo}`,
                    [base.id_docente]
                );
                const permitido = franjas.some((franja) =>
                    diaNormalizado(franja.dia_semana) === movimiento.dia &&
                    minutos(franja.hora_inicio) <= inicio &&
                    minutos(franja.hora_fin) >= fin
                );
                exigir(
                    permitido,
                    `El docente no está disponible el ${movimiento.dia} ` +
                    `entre ${movimiento.hora_inicio} y ${movimiento.hora_fin}.`
                );
            }

            // La clase puede estar partida en varios registros por feriados o
            // por rangos de semanas. Se recuperan todos los de la misma clase
            // para replicar el movimiento durante todo el semestre.
            const [registrosClase] = await conexion.query(
                `SELECT hg.id_horario, hg.semana_inicio, hg.semana_fin
                 FROM horarios_generados hg
                 INNER JOIN periodos p ON p.id_periodo = hg.id_periodo
                 WHERE p.codigo_periodo = ?
                   AND hg.estado = 'BORRADOR'
                   AND hg.id_programacion = ?
                   AND hg.tipo_modalidad = ?
                   AND (hg.id_docente <=> ?)
                   AND (hg.id_ambiente <=> ?)
                   AND hg.dia_semana = ?
                   AND TIME_FORMAT(hg.hora_inicio, '%H:%i:%s') = ?
                   AND TIME_FORMAT(hg.hora_fin, '%H:%i:%s') = ?
                 FOR UPDATE`,
                [
                    codigoPeriodo,
                    base.id_programacion,
                    base.tipo_modalidad,
                    base.id_docente,
                    base.id_ambiente,
                    base.dia_semana,
                    base.hora_inicio,
                    base.hora_fin,
                ]
            );
            exigir(
                registrosClase.length >= bloques.length,
                'No se encontraron todas las semanas de la clase seleccionada.',
                409
            );
            const idsClase = [
                ...new Set(registrosClase.map((registro) => Number(registro.id_horario))),
            ];
            const placeholdersClase = idsClase.map(() => '?').join(', ');
            const rangosClase = rangosDeBloques(registrosClase);
            const minInicio = Math.min(...rangosClase.map((rango) => rango.inicio));
            const maxFin = Math.max(...rangosClase.map((rango) => rango.fin));

            const [ocupaciones] = await conexion.query(
                `SELECT hg.id_horario, hg.id_ambiente, hg.id_docente,
                        hg.tipo_modalidad, hg.dia_semana,
                        TIME_FORMAT(hg.hora_inicio, '%H:%i:%s') AS hora_inicio,
                        TIME_FORMAT(hg.hora_fin, '%H:%i:%s') AS hora_fin,
                        hg.semana_inicio, hg.semana_fin,
                        pa.id_sede, pa.id_turno, pa.grupo, c.id_semestre,
                        ca.id_carrera, ca.codigo_carrera,
                        s.semestre AS semestre,
                        c.mat_cur AS codigo_curso, c.nombre_curso,
                        a.codigo_ambiente AS ambiente,
                        NULLIF(TRIM(CONCAT_WS(' ', d.nombres, d.apellidos)), '') AS docente
                 FROM horarios_generados hg
                 INNER JOIN programacion_academica pa
                    ON pa.id_programacion = hg.id_programacion
                 INNER JOIN cursos c ON c.id_curso = pa.id_curso
                 INNER JOIN semestres s ON s.id_semestre = c.id_semestre
                 INNER JOIN carreras ca ON ca.id_carrera = s.id_carrera
                 LEFT JOIN ambientes a ON a.id = hg.id_ambiente
                 LEFT JOIN docentes d ON d.id_docente = hg.id_docente
                 WHERE hg.id_periodo = ?
                   AND hg.estado IN ('BORRADOR', 'CONFIRMADO')
                   AND hg.dia_semana = ?
                   AND hg.semana_inicio <= ?
                   AND hg.semana_fin >= ?
                   AND hg.id_horario NOT IN (${placeholdersClase})`,
                [
                    base.id_periodo,
                    diaDb,
                    maxFin,
                    minInicio,
                    ...idsClase,
                ]
            );
            const ocupacionesRelevantes = bloquesQueSolapanRangos(
                ocupaciones,
                rangosClase
            );

            const conflictos = [];
            const agregarConflicto = (tipo, ocupacion, mensaje) => {
                conflictos.push({
                    tipo,
                    mensaje,
                    carrera: ocupacion?.codigo_carrera ?? '',
                    semestre: ocupacion?.semestre ?? '',
                    curso: ocupacion?.codigo_curso ?? '',
                    nombre_curso: ocupacion?.nombre_curso ?? '',
                    ambiente: ocupacion?.ambiente ?? '',
                    docente: ocupacion?.docente ?? '',
                    hora_inicio: ocupacion ? String(ocupacion.hora_inicio).slice(0, 5) : '',
                    hora_fin: ocupacion ? String(ocupacion.hora_fin).slice(0, 5) : '',
                });
            };

            for (const ocupacion of ocupacionesRelevantes) {
                const otraInicio = minutos(ocupacion.hora_inicio);
                const otraFin = minutos(ocupacion.hora_fin);
                const solapa = inicio < otraFin && fin > otraInicio;
                const cercaniaDocente = base.id_docente &&
                    Number(ocupacion.id_docente) === Number(base.id_docente) &&
                    inicio < otraFin + 15 &&
                    fin + 15 > otraInicio;
                const mismoSalon = base.id_ambiente &&
                    Number(ocupacion.id_ambiente) === Number(base.id_ambiente) &&
                    solapa;
                const mismaCohorte =
                    Number(ocupacion.id_sede) === Number(base.id_sede) &&
                    Number(ocupacion.id_carrera) === Number(base.id_carrera) &&
                    Number(ocupacion.id_semestre) === Number(base.id_semestre) &&
                    Number(ocupacion.id_turno) === Number(base.id_turno) &&
                    String(ocupacion.grupo) === String(base.grupo);
                const necesitaRecesoCohorte = mismaCohorte &&
                    inicio < otraFin + 15 &&
                    fin + 15 > otraInicio;

                if (mismoSalon) {
                    agregarConflicto(
                        'salon',
                        ocupacion,
                        `El salón ${ocupacion.ambiente || 'asignado'} está ocupado por ` +
                        `${ocupacion.codigo_carrera || '—'} · ${ocupacion.semestre || '—'} ` +
                        `(${ocupacion.nombre_curso || ocupacion.codigo_curso || 'curso'} ` +
                        `${String(ocupacion.hora_inicio).slice(0, 5)}–${String(ocupacion.hora_fin).slice(0, 5)}).`
                    );
                }
                if (cercaniaDocente) {
                    agregarConflicto(
                        'docente',
                        ocupacion,
                        `El docente tiene otra clase en ` +
                        `${ocupacion.codigo_carrera || '—'} · ${ocupacion.semestre || '—'} ` +
                        `(${ocupacion.nombre_curso || ocupacion.codigo_curso || 'curso'} ` +
                        `${String(ocupacion.hora_inicio).slice(0, 5)}–${String(ocupacion.hora_fin).slice(0, 5)}); ` +
                        'necesita 15 minutos de receso.'
                    );
                }
                if (necesitaRecesoCohorte) {
                    agregarConflicto(
                        'cohorte',
                        ocupacion,
                        `La cohorte ${ocupacion.codigo_carrera || '—'} · ${ocupacion.semestre || '—'} ` +
                        `ya tiene clase de ${String(ocupacion.hora_inicio).slice(0, 5)} a ` +
                        `${String(ocupacion.hora_fin).slice(0, 5)}; deja al menos 15 minutos entre clases.`
                    );
                }
            }

            if (base.id_docente) {
                const semanas = semanasDeBloques(registrosClase);
                for (const semana of semanas) {
                    const agenda = ocupacionesRelevantes
                        .filter((ocupacion) => {
                            const rango = {
                                inicio: Number(ocupacion.semana_inicio),
                                fin: Number(ocupacion.semana_fin),
                            };
                            return Number(ocupacion.id_docente) === Number(base.id_docente) &&
                                rango.inicio <= semana &&
                                rango.fin >= semana;
                        })
                        .map((ocupacion) => ({
                            inicio: minutos(ocupacion.hora_inicio),
                            fin: minutos(ocupacion.hora_fin),
                        }));
                    agenda.push({ inicio, fin });
                    agenda.sort((izquierda, derecha) => izquierda.inicio - derecha.inicio);

                    let horasContinuas =
                        (agenda[0].fin - agenda[0].inicio) / 45;
                    for (let indice = 1; indice < agenda.length; indice += 1) {
                        const anterior = agenda[indice - 1];
                        const posterior = agenda[indice];
                        const descanso = posterior.inicio - anterior.fin;
                        if (horasContinuas >= 5 && descanso < 45) {
                            agregarConflicto(
                                'docente',
                                null,
                                'El docente necesita 45 minutos de descanso después de ' +
                                '5 horas académicas continuas antes de continuar su jornada.'
                            );
                            break;
                        }
                        horasContinuas = descanso >= 45
                            ? (posterior.fin - posterior.inicio) / 45
                            : horasContinuas +
                                (posterior.fin - posterior.inicio) / 45;
                    }
                }
            }

            if (conflictos.length) {
                const error = new Error('No se puede mover la clase: hay conflictos.');
                error.status = 409;
                error.conflictos = conflictos;
                throw error;
            }

            const nuevoFin = hora(fin);
            await conexion.query(
                `UPDATE horarios_generados
                 SET dia_semana = ?, hora_inicio = ?, hora_fin = ?
                 WHERE id_periodo = ? AND estado = 'BORRADOR'
                   AND id_horario IN (${placeholdersClase})`,
                [
                    diaDb,
                    movimiento.hora_inicio,
                    nuevoFin,
                    base.id_periodo,
                    ...idsClase,
                ]
            );
            const [[verificacion]] = await conexion.query(
                `SELECT COUNT(*) AS total
                 FROM horarios_generados
                 WHERE id_periodo = ? AND estado = 'BORRADOR'
                   AND id_horario IN (${placeholdersClase})
                   AND dia_semana = ?
                   AND TIME_FORMAT(hora_inicio, '%H:%i:%s') = ?
                   AND TIME_FORMAT(hora_fin, '%H:%i:%s') = ?`,
                [
                    base.id_periodo,
                    ...idsClase,
                    diaDb,
                    movimiento.hora_inicio,
                    nuevoFin,
                ]
            );
            exigir(
                Number(verificacion?.total) === idsClase.length,
                'No se pudieron guardar todos los cambios de horario.'
            );
            await conexion.commit();
            return {
                ids: idsClase,
                dia: movimiento.dia,
                hora_inicio: movimiento.hora_inicio,
                hora_fin: nuevoFin,
            };
        } catch (error) {
            await conexion.rollback();
            throw error;
        } finally {
            conexion.release();
        }
    },

    async cambiarEstado(codigoPeriodo, estado) {
        const [periodos] = await db.query(
            'SELECT id_periodo FROM periodos WHERE codigo_periodo = ?',
            [codigoPeriodo]
        );
        exigir(periodos.length > 0, `No existe el periodo ${codigoPeriodo}.`, 404);
        const periodo = periodos[0];
        const [resultado] = await db.query(
            'UPDATE horarios_generados SET estado = ? WHERE id_periodo = ?',
            [estado, periodo.id_periodo]
        );
        return { estado, afectados: resultado.affectedRows };
    },
};

module.exports = Horario;
