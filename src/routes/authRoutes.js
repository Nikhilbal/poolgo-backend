const express = require('express');
const router = express.Router();

const {
  register,
  login,
  verifyOtp,
  getProfile
} = require('../controllers/authController');

const { protect } = require('../middleware/authMiddleware');

router.post('/register', register);
router.post('/login', login);
router.post('/verify-otp', verifyOtp);
router.get('/profile', protect, getProfile);

module.exports = router;