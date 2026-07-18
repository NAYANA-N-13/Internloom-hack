const asyncHandler = require('../utils/asyncHandler');

const getProfile = asyncHandler(async (req, res) => {
  res.status(501).json({
    success: false,
    message: 'GET /api/students/profile — not implemented yet',
  });
});

const createProfile = asyncHandler(async (req, res) => {
  res.status(501).json({
    success: false,
    message: 'POST /api/students/profile — not implemented yet',
  });
});

const updateProfile = asyncHandler(async (req, res) => {
  res.status(501).json({
    success: false,
    message: 'PUT /api/students/profile — not implemented yet',
  });
});

const deleteProfile = asyncHandler(async (req, res) => {
  res.status(501).json({
    success: false,
    message: 'DELETE /api/students/profile — not implemented yet',
  });
});

const getProfileCompleteness = asyncHandler(async (req, res) => {
  res.status(501).json({
    success: false,
    message: 'GET /api/students/profile/completeness — not implemented yet',
  });
});

module.exports = {
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  getProfileCompleteness,
};
