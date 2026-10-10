import './db.js'; // Loads configuration relative to the module, independent of cwd.
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '../../.env') });

async function checkCaretakers() {
  console.log('=========================================');
  console.log('🩺 MySQL Caretakers Check');
  console.log('=========================================\n');

  try {
    const connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST || 'localhost', port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD ?? '',
      database: process.env.MYSQL_DATABASE || 'careconnect'
    });
    
    console.log(`✅ Connected to MySQL successfully!`);
    
    const [rows] = await connection.query('SELECT caretaker_id, name, email FROM caretakers');
    
    console.log(`\n📊 Found ${rows.length} caretakers in your MySQL database:`);
    
    if (rows.length > 0) {
      rows.forEach(r => console.log(`   - ${r.name} (${r.email || 'No email'})`));
    } else {
      console.log(`\n❌ ERROR: Your database is completely empty!`);
      console.log(`   Please run this exact command to create the default caretakers:`);
      console.log(`   👉 node api/setup_db.js`);
    }
    
    await connection.end();
  } catch (err) {
    console.log(`\n❌ MYSQL ERROR: Could not connect to database.`);
    console.log(`   Please make sure XAMPP is running and MySQL is turned on.`);
    console.log(`   Details: ${err.message}`);
  }

  console.log('\n=========================================');
}

checkCaretakers();
