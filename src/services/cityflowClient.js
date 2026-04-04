const axios = require('axios');

const CITYFLOW_URL = process.env.CITYFLOW_AI_URL || 'https://sherryl-cryptovolcanic-draftily.ngrok-free.dev/api';

const cityflow = axios.create({
  baseURL: CITYFLOW_URL,
  timeout: 8000,
});

// Process a ride request through AI
const processRideRequest = async (riderId, origin, dest, time, rides) => {
  try {
    const res = await cityflow.post('/process-ride', {
      rider_id: riderId,
      origin,
      destination: dest,
      requested_time: time,
      available_rides: rides,
    });
    return res.data;
  } catch (error) {
    console.log('CityFlow AI unavailable, using fallback');
    return null;
  }
};

// Get demand for location
const getDemand = async (lat, lng, time) => {
  try {
    const res = await cityflow.post('/demand', { lat, lng, time });
    return res.data;
  } catch {
    return { level: 'medium', score: 50, surge_recommended: false };
  }
};

// Get smart pricing
const getSmartPrice = async (origin, dest, demandLevel, drivers, vehicleType, isPooled) => {
  try {
    const res = await cityflow.post('/price', {
      origin, destination: dest,
      demand_level: demandLevel,
      available_drivers: drivers,
      vehicle_type: vehicleType,
      is_pooled: isPooled,
    });
    return res.data;
  } catch {
    return null;
  }
};

// Get driver distribution recommendations
const getDriverDistribution = async (drivers) => {
  try {
    const res = await cityflow.post('/distribute-drivers', { drivers });
    return res.data;
  } catch {
    return null;
  }
};

// Get heatmap
const getHeatmap = async () => {
  try {
    const res = await cityflow.get('/heatmap');
    return res.data;
  } catch {
    return { heatmap: [], zones: [] };
  }
};

module.exports = {
  processRideRequest,
  getDemand,
  getSmartPrice,
  getDriverDistribution,
  getHeatmap,
};