const jwt = require('jsonwebtoken');
const User = require('../models/userModel');

const verifyJWT = async (req, res, next) => {
    const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return res.status(401).json({ mensaje: 'Debes iniciar sesión.' });

    let payload;
    try {
        payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
        return res.status(401).json({ mensaje: 'La sesión venció o el token no es válido.' });
    }

    try {
        // Revisa el estado actual de la cuenta para revocar el acceso sin esperar a que venza el JWT.
        const usuario = await User.buscarPorId(payload.sub);
        if (!usuario || String(usuario.estado).toUpperCase() !== 'ACTIVO') {
            return res.status(401).json({ mensaje: 'La cuenta ya no está activa.' });
        }

        req.user = { ...payload, rol: usuario.rol };
        return next();
    } catch (error) {
        console.error('No se pudo validar la cuenta de la sesión:', error.message);
        return res.status(503).json({ mensaje: 'No se pudo validar la sesión. Inténtalo de nuevo.' });
    }
};

module.exports = { verifyJWT };
