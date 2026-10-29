const jwt = require('jsonwebtoken');

const verifyJWT = (req, res, next) => {
    const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return res.status(401).json({ mensaje: 'Debes iniciar sesión.' });

    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        return next();
    } catch {
        return res.status(401).json({ mensaje: 'La sesión venció o el token no es válido.' });
    }
};

const requireRole = (...rolesPermitidos) => (req, res, next) => {
    if (!req.user || !rolesPermitidos.includes(req.user.rol)) {
        return res.status(403).json({ mensaje: 'No tienes permiso para realizar esta acción.' });
    }
    return next();
};

module.exports = { verifyJWT, requireRole };
