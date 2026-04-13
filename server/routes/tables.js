const express = require('express');
const router = express.Router();
const db = require('../db');

const TABLE_RATE_PER_SECOND = (parseFloat(process.env.TABLE_RATE_PER_HOUR) || 200) / 3600;

// Helper: compute elapsed seconds for a running table
function getElapsedSeconds(table) {
  if (table.status === 'running' && table.start_time) {
    const elapsed = Math.floor((Date.now() - new Date(table.start_time).getTime()) / 1000);
    return (table.accumulated_seconds || 0) + elapsed;
  }
  return table.accumulated_seconds || 0;
}

// Helper: compute cost from seconds
function computeCost(seconds) {
  return Math.ceil(seconds * TABLE_RATE_PER_SECOND * 100) / 100;
}

// GET /api/tables — get all tables with live elapsed time
router.get('/', (req, res) => {
  const tables = db.prepare('SELECT * FROM tables ORDER BY table_number').all();
  const result = tables.map(t => {
    const elapsed = getElapsedSeconds(t);
    const cost = t.set_hours > 0
      ? Math.round(t.set_hours * (parseFloat(process.env.TABLE_RATE_PER_HOUR) || 200) * 100) / 100
      : computeCost(elapsed);
    return {
      ...t,
      cart_items: JSON.parse(t.cart_items || '[]'),
      elapsed_seconds: elapsed,
      cost,
      set_hours: t.set_hours || 0
    };
  });
  res.json(result);
});

// GET /api/tables/:id — single table
router.get('/:id', (req, res) => {
  const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  if (!table) return res.status(404).json({ error: 'Table not found' });
  const elapsed = getElapsedSeconds(table);
  const cost = table.set_hours > 0
    ? Math.round(table.set_hours * (parseFloat(process.env.TABLE_RATE_PER_HOUR) || 200) * 100) / 100
    : computeCost(elapsed);
  res.json({
    ...table,
    cart_items: JSON.parse(table.cart_items || '[]'),
    elapsed_seconds: elapsed,
    cost,
    set_hours: table.set_hours || 0
  });
});

// POST /api/tables/:id/start — start timer (optional hours for manual setup)
router.post('/:id/start', (req, res) => {
  const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  if (!table) return res.status(404).json({ error: 'Table not found' });
  if (table.status === 'running') return res.status(400).json({ error: 'Table is already running' });

  const hours = parseFloat(req.body.hours) || 0;

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE tables SET status = 'running', start_time = ?, accumulated_seconds = 0, pause_time = NULL, set_hours = ?
    WHERE id = ?
  `).run(now, hours, table.id);

  res.json({ message: 'Timer started', start_time: now, accumulated_seconds: 0, set_hours: hours });
});

// POST /api/tables/:id/pause — pause timer
router.post('/:id/pause', (req, res) => {
  const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  if (!table) return res.status(404).json({ error: 'Table not found' });
  if (table.status !== 'running') return res.status(400).json({ error: 'Table is not running' });

  const now = new Date();
  const elapsed = Math.floor((now.getTime() - new Date(table.start_time).getTime()) / 1000);
  const totalAccumulated = (table.accumulated_seconds || 0) + elapsed;

  db.prepare(`
    UPDATE tables SET status = 'paused', pause_time = ?, accumulated_seconds = ?, start_time = NULL
    WHERE id = ?
  `).run(now.toISOString(), totalAccumulated, table.id);

  res.json({ message: 'Timer paused', accumulated_seconds: totalAccumulated });
});

// POST /api/tables/:id/resume — resume from pause
router.post('/:id/resume', (req, res) => {
  const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  if (!table) return res.status(404).json({ error: 'Table not found' });
  if (table.status !== 'paused') return res.status(400).json({ error: 'Table is not paused' });

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE tables SET status = 'running', start_time = ?, pause_time = NULL
    WHERE id = ?
  `).run(now, table.id);

  res.json({ message: 'Timer resumed', start_time: now });
});

