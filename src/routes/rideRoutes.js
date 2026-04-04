const express = require('express');
const router = express.Router();

const {
  createRide,
  bookRide,
  getMyBookings
} = require('../controllers/rideController');

const { protect } = require('../middleware/authMiddleware');

// 🔥 NEW IMPORTS (IMPORTANT)
const cityflow = require('../services/cityflowClient');
const sequelize = require('../models/database');
const { QueryTypes } = require('sequelize');


// ==============================
// 🚗 CREATE RIDE
// ==============================
router.post('/create', protect, createRide);


// ==============================
// 🔍 SEARCH RIDES (AI ENHANCED)
// ==============================
router.get('/search', protect, async (req, res) => {
  try {
    const {
      origin_lat,
      origin_lng,
      destination_lat,
      destination_lng,
      date
    } = req.query;

    // ❗ Basic validation
    if (!origin_lat || !origin_lng || !destination_lat || !destination_lng || !date) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // ==============================
    // 🧠 STEP 1: Get rides from DB
    // ==============================
    const rides = await sequelize.query(
      `SELECT r.*, u.name as driver_name, u.rating as driver_rating,
              u.aadhaar_verified
       FROM rides r
       JOIN users u ON r.driver_id = u.id
       WHERE r.available_seats > 0
         AND r.ride_status = 'upcoming'
         AND DATE(r.departure_time) = $1
       LIMIT 20`,
      {
        bind: [date],
        type: QueryTypes.SELECT
      }
    );

    // ==============================
    // 🤖 STEP 2: Call CityFlow AI
    // ==============================
    let aiResult = null;

    try {
      aiResult = await cityflow.processRideRequest(
        req.user.id,
        {
          lat: parseFloat(origin_lat),
          lng: parseFloat(origin_lng)
        },
        {
          lat: parseFloat(destination_lat),
          lng: parseFloat(destination_lng)
        },
        new Date().toISOString(),
        rides
      );
    } catch (aiError) {
      console.error('AI error (fallback to normal rides):', aiError.message);
    }

    // ==============================
    // 🚀 STEP 3: Response
    // ==============================
    res.json({
      rides: aiResult?.recommended_rides || rides,
      total: rides.length,
      aiInsights: aiResult
        ? {
            smartPrice: aiResult.smart_price,
            demandInsight: aiResult.demand_insight,
            tip: aiResult.ai_tip,
          }
        : null,
    });

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});


// ==============================
// 🎫 BOOK RIDE
// ==============================
router.post('/book', protect, bookRide);


// ==============================
// 📜 MY BOOKINGS
// ==============================
router.get('/my-bookings', protect, getMyBookings);


module.exports = router;