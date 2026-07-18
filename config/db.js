// config/db.js
const bcrypt = require('bcryptjs');

// In-Memory Data Store for Hackathon Sprint
const storage = {
  users: [],
  student_profiles: [],
  job_listings: [],
  applications: [],
  notifications: []
};

// Seed 1 Pre-Approved Company as strictly mandated[cite: 1]
const seedPassword = bcrypt.hashSync('LoomCompany2026', 10);
const seedCompany = {
  id: 1,
  email: 'recruitment@internloom.edu', // Passes the .edu constraint validation[cite: 1]
  password: seedPassword,
  role: 'company',
  is_verified: true,
  status: 'active',
  created_at: new Date()
};
storage.users.push(seedCompany);

console.log('🚀 In-Memory Database Mode Active (Network Bypassed)!');
console.log('📢 Seeded Company Credentials -> Email: recruitment@internloom.edu | Password: LoomCompany2026[cite: 1]');

module.exports = {
  query: async (text, params) => {
    console.log(`[Mock DB Query]: ${text.substring(0, 60)}...`);
    return { rows: [], rowCount: 0 };
  },
  storage
};