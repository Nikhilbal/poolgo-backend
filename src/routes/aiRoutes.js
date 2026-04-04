const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  smartRideMatch,
  generateRideSuggestions,
  calculateSmartPrice,
  predictFrequentRoutes,
  optimizePickupPoint,
} = require('../services/aiService');
const { QueryTypes } = require('sequelize');
const sequelize = require('../models/database');

// POST /api/ai/match-rides
router.post('/match-rides', protect, async (req, res) => {
  try {
    const { userLocation, destination, time } = req.body;

    const today = new Date().toISOString().split('T')[0];
    const rides = await sequelize.query(
      `SELECT r.*, u.name as driver_name, u.rating as driver_rating,
              u.aadhaar_verified
       FROM rides r
       JOIN users u ON r.driver_id = u.id
       WHERE r.available_seats > 0
         AND r.ride_status = 'upcoming'
         AND DATE(r.departure_time) = $1
       LIMIT 20`,
      { bind: [today], type: QueryTypes.SELECT }
    );

    const aiResult = await smartRideMatch(userLocation, destination, time, rides);

    // Reorder rides based on AI ranking
    const rankedIds = aiResult.rankedRides?.map(r => r.rideId) || [];
    const reorderedRides = [
      ...rankedIds.map(id => rides.find(r => r.id === id)).filter(Boolean),
      ...rides.filter(r => !rankedIds.includes(r.id)),
    ];

    res.json({
      rides: reorderedRides,
      aiInsights: {
        suggestedPickup: aiResult.suggestedPickupPoint,
        bestTimeToBook: aiResult.bestTimeToBook,
        confidence: aiResult.confidence,
      },
    });
  } catch (error) {
    console.error('AI match error:', error);
    res.status(500).json({ error: 'AI matching failed' });
  }
});

// GET /api/ai/suggestions
router.get('/suggestions', protect, async (req, res) => {
  try {
    const { lat, lng } = req.query;
    const hour = new Date().getHours();
    const timeOfDay = `${hour}:00`;

    // Get user ride history
    const history = await sequelize.query(
      `SELECT b.*, r.origin_name, r.destination_name
       FROM bookings b
       JOIN rides r ON b.ride_id = r.id
       WHERE b.rider_id = $1
       ORDER BY b.created_at DESC
       LIMIT 10`,
      { bind: [req.user.id], type: QueryTypes.SELECT }
    );

    const suggestions = await generateRideSuggestions(
      req.user.id,
      { lat: parseFloat(lat) || 17.4065, lng: parseFloat(lng) || 78.4772 },
      timeOfDay,
      history
    );

    res.json(suggestions);
  } catch (error) {
    console.error('Suggestions error:', error);
    res.status(500).json({ error: 'Failed to get suggestions' });
  }
});

// POST /api/ai/smart-price
router.post('/smart-price', protect, async (req, res) => {
  try {
    const { distanceKm, vehicleType, demandLevel } = req.body;
    const price = await calculateSmartPrice(
      distanceKm, vehicleType,
      new Date().toTimeString(), demandLevel || 'normal'
    );
    res.json(price);
  } catch (error) {
    res.status(500).json({ error: 'Pricing failed' });
  }
});

// GET /api/ai/frequent-routes
router.get('/frequent-routes', protect, async (req, res) => {
  try {
    const history = await sequelize.query(
      `SELECT r.origin_name, r.destination_name
       FROM bookings b
       JOIN rides r ON b.ride_id = r.id
       WHERE b.rider_id = $1
       ORDER BY b.created_at DESC LIMIT 20`,
      { bind: [req.user.id], type: QueryTypes.SELECT }
    );
    const routes = await predictFrequentRoutes(req.user.id, history);
    res.json({ routes });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get frequent routes' });
  }
});

// POST /api/ai/optimize-pickup
router.post('/optimize-pickup', protect, async (req, res) => {
  try {
    const { driverLocation, passengerLocation } = req.body;
    const pickup = await optimizePickupPoint(driverLocation, passengerLocation);
    res.json(pickup);
  } catch (error) {
    res.status(500).json({ error: 'Failed to optimize pickup' });
  }
});

