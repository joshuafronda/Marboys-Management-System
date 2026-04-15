const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── CREATE TABLES ───────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('owner', 'admin'))
  );

  CREATE TABLE IF NOT EXISTS foods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL DEFAULT 'Appetizers',
    status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'unavailable')),
    flavors TEXT
  );

  CREATE TABLE IF NOT EXISTS tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_number INTEGER NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'available',
    start_time TEXT,
    pause_time TEXT,
    accumulated_seconds INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_number INTEGER,
    start_time TEXT,
    end_time TEXT,
    table_cost REAL NOT NULL DEFAULT 0,
    food_total REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    received REAL NOT NULL DEFAULT 0,
    date TEXT NOT NULL,
    cashier TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL,
    food_id INTEGER NOT NULL,
    food_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    price REAL NOT NULL,
    flavor_name TEXT,
    FOREIGN KEY (sale_id) REFERENCES sales(id)
  );

  CREATE TABLE IF NOT EXISTS daily_stock_inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    food_id INTEGER NOT NULL,
    food_name TEXT NOT NULL,
    flavor_name TEXT,
    added_stock INTEGER NOT NULL DEFAULT 0,
    stock_date TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (food_id) REFERENCES foods(id)
  );
`);

// ─── SEED DEFAULT ACCOUNTS ───────────────────────────────────────────────────

const seedUsers = () => {
  const existingUsers = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (existingUsers.count > 0) return;

  const hash = (pw) => bcrypt.hashSync(pw, 10);

  db.prepare(`INSERT INTO users (name, username, password, role) VALUES (?, ?, ?, ?)`).run(
    'Owner', 'owner', hash('marboys2026'), 'owner'
  );
  db.prepare(`INSERT INTO users (name, username, password, role) VALUES (?, ?, ?, ?)`).run(
    'Admin', 'admin', hash('adminmarboys'), 'admin'
  );

  console.log('✅ Seeded default users: owner / admin');
};

// ─── SEED 16 BILLIARD TABLES ─────────────────────────────────────────────────

const seedTables = () => {
  const existingTables = db.prepare('SELECT COUNT(*) as count FROM tables').get();
  if (existingTables.count > 0) return;

  const insert = db.prepare(`INSERT INTO tables (table_number, status, accumulated_seconds) VALUES (?, 'available', 0)`);
  for (let i = 1; i <= 16; i++) {
    insert.run(i);
  }
  console.log('✅ Seeded 16 billiard tables');
};

// ─── MIGRATION: Add category column if missing ────────────────────────────────

const migrateFoodsCategory = () => {
  const columns = db.prepare("PRAGMA table_info(foods)").all();
  const hasCategory = columns.some(col => col.name === 'category');
  if (!hasCategory) {
    db.exec(`ALTER TABLE foods ADD COLUMN category TEXT NOT NULL DEFAULT 'Appetizers'`);
    console.log('✅ Migrated foods table: added category column');
  }
  
  // Add flavors column if missing
  const hasFlavors = columns.some(col => col.name === 'flavors');
  if (!hasFlavors) {
    db.exec(`ALTER TABLE foods ADD COLUMN flavors TEXT`);
    console.log('✅ Migrated foods table: added flavors column');
  }
};

// Migration: Add flavor_name column to sale_items if missing
const migrateSaleItemsFlavorName = () => {
  const columns = db.prepare("PRAGMA table_info(sale_items)").all();
  const hasFlavorName = columns.some(col => col.name === 'flavor_name');
  if (!hasFlavorName) {
    db.exec(`ALTER TABLE sale_items ADD COLUMN flavor_name TEXT`);
    console.log('✅ Migrated sale_items table: added flavor_name column');
  }
};

// Migration: Add received column to sales if missing
const migrateSalesReceived = () => {
  const columns = db.prepare("PRAGMA table_info(sales)").all();
  const hasReceived = columns.some(col => col.name === 'received');
  if (!hasReceived) {
    db.exec(`ALTER TABLE sales ADD COLUMN received REAL NOT NULL DEFAULT 0`);
    console.log('✅ Migrated sales table: added received column');
  }
};

// ─── SEED SAMPLE FOOD ITEMS ──────────────────────────────────────────────────

const seedFoods = () => {
  const existingFoods = db.prepare('SELECT COUNT(*) as count FROM foods').get();
  if (existingFoods.count > 0) return;

  const insert = db.prepare(`INSERT INTO foods (name, price, stock, category, status) VALUES (?, ?, ?, ?, 'available')`);
  const foods = [
    ['Softdrinks (Regular)', 30, 50, 'Beverages'],
    ['Softdrinks (Large)', 50, 30, 'Beverages'],
    ['Water (500ml)', 20, 60, 'Beverages'],
    ['Water (1L)', 35, 40, 'Beverages'],
    ['Chips (Small)', 25, 40, 'Appetizers'],
    ['Chips (Large)', 45, 25, 'Appetizers'],
    ['Cup Noodles', 30, 30, 'Appetizers'],
    ['Hotdog Sandwich', 35, 20, 'Sandwiches'],
    ['Peanuts', 20, 50, 'Appetizers'],
    ['Energy Drink', 60, 25, 'Beverages'],
  ];
  foods.forEach(([name, price, stock, category]) => insert.run(name, price, stock, category));
  console.log('✅ Seeded sample food items');
};

// ─── MIGRATION: Add cart_items column if missing ──────────────────────────────

const migrateTablesCartItems = () => {
  const columns = db.prepare("PRAGMA table_info(tables)").all();
  const hasCartItems = columns.some(col => col.name === 'cart_items');
  if (!hasCartItems) {
    db.exec(`ALTER TABLE tables ADD COLUMN cart_items TEXT NOT NULL DEFAULT '[]'`);
    console.log('✅ Migrated tables table: added cart_items column');
  }
};

const migrateTablesSetHours = () => {
  const columns = db.prepare("PRAGMA table_info(tables)").all();
  const hasSetHours = columns.some(col => col.name === 'set_hours');
  if (!hasSetHours) {
    db.exec(`ALTER TABLE tables ADD COLUMN set_hours REAL NOT NULL DEFAULT 0`);
    console.log('✅ Migrated tables table: added set_hours column');
  }
};

const migrateTablesRemoveCheckConstraint = () => {
  // Check if tables table has CHECK constraint on status column
  const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tables'").get();
  
  if (tableInfo && tableInfo.sql && tableInfo.sql.includes('CHECK') && tableInfo.sql.includes('status')) {
    console.log('🔄 Migrating tables table: removing CHECK constraint...');
    
    // Get all current columns
    const columns = db.prepare("PRAGMA table_info(tables)").all();
    const hasCartItems = columns.some(col => col.name === 'cart_items');
    const hasSetHours = columns.some(col => col.name === 'set_hours');
    const hasExhibitionBet = columns.some(col => col.name === 'exhibition_bet');
    
    // Create new table without CHECK constraint
    let createSQL = `
      CREATE TABLE tables_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_number INTEGER NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'available',
        start_time TEXT,
        pause_time TEXT,
        accumulated_seconds INTEGER NOT NULL DEFAULT 0
    `;
    if (hasCartItems) createSQL += `, cart_items TEXT NOT NULL DEFAULT '[]'`;
    if (hasSetHours) createSQL += `, set_hours REAL NOT NULL DEFAULT 0`;
    if (hasExhibitionBet) createSQL += `, exhibition_bet REAL NOT NULL DEFAULT 0`;
    createSQL += `)`;
    
    db.exec(createSQL);
    
    // Copy data
    let copySQL = `INSERT INTO tables_new SELECT id, table_number, status, start_time, pause_time, accumulated_seconds`;
    if (hasCartItems) copySQL += `, cart_items`; else copySQL += `, '[]'`;
    if (hasSetHours) copySQL += `, set_hours`; else copySQL += `, 0`;
    if (hasExhibitionBet) copySQL += `, exhibition_bet`; else copySQL += `, 0`;
    copySQL += ` FROM tables`;
    
    db.exec(copySQL);
    
    // Drop old and rename
    db.exec(`DROP TABLE tables`);
    db.exec(`ALTER TABLE tables_new RENAME TO tables`);
    
    console.log('✅ Migrated tables table: removed CHECK constraint');
  }
};

const migrateTablesExhibitionBet = () => {
  const columns = db.prepare("PRAGMA table_info(tables)").all();
  const hasExhibitionBet = columns.some(col => col.name === 'exhibition_bet');
  if (!hasExhibitionBet) {
    db.exec(`ALTER TABLE tables ADD COLUMN exhibition_bet REAL NOT NULL DEFAULT 0`);
    console.log('✅ Migrated tables table: added exhibition_bet column');
  }
};

const migrateTablesExhibitionCustomFee = () => {
  const columns = db.prepare("PRAGMA table_info(tables)").all();
  const hasExhibitionCustomFee = columns.some(col => col.name === 'exhibition_custom_fee');
  if (!hasExhibitionCustomFee) {
    db.exec(`ALTER TABLE tables ADD COLUMN exhibition_custom_fee REAL DEFAULT NULL`);
    console.log('✅ Migrated tables table: added exhibition_custom_fee column');
  }
};

const migrateSalesSetHours = () => {
  const columns = db.prepare("PRAGMA table_info(sales)").all();
  const hasSetHours = columns.some(col => col.name === 'set_hours');
  if (!hasSetHours) {
    db.exec(`ALTER TABLE sales ADD COLUMN set_hours REAL NOT NULL DEFAULT 0`);
    console.log('✅ Migrated sales table: added set_hours column');
  }
};

const migrateSaleItemsVoided = () => {
  const columns = db.prepare("PRAGMA table_info(sale_items)").all();
  const hasVoided = columns.some(col => col.name === 'voided');
  if (!hasVoided) {
    db.exec(`ALTER TABLE sale_items ADD COLUMN voided INTEGER NOT NULL DEFAULT 0`);
    console.log('✅ Migrated sale_items table: added voided column');
  }
};

const createVoidLogsTable = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS void_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_item_id INTEGER,
      sale_id INTEGER NOT NULL,
      food_id INTEGER NOT NULL,
      food_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price REAL NOT NULL,
      reason TEXT NOT NULL,
      authorized_by TEXT NOT NULL,
      voided_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (sale_id) REFERENCES sales(id)
    )
  `);
  console.log('✅ Ensured void_logs table exists');
};

