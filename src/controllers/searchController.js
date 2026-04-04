const { QueryTypes } = require('sequelize');
const sequelize = require('../models/database');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

// ─────────────────────────────────────
// Haversine Distance
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
// Search Places
// ─────────────────────────────────────
const searchPlaces = async (req, res) => {
  try {
    const {
      query,
      lat = 17.4065,
      lng = 78.4772,
      category,
      limit = 10,
      city = 'Hyderabad'
    } = req.query;

    if (!query || query.trim().length < 1) {
      return res.status(400).json({ error: 'Search query required' });
    }

    const searchTerm = query.trim().toLowerCase();
    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);

    // Build dynamic query
    let whereClause = `
      WHERE (
        place_name_lower LIKE $1
        OR place_name_lower LIKE $2
        OR address ILIKE $3
        OR area ILIKE $4
        OR to_tsvector('english', place_name) @@ plainto_tsquery('english', $5)
      )
    `;

    const binds = [
      `${searchTerm}%`,       // starts with
      `%${searchTerm}%`,      // contains
      `%${query}%`,           // address contains
      `%${query}%`,           // area contains
      query,                  // full text search
    ];

    if (category) {
      whereClause += ` AND place_category = $${binds.length + 1}`;
      binds.push(category);
    }

    // Search local database
    const dbResults = await sequelize.query(
      `SELECT
         p.*,
         (6371 * acos(
           LEAST(1, cos(radians($${binds.length + 1})) *
           cos(radians(p.latitude)) *
           cos(radians(p.longitude) - radians($${binds.length + 2})) +
           sin(radians($${binds.length + 1})) *
           sin(radians(p.latitude)))
         )) AS distance_km
       FROM places p
       ${whereClause}
       ORDER BY
         (p.popularity_score * 0.4 +
          p.search_count * 0.2 +
          CASE WHEN place_name_lower LIKE $6 THEN 30 ELSE 0 END +
          CASE WHEN is_verified THEN 10 ELSE 0 END
         ) DESC,
         distance_km ASC
       LIMIT $${binds.length + 3}`,
      {
        bind: [...binds, userLat, userLng, `${searchTerm}%`, parseInt(limit)],
        type: QueryTypes.SELECT,
      }
    );

    // Format results
    const formatted = dbResults.map(place => ({
      place_id: place.id,
      place_name: place.place_name,
      category: place.place_category,
      subcategory: place.place_subcategory,
      address: place.address,
      area: place.area,
      city: place.city,
      lat: parseFloat(place.latitude),
      lng: parseFloat(place.longitude),
      distance_km: parseFloat(place.distance_km || 0).toFixed(1),
      distance_label: formatDistance(parseFloat(place.distance_km || 0)),
      rating: place.rating,
      popularity: place.popularity_score,
      is_verified: place.is_verified,
      category_icon: getCategoryIcon(place.place_category),
    }));

    // Update popular searches
    await trackSearch(query, req.user?.id);

    // Try Google Places if results < 3
    let googleResults = [];
    if (formatted.length < 3 && process.env.GOOGLE_MAPS_API_KEY) {
      googleResults = await searchGooglePlaces(query, userLat, userLng);
    }

    const allResults = [...formatted, ...googleResults];

    res.json({
      query,
      total: allResults.length,
      results: allResults,
      has_google_results: googleResults.length > 0,
    });

  } catch (error) {
    console.error('Search error:', error.message);
    res.status(500).json({ error: 'Search failed', results: [] });
  }
};

// ─────────────────────────────────────
// Autocomplete
// ─────────────────────────────────────
const autocomplete = async (req, res) => {
  try {
    const { query, lat = 17.4065, lng = 78.4772 } = req.query;

    if (!query || query.length < 1) {
      return res.json({ suggestions: [] });
    }

    const searchTerm = query.toLowerCase();
    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);

    const results = await sequelize.query(
      `SELECT
         place_name,
         place_category,
         area,
         city,
         latitude,
         longitude,
         address,
         is_verified,
         popularity_score,
         (6371 * acos(
           LEAST(1, cos(radians($1)) * cos(radians(latitude)) *
           cos(radians(longitude) - radians($2)) +
           sin(radians($1)) * sin(radians(latitude)))
         )) AS distance_km
       FROM places
       WHERE place_name_lower LIKE $3
          OR place_name_lower LIKE $4
       ORDER BY
         CASE WHEN place_name_lower LIKE $5 THEN 1 ELSE 2 END,
         popularity_score DESC,
         distance_km ASC
       LIMIT 8`,
      {
        bind: [userLat, userLng, `${searchTerm}%`, `%${searchTerm}%`, `${searchTerm}%`],
        type: QueryTypes.SELECT,
      }
    );

    const suggestions = results.map(p => ({
      place_name: p.place_name,
      category: p.place_category,
      area: p.area,
      city: p.city,
      lat: parseFloat(p.latitude),
      lng: parseFloat(p.longitude),
      address: p.address,
      distance_km: parseFloat(p.distance_km || 0).toFixed(1),
      distance_label: formatDistance(parseFloat(p.distance_km || 0)),
      is_verified: p.is_verified,
      category_icon: getCategoryIcon(p.place_category),
      display_text: `${p.place_name}`,
      subtitle: `${p.area}, ${p.city}`,
    }));

    res.json({ suggestions, total: suggestions.length });

  } catch (error) {
    console.error('Autocomplete error:', error.message);
    res.json({ suggestions: [], total: 0 });
  }
};

