// CareConnect Express.js API Server
// Serves MySQL data to the React frontend, verifies Firebase auth tokens
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenv.config({ path: resolve(__dirname, '../../.env') });

import { testConnection } from './db.js';
import { authMiddleware } from './middleware/auth.js';

// Route imports
import usersRoutes from './routes/users.js';
import residentsRoutes from './routes/residents.js';
import prescriptionsRoutes from './routes/prescriptions.js';
import caretakersRoutes from './routes/caretakers.js';
import appointmentsRoutes from './routes/appointments.js';
import emotionsRoutes from './routes/emotions.js';
import systemRoutes from './routes/system.js';
import mealplansRoutes from './routes/mealplans.js';
import analyzeRoutes from './routes/analyze.js';
import doctorsRoutes from './routes/doctors.js';
import notificationsRoutes from './routes/notifications.js';
import sosRoutes from './routes/sos.js';
import complaintsRoutes from './routes/complaints.js';

const app = express();
const PORT = process.env.API_PORT || 3001;

// ──────────────────────────────────────────────
// Middleware
// ──────────────────────────────────────────────
app.use(cors({
  origin: true, // Allow all origins (Expo mobile + Cloudflare tunnel + localhost)
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));

// Health check (no auth required)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Apply auth middleware to all /api/* routes (except health)
app.use('/api', authMiddleware);

// ──────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────
app.use('/api/users', usersRoutes);
app.use('/api/residents', residentsRoutes);
app.use('/api', prescriptionsRoutes);      // Handles /api/prescriptions and /api/residents/:id/prescriptions
app.use('/api/caretakers', caretakersRoutes);
app.use('/api/appointments', appointmentsRoutes);
app.use('/api', appointmentsRoutes);        // Handles /api/residents/:id/appointments
app.use('/api', emotionsRoutes);            // Handles /api/emotions and /api/residents/:id/emotions
app.use('/api/system/components', systemRoutes);
app.use('/api', mealplansRoutes);              // Handles /api/residents/:id/meal-plan
app.use('/api', analyzeRoutes);                // Handles /api/analyze-prescription
app.use('/api/doctors', doctorsRoutes);         // Handles /api/doctors CRUD
app.use('/api', notificationsRoutes);             // Handles /api/residents/:id/notifications
app.use('/api', sosRoutes);                          // Handles /api/sos-alerts
app.use('/api', complaintsRoutes);                     // Handles /api/complaints + /api/residents/:id/complaints

// ──────────────────────────────────────────────
// Error Handling
// ──────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// ──────────────────────────────────────────────
// Start Server
// ──────────────────────────────────────────────
async function start() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║    CareConnect API Server                ║');
  console.log('╚══════════════════════════════════════════╝');

  // Test MySQL connection
  const dbConnected = await testConnection();
  if (!dbConnected) {
    console.warn('⚠️  MySQL not connected — server will start but database queries will fail.');
    console.warn('   Run: mysql -u root < server/api/schema.sql');
  }

  app.listen(PORT, () => {
    console.log(`\n🚀 API server running at http://localhost:${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/api/health`);
    console.log(`   CORS origins: all (Cloudflare tunnel + Expo mobile)\n`);
  });
}

start().catch(console.error);
