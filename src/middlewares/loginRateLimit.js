const VENTANA_MS = 15 * 60 * 1000;
const MAX_INTENTOS = 10;
const intentosPorIp = new Map();

const limpiarIntentosVencidos = () => {
    const ahora = Date.now();
    for (const [ip, intentos] of intentosPorIp) {
        const vigentes = intentos.filter((intento) => ahora - intento.inicio < VENTANA_MS);
        if (vigentes.length) intentosPorIp.set(ip, vigentes);
        else intentosPorIp.delete(ip);
    }
};

const temporizadorLimpieza = setInterval(limpiarIntentosVencidos, VENTANA_MS);
temporizadorLimpieza.unref();

const limitarIntentosLogin = (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'desconocida';
    const ahora = Date.now();
    const intentos = (intentosPorIp.get(ip) || []).filter(
        (intento) => ahora - intento.inicio < VENTANA_MS
    );

    if (intentos.length >= MAX_INTENTOS) {
        res.set('Retry-After', String(Math.ceil((intentos[0].inicio + VENTANA_MS - ahora) / 1000)));
        return res.status(429).json({
            mensaje: 'Demasiados intentos de inicio de sesión. Espera 15 minutos e inténtalo de nuevo.'
        });
    }

    const intento = { inicio: ahora };
    intentos.push(intento);
    intentosPorIp.set(ip, intentos);

    // Solo cuentan los intentos que terminan en error; un login exitoso no consume el límite.
    res.once('finish', () => {
        if (res.statusCode !== 401) {
            const actuales = intentosPorIp.get(ip);
            if (!actuales) return;
            const indice = actuales.indexOf(intento);
            if (indice !== -1) actuales.splice(indice, 1);
            if (!actuales.length) intentosPorIp.delete(ip);
        }
    });

    return next();
};

module.exports = { limitarIntentosLogin };
