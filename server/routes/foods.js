const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/foods — all food items with calculated available stock
router.get('/', (req, res) => {
  const foods = db.prepare('SELECT * FROM foods ORDER BY name').all();
  // Parse flavors JSON and calculate available stock for each food
  const result = foods.map(f => {
    const flavors = f.flavors ? JSON.parse(f.flavors) : null;
    let availableStock = 0;

    if (flavors && flavors.length > 0) {
      // Calculate stock per flavor
      const flavorStocks = flavors.map(flavor => {
        const flavorName = flavor.flavor_name || flavor.name;
        const initialStock = parseInt(flavor.stock) || 0;
        const addedStock = db.prepare(`
          SELECT COALESCE(SUM(added_stock), 0) as total
          FROM daily_stock_inventory
          WHERE food_id = ? AND LOWER(flavor_name) LIKE LOWER(?)
        `).get(f.id, `%${flavorName}%`)?.total || 0;

        const soldStock = db.prepare(`
          SELECT COALESCE(SUM(quantity), 0) as total
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          WHERE si.food_id = ? AND LOWER(si.flavor_name) LIKE LOWER(?)
        `).get(f.id, `%${flavorName}%`)?.total || 0;

        return {
          ...flavor,
          available: Math.max(0, initialStock + addedStock - soldStock),
          added: addedStock,
          sold: soldStock
        };
      });

      availableStock = flavorStocks.reduce((sum, fl) => sum + fl.available, 0);

      return {
        ...f,
        flavors: flavorStocks,
        stock: availableStock
      };
    } else {
      // Calculate stock for food without flavors (flavor_name IS NULL or empty string)
      const addedStock = db.prepare(`
        SELECT COALESCE(SUM(added_stock), 0) as total
        FROM daily_stock_inventory
        WHERE food_id = ? AND (flavor_name IS NULL OR flavor_name = '')
      `).get(f.id)?.total || 0;

      const soldStock = db.prepare(`
        SELECT COALESCE(SUM(quantity), 0) as total
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        WHERE si.food_id = ? AND (si.flavor_name IS NULL OR si.flavor_name = '')
      `).get(f.id)?.total || 0;

      availableStock = Math.max(0, addedStock - soldStock);

      return {
        ...f,
        flavors: null,
        stock: availableStock,
        stockData: { added: addedStock, sold: soldStock }
      };
    }
  });
  res.json(result);
});

// POST /api/foods — add new food (Owner only)
router.post('/', (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Owner access required' });

  const { name, price, stock, category, flavors } = req.body;
  if (!name || price === undefined) {
    return res.status(400).json({ error: 'Name and price are required' });
  }

  // Validate: if no flavors, stock is required
  const hasFlavors = flavors && flavors.length > 0;
  if (!hasFlavors && stock === undefined) {
    return res.status(400).json({ error: 'Stock is required when no flavors are provided' });
  }

  const existing = db.prepare('SELECT id FROM foods WHERE LOWER(name) = LOWER(?)').get(name);
  if (existing) {
    return res.status(409).json({ error: `"${name}" already exists in the inventory` });
  }

  // Compute total stock: sum of flavor stocks OR the provided stock
  const totalStock = hasFlavors
    ? flavors.reduce((sum, f) => sum + (parseInt(f.stock) || 0), 0)
    : parseInt(stock);

  const flavorsJSON = hasFlavors ? JSON.stringify(flavors) : null;

  const result = db.prepare(`
    INSERT INTO foods (name, price, stock, category, status, flavors) VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, parseFloat(price), totalStock, category || 'Appetizers', totalStock > 0 ? 'available' : 'unavailable', flavorsJSON);

  const newFood = db.prepare('SELECT * FROM foods WHERE id = ?').get(result.lastInsertRowid);
  const foodRes = { ...newFood, flavors: newFood.flavors ? JSON.parse(newFood.flavors) : null };
  res.status(201).json(foodRes);
});

// PUT /api/foods/:id — update food (Owner only)
router.put('/:id', (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Owner access required' });

  const food = db.prepare('SELECT * FROM foods WHERE id = ?').get(req.params.id);
  if (!food) return res.status(404).json({ error: 'Food not found' });

  const { name, price, stock, category, status, flavors } = req.body;
  const updatedName = name !== undefined ? name : food.name;

  // Check duplicate name (exclude current food)
  if (name !== undefined && name !== food.name) {
    const existing = db.prepare('SELECT id FROM foods WHERE LOWER(name) = LOWER(?) AND id != ?').get(name, food.id);
    if (existing) {
      return res.status(409).json({ error: `"${name}" already exists in the inventory` });
    }
  }
  const updatedPrice = price !== undefined ? parseFloat(price) : food.price;
  const updatedCategory = category !== undefined ? category : food.category;
  
  // Handle flavors and stock
  let updatedStock;
  let flavorsJSON;
  if (flavors !== undefined) {
    const hasFlavors = flavors && flavors.length > 0;
    updatedStock = hasFlavors
      ? flavors.reduce((sum, f) => sum + (parseInt(f.stock) || 0), 0)
      : (stock !== undefined ? parseInt(stock) : food.stock);
    flavorsJSON = hasFlavors ? JSON.stringify(flavors) : null;
  } else {
    // No flavors update - keep existing
    updatedStock = stock !== undefined ? parseInt(stock) : food.stock;
    flavorsJSON = food.flavors;
  }
  
  let updatedStatus = status !== undefined ? status : food.status;

  // Auto set unavailable if stock is 0
  if (updatedStock <= 0) updatedStatus = 'unavailable';
  if (updatedStock > 0 && updatedStatus === 'unavailable' && status === undefined) {
    updatedStatus = 'available';
  }

  db.prepare(`
    UPDATE foods SET name = ?, price = ?, stock = ?, category = ?, status = ?, flavors = ? WHERE id = ?
  `).run(updatedName, updatedPrice, updatedStock, updatedCategory, updatedStatus, flavorsJSON, food.id);

  const updated = db.prepare('SELECT * FROM foods WHERE id = ?').get(food.id);
  const foodRes = { ...updated, flavors: updated.flavors ? JSON.parse(updated.flavors) : null };
  res.json(foodRes);
});

// DELETE /api/foods/:id — delete food (Owner only)
router.delete('/:id', (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Owner access required' });

  const food = db.prepare('SELECT * FROM foods WHERE id = ?').get(req.params.id);
  if (!food) return res.status(404).json({ error: 'Food not found' });

  try {
    // Check for related records before deleting
    const dailyStockCount = db.prepare('SELECT COUNT(*) as count FROM daily_stock_inventory WHERE food_id = ?').get(food.id)?.count || 0;
    const saleItemsCount = db.prepare('SELECT COUNT(*) as count FROM sale_items WHERE food_id = ?').get(food.id)?.count || 0;

    if (dailyStockCount > 0 || saleItemsCount > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete food item with existing stock records or sales history',
        details: {
          dailyStockRecords: dailyStockCount,
          saleItems: saleItemsCount
        }
      });
    }

    db.prepare('DELETE FROM foods WHERE id = ?').run(food.id);
    res.json({ message: 'Food item deleted' });
  } catch (err) {
    console.error('Error deleting food:', err);
    res.status(500).json({ error: 'Failed to delete food item', details: err.message });
  }
});

module.exports = router;