// ─────────────────────────────────────
// Recent Searches for User
// ─────────────────────────────────────
const getRecentSearches = async (req, res) => {
  try {
    const userId = req.user.id;

    const recent = await sequelize.query(
      `SELECT DISTINCT ON (p.place_name)
         p.place_name,
         p.place_category,
         p.area,
         p.city,
         p.latitude,
         p.longitude,
         p.address,
         p.is_verified,
         sh.selected_at
       FROM search_history sh
       JOIN places p ON sh.place_id = p.id
       WHERE sh.user_id = $1
       ORDER BY p.place_name, sh.selected_at DESC
       LIMIT 8`,
      { bind: [userId], type: QueryTypes.SELECT }
    );

    res.json({
      recent: recent.map(p => ({
        place_name: p.place_name,
        category: p.place_category,
        area: p.area,
        city: p.city,
        lat: parseFloat(p.latitude),
        lng: parseFloat(p.longitude),
        address: p.address,
        category_icon: getCategoryIcon(p.place_category),
        subtitle: `${p.area}, ${p.city}`,
      }))
    });

  } catch (error) {
    res.json({ recent: [] });
  }
};

// ─────────────────────────────────────
// Popular Places
// ─────────────────────────────────────
const getPopularPlaces = async (req, res) => {
  try {
    const { lat = 17.4065, lng = 78.4772, category } = req.query;
    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);

    let categoryFilter = '';
    const binds = [userLat, userLng];

    if (category) {
      categoryFilter = `WHERE place_category = $${binds.length + 1}`;
      binds.push(category);
    }

    const places = await sequelize.query(
      `SELECT
         place_name,
         place_category,
         area,
         city,
         latitude,
         longitude,
         address,
         rating,
         is_verified,
         popularity_score,
         (6371 * acos(
           LEAST(1, cos(radians($1)) * cos(radians(latitude)) *
           cos(radians(longitude) - radians($2)) +
           sin(radians($1)) * sin(radians(latitude)))
         )) AS distance_km
       FROM places
       ${categoryFilter}
       ORDER BY popularity_score DESC, distance_km ASC
       LIMIT 12`,
      { bind: binds, type: QueryTypes.SELECT }
    );

    res.json({
      places: places.map(p => ({
        place_name: p.place_name,
        category: p.place_category,
        area: p.area,
        city: p.city,
        lat: parseFloat(p.latitude),
        lng: parseFloat(p.longitude),
        address: p.address,
        rating: p.rating,
        is_verified: p.is_verified,
        distance_label: formatDistance(parseFloat(p.distance_km || 0)),
        category_icon: getCategoryIcon(p.place_category),
        subtitle: `${p.area}, ${p.city}`,
      }))
    });

  } catch (error) {
    res.json({ places: [] });
  }
};

// ─────────────────────────────────────
// Save Selected Place to History
// ─────────────────────────────────────
const saveSearchHistory = async (req, res) => {
  try {
    const { place_name, lat, lng, address, category, area } = req.body;
    const userId = req.user.id;

    // Find or create place
    let place = await sequelize.query(
      `SELECT id FROM places WHERE place_name_lower = $1 LIMIT 1`,
      { bind: [place_name.toLowerCase()], type: QueryTypes.SELECT }
    );

    let placeId;
    if (place.length > 0) {
      placeId = place[0].id;
      // Increment search count
      await sequelize.query(
        `UPDATE places SET search_count = search_count + 1 WHERE id = $1`,
        { bind: [placeId], type: QueryTypes.UPDATE }
      );
    } else {
      // Create new place entry
      placeId = uuidv4();
      await sequelize.query(
        `INSERT INTO places (id, place_id, place_name, place_name_lower, place_category, latitude, longitude, address, area, city)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Hyderabad')`,
        {
          bind: [placeId, `custom_${placeId.slice(0, 8)}`, place_name,
                 place_name.toLowerCase(), category || 'other',
                 lat, lng, address || '', area || ''],
          type: QueryTypes.INSERT
        }
      );
    }

    // Save to history
    await sequelize.query(
      `INSERT INTO search_history (id, user_id, place_id, search_query)
       VALUES ($1, $2, $3, $4)`,
      { bind: [uuidv4(), userId, placeId, place_name], type: QueryTypes.INSERT }
    );

    res.json({ success: true });

  } catch (error) {
    console.error('Save history error:', error.message);
    res.json({ success: false });
  }
};

