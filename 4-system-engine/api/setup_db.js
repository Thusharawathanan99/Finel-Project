// Non-destructive schema setup. Demo records require --seed --confirm.
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { applyMigrations, requiredColumns } from './migrations.js';

const directory = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(directory, '../../.env') });

export function prepareSchema(sql, database, { seed = false } = {}) {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(database)) throw new Error('MYSQL_DATABASE must contain only letters, numbers and underscores');
  let prepared = sql
    .replace(/CREATE DATABASE IF NOT EXISTS careconnect\b/, `CREATE DATABASE IF NOT EXISTS \`${database}\``)
    .replace(/\bUSE careconnect;/g, `USE \`${database}\`;`);
  // The complete schema has a few table definitions after its demo INSERTs.
  // Remove only demo statements, preserving every CREATE TABLE definition.
  if (!seed) prepared = prepared.replace(/INSERT IGNORE INTO[\s\S]*?;/g, '');
  return prepared;
}

export async function setupDatabase(args = process.argv.slice(2)) {
  const seed = args.includes('--seed');
  if (seed && !args.includes('--confirm')) throw new Error('Demo records require --seed --confirm; normal setup creates tables only');
  if (args.includes('--migrate') && !args.includes('--confirm') && !args.includes('--dry-run')) throw new Error('Schema migrations require --migrate --confirm');
  if (args.some(argument => !['--seed', '--confirm', '--dry-run', '--migrate'].includes(argument))) throw new Error('Supported options: --dry-run, --migrate --confirm, --seed --confirm');
  const database = process.env.MYSQL_DATABASE || 'careconnect';
  const port = Number(process.env.MYSQL_PORT || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MYSQL_PORT must be a valid port number');
  const sql = prepareSchema(readFileSync(resolve(directory, 'schema.sql'), 'utf8'), database, { seed })
    + '\n' + readFileSync(resolve(directory, 'schema_notifications.sql'), 'utf8');
  const tableCount = (sql.match(/CREATE TABLE IF NOT EXISTS/g) || []).length;
  if (args.includes('--dry-run')) {
    console.log(`Schema validated: ${tableCount} tables in ${database}; demo records ${seed ? 'included' : 'excluded'}. No database connection was opened.`);
    console.log(`Migration plan includes ${Object.values(requiredColumns).reduce((sum, fields) => sum + Object.keys(fields).length, 0)} idempotently checked columns, observation uniqueness and history retention. Review migrations.js for SQL; --migrate --confirm applies pending steps.`);
    return;
  }
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST || 'localhost', port,
      user: process.env.MYSQL_USER || 'root', password: process.env.MYSQL_PASSWORD ?? '',
      multipleStatements: true, charset: 'utf8mb4',
    });
    await connection.query(sql);
    const migrations = await applyMigrations(connection, database, { allowChanges: args.includes('--migrate') && args.includes('--confirm') });
    console.log(`Schema ready: ${tableCount} tables in ${database}. Existing records were retained.`);
    console.log(`Schema version recorded; ${migrations.length} migration steps applied.`);
    if (seed) console.log('Demo records inserted. Seed only a disposable development database once.');
  } finally {
    if (connection) await connection.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  setupDatabase().catch(error => {
    console.error('Database setup failed:', error.message);
    process.exitCode = 1;
  });
}
