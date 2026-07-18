const asyncHandler = require('../utils/asyncHandler');
const { storage } = require('../config/db');

const getNextId = (items) => (items.length ? Math.max(...items.map((item) => item.id)) + 1 : 1);

const findProfile = (userId) => storage.student_profiles.find((profile) => profile.user_id === userId) || null;

const normalizeSkills = (skills) =>
  Array.isArray(skills)
    ? skills.map((skill) => String(skill || '').trim()).filter(Boolean)
    : [];

const normalizeEducation = (educationHistory) =>
  Array.isArray(educationHistory)
    ? educationHistory.map((item) => String(item || '').trim()).filter(Boolean)
    : [];

const normalizeSocialLinks = (socialLinks) => {
  if (Array.isArray(socialLinks)) {
    return socialLinks.map((link) => String(link || '').trim()).filter(Boolean);
  }

  if (socialLinks && typeof socialLinks === 'object') {
    return Object.values(socialLinks)
      .map((link) => String(link || '').trim())
      .filter(Boolean);
  }

  return [];
};

const calculateBioScore = (bio) => {
  if (!bio) return 0;
  const length = String(bio).trim().length;
  return Math.min(20, Math.round((length / 80) * 20));
};

const calculateCgpaScore = (cgpa) => {
  if (cgpa === undefined || cgpa === null || Number.isNaN(Number(cgpa))) return 0;
  const numeric = Number(cgpa);
  if (numeric <= 0) return 0;
  if (numeric >= 10) return 20;
  return Math.round((numeric / 10) * 20);
};

const calculateCompleteness = (profile) => {
  if (!profile) return 0;

  const skillsScore = normalizeSkills(profile.skills).length > 0 ? 20 : 0;
  const educationScore = normalizeEducation(profile.education_history).length > 0 ? 20 : 0;
  const bioScore = calculateBioScore(profile.bio);
  const socialScore = normalizeSocialLinks(profile.social_links).length > 0 ? 20 : 0;
  const cgpaScore = calculateCgpaScore(profile.cgpa);

  return Math.min(100, skillsScore + educationScore + bioScore + socialScore + cgpaScore);
};

const getProfile = asyncHandler(async (req, res) => {
  const profile = findProfile(req.user.id);
  if (!profile) {
    return res.status(404).json({
      success: false,
      message: 'Student profile not found',
    });
  }

  const user = storage.users.find((item) => item.id === req.user.id);
  const completeness = calculateCompleteness(profile, user);

  res.status(200).json({
    success: true,
    data: {
      ...profile,
      profile_completeness: completeness,
    },
  });
});

const createProfile = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  if (findProfile(userId)) {
    return res.status(409).json({
      success: false,
      message: 'Profile already exists. Use PUT /api/students/profile to update it.',
    });
  }

  const {
    branch,
    year,
    skills = [],
    education_history = [],
    social_links = [],
    bio = null,
    cgpa = null,
  } = req.body;

  const normalizedCgpa = cgpa !== undefined && cgpa !== null ? Number(cgpa) : null;
  if (cgpa !== undefined && cgpa !== null && (Number.isNaN(normalizedCgpa) || normalizedCgpa < 0 || normalizedCgpa > 10)) {
    return res.status(400).json({
      success: false,
      message: 'CGPA must be a number between 0 and 10',
    });
  }

  const profile = {
    id: getNextId(storage.student_profiles),
    user_id: userId,
    branch: branch ? String(branch).trim() : null,
    year: year ? String(year).trim() : null,
    skills: normalizeSkills(skills),
    education_history: normalizeEducation(education_history),
    social_links: normalizeSocialLinks(social_links),
    bio: bio ? String(bio).trim() : null,
    cgpa: normalizedCgpa,
    created_at: new Date(),
    updated_at: new Date(),
  };

  storage.student_profiles.push(profile);

  const user = storage.users.find((item) => item.id === userId);
  const completeness = calculateCompleteness(profile, user);

  res.status(201).json({
    success: true,
    message: 'Profile created successfully',
    data: {
      ...profile,
      completeness,
    },
  });
});

const updateProfile = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const profile = findProfile(userId);

  if (!profile) {
    return res.status(404).json({
      success: false,
      message: 'Student profile not found',
    });
  }

  const {
    branch,
    year,
    skills,
    education_history,
    social_links,
    bio,
    cgpa,
  } = req.body;

  if (branch !== undefined) profile.branch = branch ? String(branch).trim() : null;
  if (year !== undefined) profile.year = year ? String(year).trim() : null;
  if (skills !== undefined) profile.skills = normalizeSkills(skills);
  if (education_history !== undefined) profile.education_history = normalizeEducation(education_history);
  if (social_links !== undefined) profile.social_links = normalizeSocialLinks(social_links);
  if (bio !== undefined) profile.bio = bio ? String(bio).trim() : null;
  if (cgpa !== undefined) {
    const normalizedCgpa = cgpa !== null ? Number(cgpa) : null;
    if (cgpa !== null && (Number.isNaN(normalizedCgpa) || normalizedCgpa < 0 || normalizedCgpa > 10)) {
      return res.status(400).json({
        success: false,
        message: 'CGPA must be a number between 0 and 10',
      });
    }
    profile.cgpa = normalizedCgpa;
  }

  profile.updated_at = new Date();

  const user = storage.users.find((item) => item.id === userId);
  const completeness = calculateCompleteness(profile, user);

  res.status(200).json({
    success: true,
    message: 'Profile updated successfully',
    data: {
      ...profile,
      completeness,
    },
  });
});

const deleteProfile = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const activeStatuses = ['Submitted', 'Under Review', 'Shortlisted'];
  const blockedApplication = storage.applications.find(
    (application) => application.user_id === userId && activeStatuses.includes(application.status)
  );

  if (blockedApplication) {
    return res.status(400).json({
      success: false,
      message: 'Cannot delete profile while there are active applications in Submitted, Under Review, or Shortlisted status',
    });
  }

  const index = storage.student_profiles.findIndex((profile) => profile.user_id === userId);
  if (index < 0) {
    return res.status(404).json({
      success: false,
      message: 'Student profile not found',
    });
  }

  storage.student_profiles.splice(index, 1);

  res.status(200).json({
    success: true,
    message: 'Profile deleted successfully',
  });
});

const getProfileCompleteness = asyncHandler(async (req, res) => {
  const profile = findProfile(req.user.id);
  if (!profile) {
    return res.status(404).json({
      success: false,
      message: 'Student profile not found',
    });
  }

  const completeness = calculateCompleteness(profile);

  res.status(200).json({
    success: true,
    data: {
      profile_completeness: completeness,
    },
  });
});

module.exports = {
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  getProfileCompleteness,
};