// ─────────────────────────────────────
// Google Places Integration
// ─────────────────────────────────────
const searchGooglePlaces = async (query, lat, lng) => {
  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) return [];

    const response = await axios.get(
      'https://maps.googleapis.com/maps/api/place/textsearch/json',
      {
        params: {
          query: `${query} Hyderabad`,
          key: apiKey,
          location: `${lat},${lng}`,
          radius: 50000,
        },
        timeout: 3000,
      }
    );

    return (response.data.results || []).slice(0, 5).map(place => ({
      place_id: place.place_id,
      place_name: place.name,
      category: 'google',
      subcategory: place.types?.[0] || 'place',
      address: place.formatted_address,
      area: '',
      city: 'Hyderabad',
      lat: place.geometry.location.lat,
      lng: place.geometry.location.lng,
      distance_km: haversine(
        lat, lng,
        place.geometry.location.lat,
        place.geometry.location.lng
      ).toFixed(1),
      distance_label: formatDistance(haversine(
        lat, lng,
        place.geometry.location.lat,
        place.geometry.location.lng
      )),
      rating: place.rating,
      is_verified: true,
      is_google: true,
      category_icon: '📍',
    }));
  } catch (error) {
    console.error('Google Places error:', error.message);
    return [];
  }
};

// ─────────────────────────────────────
// Get Places by Category
// ─────────────────────────────────────
const getByCategory = async (req, res) => {
  try {
    const { category } = req.params;
    const { lat = 17.4065, lng = 78.4772 } = req.query;
    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);

    const places = await sequelize.query(
      `SELECT *,
         (6371 * acos(
           LEAST(1, cos(radians($1)) * cos(radians(latitude)) *
           cos(radians(longitude) - radians($2)) +
           sin(radians($1)) * sin(radians(latitude)))
         )) AS distance_km
       FROM places
       WHERE place_category = $3
       ORDER BY distance_km ASC, popularity_score DESC
       LIMIT 20`,
      { bind: [userLat, userLng, category], type: QueryTypes.SELECT }
    );

    res.json({
      category,
      places: places.map(p => ({
        place_name: p.place_name,
        category: p.place_category,
        subcategory: p.place_subcategory,
        area: p.area,
        lat: parseFloat(p.latitude),
        lng: parseFloat(p.longitude),
        address: p.address,
        rating: p.rating,
        distance_label: formatDistance(parseFloat(p.distance_km || 0)),
        category_icon: getCategoryIcon(p.place_category),
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get category places' });
  }
};

// ─────────────────────────────────────
// Helpers
// ─────────────────────────────────────
const formatDistance = (km) => {
  if (km < 0.1) return 'Very close';
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${km.toFixed(1)} km`;
};

const getCategoryIcon = (category) => {
  const icons = {
    corporate: '🏢',
    food: '🍽️',
    entertainment: '🎭',
    hospitality: '🏨',
    residential: '🏠',
    event: '🎉',
    healthcare: '🏥',
    educational: '🎓',
    transport: '🚉',
    landmark: '🗺️',
    pub: '🍺',
    mall: '🛍️',
    cinema: '🎬',
    other: '📍',
  };
  return icons[category] || '📍';
};

const trackSearch = async (query, userId) => {
  try {
    await sequelize.query(
      `INSERT INTO popular_searches (id, query, search_count, last_searched)
       VALUES ($1, $2, 1, NOW())
       ON CONFLICT (query)
       DO UPDATE SET
         search_count = popular_searches.search_count + 1,
         last_searched = NOW()`,
      { bind: [uuidv4(), query.toLowerCase()], type: QueryTypes.INSERT }
    );
  } catch {}
};

module.exports = {
  searchPlaces,
  autocomplete,
  getRecentSearches,
  getPopularPlaces,
  saveSearchHistory,
  getByCategory,
};