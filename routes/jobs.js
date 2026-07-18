const express = require('express');
const jobsController = require('../controllers/jobsController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, jobsController.getJobs);
router.get('/:id', authenticate, jobsController.getJobById);

router.post('/', authenticate, authorize('company'), jobsController.createJob);
router.patch('/:id', authenticate, authorize('company'), jobsController.updateJob);
router.patch('/:id/status', authenticate, authorize('company'), jobsController.updateJobStatus);
router.delete('/:id', authenticate, authorize('company'), jobsController.deleteJob);

module.exports = router;
