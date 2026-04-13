const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const db = new Database('./database.db');

// Hash new passwords
const ownerHash = bcrypt.hashSync('marboys2026', 10);
const adminHash = bcrypt.hashSync('adminmarboys', 10);

// Update passwords
try {
  db.prepare('UPDATE users SET password = ? WHERE username = ?').run(ownerHash, 'owner');
  console.log('✅ Owner password updated to: marboys2026');
  
  db.prepare('UPDATE users SET password = ? WHERE username = ?').run(adminHash, 'admin');
  console.log('✅ Admin password updated to: adminmarboys');
  
  console.log('\nPassword update complete!');
} catch (err) {
  console.error('Error updating passwords:', err);
} finally {
  db.close();
}