// POST /api/tables/:id/stop — stop and return cost info
router.post('/:id/stop', (req, res) => {
  const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  if (!table) return res.status(404).json({ error: 'Table not found' });
  if (table.status === 'available') return res.status(400).json({ error: 'Table has not started' });

  const totalSeconds = getElapsedSeconds(table);
  // Prepaid: exact set_hours * rate; otherwise per-second
  const cost = table.set_hours > 0
    ? Math.round(table.set_hours * (parseFloat(process.env.TABLE_RATE_PER_HOUR) || 200) * 100) / 100
    : computeCost(totalSeconds);
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE tables SET status = 'finished', accumulated_seconds = ?, pause_time = NULL
    WHERE id = ?
  `).run(totalSeconds, table.id);

  res.json({
    message: 'Timer stopped',
    elapsed_seconds: totalSeconds,
    cost,
    start_time: table.start_time,
    end_time: now
  });
});

// POST /api/tables/:id/extend — extend hours on active table
router.post('/:id/extend', (req, res) => {
  const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  if (!table) return res.status(404).json({ error: 'Table not found' });
  if (table.status !== 'running' && table.status !== 'paused') {
    return res.status(400).json({ error: 'Table is not active' });
  }

  const hours = parseFloat(req.body.hours);
  if (!hours || hours <= 0) return res.status(400).json({ error: 'Hours must be greater than 0' });

  if (table.status === 'running' && table.start_time) {
    // Running: snapshot elapsed, restart timer, extend set_hours
    const elapsed = Math.floor((Date.now() - new Date(table.start_time).getTime()) / 1000);
    const totalAccumulated = (table.accumulated_seconds || 0) + elapsed;
    const newSetHours = (table.set_hours || 0) + hours;
    db.prepare(`
      UPDATE tables SET accumulated_seconds = ?, start_time = ?, set_hours = ?
      WHERE id = ?
    `).run(totalAccumulated, new Date().toISOString(), newSetHours, table.id);
    res.json({ message: `Extended by ${hours}h`, accumulated_seconds: totalAccumulated, set_hours: newSetHours });
  } else {
    // Paused: just extend set_hours
    const newSetHours = (table.set_hours || 0) + hours;
    db.prepare(`
      UPDATE tables SET set_hours = ?
      WHERE id = ?
    `).run(newSetHours, table.id);
    res.json({ message: `Extended by ${hours}h`, accumulated_seconds: table.accumulated_seconds || 0, set_hours: newSetHours });
  }
});

// POST /api/tables/:id/exhibition — set to exhibition match status
router.post('/:id/exhibition', (req, res) => {
  const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  if (!table) return res.status(404).json({ error: 'Table not found' });
  if (table.status !== 'available') return res.status(400).json({ error: 'Table must be available to start exhibition match' });

  const betAmount = parseFloat(req.body.bet_amount) || 0;
  if (betAmount <= 0) return res.status(400).json({ error: 'Bet amount must be greater than 0' });

  db.prepare(`
    UPDATE tables SET status = 'exhibition', exhibition_bet = ?, start_time = NULL, accumulated_seconds = 0
    WHERE id = ?
  `).run(betAmount, table.id);

  res.json({ message: 'Exhibition match started', bet_amount: betAmount });
});

// POST /api/tables/:id/reset — reset to available
router.post('/:id/reset', (req, res) => {
  const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  if (!table) return res.status(404).json({ error: 'Table not found' });

  db.prepare(`
    UPDATE tables SET status = 'available', start_time = NULL, pause_time = NULL, accumulated_seconds = 0, cart_items = '[]', set_hours = 0, exhibition_bet = 0
    WHERE id = ?
  `).run(table.id);

  res.json({ message: 'Table reset to available' });
});

// PUT /api/tables/:id/cart — save cart items for a table
router.put('/:id/cart', (req, res) => {
  const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  if (!table) return res.status(404).json({ error: 'Table not found' });

  const cartItems = JSON.stringify(req.body.cart_items || []);
  db.prepare('UPDATE tables SET cart_items = ? WHERE id = ?').run(cartItems, table.id);

  res.json({ message: 'Cart saved', cart_items: req.body.cart_items || [] });
});

module.exports = router;
