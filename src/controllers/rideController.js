const sequelize = require('../models/database');
const { QueryTypes } = require('sequelize');
const { v4: uuidv4 } = require('uuid');

// Create a new ride (driver posts availability)
const createRide = async (req, res) => {
  try {
    const {
      origin_lat, origin_lng, origin_name,
      destination_lat, destination_lng, destination_name,
      departure_time, total_seats, price_per_seat,
      is_recurring, recurring_days
    } = req.body;

    const id = uuidv4();

    await sequelize.query(
      `INSERT INTO rides (
        id, driver_id, origin_lat, origin_lng, origin_name,
        destination_lat, destination_lng, destination_name,
        departure_time, total_seats, available_seats,
        price_per_seat, is_recurring, recurring_days
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      {
        bind: [
          id, req.user.id, origin_lat, origin_lng, origin_name,
          destination_lat, destination_lng, destination_name,
          departure_time, total_seats, total_seats,
          price_per_seat, is_recurring || false, recurring_days || null
        ],
        type: QueryTypes.INSERT
      }
    );

    res.status(201).json({ message: 'Ride created', rideId: id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create ride' });
  }
};

// Search for rides (AI route matching based on proximity)
const searchRides = async (req, res) => {
  try {
    const { origin_lat, origin_lng, destination_lat, destination_lng, date } = req.query;

    // Find rides within 2km radius of origin AND destination
    // Uses Haversine formula via PostgreSQL math
    const rides = await sequelize.query(
      `SELECT r.*,
              u.name as driver_name, u.rating as driver_rating,
              u.profile_photo as driver_photo, u.aadhaar_verified,
              (6371 * acos(
                cos(radians($1)) * cos(radians(r.origin_lat)) *
                cos(radians(r.origin_lng) - radians($2)) +
                sin(radians($1)) * sin(radians(r.origin_lat))
              )) AS origin_distance,
              (6371 * acos(
                cos(radians($3)) * cos(radians(r.destination_lat)) *
                cos(radians(r.destination_lng) - radians($4)) +
                sin(radians($3)) * sin(radians(r.destination_lat))
              )) AS destination_distance
       FROM rides r
       JOIN users u ON r.driver_id = u.id
       WHERE r.available_seats > 0
         AND r.ride_status = 'upcoming'
         AND DATE(r.departure_time) = $5
       HAVING origin_distance < 2 AND destination_distance < 2
       ORDER BY origin_distance ASC
       LIMIT 20`,
      {
        bind: [origin_lat, origin_lng, destination_lat, destination_lng, date],
        type: QueryTypes.SELECT
      }
    );

    res.json({ rides, total: rides.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Search failed' });
  }
};

// Book a seat on a ride
const bookRide = async (req, res) => {
  try {
    const { ride_id, seats, pickup_lat, pickup_lng, pickup_name, payment_id } = req.body;

    // Check availability
    const rideCheck = await sequelize.query(
      'SELECT available_seats, price_per_seat, driver_id FROM rides WHERE id = $1',
      { bind: [ride_id], type: QueryTypes.SELECT }
    );

    if (rideCheck.length === 0) return res.status(404).json({ error: 'Ride not found' });
    const ride = rideCheck[0];

    if (ride.available_seats < seats) {
      return res.status(400).json({ error: 'Not enough seats available' });
    }

    if (ride.driver_id === req.user.id) {
      return res.status(400).json({ error: 'You cannot book your own ride' });
    }

    const bookingId = uuidv4();
    const amount = ride.price_per_seat * seats;

    await sequelize.query(
      `INSERT INTO bookings
        (id, ride_id, rider_id, seats_booked, pickup_lat, pickup_lng, pickup_name, amount_paid, payment_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      {
        bind: [bookingId, ride_id, req.user.id, seats, pickup_lat, pickup_lng, pickup_name, amount, payment_id],
        type: QueryTypes.INSERT
      }
    );

    // Reduce available seats
    await sequelize.query(
      'UPDATE rides SET available_seats = available_seats - $1 WHERE id = $2',
      { bind: [seats, ride_id], type: QueryTypes.UPDATE }
    );

    res.status(201).json({ message: 'Ride booked successfully', bookingId, amount });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Booking failed' });
  }
};

// Get user's bookings
const getMyBookings = async (req, res) => {
  try {
    const bookings = await sequelize.query(
      `SELECT b.*, r.origin_name, r.destination_name,
              r.departure_time, r.price_per_seat,
              u.name as driver_name, u.rating as driver_rating
       FROM bookings b
       JOIN rides r ON b.ride_id = r.id
       JOIN users u ON r.driver_id = u.id
       WHERE b.rider_id = $1
       ORDER BY r.departure_time DESC`,
      { bind: [req.user.id], type: QueryTypes.SELECT }
    );

    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
};

module.exports = { createRide, searchRides, bookRide, getMyBookings };