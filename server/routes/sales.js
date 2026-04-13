const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcryptjs');

// Helper function to get current date in Philippines timezone (UTC+8)
function getPhilippinesDate() {
  return new Date().toLocaleString('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).split(',')[0];
}

// Helper function to get current ISO string in Philippines timezone
function getPhilippinesISOString() {
  const now = new Date();
  const phTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
  return phTime.toISOString();
}

// POST /api/sales — record a completed sale and deduct stock
router.post('/', (req, res) => {
  const { table_number, start_time, end_time, table_cost, food_items, set_hours, received } = req.body;
  const cashier = req.user.name;

  const foodTotal = food_items ? food_items.reduce((sum, item) => sum + item.price * item.quantity, 0) : 0;
  const total = (parseFloat(table_cost) || 0) + foodTotal;
  const today = getPhilippinesDate();

  // Insert sale record
  const saleResult = db.prepare(`
    INSERT INTO sales (table_number, start_time, end_time, table_cost, food_total, total, received, date, cashier, set_hours)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    table_number || null,
    start_time || null,
    end_time || getPhilippinesISOString(),
    parseFloat(table_cost) || 0,
    foodTotal,
    total,
    parseFloat(received) || 0,
    today,
    cashier,
    parseFloat(set_hours) || 0
  );

  const saleId = saleResult.lastInsertRowid;

  // Insert sale items (stock is now calculated from daily_stock_inventory - sale_items)
  if (food_items && food_items.length > 0) {
    const insertItem = db.prepare(`
      INSERT INTO sale_items (sale_id, food_id, food_name, quantity, price, flavor_name)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertAll = db.transaction(() => {
      for (const item of food_items) {
        insertItem.run(saleId, item.food_id, item.food_name, item.quantity, item.price, item.flavor_name || null);
      }
    });
    insertAll();
  }

  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId);

  res.status(201).json({ ...sale, items });
});

// GET /api/sales/today — all sales for a specific date (defaults to today)
router.get('/today', (req, res) => {
  const { date } = req.query;
  const targetDate = date || getPhilippinesDate();
  const sales = db.prepare(`
    SELECT * FROM sales WHERE date = ? ORDER BY id DESC
  `).all(targetDate);

  const result = sales.map(s => ({
    ...s,
    items: db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(s.id)
  }));

  res.json(result);
});

// GET /api/sales/month — current month stats
router.get('/month', (req, res) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `${year}-${month}`;

  const sales = db.prepare(`
    SELECT * FROM sales WHERE date LIKE ? ORDER BY date DESC
  `).all(`${prefix}%`);

  const totalRevenue = sales.reduce((sum, s) => sum + s.total, 0);

  res.json({ sales, totalRevenue, count: sales.length });
});

// GET /api/sales/chart — daily sales data for charts
router.get('/chart', (req, res) => {
  const { range } = req.query; // 'week' or 'month'
  const now = new Date();

  if (range === 'week') {
    // Last 7 days including today
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().split('T')[0]);
    }

    const data = days.map(date => {
      const daySales = db.prepare(`
        SELECT COALESCE(SUM(total), 0) as total,
               COALESCE(SUM(table_cost), 0) as table_total,
               COALESCE(SUM(food_total), 0) as food_total,
               COUNT(*) as count
        FROM sales WHERE date = ?
      `).get(date);
      return {
        date: date.slice(5), // MM-DD format
        fullDate: date,
        total: daySales.total,
        tableTotal: daySales.table_total,
        foodTotal: daySales.food_total,
        count: daySales.count
      };
    });

    return res.json({ range: 'week', data });
  }

  if (range === 'month') {
    // Current month days 1-31
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const daysInMonth = new Date(year, month, 0).getDate();
    const prefix = `${year}-${String(month).padStart(2, '0')}`;

    const data = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const date = `${prefix}-${String(day).padStart(2, '0')}`;
      const daySales = db.prepare(`
        SELECT COALESCE(SUM(total), 0) as total,
               COALESCE(SUM(table_cost), 0) as table_total,
               COALESCE(SUM(food_total), 0) as food_total,
               COUNT(*) as count
        FROM sales WHERE date = ?
      `).get(date);
      data.push({
        date: String(day),
        fullDate: date,
        total: daySales.total,
        tableTotal: daySales.table_total,
        foodTotal: daySales.food_total,
        count: daySales.count
      });
    }

    return res.json({ range: 'month', data });
  }

  res.status(400).json({ error: 'Invalid range. Use "week" or "month"' });
});

