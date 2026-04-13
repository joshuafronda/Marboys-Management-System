const db = require('./server/db');

// Replicate the exact GET /api/foods logic
const foods = db.prepare('SELECT * FROM foods ORDER BY name').all();
const result = foods.map(f => {
  const flavors = f.flavors ? JSON.parse(f.flavors) : null;
  let availableStock = 0;

  if (flavors && flavors.length > 0) {
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

const cw = result.find(f => f.name === 'Chicken Wings');
if (cw) {
  console.log('Chicken Wings from API logic:');
  console.log('  stock:', cw.stock);
  console.log('  flavors:', JSON.stringify(cw.flavors, null, 2));
} else {
  console.log('Chicken Wings not found');
}
