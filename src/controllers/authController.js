const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/userModel');

const usuarioPublico = (usuario) => ({
    id: usuario.id_usuario,
    dni: usuario.dni,
    correo: usuario.correo_institucional,
    nombre: [usuario.nombres, usuario.apellidos].filter(Boolean).join(' ') || usuario.correo_institucional,
    rol: usuario.rol
});

const login = async (req, res) => {
    const { identificador, password } = req.body ?? {};
    if (typeof identificador !== 'string' || !identificador.trim() || typeof password !== 'string' || !password) {
        return res.status(400).json({ mensaje: 'Ingresa tu DNI o correo y tu contraseña.' });
    }
    if (!process.env.JWT_SECRET) {
        console.error('Falta configurar JWT_SECRET en el .env del backend.');
        return res.status(500).json({ mensaje: 'El inicio de sesión aún no está configurado en el servidor.' });
    }

    try {
        const usuario = await User.buscarPorIdentificador(identificador);
        const activo = usuario && String(usuario.estado).toUpperCase() === 'ACTIVO';
        const passwordValido = activo && await bcrypt.compare(password, usuario.password_hash);
        if (!passwordValido) return res.status(401).json({ mensaje: 'Credenciales incorrectas o cuenta inactiva.' });

        await User.actualizarUltimoAcceso(usuario.id_usuario);
        const token = jwt.sign({ sub: usuario.id_usuario, rol: usuario.rol }, process.env.JWT_SECRET, { expiresIn: '8h' });
        return res.json({ token, usuario: usuarioPublico(usuario) });
    } catch (error) {
        console.error('No se pudo iniciar sesión:', error.message);
        return res.status(500).json({ mensaje: 'No se pudo iniciar sesión. Verifica la tabla de usuarios y la conexión a la base de datos.' });
    }
};

const verifyToken = async (req, res) => {
    try {
        const usuario = await User.buscarPorId(req.user.sub);
        if (!usuario || String(usuario.estado).toUpperCase() !== 'ACTIVO') {
            return res.status(401).json({ mensaje: 'La cuenta ya no está activa.' });
        }
        return res.json({ usuario: usuarioPublico(usuario) });
    } catch (error) {
        console.error('No se pudo verificar la sesión:', error.message);
        return res.status(500).json({ mensaje: 'No se pudo verificar la sesión.' });
    }
};

module.exports = { login, verifyToken };
