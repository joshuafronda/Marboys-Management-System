const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/daily-stock - Get all daily stock inventory records
router.get('/', (req, res) => {
  try {
    const records = db.prepare(`
      SELECT 
        ds.id,
        ds.food_id,
        ds.food_name,
        ds.flavor_name,
        ds.added_stock,
        ds.stock_date,
        ds.notes,
        ds.created_at,
        f.category,
        f.price
      FROM daily_stock_inventory ds
      LEFT JOIN foods f ON ds.food_id = f.id
      ORDER BY ds.stock_date DESC, ds.created_at DESC
    `).all();
    res.json(records);
  } catch (err) {
    console.error('Error fetching daily stock:', err);
    res.status(500).json({ error: 'Failed to fetch daily stock records' });
  }
});

// GET /api/daily-stock/:id - Get single daily stock record
router.get('/:id', (req, res) => {
  try {
    const record = db.prepare(`
      SELECT 
        ds.id,
        ds.food_id,
        ds.food_name,
        ds.flavor_name,
        ds.added_stock,
        ds.stock_date,
        ds.notes,
        ds.created_at,
        f.category,
        f.price
      FROM daily_stock_inventory ds
      LEFT JOIN foods f ON ds.food_id = f.id
      WHERE ds.id = ?
    `).get(req.params.id);
    
    if (!record) return res.status(404).json({ error: 'Daily stock record not found' });
    res.json(record);
  } catch (err) {
    console.error('Error fetching daily stock record:', err);
    res.status(500).json({ error: 'Failed to fetch daily stock record' });
  }
});

// GET /api/daily-stock/available/:foodId - Get available stock for a food item
// Available = Initial Stock + Total Added Stock - Total Sold Stock
router.get('/available/:foodId', (req, res) => {
  try {
    const { foodId } = req.params;
    const { flavor_name } = req.query;

    let addedStock = 0;
    let soldStock = 0;
    let initialStock = 0;

    // Get food item to check for flavors
    const food = db.prepare('SELECT * FROM foods WHERE id = ?').get(foodId);
    if (!food) return res.status(404).json({ error: 'Food not found' });

    if (flavor_name) {
      // Calculate for specific flavor
      addedStock = db.prepare(`
        SELECT COALESCE(SUM(added_stock), 0) as total
        FROM daily_stock_inventory
        WHERE food_id = ? AND LOWER(flavor_name) LIKE LOWER(?)
      `).get(foodId, `%${flavor_name}%`)?.total || 0;

      soldStock = db.prepare(`
        SELECT COALESCE(SUM(quantity), 0) as total
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        WHERE si.food_id = ? AND LOWER(si.flavor_name) LIKE LOWER(?)
      `).get(foodId, `%${flavor_name}%`)?.total || 0;

      // Get initial stock from flavors array
      if (food.flavors) {
        const flavors = JSON.parse(food.flavors);
        const flavor = flavors.find(f => 
          (f.flavor_name || f.name).toLowerCase().includes(flavor_name.toLowerCase()) ||
          flavor_name.toLowerCase().includes((f.flavor_name || f.name).toLowerCase())
        );
        if (flavor) {
          initialStock = parseInt(flavor.stock) || 0;
        }
      }
    } else {
      // Calculate for food item (no flavors)
      addedStock = db.prepare(`
        SELECT COALESCE(SUM(added_stock), 0) as total
        FROM daily_stock_inventory
        WHERE food_id = ? AND (flavor_name IS NULL OR flavor_name = '')
      `).get(foodId)?.total || 0;

      soldStock = db.prepare(`
        SELECT COALESCE(SUM(quantity), 0) as total
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        WHERE si.food_id = ? AND (si.flavor_name IS NULL OR si.flavor_name = '')
      `).get(foodId)?.total || 0;

      // For non-flavored items, use the stock column as initial stock
      initialStock = parseInt(food.stock) || 0;
    }

    const available = initialStock + addedStock - soldStock;
    res.json({ available: Math.max(0, available), added: addedStock, sold: soldStock, initial: initialStock });
  } catch (err) {
    console.error('Error calculating available stock:', err);
    res.status(500).json({ error: 'Failed to calculate available stock' });
  }
});

// GET /api/daily-stock/date/:date - Get daily stock records for a specific date
router.get('/date/:date', (req, res) => {
  try {
    const records = db.prepare(`
      SELECT 
        ds.id,
        ds.food_id,
        ds.food_name,
        ds.flavor_name,
        ds.added_stock,
        ds.stock_date,
        ds.notes,
        ds.created_at,
        f.category,
        f.price
      FROM daily_stock_inventory ds
      LEFT JOIN foods f ON ds.food_id = f.id
      WHERE ds.stock_date = ?
      ORDER BY ds.created_at DESC
    `).all(req.params.date);
    res.json(records);
  } catch (err) {
    console.error('Error fetching daily stock by date:', err);
    res.status(500).json({ error: 'Failed to fetch daily stock records for date' });
  }
});

