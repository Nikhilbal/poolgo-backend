const OpenAI = require('openai');

// ✅ Safe OpenAI initialization (prevents crash if no API key)
let openai = null;

if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
} else {
  console.warn('⚠️ OpenAI API key missing — running in fallback mode');
}

// Simple in-memory cache (optional but useful)
const cache = new Map();

// ─────────────────────────────────────
// 1. Smart Ride Matching
// ─────────────────────────────────────
const smartRideMatch = async (userLocation, destination, time, availableRides) => {
  try {
    if (!openai || availableRides.length === 0) {
      return fallbackRideMatch(userLocation, destination, availableRides);
    }

    const cacheKey = JSON.stringify({ userLocation, destination, time });
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    const prompt = `
You are a carpooling AI assistant for Hyderabad, India.

User wants a ride:
- From: lat ${userLocation.lat}, lng ${userLocation.lng}
- To: lat ${destination.lat}, lng ${destination.lng}
- At: ${time}

Available rides:
${JSON.stringify(availableRides.slice(0, 10), null, 2)}

Return ONLY valid JSON:
{
  "rankedRides": [
    {
      "rideId": "uuid",
      "score": 85,
      "reason": "..."
    }
  ],
  "suggestedPickupPoint": {
    "name": "...",
    "lat": 0,
    "lng": 0,
    "reason": "..."
  },
  "bestTimeToBook": "...",
  "confidence": 0.9
}
`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400,
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    const result = JSON.parse(response.choices[0].message.content);
    cache.set(cacheKey, result);

    return result;

  } catch (error) {
    console.error('AI ride match error:', error.message);
    return fallbackRideMatch(userLocation, destination, availableRides);
  }
};

// Fallback logic
const fallbackRideMatch = (userLocation, destination, rides) => {
  const scored = rides.map(ride => {
    const dist = haversineDistance(
      userLocation.lat, userLocation.lng,
      ride.origin_lat || 17.4065, ride.origin_lng || 78.4772
    );
    const score = Math.max(0, 100 - dist * 10);
    return { rideId: ride.id, score, reason: `${dist.toFixed(1)}km away` };
  }).sort((a, b) => b.score - a.score);

  return {
    rankedRides: scored,
    suggestedPickupPoint: {
      name: 'Nearest Metro Station',
      lat: userLocation.lat,
      lng: userLocation.lng,
      reason: 'Closest landmark',
    },
    bestTimeToBook: 'Now',
    confidence: 0.6,
  };
};

// ─────────────────────────────────────
// 2. AI Suggestions
// ─────────────────────────────────────
const generateRideSuggestions = async (userId, userLocation, timeOfDay, rideHistory) => {
  try {
    if (!openai) return getDefaultSuggestions(timeOfDay);

    const prompt = `
Suggest 3 ride routes for a user in Hyderabad.

Time: ${timeOfDay}
Location: ${JSON.stringify(userLocation)}
History: ${JSON.stringify(rideHistory?.slice(0, 3) || [])}

Return JSON:
{
  "suggestions": [...],
  "greeting": "...",
  "tip": "..."
}
`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 300,
      temperature: 0.5,
      response_format: { type: "json_object" },
    });

    return JSON.parse(response.choices[0].message.content);

  } catch (error) {
    console.error('AI suggestions error:', error.message);
    return getDefaultSuggestions(timeOfDay);
  }
};

// Default suggestions
const getDefaultSuggestions = (timeOfDay) => {
  return {
    suggestions: [
      {
        origin: 'Kondapur',
        destination: 'HITEC City',
        estimatedFare: 45,
        reason: 'Common route',
      }
    ],
    greeting: 'Need a ride?',
    tip: 'Book early to avoid surge',
  };
};

// ─────────────────────────────────────
// 3. Smart Pricing
// ─────────────────────────────────────
const calculateSmartPrice = async (distanceKm, vehicleType, time, demandLevel) => {
  const hour = new Date().getHours();
  let surge = 1;

  if (hour >= 8 && hour <= 10) surge = 1.5;
  else if (hour >= 17 && hour <= 20) surge = 1.8;

  const rates = {
    car: { base: 50, perKm: 14 },
    bike: { base: 15, perKm: 6 },
  };

  const rate = rates[vehicleType] || rates.car;
  const fare = Math.ceil((rate.base + distanceKm * rate.perKm) * surge);

  return { fare, surge };
};

// ─────────────────────────────────────
// 4. Route Prediction
// ─────────────────────────────────────
const predictFrequentRoutes = (rideHistory = []) => {
  const map = {};

  rideHistory.forEach(r => {
    const key = `${r.origin_name}→${r.destination_name}`;
    map[key] = (map[key] || 0) + 1;
  });

  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
};

// ─────────────────────────────────────
// 5. Fraud Detection
// ─────────────────────────────────────
const detectFraud = (recentActions = []) => {
  const cancels = recentActions.filter(a => a.type === 'cancellation');

  if (cancels.length >= 3) {
    return { flagged: true, reason: 'Too many cancellations' };
  }

  return { flagged: false };
};

// ─────────────────────────────────────
// 6. Pickup Optimizer
// ─────────────────────────────────────
const optimizePickupPoint = (driver, passenger) => {
  return {
    name: 'Mid Point',
    lat: (driver.lat + passenger.lat) / 2,
    lng: (driver.lng + passenger.lng) / 2,
  };
};

// ─────────────────────────────────────
// Helper
// ─────────────────────────────────────
const haversineDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;

  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// Export
module.exports = {
  smartRideMatch,
  generateRideSuggestions,
  calculateSmartPrice,
  predictFrequentRoutes,
  detectFraud,
  optimizePickupPoint,
};