// Reset caretaker records and ensure caretaker table fields exist.
// Optional Firebase cleanup deletes caretaker accounts from Firebase Auth.
// Usage:
//   node reset_caretakers.js --dry-run
//   node reset_caretakers.js --dry-run --with-firebase
//   node reset_caretakers.js --confirm
//   node reset_caretakers.js --confirm --with-firebase

import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import pool from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CARETAKER_COLUMNS = [
  { name: 'name', definition: 'VARCHAR(255) NOT NULL' },
  { name: 'email', definition: 'VARCHAR(255) DEFAULT NULL' },
  { name: 'phone', definition: 'VARCHAR(50) DEFAULT NULL' },
  { name: 'specialization', definition: 'VARCHAR(100) DEFAULT NULL' },
  { name: 'is_active', definition: 'BOOLEAN DEFAULT TRUE' },
  { name: 'date_joined', definition: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' },
];

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function columnExists(connection, tableName, columnName) {
  const [rows] = await connection.execute(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = ?
      AND column_name = ?
    LIMIT 1
    `,
    [tableName, columnName]
  );

  return rows.length > 0;
}

async function ensureCaretakerColumns(connection) {
  const added = [];

  for (const column of CARETAKER_COLUMNS) {
    const exists = await columnExists(connection, 'caretakers', column.name);
    if (!exists) {
      await connection.query(
        `ALTER TABLE caretakers ADD COLUMN ${column.name} ${column.definition}`
      );
      added.push(column.name);
    }
  }

  return added;
}

async function getCounts(connection) {
  const [[caretakers]] = await connection.query('SELECT COUNT(*) AS count FROM caretakers');
  const [[caretakerUsers]] = await connection.query(
    "SELECT COUNT(*) AS count FROM users WHERE role = 'caretaker'"
  );
  const [[assignments]] = await connection.query('SELECT COUNT(*) AS count FROM caretaker_residents');
  const [[leaveRequests]] = await connection.query('SELECT COUNT(*) AS count FROM leave_requests');

  return {
    caretakers: caretakers.count,
    caretakerUsers: caretakerUsers.count,
    assignments: assignments.count,
    leaveRequests: leaveRequests.count,
  };
}

async function getCaretakerIdentitySnapshot(connection) {
  const [caretakerUsers] = await connection.query(
    "SELECT id AS uid, email FROM users WHERE role = 'caretaker'"
  );

  const [caretakerProfiles] = await connection.query(
    "SELECT caretaker_id, email FROM caretakers WHERE email IS NOT NULL AND email <> ''"
  );

  const uidSet = new Set();
  const emailSet = new Set();

  for (const row of caretakerUsers) {
    if (row.uid) {
      uidSet.add(row.uid);
    }
    const email = normalizeEmail(row.email);
    if (email) {
      emailSet.add(email);
    }
  }

  for (const row of caretakerProfiles) {
    const email = normalizeEmail(row.email);
    if (email) {
      emailSet.add(email);
    }
  }

  return {
    uids: [...uidSet],
    emails: [...emailSet],
    caretakerUserRows: caretakerUsers.length,
    caretakerProfileRows: caretakerProfiles.length,
  };
}

function printCounts(label, counts) {
  console.log(`\n${label}`);
  console.log(`  caretakers:             ${counts.caretakers}`);
  console.log(`  users(role=caretaker):  ${counts.caretakerUsers}`);
  console.log(`  caretaker_residents:    ${counts.assignments}`);
  console.log(`  leave_requests:         ${counts.leaveRequests}`);
}

async function initializeFirebaseAdmin() {
  const firebaseAdminModule = await import('firebase-admin');
  const admin = firebaseAdminModule.default;

  if (admin.apps.length > 0) {
    return admin;
  }

  const serviceAccountPath = resolve(__dirname, '../serviceAccountKey.json');
  if (existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf-8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    return admin;
  }

  admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID,
  });

  return admin;
}

async function deleteFirebaseUsersByUid(admin, uids) {
  const failures = [];
  let deletedCount = 0;

  for (const chunk of chunkArray(uids, 1000)) {
    const result = await admin.auth().deleteUsers(chunk);
    deletedCount += result.successCount;

    for (const item of result.errors) {
      failures.push({
        uid: chunk[item.index],
        message: item.error?.message || 'Unknown Firebase deletion error',
      });
    }
  }

  return { deletedCount, failures };
}

async function findFirebaseUidsByEmail(admin, emailSet) {
  const emailToUid = new Map();
  let pageToken = undefined;

  do {
    const page = await admin.auth().listUsers(1000, pageToken);
    for (const userRecord of page.users) {
      const email = normalizeEmail(userRecord.email);
      if (email && emailSet.has(email)) {
        emailToUid.set(email, userRecord.uid);
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);

  return emailToUid;
}

async function cleanupFirebaseCaretakers(snapshot, dryRun) {
  const uidCandidates = [...new Set(snapshot.uids)];
  const emailCandidates = new Set(snapshot.emails.map(normalizeEmail).filter(Boolean));

  console.log('\nFirebase caretaker cleanup:');
  console.log(`  uid candidates:   ${uidCandidates.length}`);
  console.log(`  email candidates: ${emailCandidates.size}`);

  if (uidCandidates.length === 0 && emailCandidates.size === 0) {
    console.log('  No caretaker identities found to clean in Firebase.');
    return;
  }

  if (dryRun) {
    console.log('  Dry run: Firebase users were not deleted.');
    return;
  }

  const admin = await initializeFirebaseAdmin();

  const uidDeletion = await deleteFirebaseUsersByUid(admin, uidCandidates);
  const failedUidSet = new Set(uidDeletion.failures.map(f => f.uid));
  const deletedUidSet = new Set(uidCandidates.filter(uid => !failedUidSet.has(uid)));

  const emailToUid = await findFirebaseUidsByEmail(admin, emailCandidates);
  const fallbackUids = [...new Set(emailToUid.values())].filter(uid => !deletedUidSet.has(uid));
  const fallbackDeletion = await deleteFirebaseUsersByUid(admin, fallbackUids);

  const unresolvedEmails = [...emailCandidates].filter(email => !emailToUid.has(email));

  console.log(`  Deleted by uid:      ${uidDeletion.deletedCount}`);
  console.log(`  Deleted by email map:${fallbackDeletion.deletedCount}`);
  console.log(`  Unresolved emails:   ${unresolvedEmails.length}`);

  const allFailures = [...uidDeletion.failures, ...fallbackDeletion.failures];
  if (allFailures.length > 0) {
    console.warn(`  Firebase deletion failures: ${allFailures.length}`);
    for (const failure of allFailures.slice(0, 10)) {
      console.warn(`    - ${failure.uid}: ${failure.message}`);
    }
  }
}

export async function resetCaretakers({ dryRun, withFirebase }) {
  const connection = await pool.getConnection();
  let identitySnapshot = {
    uids: [],
    emails: [],
    caretakerUserRows: 0,
    caretakerProfileRows: 0,
  };
  let dbStepSucceeded = false;

  try {
    // ALTER TABLE commits implicitly in MySQL. Skip it entirely for previews,
    // and finish schema preparation before the destructive transaction begins.
    const addedColumns = dryRun ? [] : await ensureCaretakerColumns(connection);
    if (dryRun) {
      console.log('Dry run: schema changes were skipped.');
    } else if (addedColumns.length > 0) {
      console.log(`Added missing caretaker columns: ${addedColumns.join(', ')}`);
    } else {
      console.log('Caretaker columns already up to date.');
    }

    await connection.beginTransaction();

    identitySnapshot = await getCaretakerIdentitySnapshot(connection);
    if (withFirebase) {
      console.log(`\nSnapshot for Firebase cleanup: ${identitySnapshot.uids.length} uid(s), ${identitySnapshot.emails.length} email(s)`);
    }

    const before = await getCounts(connection);
    printCounts('Before reset:', before);

    if (!dryRun) {
      // Remove app user profiles for caretakers.
      await connection.query("DELETE FROM users WHERE role = 'caretaker'");

      // Remove caretaker records. Related rows in caretaker_residents and
      // leave_requests are removed by FK cascade.
      await connection.query('DELETE FROM caretakers');
    }

    const after = dryRun ? before : await getCounts(connection);

    if (dryRun) {
      await connection.rollback();
      console.log('\nDry run complete. No MySQL data was changed.');
    } else {
      await connection.commit();
      console.log('\nCaretaker reset completed and committed.');
    }

    printCounts('After reset:', after);
    dbStepSucceeded = true;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Ignore rollback errors.
    }
    console.error('Failed to reset caretakers in MySQL:', error.message);
    process.exitCode = 1;
  } finally {
    connection.release();
  }

  if (dbStepSucceeded && withFirebase) {
    try {
      await cleanupFirebaseCaretakers(identitySnapshot, dryRun);
    } catch (error) {
      console.error('Failed during Firebase cleanup:', error.message);
      console.error('MySQL reset has already completed.');
      process.exitCode = 1;
    }
  }

  await pool.end();
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  const dryRun = process.argv.includes('--dry-run');
  const confirm = process.argv.includes('--confirm');
  const withFirebase = process.argv.includes('--with-firebase');
  if (!dryRun && !confirm) {
    console.error('Refusing to run destructive reset without --confirm.');
    console.error('Use --dry-run to preview or --confirm to execute.');
    process.exitCode = 1;
  } else {
    resetCaretakers({ dryRun, withFirebase }).catch(error => {
      console.error('Caretaker reset could not be completed:', error.message);
      process.exitCode = 1;
    });
  }
}
