const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const cityflow = require('../services/cityflowClient');

// GET /api/cityflow/heatmap
router.get('/heatmap', protect, async (req, res) => {
  try {
    const data = await cityflow.getHeatmap();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Heatmap failed' });
  }
});

// POST /api/cityflow/smart-price
router.post('/smart-price', protect, async (req, res) => {
  try {
    const { origin, destination, vehicleType, isPooled } = req.body;
    const demand = await cityflow.getDemand(origin.lat, origin.lng);
    const price = await cityflow.getSmartPrice(
      origin, destination,
      demand?.level || 'medium',
      5, vehicleType || 'car', isPooled || false
    );
    res.json({ price, demand });
  } catch (error) {
    res.status(500).json({ error: 'Pricing failed' });
  }
});

// GET /api/cityflow/demand
router.get('/demand', protect, async (req, res) => {
  try {
    const { lat, lng } = req.query;
    const demand = await cityflow.getDemand(
      parseFloat(lat) || 17.4065,
      parseFloat(lng) || 78.4772
    );
    res.json(demand);
  } catch (error) {
    res.status(500).json({ error: 'Demand prediction failed' });
  }
});

// GET /api/cityflow/driver-hotspots
router.get('/driver-hotspots', protect, async (req, res) => {
  try {
    const distribution = await cityflow.getDriverDistribution([]);
    res.json({
      hotspots: distribution?.recommendations || [],
      heatmap: distribution?.heatmap || [],
    });
  } catch (error) {
    res.status(500).json({ error: 'Hotspots failed' });
  }
});

module.exports = router;