const express = require('express');
const profileController = require('../controllers/profileController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate, authorize('student'));

router.get('/profile', profileController.getProfile);
router.post('/profile', profileController.createProfile);
router.put('/profile', profileController.updateProfile);
router.delete('/profile', profileController.deleteProfile);
router.get('/profile/completeness', profileController.getProfileCompleteness);

module.exports = router;
