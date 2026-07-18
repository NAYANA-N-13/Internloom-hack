const asyncHandler = require('../utils/asyncHandler');
const { storage } = require('../config/db');
const { pushNotification } = require('./notificationController');

const getNextId = (items) => (items.length ? Math.max(...items.map((item) => item.id)) + 1 : 1);
const getUserById = (userId) => storage.users.find((user) => user.id === userId) || null;

const listApplications = asyncHandler(async (req, res) => {
  const applications = storage.applications.filter((app) => app.user_id === req.user?.id);

  res.status(200).json({
    success: true,
    count: applications.length,
    data: applications,
  });
});

const getApplicationById = asyncHandler(async (req, res) => {
  const applicationId = Number(req.params.id);
  const application = storage.applications.find((app) => app.id === applicationId && app.user_id === req.user?.id);

  if (!application) {
    return res.status(404).json({
      success: false,
      message: 'Application not found',
    });
  }

  res.status(200).json({
    success: true,
    data: application,
  });
});

const applyToJob = asyncHandler(async (req, res) => {
  const { job_id } = req.body;
  const studentId = req.user?.id;

  if (!job_id) {
    return res.status(400).json({
      success: false,
      message: 'job_id is required to apply',
    });
  }

  const job = storage.job_listings.find((item) => item.id === Number(job_id));
  if (!job) {
    return res.status(404).json({
      success: false,
      message: 'Job not found',
    });
  }

  const user = getUserById(studentId);
  if (!user) {
    return res.status(401).json({
      success: false,
      message: 'Authenticated student account not found',
    });
  }

  if (user.role !== 'student') {
    return res.status(403).json({
      success: false,
      message: 'Only students can apply to jobs',
    });
  }

  if (!user.is_verified) {
    return res.status(403).json({
      success: false,
      message: 'Cannot apply until your student account is verified',
    });
  }

  if (job.status !== 'Active') {
    return res.status(400).json({
      success: false,
      message: 'Applications are only accepted for active jobs',
    });
  }

  const existingApplication = storage.applications.find(
    (app) => app.job_id === job.id && app.user_id === studentId
  );
  if (existingApplication) {
    return res.status(409).json({
      success: false,
      message: 'Duplicate application blocked: you already applied to this job',
    });
  }

  job.current_applicants += 1;
  if (job.current_applicants >= job.max_applicant_cap) {
    job.status = 'Closed';
    pushNotification({
      user_id: job.company_id,
      job_id: job.id,
      type: 'auto_close',
      message: `Job ${job.title} has reached its applicant cap and is now closed`,
    });
  }

  const application = {
    id: getNextId(storage.applications),
    job_id: job.id,
    user_id: studentId,
    status: 'Submitted',
    applied_at: new Date(),
  };

  storage.applications.push(application);
  pushNotification({
    user_id: studentId,
    job_id: job.id,
    message: `Student ${studentId} applied to job ${job.title}`,
  });

  res.status(201).json({
    success: true,
    message: 'Application submitted successfully',
    data: application,
  });
});

const updateApplicationStatus = asyncHandler(async (req, res) => {
  if (req.user?.role !== 'company') {
    return res.status(403).json({
      success: false,
      message: 'Only company users can update application status',
    });
  }

  const applicationId = Number(req.params.id);
  const { status } = req.body;
  const application = storage.applications.find((app) => app.id === applicationId);

  if (!application) {
    return res.status(404).json({
      success: false,
      message: 'Application not found',
    });
  }

  const job = storage.job_listings.find((item) => item.id === application.job_id);
  if (!job || job.company_id !== req.user.id) {
    return res.status(403).json({
      success: false,
      message: 'You can only update applications for jobs posted by your company',
    });
  }

  const validStatuses = ['Submitted', 'Shortlisted', 'Rejected', 'Accepted'];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: `Invalid application status. Allowed values: ${validStatuses.join(', ')}`,
    });
  }

  if (application.status === 'Rejected' || application.status === 'Accepted') {
    return res.status(400).json({
      success: false,
      message: 'Finalized applications cannot be updated',
    });
  }

  const previousStatus = application.status;
  application.status = status;

  pushNotification({
    user_id: application.user_id,
    job_id: application.job_id,
    message: `Application ${application.id} status changed from ${previousStatus} to ${application.status}`,
  });

  res.status(200).json({
    success: true,
    message: 'Application status updated',
    data: application,
  });
});

const withdrawApplication = asyncHandler(async (req, res) => {
  const applicationId = Number(req.params.id);
  const applicationIndex = storage.applications.findIndex(
    (app) => app.id === applicationId && app.user_id === req.user?.id
  );

  if (applicationIndex < 0) {
    return res.status(404).json({
      success: false,
      message: 'Application not found or not owned by you',
    });
  }

  const application = storage.applications[applicationIndex];
  if (application.status !== 'Submitted') {
    return res.status(400).json({
      success: false,
      message: 'Only Submitted applications can be withdrawn',
    });
  }

  const [removedApplication] = storage.applications.splice(applicationIndex, 1);
  const job = storage.job_listings.find((item) => item.id === removedApplication.job_id);

  if (job) {
    job.current_applicants = Math.max(0, job.current_applicants - 1);
    if (job.status === 'Closed' && job.current_applicants < job.max_applicant_cap) {
      job.status = 'Active';
    }
  }

  res.status(200).json({
    success: true,
    message: 'Application withdrawn successfully',
  });
});

const bulkUpdateStatus = asyncHandler(async (req, res) => {
  if (req.user?.role !== 'company') {
    return res.status(403).json({
      success: false,
      message: 'Only company users can perform bulk application updates',
    });
  }

  const companyJobIds = storage.job_listings
    .filter((job) => job.company_id === req.user.id)
    .map((job) => job.id);

  const cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const updatedApplications = [];

  storage.applications.forEach((application) => {
    if (
      application.status === 'Submitted' &&
      application.applied_at instanceof Date &&
      application.applied_at < cutoffDate &&
      companyJobIds.includes(application.job_id)
    ) {
      application.status = 'Rejected';
      updatedApplications.push(application);
      pushNotification({
        user_id: application.user_id,
        job_id: application.job_id,
        message: `Application ${application.id} has been rejected after 7 days without review`,
      });
    }
  });

  res.status(200).json({
    success: true,
    message: `${updatedApplications.length} submitted application(s) older than 7 days were rejected`,
    count: updatedApplications.length,
    data: updatedApplications,
  });
});

module.exports = {
  listApplications,
  getApplicationById,
  applyToJob,
  updateApplicationStatus,
  withdrawApplication,
  bulkUpdateStatus,
};
