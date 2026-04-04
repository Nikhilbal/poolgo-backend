const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  createCommunity, joinCommunity,
  getCommunityMembers, getUserCommunities
} = require('../services/communityService');

// POST /api/community/create
router.post('/create', protect, async (req, res) => {
  try {
    const { name, type, inviteCode } = req.body;
    if (!name) return res.status(400).json({ error: 'Community name required' });
    const community = await createCommunity(name, type || 'general', req.user.id, inviteCode);
    res.status(201).json({ message: 'Community created', community });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/community/join
router.post('/join', protect, async (req, res) => {
  try {
    const { inviteCode } = req.body;
    if (!inviteCode) return res.status(400).json({ error: 'Invite code required' });
    const result = await joinCommunity(req.user.id, inviteCode);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/community/my
router.get('/my', protect, async (req, res) => {
  try {
    const communities = await getUserCommunities(req.user.id);
    res.json({ communities });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get communities' });
  }
});

// GET /api/community/:id/members
router.get('/:id/members', protect, async (req, res) => {
  try {
    const members = await getCommunityMembers(req.params.id);
    res.json({ members });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get members' });
  }
});

module.exports = router;