import pool from '../4-system-engine/api/db.js';

async function setup() {
  const ctUid = 'vIoQ4844jPWTi07BWmMEZPdFJJs2';
  const ptUid = 'I49zyT27Geb7rjiNcQC8fsF0AM52';

  // 1. Ensure caretaker user
  await pool.query(
    'INSERT INTO users (id, name, email, role, resident_id) VALUES (?, ?, ?, ?, NULL) ' +
    'ON DUPLICATE KEY UPDATE name = VALUES(name), role = VALUES(role)',
    [ctUid, 'Demo Caretaker', 'caretaker.demo@careconnect.com', 'caretaker']
  );

  // 2. Ensure caretaker record
  await pool.query(
    'INSERT INTO caretakers (caretaker_id, name, email, phone, specialization, is_active) VALUES (?, ?, ?, ?, ?, 1) ' +
    'ON DUPLICATE KEY UPDATE name = VALUES(name), email = VALUES(email), is_active = 1',
    ['CT-DEMO', 'Demo Caretaker', 'caretaker.demo@careconnect.com', '555-0101', 'Senior & General Care']
  );

  // 3. Ensure patient user
  await pool.query(
    'INSERT INTO users (id, name, email, role, resident_id) VALUES (?, ?, ?, ?, ?) ' +
    'ON DUPLICATE KEY UPDATE name = VALUES(name), role = VALUES(role), resident_id = VALUES(resident_id)',
    [ptUid, 'Margaret Thompson', 'patient.demo@careconnect.com', 'patient', 'R001']
  );

  // 4. Ensure caretaker assignments
  await pool.query(
    'INSERT IGNORE INTO caretaker_residents (caretaker_id, resident_id) VALUES (?, ?), (?, ?), (?, ?)',
    ['CT-DEMO', 'R001', 'CT-DEMO', 'R002', 'CT-DEMO', 'R003']
  );

  console.log('SUCCESS: Demo users configured in MySQL!');
  process.exit(0);
}

setup().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
