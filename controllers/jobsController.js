const asyncHandler = require('../utils/asyncHandler');
const { storage } = require('../config/db');
const { pushNotification } = require('./notificationController');

const getNextId = (items) => (items.length ? Math.max(...items.map((item) => item.id)) + 1 : 1);

const normalizeArray = (input) => (Array.isArray(input) ? input.map((item) => String(item).trim().toLowerCase()) : []);

const calculatePercentOverlap = (studentValues = [], jobValues = []) => {
  if (!Array.isArray(jobValues) || jobValues.length === 0) return 100;
  const normalizedStudent = normalizeArray(studentValues);
  const normalizedJob = normalizeArray(jobValues);
  const overlap = normalizedJob.filter((value) => normalizedStudent.includes(value));
  return Math.round((overlap.length / normalizedJob.length) * 100);
};

const calculateSkillOverlap = (studentSkills = [], requiredSkills = [], preferredSkills = []) => {
  const requiredMatch = calculatePercentOverlap(studentSkills, requiredSkills);
  const preferredMatch = calculatePercentOverlap(studentSkills, preferredSkills);
  return {
    requiredMatch,
    preferredMatch,
    skillScore: Math.round(requiredMatch * 0.6 + preferredMatch * 0.4),
  };
};

const calculateBranchAlignment = (studentBranch, preferredBranches) => {
  if (!preferredBranches?.length || !studentBranch) return 100;
  const normalizedStudent = String(studentBranch).trim().toLowerCase();
  const normalizedPreferred = normalizeArray(preferredBranches);
  return normalizedPreferred.includes(normalizedStudent) ? 100 : 10;
};

const calculateYearAlignment = (studentYear, preferredYears) => {
  if (!preferredYears?.length || !studentYear) return 100;
  const normalizedStudent = String(studentYear).trim().toLowerCase();
  const normalizedPreferred = normalizeArray(preferredYears);
  if (normalizedPreferred.includes(normalizedStudent)) return 100;

  const studentValue = Number(normalizedStudent.replace(/[^0-9]/g, ''));
  if (!Number.isFinite(studentValue)) return 10;

  const preferredNumbers = normalizedPreferred
    .map((value) => Number(value.replace(/[^0-9]/g, '')))
    .filter(Number.isFinite);

  const offByOne = preferredNumbers.some((year) => Math.abs(year - studentValue) === 1);
  return offByOne ? 50 : 10;
};

const calculateCompletenessRatio = (profile) => {
  if (!profile) return 0;
  if (typeof profile.profile_completeness === 'number') {
    return Math.min(1, Math.max(0, profile.profile_completeness / 100));
  }

  const completeness = [
    Array.isArray(profile.skills) && profile.skills.length > 0,
    Boolean(profile.branch),
    Boolean(profile.year),
    Array.isArray(profile.education_history) && profile.education_history.length > 0,
    Boolean(profile.is_verified),
  ].filter(Boolean).length * 20;

  return Math.min(1, completeness / 100);
};

const calculateRecencyMultiplier = (createdAt) => {
  const daysSince = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24)));
  if (daysSince <= 7) return 1;
  if (daysSince <= 30) return 0.95;
  if (daysSince <= 60) return 0.9;
  if (daysSince <= 90) return 0.8;
  if (daysSince <= 120) return 0.65;
  if (daysSince <= 180) return 0.5;
  return 0.35;
};

const getProfileByUser = (userId) => storage.student_profiles.find((profile) => profile.user_id === userId) || null;

const calculateJobMatch = (studentProfile, job) => {
  const { requiredMatch, preferredMatch, skillScore } = calculateSkillOverlap(
    studentProfile?.skills,
    job.required_skills,
    job.preferred_skills
  );

  const branchScore = calculateBranchAlignment(studentProfile?.branch, job.preferred_branches);
  const yearScore = calculateYearAlignment(studentProfile?.year, job.preferred_years);
  const alignmentScore = Math.round((branchScore + yearScore) / 2);
  const completenessRatio = calculateCompletenessRatio(studentProfile);
  const recencyMultiplier = calculateRecencyMultiplier(job.created_at);

  const rawSubtotal = Math.round(skillScore * 0.7 + alignmentScore * 0.3);
  const finalScore = Math.round(rawSubtotal * completenessRatio * recencyMultiplier);

  return {
    match_score: finalScore,
    score_breakdown: {
      required_skill_overlap: requiredMatch,
      preferred_skill_overlap: preferredMatch,
      skill_overlap_score: skillScore,
      branch_alignment_score: branchScore,
      year_alignment_score: yearScore,
      alignment_score: alignmentScore,
      completeness_ratio: Number(completenessRatio.toFixed(2)),
      recency_multiplier: Number(recencyMultiplier.toFixed(2)),
      raw_subtotal: rawSubtotal,
    },
  };
};

