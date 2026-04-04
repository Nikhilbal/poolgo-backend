const { QueryTypes } = require('sequelize');
const sequelize = require('../models/database');
const { v4: uuidv4 } = require('uuid');

// ─────────────────────────────────────
// Get Wallet Balance
// ─────────────────────────────────────
const getBalance = async (userId) => {
  const result = await sequelize.query(
    `SELECT COALESCE(SUM(
       CASE WHEN type = 'credit' THEN amount
            WHEN type = 'debit' THEN -amount
            ELSE 0 END
     ), 0) as balance
     FROM wallet_transactions WHERE user_id = $1`,
    { bind: [userId], type: QueryTypes.SELECT }
  );
  return parseFloat(result[0]?.balance || 0);
};

// ─────────────────────────────────────
// Add Credits (referral, first ride, etc.)
// ─────────────────────────────────────
const addCredits = async (userId, amount, reason) => {
  await sequelize.query(
    `INSERT INTO wallet_transactions (id, user_id, amount, type, description, created_at)
     VALUES ($1, $2, $3, 'credit', $4, NOW())`,
    { bind: [uuidv4(), userId, amount, reason], type: QueryTypes.INSERT }
  );
  return await getBalance(userId);
};

// ─────────────────────────────────────
// Deduct Credits
// ─────────────────────────────────────
const deductCredits = async (userId, amount, reason) => {
  const balance = await getBalance(userId);
  if (balance < amount) throw new Error('Insufficient wallet balance');

  await sequelize.query(
    `INSERT INTO wallet_transactions (id, user_id, amount, type, description, created_at)
     VALUES ($1, $2, $3, 'debit', $4, NOW())`,
    { bind: [uuidv4(), userId, amount, reason], type: QueryTypes.INSERT }
  );

  return await getBalance(userId);
};

// ─────────────────────────────────────
// Process Referral Reward
// ─────────────────────────────────────
const processReferral = async (referrerId, newUserId) => {
  // Give ₹50 to referrer
  await addCredits(referrerId, 50, 'Referral reward — friend joined PoolGo');
  // Give ₹30 welcome bonus to new user
  await addCredits(newUserId, 30, 'Welcome bonus — first ride discount');
  return { referrerBonus: 50, newUserBonus: 30 };
};

// ─────────────────────────────────────
// First Ride Bonus
// ─────────────────────────────────────
const giveFirstRideBonus = async (userId) => {
  const bookings = await sequelize.query(
    `SELECT COUNT(*) as count FROM bookings WHERE rider_id = $1`,
    { bind: [userId], type: QueryTypes.SELECT }
  );

  if (parseInt(bookings[0]?.count) === 1) {
    await addCredits(userId, 20, 'First ride bonus!');
    return true;
  }
  return false;
};

// ─────────────────────────────────────
// Transaction History
// ─────────────────────────────────────
const getTransactionHistory = async (userId) => {
  return await sequelize.query(
    `SELECT * FROM wallet_transactions
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    { bind: [userId], type: QueryTypes.SELECT }
  );
};

module.exports = { getBalance, addCredits, deductCredits, processReferral, giveFirstRideBonus, getTransactionHistory };