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

module.exports = { verifyJWT };
