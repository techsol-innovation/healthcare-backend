const express = require('express');
const router = express.Router();
const { register, login, getProfile, generateSyncToken, verifySyncToken, logoutUser } = require('../controllers/authController');
const { verifyToken } = require('../middleware/auth');
const { validateRegister, validateLogin } = require('../middleware/validation');

// Public routes
router.post('/register', validateRegister, register);
router.post('/login', validateLogin, login);
router.post('/sync/verify', verifySyncToken);

// Protected routes
router.get('/profile', verifyToken, getProfile);
router.post('/sync/generate', verifyToken, generateSyncToken);
router.post('/logout', verifyToken, logoutUser);

module.exports = router;