// GET /api/sales/best-selling — top food items by quantity sold
router.get('/best-selling', (req, res) => {
  const items = db.prepare(`
    SELECT food_id, food_name, flavor_name, SUM(quantity) as total_sold, SUM(quantity * price) as total_revenue
    FROM sale_items
    GROUP BY food_id, food_name, flavor_name
    ORDER BY total_sold DESC
    LIMIT 10
  `).all();
  res.json(items);
});

// GET /api/sales/all — all sales with pagination
router.get('/all', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const dateFilter = req.query.date;

  let query = 'SELECT * FROM sales';
  let params = [];

  if (dateFilter) {
    query += ' WHERE date = ?';
    params.push(dateFilter);
  }

  query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const sales = db.prepare(query).all(...params);
  const result = sales.map(s => ({
    ...s,
    items: db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(s.id)
  }));

  res.json(result);
});

// POST /api/sales/:saleId/items/:itemId/void — void a sale item (partial or full) with manager authorization
router.post('/:saleId/items/:itemId/void', (req, res) => {
  const { saleId, itemId } = req.params;
  const { password, reason, quantity: voidQty } = req.body;

  if (!password || !reason) {
    return res.status(400).json({ error: 'Manager password and reason are required' });
  }

  // Verify dedicated void password (set by owner)
  const owners = db.prepare(`SELECT * FROM users WHERE role = 'owner' AND void_password IS NOT NULL`).all();
  const validOwner = owners.find(m => bcrypt.compareSync(password, m.void_password));
  if (!validOwner) {
    return res.status(403).json({ error: 'Invalid void password. Owner must set up a void password first.' });
  }

  // Get the sale item
  const item = db.prepare('SELECT * FROM sale_items WHERE id = ? AND sale_id = ?').get(itemId, saleId);
  if (!item) {
    return res.status(404).json({ error: 'Sale item not found' });
  }
  if (item.voided) {
    return res.status(400).json({ error: 'Item is already voided' });
  }

  const qty = Math.min(parseInt(voidQty) || item.quantity, item.quantity);
  if (qty <= 0) {
    return res.status(400).json({ error: 'Invalid void quantity' });
  }

  const isFullVoid = qty >= item.quantity;

  // Transaction: void qty, return stock, recalc sale totals, log void
  const doVoid = db.transaction(() => {
    if (isFullVoid) {
      // Full void: mark as voided
      db.prepare('UPDATE sale_items SET voided = 1 WHERE id = ?').run(itemId);
    } else {
      // Partial void: reduce quantity
      db.prepare('UPDATE sale_items SET quantity = quantity - ? WHERE id = ?').run(qty, itemId);
    }

    // Return stock for voided quantity
    const food = db.prepare('SELECT * FROM foods WHERE id = ?').get(item.food_id);
    if (food && food.flavors && item.flavor_name) {
      // Return stock to specific flavor
      const flavors = JSON.parse(food.flavors);
      const flavorIndex = flavors.findIndex(f => f.flavor_name === item.flavor_name);
      if (flavorIndex !== -1) {
        flavors[flavorIndex].stock = (flavors[flavorIndex].stock || 0) + qty;
        const newTotalStock = flavors.reduce((sum, f) => sum + (f.stock || 0), 0);
        db.prepare('UPDATE foods SET flavors = ?, stock = ?, status = CASE WHEN ? > 0 THEN ? ELSE status END WHERE id = ?')
          .run(JSON.stringify(flavors), newTotalStock, newTotalStock, food.status === 'unavailable' ? 'available' : food.status, food.id);
      }
    } else {
      db.prepare(`
        UPDATE foods SET stock = stock + ?,
          status = CASE WHEN stock + ? > 0 THEN 'available' ELSE status END
        WHERE id = ?
      `).run(qty, qty, item.food_id);
    }

    // Recalculate sale totals (only non-voided items, using their current quantity)
    const newFoodTotal = db.prepare(`
      SELECT COALESCE(SUM(quantity * price), 0) as total
      FROM sale_items WHERE sale_id = ? AND voided = 0
    `).get(saleId).total;

    const sale = db.prepare('SELECT table_cost FROM sales WHERE id = ?').get(saleId);
    const newTotal = (sale.table_cost || 0) + newFoodTotal;

    db.prepare('UPDATE sales SET food_total = ?, total = ? WHERE id = ?').run(newFoodTotal, newTotal, saleId);

    // Insert void log
    db.prepare(`
      INSERT INTO void_logs (sale_item_id, sale_id, food_id, food_name, quantity, price, reason, authorized_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(itemId, saleId, item.food_id, item.food_name, qty, item.price, reason, validOwner.name);
  });

  doVoid();

  const updatedSale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
  const updatedItems = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId);

  res.json({ message: isFullVoid ? 'Item fully voided' : `${qty} unit(s) voided`, sale: updatedSale, items: updatedItems });
});

// DELETE /api/sales/:id — delete entire sale (owner only, requires void password)
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const { password } = req.body;

  // Only owners can delete sales
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Owner access required' });
  }

  if (!password) {
    return res.status(400).json({ error: 'Void password is required' });
  }

  // Verify void password
  const owners = db.prepare(`SELECT * FROM users WHERE role = 'owner' AND void_password IS NOT NULL`).all();
  const validOwner = owners.find(m => bcrypt.compareSync(password, m.void_password));
  if (!validOwner) {
    return res.status(403).json({ error: 'Invalid void password' });
  }

  // Get sale and items
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
  if (!sale) {
    return res.status(404).json({ error: 'Sale not found' });
  }

  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(id);

  // Transaction: return stock for non-voided items, log deletion, delete records
  const doDelete = db.transaction(() => {
    // Return stock for all non-voided items
    for (const item of items) {
      if (!item.voided) {
        const food = db.prepare('SELECT * FROM foods WHERE id = ?').get(item.food_id);
        if (food && food.flavors && item.flavor_name) {
          // Return stock to specific flavor
          const flavors = JSON.parse(food.flavors);
          const flavorIndex = flavors.findIndex(f => f.flavor_name === item.flavor_name);
          if (flavorIndex !== -1) {
            flavors[flavorIndex].stock = (flavors[flavorIndex].stock || 0) + item.quantity;
            const newTotalStock = flavors.reduce((sum, f) => sum + (f.stock || 0), 0);
            db.prepare('UPDATE foods SET flavors = ?, stock = ?, status = CASE WHEN ? > 0 THEN ? ELSE status END WHERE id = ?')
              .run(JSON.stringify(flavors), newTotalStock, newTotalStock, food.status === 'unavailable' ? 'available' : food.status, food.id);
          }
        } else {
          db.prepare(`
            UPDATE foods SET stock = stock + ?,
              status = CASE WHEN stock + ? > 0 THEN 'available' ELSE status END
            WHERE id = ?
          `).run(item.quantity, item.quantity, item.food_id);
        }
      }
    }

    // Delete void logs for this sale (avoid FK constraint)
    db.prepare('DELETE FROM void_logs WHERE sale_id = ?').run(id);

    // Delete sale items
    db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(id);

    // Delete sale
    db.prepare('DELETE FROM sales WHERE id = ?').run(id);
  });

  doDelete();

  res.json({ message: 'Sale deleted successfully' });
});

module.exports = router;
