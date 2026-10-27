// frontend/src/modules/docentes/utils/franjas.js

export function aMinutos(horaStr) {
    if (!horaStr) return 420;
    const [h, m] = horaStr.split(':').map(Number);
    return h * 60 + m;
}

export function aHora(minutos) {
    const h = Math.floor(minutos / 60).toString().padStart(2, '0');
    const m = (minutos % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
}

// Convierte franjas backend a matriz de celdas de cuadrícula (07:00 a 21:00, dias 1 a 6)
export function franjasACeldas(franjas) {
    const celdas = {}; // clave: "dia-hora" (ej: "1-07:00")
    if (!Array.isArray(franjas)) return celdas;

    franjas.forEach(f => {
        const inicioMin = aMinutos(f.hora_inicio);
        const finMin = aMinutos(f.hora_fin);
        // Cada celda representa 1 hora (60 mins) desde hora_inicio hasta hora_fin - 60
        for (let m = inicioMin; m < finMin; m += 60) {
            const horaStr = aHora(m);
            celdas[`${f.dia_semana}-${horaStr}`] = true;
        }
    });
    return celdas;
}

// Convierte matriz de celdas en franjas continuas por día para enviar al backend
export function celdasAFranjas(celdas) {
    const porDia = {};
    for (const key in celdas) {
        if (!celdas[key]) continue;
        const [diaStr, horaStr] = key.split('-');
        const dia = Number(diaStr);
        if (!porDia[dia]) porDia[dia] = [];
        porDia[dia].push(aMinutos(horaStr));
    }

    const franjas = [];
    for (const diaStr in porDia) {
        const dia = Number(diaStr);
        const minutosList = porDia[dia].sort((a, b) => a - b);
        if (minutosList.length === 0) continue;

        let inicio = minutosList[0];
        let fin = inicio + 60;

        for (let i = 1; i < minutosList.length; i++) {
            const actual = minutosList[i];
            if (actual === fin) {
                fin = actual + 60;
            } else {
                franjas.push({
                    dia_semana: dia,
                    hora_inicio: aHora(inicio),
                    hora_fin: aHora(fin)
                });
                inicio = actual;
                fin = inicio + 60;
            }
        }
        franjas.push({
            dia_semana: dia,
            hora_inicio: aHora(inicio),
            hora_fin: aHora(fin)
        });
    }
    return franjas;
}

// Convierte franjas guardadas a formato de tabla Rango (Foto)
export function franjasARango(franjas) {
    const rangoDias = {};
    for (let d = 1; d <= 6; d++) {
        rangoDias[d] = { habilitado: false, hora_inicio: '08:00', hora_fin: '12:00', tieneHuecos: false };
    }

    if (!Array.isArray(franjas)) return rangoDias;

    const porDia = {};
    franjas.forEach(f => {
        if (!porDia[f.dia_semana]) porDia[f.dia_semana] = [];
        porDia[f.dia_semana].push(f);
    });

    for (const dStr in porDia) {
        const dia = Number(dStr);
        const lista = porDia[dia];
        // Ordenar por hora inicio
        lista.sort((a, b) => aMinutos(a.hora_inicio) - aMinutos(b.hora_inicio));

        rangoDias[dia].habilitado = true;
        rangoDias[dia].hora_inicio = lista[0].hora_inicio;
        rangoDias[dia].hora_fin = lista[lista.length - 1].hora_fin;

        // Verificar si hay huecos (más de una franja discontinua)
        if (lista.length > 1) {
            for (let i = 0; i < lista.length - 1; i++) {
                if (lista[i].hora_fin !== lista[i + 1].hora_inicio) {
                    rangoDias[dia].tieneHuecos = true;
                }
            }
        }
    }
    return rangoDias;
}