// POST /api/daily-stock - Add daily stock record
router.post('/', (req, res) => {
  const { food_id, food_name, flavor_name, added_stock, stock_date, notes } = req.body;

  if (!food_id || !food_name || added_stock === undefined || !stock_date) {
    return res.status(400).json({ error: 'food_id, food_name, added_stock, and stock_date are required' });
  }

  if (added_stock < 0) {
    return res.status(400).json({ error: 'added_stock must be non-negative' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO daily_stock_inventory (food_id, food_name, flavor_name, added_stock, stock_date, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(food_id, food_name, flavor_name || null, added_stock, stock_date, notes || null);

    const newRecord = db.prepare(`
      SELECT 
        ds.id,
        ds.food_id,
        ds.food_name,
        ds.flavor_name,
        ds.added_stock,
        ds.stock_date,
        ds.notes,
        ds.created_at,
        f.category,
        f.price
      FROM daily_stock_inventory ds
      LEFT JOIN foods f ON ds.food_id = f.id
      WHERE ds.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json(newRecord);
  } catch (err) {
    console.error('Error adding daily stock:', err);
    res.status(500).json({ error: 'Failed to add daily stock record' });
  }
});

// POST /api/daily-stock/batch - Add multiple daily stock records at once
router.post('/batch', (req, res) => {
  const { records } = req.body;

  if (!records || !Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records array is required' });
  }

  // Validate each record
  for (const record of records) {
    if (!record.food_id || !record.food_name || record.added_stock === undefined || !record.stock_date) {
      return res.status(400).json({ error: 'Each record must have food_id, food_name, added_stock, and stock_date' });
    }
    if (record.added_stock < 0) {
      return res.status(400).json({ error: 'added_stock must be non-negative' });
    }
  }

  try {
    const insert = db.prepare(`
      INSERT INTO daily_stock_inventory (food_id, food_name, flavor_name, added_stock, stock_date, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((items) => {
      const results = [];
      for (const item of items) {
        const result = insert.run(
          item.food_id,
          item.food_name,
          item.flavor_name || null,
          item.added_stock,
          item.stock_date,
          item.notes || null
        );
        results.push(result.lastInsertRowid);
      }
      return results;
    });

    const insertedIds = insertMany(records);

    // Fetch all inserted records
    const insertedRecords = insertedIds.map((id, index) => {
      return db.prepare(`
        SELECT 
          ds.id,
          ds.food_id,
          ds.food_name,
          ds.flavor_name,
          ds.added_stock,
          ds.stock_date,
          ds.notes,
          ds.created_at,
          f.category,
          f.price
        FROM daily_stock_inventory ds
        LEFT JOIN foods f ON ds.food_id = f.id
        WHERE ds.id = ?
      `).get(id);
    });

    res.status(201).json({ records: insertedRecords, count: insertedRecords.length });
  } catch (err) {
    console.error('Error adding batch daily stock:', err);
    res.status(500).json({ error: 'Failed to add batch daily stock records' });
  }
});

// PUT /api/daily-stock/:id - Update daily stock record
router.put('/:id', (req, res) => {
  const { added_stock, stock_date, notes } = req.body;

  if (added_stock === undefined || !stock_date) {
    return res.status(400).json({ error: 'added_stock and stock_date are required' });
  }

  if (added_stock < 0) {
    return res.status(400).json({ error: 'added_stock must be non-negative' });
  }

  try {
    const existing = db.prepare('SELECT * FROM daily_stock_inventory WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Daily stock record not found' });

    db.prepare(`
      UPDATE daily_stock_inventory
      SET added_stock = ?, stock_date = ?, notes = ?
      WHERE id = ?
    `).run(added_stock, stock_date, notes || null, req.params.id);

    const updated = db.prepare(`
      SELECT 
        ds.id,
        ds.food_id,
        ds.food_name,
        ds.flavor_name,
        ds.added_stock,
        ds.stock_date,
        ds.notes,
        ds.created_at,
        f.category,
        f.price
      FROM daily_stock_inventory ds
      LEFT JOIN foods f ON ds.food_id = f.id
      WHERE ds.id = ?
    `).get(req.params.id);

    res.json(updated);
  } catch (err) {
    console.error('Error updating daily stock:', err);
    res.status(500).json({ error: 'Failed to update daily stock record' });
  }
});

// DELETE /api/daily-stock/:id - Delete daily stock record
router.delete('/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM daily_stock_inventory WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Daily stock record not found' });

    db.prepare('DELETE FROM daily_stock_inventory WHERE id = ?').run(req.params.id);
    res.json({ message: 'Daily stock record deleted' });
  } catch (err) {
    console.error('Error deleting daily stock:', err);
    res.status(500).json({ error: 'Failed to delete daily stock record' });
  }
});

module.exports = router;
