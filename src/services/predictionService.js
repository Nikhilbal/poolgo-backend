const { QueryTypes } = require('sequelize');
const sequelize = require('../models/database');

// ─────────────────────────────────────
// Demand Prediction by Time of Day
// ─────────────────────────────────────
const predictDemand = async () => {
  try {
    const hourlyDemand = await sequelize.query(
      `SELECT
         EXTRACT(HOUR FROM departure_time) as hour,
         COUNT(*) as ride_count,
         AVG(available_seats) as avg_seats
       FROM rides
       WHERE created_at > NOW() - INTERVAL '30 days'
       GROUP BY hour
       ORDER BY hour`,
      { type: QueryTypes.SELECT }
    );

    const peakHours = hourlyDemand
      .filter(h => parseInt(h.ride_count) > 2)
      .map(h => ({
        hour: parseInt(h.hour),
        label: `${h.hour}:00 - ${parseInt(h.hour) + 1}:00`,
        demand: parseInt(h.ride_count),
        avgSeats: Math.round(parseFloat(h.avg_seats)),
        isPeak: parseInt(h.ride_count) > 5,
      }));

    const currentHour = new Date().getHours();
    const currentDemand = hourlyDemand.find(
      h => parseInt(h.hour) === currentHour
    );

    return {
      peakHours,
      currentDemand: currentDemand
        ? parseInt(currentDemand.ride_count)
        : 0,
      recommendation: getTimeRecommendation(currentHour),
      surgeLevel: getSurgeLevel(currentHour),
    };
  } catch (error) {
    return {
      peakHours: [],
      currentDemand: 0,
      recommendation: 'Normal demand',
      surgeLevel: 'normal',
    };
  }
};

// ─────────────────────────────────────
// Route Popularity
// ─────────────────────────────────────
const getPopularRoutes = async () => {
  try {
    const routes = await sequelize.query(
      `SELECT
         origin_name,
         destination_name,
         COUNT(*) as frequency,
         AVG(price_per_seat) as avg_price,
         AVG(available_seats) as avg_seats
       FROM rides
       WHERE created_at > NOW() - INTERVAL '30 days'
       GROUP BY origin_name, destination_name
       ORDER BY frequency DESC
       LIMIT 10`,
      { type: QueryTypes.SELECT }
    );

    return routes.map(r => ({
      origin: r.origin_name,
      destination: r.destination_name,
      frequency: parseInt(r.frequency),
      avgPrice: Math.round(parseFloat(r.avg_price)),
      avgSeats: Math.round(parseFloat(r.avg_seats)),
      label: `${r.origin_name} → ${r.destination_name}`,
    }));
  } catch (error) {
    return [];
  }
};

// ─────────────────────────────────────
// Best Areas for Drivers
// ─────────────────────────────────────
const getDriverHotspots = async () => {
  const hour = new Date().getHours();

  const morning = [
    { area: 'Kondapur', reason: 'High demand to HITEC City at this hour', priority: 1 },
    { area: 'Kukatpally', reason: 'Many IT employees start here', priority: 2 },
    { area: 'Miyapur', reason: 'Metro catchment area', priority: 3 },
  ];

  const evening = [
    { area: 'HITEC City', reason: 'High return traffic from offices', priority: 1 },
    { area: 'Gachibowli', reason: 'Tech park exodus', priority: 2 },
    { area: 'Madhapur', reason: 'Evening peak demand', priority: 3 },
  ];

  const night = [
    { area: 'Ameerpet', reason: 'Metro connectivity hub', priority: 1 },
    { area: 'Banjara Hills', reason: 'Late night activity', priority: 2 },
  ];

  if (hour >= 7 && hour <= 10) return morning;
  if (hour >= 17 && hour <= 21) return evening;
  if (hour >= 21 || hour <= 6) return night;
  return morning;
};

// ─────────────────────────────────────
// Predict User's Next Ride
// ─────────────────────────────────────
const predictNextRide = async (userId) => {
  try {
    const history = await sequelize.query(
      `SELECT
         r.origin_name, r.destination_name,
         EXTRACT(HOUR FROM r.departure_time) as usual_hour,
         COUNT(*) as frequency
       FROM bookings b
       JOIN rides r ON b.ride_id = r.id
       WHERE b.rider_id = $1
       GROUP BY r.origin_name, r.destination_name, usual_hour
       ORDER BY frequency DESC
       LIMIT 1`,
      { bind: [userId], type: QueryTypes.SELECT }
    );

    if (!history.length) return null;

    const top = history[0];
    return {
      origin: top.origin_name,
      destination: top.destination_name,
      usualHour: parseInt(top.usual_hour),
      frequency: parseInt(top.frequency),
      suggestion: `Your usual ${top.origin_name} → ${top.destination_name} ride`,
    };
  } catch (error) {
    return null;
  }
};

// ─────────────────────────────────────
// Helpers
// ─────────────────────────────────────
const getTimeRecommendation = (hour) => {
  if (hour >= 8 && hour <= 10) return '🔥 Peak hours — book now to secure a seat';
  if (hour >= 17 && hour <= 20) return '🔥 Evening rush — rides filling up fast';
  if (hour >= 11 && hour <= 16) return '✅ Good time to travel — less traffic';
  if (hour >= 6 && hour <= 8) return '🌅 Early bird — great availability';
  return '🌙 Off-peak hours — easy booking';
};

const getSurgeLevel = (hour) => {
  if ((hour >= 8 && hour <= 10) || (hour >= 17 && hour <= 20)) return 'high';
  if ((hour >= 7 && hour <= 8) || (hour >= 20 && hour <= 22)) return 'medium';
  return 'normal';
};

module.exports = { predictDemand, getPopularRoutes, getDriverHotspots, predictNextRide };