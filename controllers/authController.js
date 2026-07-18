const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const asyncHandler = require('../utils/asyncHandler');
const User = require('../models/User');

const STUDENT_EMAIL_REGEX = /^[^\s@]+@[\w.-]+\.(edu|ac\.in)$/i;
const JWT_SECRET = process.env.JWT_SECRET || 'internloom-default-secret';
const JWT_EXPIRES_IN = '1h';

const generateAccessToken = (user) =>
  jwt.sign(
    {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

const generateRefreshToken = () => crypto.randomBytes(40).toString('hex');
const generateOtpCode = () => String(Math.floor(100000 + Math.random() * 900000));

const validateStudentEmail = (email) => {
  const normalizedEmail = String(email).trim().toLowerCase();
  if (!STUDENT_EMAIL_REGEX.test(normalizedEmail)) {
    return 'Students must register with a .edu or .ac.in email address';
  }
  return null;
};

const sendJson = (res, status, success, message, data = null) =>
  res.status(status).json({ success, message, data });

const buildUserResponse = (user) => ({
  id: user._id.toString(),
  email: user.email,
  role: user.role,
  is_verified: user.is_verified,
  status: user.status,
  company_name: user.company_name || null,
  company_status: user.company_status || null,
});

const registerStudent = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return sendJson(res, 400, false, 'Email and password are required');
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const validationError = validateStudentEmail(normalizedEmail);
  if (validationError) {
    return sendJson(res, 400, false, validationError);
  }

  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    return sendJson(res, 409, false, 'A user with that email already exists');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const otp_code = generateOtpCode();

  const user = new User({
    email: normalizedEmail,
    password: passwordHash,
    role: 'student',
    is_verified: false,
    otp_code,
    status: 'active',
  });

  await user.save();

  return sendJson(res, 201, true, 'Student registered successfully. Please verify your OTP.', {
    ...buildUserResponse(user),
    otp_code,
  });
});

const registerCompany = asyncHandler(async (req, res) => {
  const { email, password, company_name } = req.body;

  if (!email || !password || !company_name) {
    return sendJson(res, 400, false, 'Email, password, and company_name are required');
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    return sendJson(res, 409, false, 'A user with that email already exists');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const isDemoApproved = normalizedEmail === 'recruitment@internloom.edu';
  const company_status = isDemoApproved ? 'approved' : 'pending';
  const status = isDemoApproved ? 'active' : 'pending';

  const user = new User({
    email: normalizedEmail,
    password: passwordHash,
    role: 'company',
    company_name: String(company_name).trim(),
    company_status,
    is_verified: isDemoApproved,
    status,
  });

  await user.save();

  return sendJson(res, 201, true, 'Company registered successfully.', buildUserResponse(user));
});

const verifyOtp = asyncHandler(async (req, res) => {
  const { email, otp_code } = req.body;

  if (!email || !otp_code) {
    return sendJson(res, 400, false, 'Email and otp_code are required');
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const user = await User.findOne({ email: normalizedEmail });
  if (!user || !user.otp_code || user.otp_code !== String(otp_code).trim()) {
    return sendJson(res, 400, false, 'Invalid email or OTP');
  }

  user.is_verified = true;
  user.otp_code = null;
  await user.save();

  return sendJson(res, 200, true, 'OTP verified successfully', buildUserResponse(user));
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return sendJson(res, 400, false, 'Email and password are required');
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const user = await User.findOne({ email: normalizedEmail });
  if (!user) {
    return sendJson(res, 401, false, 'Invalid credentials');
  }

  const passwordMatches = await bcrypt.compare(password, user.password);
  if (!passwordMatches) {
    return sendJson(res, 401, false, 'Invalid credentials');
  }

  if (user.role === 'company' && user.company_status === 'pending') {
    return sendJson(res, 403, false, 'Company registration is still pending approval');
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken();
  user.refreshToken = refreshToken;
  await user.save();

  return sendJson(res, 200, true, 'Logged in successfully', {
    ...buildUserResponse(user),
    token: accessToken,
    refreshToken,
    expiresIn: JWT_EXPIRES_IN,
  });
});

const sendOtp = asyncHandler(async (req, res) => {
  const email = String(req.body.email || req.user?.email || '').trim().toLowerCase();
  if (!email) {
    return sendJson(res, 400, false, 'Email is required to send OTP');
  }

  const user = await User.findOne({ email });
  if (!user) {
    return sendJson(res, 404, false, 'User not found');
  }

  const otp_code = generateOtpCode();
  user.otp_code = otp_code;
  user.is_verified = false;
  await user.save();

  return sendJson(res, 200, true, 'OTP has been sent to the registered email address (simulated)', {
    otp_code,
  });
});

const refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken: incomingToken } = req.body;
  if (!incomingToken) {
    return sendJson(res, 400, false, 'Refresh token is required');
  }

  const user = await User.findOne({ refreshToken: incomingToken });
  if (!user) {
    return sendJson(res, 401, false, 'Refresh token not recognized');
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken();
  user.refreshToken = refreshToken;
  await user.save();

  return sendJson(res, 200, true, 'Refresh token accepted', {
    ...buildUserResponse(user),
    token: accessToken,
    refreshToken,
    expiresIn: JWT_EXPIRES_IN,
  });
});

const updateAccount = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!req.user) {
    return sendJson(res, 401, false, 'Authentication required');
  }

  const user = await User.findById(req.user.id);
  if (!user) {
    return sendJson(res, 404, false, 'User not found');
  }

  let otp_code = null;
  if (email !== undefined) {
    const normalizedEmail = String(email).trim().toLowerCase();
    if (!normalizedEmail) {
      return sendJson(res, 400, false, 'Email cannot be empty');
    }

    if (normalizedEmail !== user.email) {
      if (user.role === 'student') {
        const validationError = validateStudentEmail(normalizedEmail);
        if (validationError) {
          return sendJson(res, 400, false, validationError);
        }
      }

      const existingUser = await User.findOne({ email: normalizedEmail });
      if (existingUser && existingUser._id.toString() !== user._id.toString()) {
        return sendJson(res, 409, false, 'That email address is already registered');
      }

      user.email = normalizedEmail;
      user.is_verified = false;
      otp_code = generateOtpCode();
      user.otp_code = otp_code;
    }
  }

  if (password !== undefined) {
    if (!password) {
      return sendJson(res, 400, false, 'Password cannot be empty');
    }
    user.password = await bcrypt.hash(password, 10);
  }

  await user.save();

  return sendJson(res, 200, true, 'Account updated successfully', {
    ...buildUserResponse(user),
    otp_code,
  });
});

const logout = asyncHandler(async (req, res) => {
  if (!req.user) {
    return sendJson(res, 401, false, 'Authentication required');
  }

  const user = await User.findById(req.user.id);
  if (user) {
    user.refreshToken = null;
    await user.save();
  }

  return sendJson(res, 200, true, 'Logged out successfully');
});

const getCurrentUser = asyncHandler(async (req, res) => {
  if (!req.user) {
    return sendJson(res, 401, false, 'Authentication required');
  }

  const user = await User.findById(req.user.id);
  if (!user) {
    return sendJson(res, 404, false, 'User not found');
  }

  return sendJson(res, 200, true, 'Current user loaded', buildUserResponse(user));
});

module.exports = {
  registerStudent,
  registerCompany,
  verifyOtp,
  login,
  sendOtp,
  refreshToken,
  logout,
  getCurrentUser,
  updateAccount,
};
