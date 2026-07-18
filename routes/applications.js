const express = require('express');
const applicationsController = require('../controllers/applicationsController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

router.get('/', applicationsController.listApplications);
router.patch('/bulk-status', applicationsController.bulkUpdateStatus);
router.get('/:id', applicationsController.getApplicationById);
router.post('/', applicationsController.applyToJob);
router.patch('/:id/status', applicationsController.updateApplicationStatus);
router.delete('/:id', applicationsController.withdrawApplication);

module.exports = router;