const getJobs = asyncHandler(async (req, res) => {
  const jobs = storage.job_listings.map((job) => ({ ...job }));
  const studentProfile = req.user?.role === 'student' ? getProfileByUser(req.user.id) : null;

  const jobsWithScore = jobs
    .map((job) => {
      const scoreData = studentProfile
        ? calculateJobMatch(studentProfile, job)
        : {
            match_score: calculateRecencyMultiplier(job.created_at) * 100,
            score_breakdown: {
              recency_multiplier: calculateRecencyMultiplier(job.created_at),
            },
          };

      if (req.user?.role === 'student' && scoreData.match_score > 70) {
        const alreadyNotified = storage.notifications.some(
          (item) =>
            item.user_id === req.user.id &&
            item.job_id === job.id &&
            item.type === 'high_match'
        );
        if (!alreadyNotified) {
          pushNotification({
            user_id: req.user.id,
            job_id: job.id,
            type: 'high_match',
            message: `High match alert: ${job.title} is ${scoreData.match_score}% matched to your profile`,
          });
        }
      }

      return {
        ...job,
        match_score: scoreData.match_score,
        score_breakdown: scoreData.score_breakdown,
      };
    })
    .sort((a, b) => b.match_score - a.match_score);

  res.status(200).json({
    success: true,
    count: jobsWithScore.length,
    data: jobsWithScore,
  });
});

const getJobById = asyncHandler(async (req, res) => {
  const jobId = Number(req.params.id);
  const job = storage.job_listings.find((item) => item.id === jobId);

  if (!job) {
    return res.status(404).json({
      success: false,
      message: 'Job not found',
    });
  }

  res.status(200).json({
    success: true,
    data: job,
  });
});

const createJob = asyncHandler(async (req, res) => {
  const {
    title,
    description,
    required_skills = [],
    max_applicant_cap = 1,
    location,
    salary,
    preferred_branches = [],
    preferred_years = [],
  } = req.body;

  const companyId = req.user?.id;
  if (!title || !description) {
    return res.status(400).json({
      success: false,
      message: 'Title and description are required to create a job',
    });
  }

  const newJob = {
    id: getNextId(storage.job_listings),
    title: String(title).trim(),
    description: String(description).trim(),
    required_skills: Array.isArray(required_skills) ? required_skills : [],
    preferred_branches: Array.isArray(preferred_branches) ? preferred_branches : [],
    preferred_years: Array.isArray(preferred_years) ? preferred_years : [],
    max_applicant_cap: Number(max_applicant_cap) || 1,
    current_applicants: 0,
    status: 'Draft',
    company_id: companyId,
    location: location ? String(location).trim() : null,
    salary: salary ? String(salary).trim() : null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  storage.job_listings.push(newJob);

  res.status(201).json({
    success: true,
    message: 'Job created in Draft status',
    data: newJob,
  });
});

const updateJob = asyncHandler(async (req, res) => {
  const jobId = Number(req.params.id);
  const job = storage.job_listings.find((item) => item.id === jobId);
  if (!job) {
    return res.status(404).json({
      success: false,
      message: 'Job not found',
    });
  }
  if (job.company_id !== req.user?.id) {
    return res.status(403).json({
      success: false,
      message: 'You are not authorized to update this job',
    });
  }

  const allowedUpdates = [
    'title',
    'description',
    'required_skills',
    'preferred_branches',
    'preferred_years',
    'max_applicant_cap',
    'location',
    'salary',
  ];
  allowedUpdates.forEach((field) => {
    if (field in req.body) {
      job[field] = req.body[field];
    }
  });

  job.updated_at = new Date();

  res.status(200).json({
    success: true,
    message: 'Job updated successfully',
    data: job,
  });
});

const updateJobStatus = asyncHandler(async (req, res) => {
  const jobId = Number(req.params.id);
  const { status: requestedStatus } = req.body;
  const job = storage.job_listings.find((item) => item.id === jobId);
  if (!job) {
    return res.status(404).json({
      success: false,
      message: 'Job not found',
    });
  }
  if (job.company_id !== req.user?.id) {
    return res.status(403).json({
      success: false,
      message: 'You are not authorized to update this job status',
    });
  }

  const validTransitions = {
    Draft: ['Active'],
    Active: ['Closed'],
    Closed: [],
  };
  if (!requestedStatus || typeof requestedStatus !== 'string') {
    return res.status(400).json({
      success: false,
      message: 'A valid status is required',
    });
  }

  const nextStatus = String(requestedStatus).trim();
  if (!validTransitions[job.status].includes(nextStatus)) {
    return res.status(400).json({
      success: false,
      message: `Invalid status transition from ${job.status} to ${nextStatus}`,
    });
  }

  job.status = nextStatus;
  job.updated_at = new Date();

  res.status(200).json({
    success: true,
    message: `Job status updated to ${nextStatus}`,
    data: job,
  });
});

const deleteJob = asyncHandler(async (req, res) => {
  const jobId = Number(req.params.id);
  const jobIndex = storage.job_listings.findIndex((item) => item.id === jobId);
  if (jobIndex < 0) {
    return res.status(404).json({
      success: false,
      message: 'Job not found',
    });
  }
  const job = storage.job_listings[jobIndex];
  if (job.company_id !== req.user?.id) {
    return res.status(403).json({
      success: false,
      message: 'You are not authorized to delete this job',
    });
  }

  storage.job_listings.splice(jobIndex, 1);
  res.status(200).json({
    success: true,
    message: 'Job deleted successfully',
  });
});

module.exports = {
  getJobs,
  getJobById,
  createJob,
  updateJob,
  updateJobStatus,
  deleteJob,
};
