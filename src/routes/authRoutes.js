const express = require('express');
const { login, verifyToken } = require('../controllers/authController');
const { verifyJWT } = require('../middlewares/authMiddleware');
const { limitarIntentosLogin } = require('../middlewares/loginRateLimit');

const router = express.Router();
router.post('/login', limitarIntentosLogin, login);
router.get('/verify', verifyJWT, verifyToken);

module.exports = router;
