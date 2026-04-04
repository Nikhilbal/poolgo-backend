const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const sequelize = require('../models/database');
const { QueryTypes } = require('sequelize');

// Generate JWT Token
const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN
  });
};

// REGISTER
const register = async (req, res) => {
  try {
    const { name, email, phone, password, user_type } = req.body;

    const existing = await sequelize.query(
      'SELECT id FROM users WHERE email = $1 OR phone = $2',
      { bind: [email, phone], type: QueryTypes.SELECT }
    );

    if (existing.length > 0) {
      return res.status(400).json({ error: 'Email or phone already registered' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const id = uuidv4();

    await sequelize.query(
      `INSERT INTO users (id, name, email, phone, password_hash, user_type)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      { bind: [id, name, email, phone, password_hash, user_type || 'rider'], type: QueryTypes.INSERT }
    );

    const token = generateToken(id);
    res.status(201).json({ message: 'Account created', token, user: { id, name, email, phone } });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error during registration' });
  }
};

// LOGIN
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const users = await sequelize.query(
      'SELECT * FROM users WHERE email = $1',
      { bind: [email], type: QueryTypes.SELECT }
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const token = generateToken(user.id);

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        user_type: user.user_type
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error during login' });
  }
};

// ✅ VERIFY OTP
const verifyOtp = async (req, res) => {
  try {
    const { phone, otp } = req.body;

    console.log("BODY:", req.body);

    if (!phone || !otp) {
      return res.status(400).json({ error: "Phone and OTP required" });
    }

    if (otp !== "1234") {
      return res.status(400).json({ error: "Invalid OTP" });
    }

    res.status(200).json({
      success: true,
      message: "OTP verified successfully"
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "OTP verification failed" });
  }
};

// GET PROFILE
const getProfile = async (req, res) => {
  try {
    const users = await sequelize.query(
      `SELECT id, name, email, phone FROM users WHERE id = $1`,
      { bind: [req.user.id], type: QueryTypes.SELECT }
    );

    if (users.length === 0) return res.status(404).json({ error: 'User not found' });

    res.json(users[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get profile' });
  }
};

module.exports = { register, login, verifyOtp, getProfile };