import pool from './db.js';

async function createTable() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS sos_alerts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      resident_id VARCHAR(50) NOT NULL,
      resident_name VARCHAR(100),
      message TEXT,
      is_resolved BOOLEAN DEFAULT FALSE,
      resolved_by VARCHAR(100),
      resolved_at DATETIME,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('✅ sos_alerts table created');
  process.exit(0);
}

createTable().catch(e => { console.error(e); process.exit(1); });
