// Verify only the configured MySQL account; credentials are never printed.
import pool, { testConnection } from './db.js';

try {
  if (!await testConnection()) process.exitCode = 1;
} finally {
  await pool.end();
}
