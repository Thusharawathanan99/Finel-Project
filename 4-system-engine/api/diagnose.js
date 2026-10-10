import './db.js'; // Loads configuration relative to the module, independent of cwd.
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '../../.env') });

async function runDiagnostics() {
  console.log('=========================================');
  console.log('CareConnect Caretaker Diagnostic Tool');
  console.log('=========================================\n');

  // TEST 1: Database Check
  console.log('1️⃣ TESTING MYSQL DATABASE...');
  try {
    const connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST || 'localhost', port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD ?? '',
      database: process.env.MYSQL_DATABASE || 'careconnect'
    });
    
    const [rows] = await connection.query('SELECT caretaker_id, name, email FROM caretakers');
    console.log(`   ✅ Connected to MySQL successfully!`);
    console.log(`   📊 Found ${rows.length} caretakers in the database.`);
    if (rows.length > 0) {
      rows.forEach(r => console.log(`      - ${r.name} (${r.email})`));
    } else {
      console.log(`   ❌ ERROR: Your database is empty! Run 'node api/setup_db.js' to fix this.`);
    }
    await connection.end();
  } catch (err) {
    console.log(`   ❌ MYSQL ERROR: Could not connect to database. Is XAMPP/MySQL running?`);
    console.log(`      Details: ${err.message}`);
  }

  console.log('\n2️⃣ TESTING LOCAL EXPRESS SERVER...');
  try {
    const res = await fetch('http://localhost:3001/api/caretakers');
    if (res.ok) {
      const data = await res.json();
      console.log(`   ✅ Express server is running on port 3001!`);
      console.log(`   📦 Server returned ${data.length} caretakers.`);
    } else {
      console.log(`   ❌ EXPRESS ERROR: Server responded with status ${res.status}`);
    }
  } catch (err) {
    console.log(`   ❌ EXPRESS ERROR: Could not reach localhost:3001.`);
    console.log(`      Did you forget to run 'npm run dev' in a separate terminal?`);
  }

  console.log('\n3️⃣ TESTING CLOUDFLARE TUNNEL...');
  try {
    const res = await fetch('https://api.careconnect.website/api/caretakers');
    if (res.ok) {
      const data = await res.json();
      console.log(`   ✅ Cloudflare Tunnel is working perfectly!`);
      console.log(`   🌐 Cloudflare returned ${data.length} caretakers.`);
    } else {
      console.log(`   ❌ CLOUDFLARE ERROR: Tunnel responded with status ${res.status}.`);
      console.log(`      This usually means your Express server isn't running or the tunnel isn't connected.`);
    }
  } catch (err) {
    console.log(`   ❌ CLOUDFLARE ERROR: Network request failed.`);
    console.log(`      Details: ${err.message}`);
    console.log(`      Are you sure 'cloudflared service install' is running on this PC?`);
  }

  console.log('\n=========================================');
  console.log('Diagnostic Complete.');
}

runDiagnostics();
