// Advanced Matching Engine — Weighted Scoring System
const { QueryTypes } = require('sequelize');
const sequelize = require('../models/database');

// ─────────────────────────────────────
// Haversine Distance Calculator
// ─────────────────────────────────────
const haversine = (lat1, lng1, lat2, lng2) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// ─────────────────────────────────────
// Route Similarity Score (0-100)
// ─────────────────────────────────────
const routeSimilarity = (ride, userOrigin, userDest) => {
  const originDist = haversine(
    userOrigin.lat, userOrigin.lng,
    ride.origin_lat, ride.origin_lng
  );
  const destDist = haversine(
    userDest.lat, userDest.lng,
    ride.destination_lat, ride.destination_lng
  );
  const avgDist = (originDist + destDist) / 2;
  return Math.max(0, 100 - avgDist * 15);
};

// ─────────────────────────────────────
// Time Overlap Score (0-100)
// ─────────────────────────────────────
const timeOverlap = (rideTime, userTime) => {
  const ride = new Date(rideTime);
  const user = new Date(userTime);
  const diffMins = Math.abs(ride - user) / 60000;
  if (diffMins <= 10) return 100;
  if (diffMins <= 20) return 80;
  if (diffMins <= 30) return 60;
  if (diffMins <= 60) return 30;
  return 0;
};

// ─────────────────────────────────────
// Trust Score (0-100)
// ─────────────────────────────────────
const trustScore = (rating, totalRides, isVerified) => {
  const ratingScore = (parseFloat(rating) / 5) * 50;
  const ridesScore = Math.min(totalRides * 2, 30);
  const verifiedScore = isVerified ? 20 : 0;
  return ratingScore + ridesScore + verifiedScore;
};

// ─────────────────────────────────────
// MAIN MATCHING ENGINE
// Weights: Distance 40%, Route 30%, Time 20%, Trust 10%
// ─────────────────────────────────────
const matchRides = async ({
  userOrigin,
  userDest,
  requestedTime,
  communityId = null,
  maxResults = 5,
  radiusKm = 3,
}) => {
  try {
    const date = new Date(requestedTime).toISOString().split('T')[0];

    let query = `
      SELECT r.*,
             u.name as driver_name,
             u.rating as driver_rating,
             u.total_rides as driver_total_rides,
             u.aadhaar_verified,
             u.kyc_status,
             (SELECT COUNT(*) FROM bookings b WHERE b.ride_id = r.id) as booked_seats
      FROM rides r
      JOIN users u ON r.driver_id = u.id
      WHERE r.available_seats > 0
        AND r.ride_status = 'upcoming'
        AND DATE(r.departure_time) = $1
    `;

    const binds = [date];

    if (communityId) {
      query += ` AND r.community_id = $${binds.length + 1}`;
      binds.push(communityId);
    }

    const rides = await sequelize.query(query, {
      bind: binds,
      type: QueryTypes.SELECT,
    });

    // Score each ride
    const scored = rides.map(ride => {
      // Distance score (40%)
      const originDist = haversine(
        userOrigin.lat, userOrigin.lng,
        parseFloat(ride.origin_lat) || 17.4065,
        parseFloat(ride.origin_lng) || 78.4772
      );
      const distScore = Math.max(0, 100 - originDist * 20) * 0.4;

      // Route similarity score (30%)
      const routeScore = routeSimilarity(
        {
          origin_lat: parseFloat(ride.origin_lat) || 17.4065,
          origin_lng: parseFloat(ride.origin_lng) || 78.4772,
          destination_lat: parseFloat(ride.destination_lat) || 17.4435,
          destination_lng: parseFloat(ride.destination_lng) || 78.3772,
        },
        userOrigin, userDest
      ) * 0.3;

      // Time overlap score (20%)
      const timeScore = timeOverlap(ride.departure_time, requestedTime) * 0.2;

      // Trust score (10%)
      const trust = trustScore(
        ride.driver_rating || 4.5,
        ride.driver_total_rides || 0,
        ride.aadhaar_verified || false
      ) * 0.1;

      const totalScore = distScore + routeScore + timeScore + trust;

      return {
        ...ride,
        matchScore: Math.round(totalScore),
        originDistance: originDist.toFixed(2),
        matchDetails: {
          distanceScore: Math.round(distScore / 0.4),
          routeScore: Math.round(routeScore / 0.3),
          timeScore: Math.round(timeScore / 0.2),
          trustScore: Math.round(trust / 0.1),
        },
      };
    });

    // Filter by radius and sort by score
    const filtered = scored
      .filter(r => parseFloat(r.originDistance) <= radiusKm)
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, maxResults);

    return {
      matches: filtered,
      totalFound: scored.length,
      filteredCount: filtered.length,
      searchRadius: radiusKm,
      matchRate: scored.length > 0
        ? Math.round((filtered.length / scored.length) * 100)
        : 0,
    };
  } catch (error) {
    console.error('Matching engine error:', error.message);
    return { matches: [], totalFound: 0, filteredCount: 0, matchRate: 0 };
  }
};

// ─────────────────────────────────────
// Multi-hop ride support
// ─────────────────────────────────────
const findMultiHopRides = async (userOrigin, userDest, requestedTime) => {
  try {
    // Find rides that pass near user's location
    const allRides = await sequelize.query(
      `SELECT r.*, u.name as driver_name, u.rating as driver_rating
       FROM rides r
       JOIN users u ON r.driver_id = u.id
       WHERE r.available_seats > 0
         AND r.ride_status = 'upcoming'
         AND DATE(r.departure_time) = $1`,
      { bind: [new Date(requestedTime).toISOString().split('T')[0]], type: QueryTypes.SELECT }
    );

    const multiHop = allRides.filter(ride => {
      const rideOriginLat = parseFloat(ride.origin_lat) || 17.4065;
      const rideOriginLng = parseFloat(ride.origin_lng) || 78.4772;
      const rideDestLat = parseFloat(ride.destination_lat) || 17.4435;
      const rideDestLng = parseFloat(ride.destination_lng) || 78.3772;

      // Check if ride passes near user's origin
      const passesNearOrigin = haversine(
        userOrigin.lat, userOrigin.lng,
        rideOriginLat, rideOriginLng
      ) <= 5;

      // Check if ride goes toward user's destination
      const goesTowardDest = haversine(
        userDest.lat, userDest.lng,
        rideDestLat, rideDestLng
      ) <= 5;

      return passesNearOrigin && goesTowardDest;
    });

    return multiHop.slice(0, 3);
  } catch (error) {
    return [];
  }
};

module.exports = { matchRides, findMultiHopRides, haversine };