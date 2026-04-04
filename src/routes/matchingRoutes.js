const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { matchRides, findMultiHopRides } = require('../services/matchingEngine');
const { predictDemand, getPopularRoutes, getDriverHotspots, predictNextRide } = require('../services/predictionService');
const { QueryTypes } = require('sequelize');
const sequelize = require('../models/database');

// POST /api/match/find
router.post('/find', protect, async (req, res) => {
  try {
    const { userOrigin, userDest, requestedTime, communityOnly } = req.body;

    if (!userOrigin || !userDest) {
      return res.status(400).json({ error: 'Origin and destination required' });
    }

    // Get user community
    const user = await sequelize.query(
      `SELECT community_id FROM users WHERE id = $1`,
      { bind: [req.user.id], type: QueryTypes.SELECT }
    );
    const communityId = communityOnly ? user[0]?.community_id : null;

    const result = await matchRides({
      userOrigin,
      userDest,
      requestedTime: requestedTime || new Date().toISOString(),
      communityId,
      maxResults: 5,
      radiusKm: 3,
    });

    // Also find multi-hop
    const multiHop = await findMultiHopRides(userOrigin, userDest, requestedTime || new Date().toISOString());

    res.json({
      ...result,
      multiHopRides: multiHop,
      tip: result.filteredCount === 0
        ? 'No rides nearby. Try expanding search or schedule for tomorrow.'
        : `Found ${result.filteredCount} matching rides`,
    });
  } catch (error) {
    console.error('Match error:', error);
    res.status(500).json({ error: 'Matching failed' });
  }
});

// GET /api/match/demand
router.get('/demand', protect, async (req, res) => {
  try {
    const demand = await predictDemand();
    const routes = await getPopularRoutes();
    const hotspots = await getDriverHotspots();
    const nextRide = await predictNextRide(req.user.id);

    res.json({ demand, popularRoutes: routes, driverHotspots: hotspots, predictedNextRide: nextRide });
  } catch (error) {
    res.status(500).json({ error: 'Prediction failed' });
  }
});

// GET /api/match/fixed-routes
router.get('/fixed-routes', protect, async (req, res) => {
  try {
    const routes = await sequelize.query(
      `SELECT * FROM fixed_routes WHERE is_active = true ORDER BY name`,
      { type: QueryTypes.SELECT }
    );
    res.json({ routes });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get routes' });
  }
});

module.exports = router;