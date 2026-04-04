const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  searchPlaces,
  autocomplete,
  getRecentSearches,
  getPopularPlaces,
  saveSearchHistory,
  getByCategory,
} = require('../controllers/searchController');

// GET /api/search?query=paradise&lat=17.44&lng=78.37
router.get('/', protect, searchPlaces);

// GET /api/search/autocomplete?query=royal&lat=17.44&lng=78.37
router.get('/autocomplete', protect, autocomplete);

// GET /api/search/recent
router.get('/recent', protect, getRecentSearches);

// GET /api/search/popular
router.get('/popular', protect, getPopularPlaces);

// GET /api/search/category/:category
router.get('/category/:category', protect, getByCategory);

// POST /api/search/history
router.post('/history', protect, saveSearchHistory);

module.exports = router;