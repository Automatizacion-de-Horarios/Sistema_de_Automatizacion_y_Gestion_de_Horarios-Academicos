const express = require('express');
const { login, verifyToken } = require('../controllers/authController');
const { verifyJWT } = require('../middlewares/authMiddleware');

const router = express.Router();
router.post('/login', login);
router.get('/verify', verifyJWT, verifyToken);

module.exports = router;
