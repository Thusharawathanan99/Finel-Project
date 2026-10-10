import './db.js'; // Loads configuration relative to the module, independent of cwd.
import mysql from 'mysql2/promise';

async function verify() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost', port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE || 'careconnect',
  });

  console.log('✅ Connected to careconnect database\n');

  // List all tables
  const [tables] = await connection.query('SHOW TABLES');
  console.log(`📋 Tables (${tables.length}):`);
  tables.forEach(t => console.log(`   - ${Object.values(t)[0]}`));

  // Count rows in key tables
  const counts = [
    'users', 'residents', 'caretakers', 'prescriptions', 'medications',
    'appointments', 'emotional_states', 'leave_requests', 'emergency_alerts',
    'system_components', 'caretaker_residents'
  ];

  console.log('\n📊 Row counts:');
  for (const table of counts) {
    try {
      const [rows] = await connection.query(`SELECT COUNT(*) as cnt FROM ${table}`);
      console.log(`   ${table}: ${rows[0].cnt} rows`);
    } catch (e) {
      console.log(`   ${table}: ERROR - ${e.message}`);
    }
  }

  // Show sample resident data
  const [residents] = await connection.query('SELECT resident_id, name, age FROM residents');
  console.log('\n👥 Residents:');
  residents.forEach(r => console.log(`   ${r.resident_id} — ${r.name} (age ${r.age})`));

  // Show sample prescriptions
  const [prescriptions] = await connection.query('SELECT p.prescription_id, r.name as resident, p.doctor_name, p.date_issued FROM prescriptions p JOIN residents r ON p.resident_id = r.resident_id');
  console.log('\n💊 Prescriptions:');
  prescriptions.forEach(p => console.log(`   ${p.prescription_id} — ${p.resident} — Dr. ${p.doctor_name} (${p.date_issued.toISOString().split('T')[0]})`));

  // Show medications
  const [meds] = await connection.query('SELECT m.drug_name, m.dosage, m.frequency, m.prescription_id FROM medications m');
  console.log(`\n💉 Medications (${meds.length} total):`);
  meds.forEach(m => console.log(`   [${m.prescription_id}] ${m.drug_name} ${m.dosage} — ${m.frequency}`));

  await connection.end();
  console.log('\n✅ Database verification complete!');
}

verify().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
