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

import pool, { testConnection } from './db.js';
import { authMiddleware, isAuthenticationReady } from './middleware/auth.js';
import { authorizationMiddleware } from './middleware/authorization.js';
import { inferenceLimitMiddleware } from './middleware/inferenceLimits.js';
import { readiness } from './readiness.js';
import { isSchemaReady } from './migrations.js';

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
import aiRoutes from './routes/ai.js';
import medicationEventsRoutes from './routes/medicationEvents.js';
import edgeRoutes from './routes/edge.js';
import monitoringRoutes from './routes/monitoring.js';
import { startMonitoringMaintenance } from './monitoringMaintenance.js';
import remindersRoutes from './routes/reminders.js';
import pushDevicesRoutes, { revokeInstallationHandler } from './routes/pushDevices.js';
import { startNotificationWorker } from './notificationService.js';
import { auditAccessMiddleware } from './middleware/auditAccess.js';
import storageAccessRoutes from './routes/storageAccess.js';

const app = express();
const PORT = process.env.API_PORT || 3001;

// ──────────────────────────────────────────────
// Middleware
// ──────────────────────────────────────────────
const configuredCorsOrigins = new Set(
  (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean),
);
const isDevelopmentOrigin = origin => {
  if (process.env.NODE_ENV === 'production') return false;
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
};

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || configuredCorsOrigins.has(origin) || isDevelopmentOrigin(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '15mb' }));

// Health check (no auth required)
app.get('/api/health', async (req, res) => {
  const state = await readiness(pool, isAuthenticationReady, () => isSchemaReady(pool));
  res.status(state.status === 'ready' ? 200 : 503).json(state);
});

// Edge identities have their own hashed device tokens, never a Firebase user role.
app.use('/api/edge', edgeRoutes);
// Possession of the high-entropy installation secret grants disable-only access.
// This cannot read notifications, register a token, transfer ownership or enable it.
app.delete('/api/push-devices/revoke-installation', revokeInstallationHandler);
// Apply auth middleware to user routes.
app.use('/api', authMiddleware, authorizationMiddleware, inferenceLimitMiddleware, auditAccessMiddleware);

// ──────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────
app.use('/api/users', usersRoutes);
app.use('/api/residents', residentsRoutes);
app.use('/api', prescriptionsRoutes);      // Handles /api/prescriptions and /api/residents/:id/prescriptions
app.use('/api/caretakers', caretakersRoutes);
app.use('/api', appointmentsRoutes);        // Handles /api/appointments and /api/residents/:id/appointments
app.use('/api', emotionsRoutes);            // Handles /api/emotions and /api/residents/:id/emotions
app.use('/api/system/components', systemRoutes);
app.use('/api', mealplansRoutes);              // Handles /api/residents/:id/meal-plan
app.use('/api', analyzeRoutes);                // Handles /api/analyze-prescription
app.use('/api/doctors', doctorsRoutes);         // Handles /api/doctors CRUD
app.use('/api', notificationsRoutes);             // Handles /api/residents/:id/notifications
app.use('/api', sosRoutes);                          // Handles /api/sos-alerts
app.use('/api', complaintsRoutes);                     // Handles /api/complaints + /api/residents/:id/complaints
app.use('/api', aiRoutes);                             // Authenticated browser AI inference
app.use('/api', medicationEventsRoutes);
app.use('/api', storageAccessRoutes);
app.use('/api/monitoring', monitoringRoutes);
app.use('/api', remindersRoutes);
app.use('/api', pushDevicesRoutes);

// ──────────────────────────────────────────────
// Error Handling
// ──────────────────────────────────────────────
app.use((err, req, res, _next) => {
  if (err.message === 'Origin is not allowed by CORS') {
    return res.status(403).json({ error: 'Origin is not allowed by CORS' });
  }
  console.error('Unhandled error:', err);
  res.status(err.status === 413 ? 413 : err.status === 400 ? 400 : 500).json({ error: err.status === 413 ? 'Request is too large' : err.status === 400 ? 'Invalid JSON request' : 'Internal server error' });
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
    throw new Error('MySQL is unavailable. Check configuration before starting the API.');
  }
  if (process.env.NODE_ENV === 'production' && !isAuthenticationReady()) {
    throw new Error('Firebase authentication is not configured. API startup rejected.');
  }
  if (!isAuthenticationReady()) {
    console.warn('⚠️  Firebase Admin authentication is not configured. Protected API routes will require credentials.');
  }
  if (!await isSchemaReady(pool)) throw new Error('Database migrations are pending. Run setup_db.js --migrate --confirm before starting the API.');

  app.listen(PORT, () => {
    console.log(`\n🚀 API server running at http://localhost:${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/api/health`);
    console.log(`   CORS origins: ${configuredCorsOrigins.size ? [...configuredCorsOrigins].join(', ') : 'development localhost only'}\n`);
  });
  if (process.env.BACKGROUND_WORKERS_ENABLED !== 'false') {
    startMonitoringMaintenance(pool);
    startNotificationWorker(pool);
  }
}

start().catch(async error => { console.error(error.message); process.exitCode = 1; await pool.end(); });
