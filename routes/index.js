const express = require('express');
const authRoutes = require('./auth');
const studentsRoutes = require('./students');
const jobsRoutes = require('./jobs');
const applicationsRoutes = require('./applications');
const notificationsRoutes = require('./notifications');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/students', studentsRoutes);
router.use('/jobs', jobsRoutes);
router.use('/applications', applicationsRoutes);
router.use('/notifications', notificationsRoutes);

module.exports = router;
