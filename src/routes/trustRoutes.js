const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { getUserTrustProfile, submitRating } = require('../services/trustService');

// GET /api/trust/profile
router.get('/profile', protect, async (req, res) => {
  try {
    const profile = await getUserTrustProfile(req.user.id);
    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get trust profile' });
  }
});

// GET /api/trust/profile/:userId
router.get('/profile/:userId', protect, async (req, res) => {
  try {
    const profile = await getUserTrustProfile(req.params.userId);
    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get trust profile' });
  }
});

// POST /api/trust/rate
router.post('/rate', protect, async (req, res) => {
  try {
    const { rideId, ratedUserId, rating, comment } = req.body;

    if (!rideId || !ratedUserId || !rating) {
      return res.status(400).json({ error: 'rideId, ratedUserId, and rating are required' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    const result = await submitRating(rideId, req.user.id, ratedUserId, rating, comment);
    res.json({ message: 'Rating submitted', ...result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;