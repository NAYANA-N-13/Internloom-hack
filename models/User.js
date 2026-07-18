const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ['student', 'company'],
      required: true,
      default: 'student',
    },
    is_verified: {
      type: Boolean,
      default: false,
    },
    otp_code: {
      type: String,
      default: null,
    },
    company_name: {
      type: String,
      trim: true,
      default: null,
    },
    company_status: {
      type: String,
      enum: ['pending', 'approved', 'active', 'rejected', null],
      default: null,
    },
    status: {
      type: String,
      enum: ['active', 'pending', 'inactive'],
      default: 'active',
    },
    refreshToken: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.index({ email: 1 }, { unique: true });

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
