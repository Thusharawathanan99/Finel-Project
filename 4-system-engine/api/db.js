// MySQL connection pool for CareConnect API
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenv.config({ path: resolve(__dirname, '../../.env') });

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306', 10),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD ?? '',
  database: process.env.MYSQL_DATABASE || 'careconnect',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 100,
  connectTimeout: 5000,
  charset: 'utf8mb4',
  // DATE is a calendar value, not an instant; TIMESTAMP values are serialized in UTC.
  dateStrings: ['DATE'],
  timezone: 'Z',
  ...(process.env.MYSQL_SSL_CA ? {ssl:{ca:readFileSync(process.env.MYSQL_SSL_CA,'utf8'),rejectUnauthorized:true}} : {}),
});
pool.pool.on('connection', connection => { connection.query("SET time_zone = '+00:00'"); });

/**
 * Test the database connection.
 */
export async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('✅ MySQL connected successfully');
    connection.release();
    return true;
  } catch (error) {
    console.error('❌ MySQL connection failed:', error.message);
    return false;
  }
}

export default pool;
