// Notifications API routes
import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// GET /api/residents/:residentId/notifications — Get notifications for a patient
router.get('/residents/:residentId/notifications', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM notifications WHERE resident_id = ? ORDER BY created_at DESC LIMIT 50',
      [req.params.residentId]
    );
    res.json(rows);
  } catch (error) {
    console.error('[Notifications] List error:', error.message);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// PUT /api/notifications/:id/read — Mark notification as read
router.put('/notifications/:id/read', async (req, res) => {
  try {
    await pool.execute('UPDATE notifications SET is_read = TRUE WHERE notification_id = ?', [req.params.id]);
    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('[Notifications] Mark read error:', error.message);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

// PUT /api/notifications/read-all/:residentId — Mark all as read
router.put('/notifications/read-all/:residentId', async (req, res) => {
  try {
    await pool.execute('UPDATE notifications SET is_read = TRUE WHERE resident_id = ?', [req.params.residentId]);
    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error('[Notifications] Mark all read error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
