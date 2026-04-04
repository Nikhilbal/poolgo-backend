const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getBalance, addCredits, deductCredits,
  processReferral, getTransactionHistory
} = require('../services/walletService');
const { QueryTypes } = require('sequelize');
const sequelize = require('../models/database');

// GET /api/wallet/balance
router.get('/balance', protect, async (req, res) => {
  try {
    const balance = await getBalance(req.user.id);
    res.json({ balance, formatted: `₹${balance.toFixed(2)}` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get balance' });
  }
});

// GET /api/wallet/transactions
router.get('/transactions', protect, async (req, res) => {
  try {
    const transactions = await getTransactionHistory(req.user.id);
    res.json({ transactions });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get transactions' });
  }
});

// POST /api/wallet/use-referral
router.post('/use-referral', protect, async (req, res) => {
  try {
    const { referralCode } = req.body;
    if (!referralCode) return res.status(400).json({ error: 'Referral code required' });

    const referrer = await sequelize.query(
      `SELECT id FROM users WHERE referral_code = $1 AND id != $2`,
      { bind: [referralCode, req.user.id], type: QueryTypes.SELECT }
    );

    if (!referrer.length) return res.status(404).json({ error: 'Invalid referral code' });

    // Check not already referred
    const alreadyReferred = await sequelize.query(
      `SELECT referred_by FROM users WHERE id = $1`,
      { bind: [req.user.id], type: QueryTypes.SELECT }
    );

    if (alreadyReferred[0]?.referred_by) {
      return res.status(400).json({ error: 'You have already used a referral code' });
    }

    // Process referral
    await sequelize.query(
      `UPDATE users SET referred_by = $1 WHERE id = $2`,
      { bind: [referrer[0].id, req.user.id], type: QueryTypes.UPDATE }
    );

    const result = await processReferral(referrer[0].id, req.user.id);
    res.json({ message: 'Referral applied successfully', ...result });
  } catch (error) {
    res.status(500).json({ error: 'Referral failed' });
  }
});

// GET /api/wallet/my-referral-code
router.get('/my-referral-code', protect, async (req, res) => {
  try {
    const user = await sequelize.query(
      `SELECT referral_code FROM users WHERE id = $1`,
      { bind: [req.user.id], type: QueryTypes.SELECT }
    );
    res.json({ referralCode: user[0]?.referral_code });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get referral code' });
  }
});

module.exports = router;