const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();


// ✅ Create app FIRST
const app = express();

// Create HTTP server + socket
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// ✅ Routes (AFTER app is created)
app.use('/api/auth', require('./src/routes/authRoutes'));
app.use('/api/rides', require('./src/routes/rideRoutes'));
app.use('/api/users', require('./src/routes/userRoutes')); 
app.use('/api/payments', require('./src/routes/paymentRoutes'));
app.use('/api/ai', require('./src/routes/aiRoutes')); 
app.use('/api/match',     require('./src/routes/matchingRoutes'));
app.use('/api/community', require('./src/routes/communityRoutes'));
app.use('/api/schedule',  require('./src/routes/scheduleRoutes'));
app.use('/api/wallet',    require('./src/routes/walletRoutes'));
app.use('/api/trust',     require('./src/routes/trustRoutes'));
app.use('/api/cityflow', require('./src/routes/cityflowRoutes'));
app.use('/api/search', require('./src/routes/searchRoutes'));

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'PoolGo API is running', version: '1.0.0' });
});

// Socket.io
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('driver:location', (data) => {
    socket.to(`ride:${data.rideId}`).emit('location:update', data);
  });

  socket.on('join:ride', (rideId) => {
    socket.join(`ride:${rideId}`);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Start server
const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`PoolGo server running on port ${PORT}`);
});