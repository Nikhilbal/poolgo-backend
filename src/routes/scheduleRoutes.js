const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  createScheduledRide, getUserScheduledRides, findBestTimeSlot
} = require('../services/schedulingService');
const { QueryTypes } = require('sequelize');
const sequelize = require('../models/database');

// POST /api/schedule/create
router.post('/create', protect, async (req, res) => {
  try {
    const result = await createScheduledRide({
      driverId: req.user.id,
      ...req.body,
    });
    res.status(201).json({ message: 'Ride scheduled successfully', ...result });
  } catch (error) {
    console.error('Schedule error:', error);
    res.status(500).json({ error: 'Failed to schedule ride' });
  }
});

// GET /api/schedule/my
router.get('/my', protect, async (req, res) => {
  try {
    const rides = await getUserScheduledRides(req.user.id);
    res.json({ rides });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get scheduled rides' });
  }
});

// GET /api/schedule/best-time
router.get('/best-time', protect, async (req, res) => {
  try {
    const { originLat, originLng, destLat, destLng } = req.query;
    const slots = await findBestTimeSlot(originLat, originLng, destLat, destLng);
    res.json({ slots });
  } catch (error) {
    res.status(500).json({ error: 'Failed to find best time' });
  }
});

module.exports = router;