// GET /api/ai/places-autocomplete
router.get('/places-autocomplete', protect, async (req, res) => {
  try {
    const { query, lat, lng } = req.query;

    if (!process.env.GOOGLE_MAPS_API_KEY) {
      // Fallback to static places
      const PLACES = [
        'HITEC City', 'Gachibowli', 'Kondapur', 'Madhapur',
        'Kukatpally', 'Ameerpet', 'Begumpet', 'Secunderabad',
        'LB Nagar', 'Uppal', 'Dilsukhnagar', 'Jubilee Hills',
        'Banjara Hills', 'Charminar', 'MG Bus Station',
        'Hyderabad Railway Station', 'Rajiv Gandhi Airport',
      ];
      const filtered = PLACES
        .filter(p => p.toLowerCase().includes(query?.toLowerCase() || ''))
        .slice(0, 6)
        .map(name => ({ name, address: `${name}, Hyderabad, Telangana` }));
      return res.json({ predictions: filtered });
    }

    const axios = require('axios');
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json`;
    const response = await axios.get(url, {
      params: {
        input: query,
        key: process.env.GOOGLE_MAPS_API_KEY,
        components: 'country:in',
        location: `${lat || 17.4065},${lng || 78.4772}`,
        radius: 50000,
        types: 'geocode|establishment',
      },
    });

    const predictions = response.data.predictions.map(p => ({
      placeId: p.place_id,
      name: p.structured_formatting?.main_text || p.description,
      address: p.description,
    }));

    res.json({ predictions });
  } catch (error) {
    console.error('Places autocomplete error:', error.message);
    res.status(500).json({ error: 'Autocomplete failed', predictions: [] });
  }
});

// GET /api/ai/place-details
router.get('/place-details', protect, async (req, res) => {
  try {
    const { placeId } = req.query;

    if (!process.env.GOOGLE_MAPS_API_KEY) {
      return res.json({ lat: 17.4065, lng: 78.4772, name: 'Hyderabad' });
    }

    const axios = require('axios');
    const url = `https://maps.googleapis.com/maps/api/place/details/json`;
    const response = await axios.get(url, {
      params: {
        place_id: placeId,
        key: process.env.GOOGLE_MAPS_API_KEY,
        fields: 'geometry,name,formatted_address',
      },
    });

    const result = response.data.result;
    res.json({
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      name: result.name,
      address: result.formatted_address,
    });
  } catch (error) {
    res.status(500).json({ error: 'Place details failed' });
  }
});

// GET /api/ai/directions
router.get('/directions', protect, async (req, res) => {
  try {
    const { originLat, originLng, destLat, destLng } = req.query;

    if (!process.env.GOOGLE_MAPS_API_KEY) {
      // Fallback calculation
      const R = 6371;
      const dLat = (destLat - originLat) * Math.PI / 180;
      const dLng = (destLng - originLng) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(originLat * Math.PI / 180) *
        Math.cos(destLat * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
      const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      return res.json({
        distanceKm: distKm.toFixed(1),
        durationMinutes: Math.round(distKm * 3),
        polyline: null,
      });
    }

    const axios = require('axios');
    const url = `https://maps.googleapis.com/maps/api/directions/json`;
    const response = await axios.get(url, {
      params: {
        origin: `${originLat},${originLng}`,
        destination: `${destLat},${destLng}`,
        key: process.env.GOOGLE_MAPS_API_KEY,
        mode: 'driving',
      },
    });

    const route = response.data.routes[0];
    const leg = route?.legs[0];

    res.json({
      distanceKm: (leg?.distance?.value / 1000).toFixed(1),
      durationMinutes: Math.round(leg?.duration?.value / 60),
      polyline: route?.overview_polyline?.points,
      distanceText: leg?.distance?.text,
      durationText: leg?.duration?.text,
    });
  } catch (error) {
    res.status(500).json({ error: 'Directions failed' });
  }
});

module.exports = router;