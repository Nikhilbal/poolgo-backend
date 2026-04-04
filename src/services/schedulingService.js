const { QueryTypes } = require('sequelize');
const sequelize = require('../models/database');
const { v4: uuidv4 } = require('uuid');

// ─────────────────────────────────────
// Create Scheduled Ride
// ─────────────────────────────────────
const createScheduledRide = async ({
  driverId,
  originName, originLat, originLng,
  destinationName, destinationLat, destinationLng,
  departureTime,
  totalSeats,
  pricePerSeat,
  vehicleType,
  vehicleNumber,
  isRecurring,
  recurringDays, // ['MON','TUE','WED','THU','FRI']
  communityId,
}) => {
  const id = uuidv4();
  const rides = [];

  await sequelize.query(
    `INSERT INTO rides (
      id, driver_id, origin_name, origin_lat, origin_lng,
      destination_name, destination_lat, destination_lng,
      departure_time, total_seats, available_seats,
      price_per_seat, vehicle_type, vehicle_number,
      is_recurring, recurring_days, community_id, ride_status
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'upcoming'
    )`,
    {
      bind: [
        id, driverId, originName, originLat, originLng,
        destinationName, destinationLat, destinationLng,
        departureTime, totalSeats, totalSeats,
        pricePerSeat, vehicleType, vehicleNumber,
        isRecurring || false,
        recurringDays ? recurringDays.join(',') : null,
        communityId || null,
      ],
      type: QueryTypes.INSERT,
    }
  );

  rides.push(id);

  // If recurring, create rides for next 4 weeks
  if (isRecurring && recurringDays && recurringDays.length > 0) {
    const dayMap = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6, SUN: 0 };
    const baseDate = new Date(departureTime);
    const baseHour = baseDate.getHours();
    const baseMin = baseDate.getMinutes();

    for (let week = 1; week <= 4; week++) {
      for (const day of recurringDays) {
        const targetDay = dayMap[day];
        const date = new Date(baseDate);
        date.setDate(date.getDate() + week * 7);

        // Adjust to correct day of week
        const diff = (targetDay - date.getDay() + 7) % 7;
        date.setDate(date.getDate() + diff);
        date.setHours(baseHour, baseMin, 0, 0);

        const recurId = uuidv4();
        await sequelize.query(
          `INSERT INTO rides (
            id, driver_id, origin_name, origin_lat, origin_lng,
            destination_name, destination_lat, destination_lng,
            departure_time, total_seats, available_seats,
            price_per_seat, vehicle_type, vehicle_number,
            is_recurring, recurring_days, community_id, ride_status
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'upcoming'
          )`,
          {
            bind: [
              recurId, driverId, originName, originLat, originLng,
              destinationName, destinationLat, destinationLng,
              date.toISOString(), totalSeats, totalSeats,
              pricePerSeat, vehicleType, vehicleNumber,
              true, recurringDays.join(','), communityId || null,
            ],
            type: QueryTypes.INSERT,
          }
        );
        rides.push(recurId);
      }
    }
  }

  return { primaryRideId: id, totalCreated: rides.length, rideIds: rides };
};

// ─────────────────────────────────────
// Get Upcoming Scheduled Rides for User
// ─────────────────────────────────────
const getUserScheduledRides = async (userId) => {
  return await sequelize.query(
    `SELECT r.*, u.name as driver_name, u.rating as driver_rating
     FROM rides r
     JOIN users u ON r.driver_id = u.id
     WHERE r.driver_id = $1
       AND r.departure_time > NOW()
       AND r.ride_status = 'upcoming'
     ORDER BY r.departure_time ASC
     LIMIT 10`,
    { bind: [userId], type: QueryTypes.SELECT }
  );
};

// ─────────────────────────────────────
// Group Users by Time Window (15-min slots)
// ─────────────────────────────────────
const groupByTimeWindow = (rides) => {
  const windows = {};
  rides.forEach(ride => {
    const time = new Date(ride.departure_time);
    const slotMinutes = Math.floor(time.getMinutes() / 15) * 15;
    const key = `${time.getHours()}:${slotMinutes.toString().padStart(2, '0')}`;
    if (!windows[key]) windows[key] = [];
    windows[key].push(ride);
  });
  return windows;
};

// ─────────────────────────────────────
// Find Best Time Slot for User
// ─────────────────────────────────────
const findBestTimeSlot = async (originLat, originLng, destinationLat, destinationLng) => {
  const rides = await sequelize.query(
    `SELECT departure_time, COUNT(*) as ride_count
     FROM rides
     WHERE ride_status = 'upcoming'
       AND departure_time > NOW()
     GROUP BY date_trunc('hour', departure_time), departure_time
     ORDER BY ride_count DESC
     LIMIT 5`,
    { type: QueryTypes.SELECT }
  );

  return rides.map(r => ({
    time: new Date(r.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    rideCount: parseInt(r.ride_count),
    suggestion: `${r.ride_count} rides available at this time`,
  }));
};

module.exports = {
  createScheduledRide,
  getUserScheduledRides,
  groupByTimeWindow,
  findBestTimeSlot,
};