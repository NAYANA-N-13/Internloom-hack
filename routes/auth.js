const express = require('express');
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.post('/register', authController.registerStudent);
router.post('/register/student', authController.registerStudent);
router.post('/register/company', authController.registerCompany);
router.post('/login', authController.login);
router.post('/verify-otp', authController.verifyOtp);
router.post('/send-otp', authenticate, authController.sendOtp);
router.post('/update', authenticate, authController.updateAccount);
router.post('/refresh', authController.refreshToken);
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.getCurrentUser);

module.exports = router;
