// Local administrator provisioning. Read-only unless --confirm is supplied.
import { resolve } from 'path';
import { fileURLToPath } from 'url';

export const help = 'Usage: npm run admin:bootstrap -- --uid <Firebase UID> --email <verified email> [--confirm]\nDefault: inspect the exact account without changing Firebase or MySQL. --help needs no credentials.';

export function parseArguments(args) {
  if (args.includes('--help')) return { help: true };
  const options = { confirm: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--confirm') { options.confirm = true; continue; }
    if (argument !== '--uid' && argument !== '--email') throw new Error(help);
    const value = args[++index];
    if (!value || value.startsWith('--') || options[argument.slice(2)]) throw new Error(help);
    options[argument.slice(2)] = value;
  }
  if (!options.uid || options.uid.length > 128 || !options.email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.email) || options.email.length > 255) throw new Error(help);
  options.email = options.email.trim().toLowerCase();
  return options;
}

export async function bootstrapAdmin(args = process.argv.slice(2), services) {
  const options = parseArguments(args);
  if (options.help) return { help };
  let ownsPool = false;
  if (!services) {
    // Lazy loading keeps --help offline and avoids connecting before validation.
    const [identity, database] = await Promise.all([import('./middleware/auth.js'), import('./db.js')]);
    services = { admin: identity.default, pool: database.default };
    ownsPool = true;
  }
  const { admin, pool } = services;
  let connection, claimAttempted = false, previousClaims;
  try {
    if (!admin.apps.length) throw new Error('Configure Firebase Admin credentials before provisioning an administrator');
    const account = await admin.auth().getUser(options.uid);
    if (account.uid !== options.uid || account.email?.trim().toLowerCase() !== options.email) {
      throw new Error('The UID and expected email do not match the Firebase account');
    }
    if (account.disabled || !account.emailVerified) throw new Error('The administrator account must be enabled and its email verified');
    previousClaims = { ...(account.customClaims || {}) };
    if (!options.confirm) {
      const [profiles] = await pool.execute('SELECT id, email, role FROM users WHERE id = ?', [options.uid]);
      if (profiles[0] && profiles[0].id !== options.uid) throw new Error('This UID conflicts with a different database account');
      const [emails] = await pool.execute('SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id <> ?', [options.email, options.uid]);
      if (emails.length) throw new Error('The email already belongs to a different database account');
      return { dryRun: true, uid: options.uid, email: options.email, previousRole: profiles[0]?.role || null,
        message: 'Identity verified. No records changed. Add --confirm to provision this administrator.' };
    }
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [profiles] = await connection.execute('SELECT * FROM users WHERE id = ? FOR UPDATE', [options.uid]);
    if (profiles[0] && profiles[0].id !== options.uid) throw new Error('This UID conflicts with a different database account');
    const [emails] = await connection.execute('SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id <> ?', [options.email, options.uid]);
    if (emails.length) throw new Error('The email already belongs to a different database account');
    const name = (account.displayName || profiles[0]?.name || options.email).slice(0, 255);
    if (profiles.length) await connection.execute('UPDATE users SET name = ?, email = ?, role = ? WHERE id = ?', [name, options.email, 'admin', options.uid]);
    else await connection.execute('INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)', [options.uid, name, options.email, 'admin']);
    claimAttempted = true;
    await admin.auth().setCustomUserClaims(options.uid, { ...previousClaims, role: 'admin' });
    await connection.commit();
    return { dryRun: false, uid: options.uid, email: options.email, role: 'admin',
      message: 'Administrator provisioned. Sign out and sign in again to refresh the Firebase token.' };
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    if (claimAttempted) {
      try {
        await admin.auth().setCustomUserClaims(options.uid, previousClaims);
      } catch {
        throw new Error('Admin setup failed and previous Firebase claims could not be restored. Inspect this UID in Firebase and MySQL before retrying.');
      }
      throw new Error('Admin setup failed. The database transaction was rolled back and previous Firebase claims were restored.');
    }
    throw error;
  } finally {
    connection?.release();
    if (ownsPool) await pool.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  bootstrapAdmin().then(result => console.log(result.help || JSON.stringify(result, null, 2))).catch(error => {
    console.error('Administrator setup failed:', error.message);
    process.exitCode = 1;
  });
}
