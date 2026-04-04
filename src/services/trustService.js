const { QueryTypes } = require('sequelize');
const sequelize = require('../models/database');

// ─────────────────────────────────────
// Calculate Trust Score (0-100)
// ─────────────────────────────────────
const calculateTrustScore = async (userId) => {
  try {
    const user = await sequelize.query(
      `SELECT u.*,
              COUNT(DISTINCT b.id) as total_bookings,
              COUNT(DISTINCT r.id) as total_rides_created,
              AVG(rt.rating) as avg_rating,
              COUNT(DISTINCT rt.id) as total_ratings
       FROM users u
       LEFT JOIN bookings b ON b.rider_id = u.id
       LEFT JOIN rides r ON r.driver_id = u.id
       LEFT JOIN ratings rt ON rt.rated_user = u.id
       WHERE u.id = $1
       GROUP BY u.id`,
      { bind: [userId], type: QueryTypes.SELECT }
    );

    if (!user.length) return 0;
    const u = user[0];

    let score = 0;

    // Phone verified (20 pts)
    if (u.phone) score += 20;

    // Aadhaar verified (25 pts)
    if (u.aadhaar_verified) score += 25;

    // KYC done (15 pts)
    if (u.kyc_status === 'verified') score += 15;

    // Rating score (20 pts)
    const avgRating = parseFloat(u.avg_rating) || 0;
    score += (avgRating / 5) * 20;

    // Ride history (10 pts)
    const rides = parseInt(u.total_bookings) + parseInt(u.total_rides_created);
    score += Math.min(rides * 1, 10);

    // Community member bonus (10 pts)
    if (u.community_id) score += 10;

    return Math.min(Math.round(score), 100);
  } catch (error) {
    console.error('Trust score error:', error.message);
    return 50;
  }
};

// ─────────────────────────────────────
// Submit Rating
// ─────────────────────────────────────
const submitRating = async (rideId, ratedBy, ratedUser, rating, comment) => {
  const { v4: uuidv4 } = require('uuid');

  // Check if already rated
  const existing = await sequelize.query(
    `SELECT id FROM ratings WHERE ride_id = $1 AND rated_by = $2`,
    { bind: [rideId, ratedBy], type: QueryTypes.SELECT }
  );

  if (existing.length > 0) {
    throw new Error('You have already rated this ride');
  }

  await sequelize.query(
    `INSERT INTO ratings (id, ride_id, rated_by, rated_user, rating, comment)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    {
      bind: [uuidv4(), rideId, ratedBy, ratedUser, rating, comment || null],
      type: QueryTypes.INSERT,
    }
  );

  // Update user average rating
  await sequelize.query(
    `UPDATE users SET rating = (
       SELECT AVG(rating) FROM ratings WHERE rated_user = $1
     ) WHERE id = $1`,
    { bind: [ratedUser], type: QueryTypes.UPDATE }
  );

  return { success: true };
};

// ─────────────────────────────────────
// Fraud Detection
// ─────────────────────────────────────
const detectSuspiciousActivity = async (userId) => {
  const flags = [];

  // Check cancellations in last 24 hours
  const cancellations = await sequelize.query(
    `SELECT COUNT(*) as count FROM bookings
     WHERE rider_id = $1
       AND booking_status = 'cancelled'
       AND created_at > NOW() - INTERVAL '24 hours'`,
    { bind: [userId], type: QueryTypes.SELECT }
  );

  if (parseInt(cancellations[0]?.count) >= 3) {
    flags.push({ type: 'excessive_cancellations', severity: 'high' });
  }

  // Check for multiple accounts with same phone
  const user = await sequelize.query(
    `SELECT phone FROM users WHERE id = $1`,
    { bind: [userId], type: QueryTypes.SELECT }
  );

  if (user.length && user[0].phone) {
    const duplicates = await sequelize.query(
      `SELECT COUNT(*) as count FROM users WHERE phone = $1`,
      { bind: [user[0].phone], type: QueryTypes.SELECT }
    );
    if (parseInt(duplicates[0]?.count) > 1) {
      flags.push({ type: 'duplicate_phone', severity: 'medium' });
    }
  }

  return {
    isSuspicious: flags.length > 0,
    flags,
    canCreateRide: !flags.some(f => f.severity === 'high'),
    canBook: flags.length === 0,
  };
};

// ─────────────────────────────────────
// Get User Trust Profile
// ─────────────────────────────────────
const getUserTrustProfile = async (userId) => {
  const score = await calculateTrustScore(userId);
  const activity = await detectSuspiciousActivity(userId);

  let badge = 'New Member';
  if (score >= 80) badge = '⭐ Trusted Rider';
  else if (score >= 60) badge = '✅ Verified Member';
  else if (score >= 40) badge = '👤 Active Member';

  return {
    trustScore: score,
    badge,
    canCreateRide: activity.canCreateRide,
    canBook: activity.canBook,
    flags: activity.flags,
    breakdown: {
      phoneVerified: score >= 20,
      aadhaarVerified: score >= 45,
      kycDone: score >= 60,
      goodRating: score >= 70,
    },
  };
};

module.exports = { calculateTrustScore, submitRating, detectSuspiciousActivity, getUserTrustProfile };