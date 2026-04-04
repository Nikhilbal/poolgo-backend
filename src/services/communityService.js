const { QueryTypes } = require('sequelize');
const sequelize = require('../models/database');
const { v4: uuidv4 } = require('uuid');

// ─────────────────────────────────────
// Create Community (College/Office)
// ─────────────────────────────────────
const createCommunity = async (name, type, adminId, inviteCode) => {
  const id = uuidv4();
  const code = inviteCode || Math.random().toString(36).substring(2, 8).toUpperCase();

  await sequelize.query(
    `INSERT INTO communities (id, name, type, admin_id, invite_code, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    { bind: [id, name, type, adminId, code], type: QueryTypes.INSERT }
  );

  return { id, name, type, inviteCode: code };
};

// ─────────────────────────────────────
// Join Community via Invite Code
// ─────────────────────────────────────
const joinCommunity = async (userId, inviteCode) => {
  const community = await sequelize.query(
    `SELECT * FROM communities WHERE invite_code = $1`,
    { bind: [inviteCode], type: QueryTypes.SELECT }
  );

  if (!community.length) throw new Error('Invalid invite code');

  const comm = community[0];

  // Check already member
  const existing = await sequelize.query(
    `SELECT id FROM community_members WHERE user_id = $1 AND community_id = $2`,
    { bind: [userId, comm.id], type: QueryTypes.SELECT }
  );

  if (existing.length) throw new Error('Already a member of this community');

  await sequelize.query(
    `INSERT INTO community_members (id, user_id, community_id, joined_at)
     VALUES ($1, $2, $3, NOW())`,
    { bind: [uuidv4(), userId, comm.id], type: QueryTypes.INSERT }
  );

  // Update user's community
  await sequelize.query(
    `UPDATE users SET community_id = $1 WHERE id = $2`,
    { bind: [comm.id, userId], type: QueryTypes.UPDATE }
  );

  return { success: true, community: comm };
};

// ─────────────────────────────────────
// Get Community Members
// ─────────────────────────────────────
const getCommunityMembers = async (communityId) => {
  return await sequelize.query(
    `SELECT u.id, u.name, u.rating, u.total_rides, u.aadhaar_verified
     FROM users u
     JOIN community_members cm ON cm.user_id = u.id
     WHERE cm.community_id = $1`,
    { bind: [communityId], type: QueryTypes.SELECT }
  );
};

// ─────────────────────────────────────
// Get User's Communities
// ─────────────────────────────────────
const getUserCommunities = async (userId) => {
  return await sequelize.query(
    `SELECT c.*, COUNT(cm2.id) as member_count
     FROM communities c
     JOIN community_members cm ON cm.community_id = c.id
     LEFT JOIN community_members cm2 ON cm2.community_id = c.id
     WHERE cm.user_id = $1
     GROUP BY c.id`,
    { bind: [userId], type: QueryTypes.SELECT }
  );
};

module.exports = { createCommunity, joinCommunity, getCommunityMembers, getUserCommunities };