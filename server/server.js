require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');

// Initialize DB (creates + seeds on first run)
require('./db');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────

app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());

// JWT Auth Middleware
const authenticate = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

// Role Guard Middleware
const requireRole = (role) => (req, res, next) => {
  if (req.user.role !== role) {
    return res.status(403).json({ error: `Access denied. Requires ${role} role.` });
  }
  next();
};

app.locals.JWT_SECRET = JWT_SECRET;
app.locals.authenticate = authenticate;
app.locals.requireRole = requireRole;

// ─── ROUTES ───────────────────────────────────────────────────────────────────

app.use('/api/auth', require('./routes/auth'));
app.use('/api/tables', authenticate, require('./routes/tables'));
app.use('/api/foods', authenticate, require('./routes/foods'));
app.use('/api/sales', authenticate, require('./routes/sales'));
app.use('/api/daily-stock', authenticate, require('./routes/dailyStock'));

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'OK', time: new Date().toISOString() }));

// ─── START ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\nBilliard POS Server running at http://localhost:${PORT}`);
});