// Migration: Remove NOT NULL constraint and FK from sale_item_id if table exists
const migrateVoidLogsTable = () => {
  try {
    // Check if table exists
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='void_logs'").get();
    if (!tableExists) return;

    // Check current schema
    const columns = db.prepare("PRAGMA table_info(void_logs)").all();
    const saleItemIdCol = columns.find(col => col.name === 'sale_item_id');

    // If sale_item_id has NOT NULL constraint, we need to migrate
    if (saleItemIdCol && saleItemIdCol.notnull === 1) {
      // SQLite doesn't support ALTER COLUMN, so we need to recreate the table
      db.exec(`
        CREATE TABLE void_logs_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sale_item_id INTEGER,
          sale_id INTEGER NOT NULL,
          food_id INTEGER NOT NULL,
          food_name TEXT NOT NULL,
          quantity INTEGER NOT NULL,
          price REAL NOT NULL,
          reason TEXT NOT NULL,
          authorized_by TEXT NOT NULL,
          voided_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (sale_id) REFERENCES sales(id)
        );
        INSERT INTO void_logs_new SELECT * FROM void_logs;
        DROP TABLE void_logs;
        ALTER TABLE void_logs_new RENAME TO void_logs;
      `);
      console.log('✅ Migrated void_logs table: removed NOT NULL constraint from sale_item_id');
    }
  } catch (err) {
    console.log('⚠️  Void_logs migration skipped or failed:', err.message);
  }
};

seedUsers();
seedTables();
migrateFoodsCategory();
migrateTablesCartItems();
migrateTablesSetHours();
migrateTablesRemoveCheckConstraint();
migrateTablesExhibitionBet();
migrateTablesExhibitionCustomFee();
migrateSalesSetHours();
migrateSaleItemsVoided();
createVoidLogsTable();
migrateVoidLogsTable();

const migrateUsersVoidPassword = () => {
  const columns = db.prepare("PRAGMA table_info(users)").all();
  const hasVoidPw = columns.some(col => col.name === 'void_password');
  if (!hasVoidPw) {
    db.exec(`ALTER TABLE users ADD COLUMN void_password TEXT`);
    console.log('✅ Migrated users table: added void_password column');
  }
};

migrateUsersVoidPassword();
migrateSaleItemsFlavorName();
migrateSalesReceived();
seedFoods();

module.exports = db;
