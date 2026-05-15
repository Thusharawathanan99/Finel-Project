// Emotional States API routes
import { Router } from 'express';
import pool from '../db.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = Router();

// Configure Gemini
let genAI = null;
if (process.env.VITE_GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(process.env.VITE_GEMINI_API_KEY);
  console.log('✅ Gemini API initialized for emotion analysis');
} else {
  console.warn('⚠️  VITE_GEMINI_API_KEY not set — Gemini will be unavailable for emotion analysis');
}

// POST /api/emotions/analyze-image — Analyze facial expression for health/wellness context
router.post('/emotions/analyze-image', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ error: 'Image base64 data is required' });
    }
    if (!genAI) {
      return res.status(503).json({ error: 'AI analysis service is unavailable — VITE_GEMINI_API_KEY not set' });
    }

    console.log('[Emotions] 🚀 Analyzing image for health/wellness indicators...');

    let cleanBase64 = image;
    const dataUrlMatch = image.match(/^data:([^;]+);base64,(.+)$/);
    if (dataUrlMatch) {
      cleanBase64 = dataUrlMatch[2];
    } else {
      cleanBase64 = image.replace(/^data:[^;]+;base64,/, '');
    }

    console.log(`[Emotions]   Base64 length: ${cleanBase64.length} chars`);

    // Use the model from env or fall back to gemini-2.5-flash
    const modelName = (process.env.VITE_GEMINI_MODELS || 'gemini-2.5-flash').split(',')[0].trim();
    console.log(`[Emotions]   Using model: ${modelName}`);
    const model = genAI.getGenerativeModel({ model: modelName });
    
    const prompt = `You are an AI assistant for a health monitoring system. 
Analyze this patient's facial expression and provide a wellness assessment. Look for signs of distress, fatigue, pain, or well-being.
Return ONLY a raw JSON object (no markdown, no backticks) with the following structure:
{
  "emotionLabel": "string (e.g., Stable, Fatigued, Distressed, Content, Anxious)",
  "stateScore": number (0-100, where 100 is perfectly well/positive and 0 is severe distress/pain),
  "category": "string (either 'positive', 'neutral', 'negative', or 'side-effect')",
  "note": "A short clinical observation sentence (e.g., 'Patient appears rested and calm.')"
}`;

    const parts = [
      { text: prompt },
      { inlineData: { mimeType: 'image/jpeg', data: cleanBase64 } }
    ];

    const result = await model.generateContent(parts);
    const text = result.response.text();
    console.log(`[Emotions]   AI response length: ${text.length} chars`);
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      console.error('[Emotions]   Failed to parse JSON. Raw response:', text.substring(0, 500));
      throw new Error("Failed to parse JSON from AI response");
    }

    const parsed = JSON.parse(jsonMatch[0]);
    console.log(`[Emotions]   ✅ Result: ${parsed.emotionLabel} (${parsed.stateScore}/100)`);
    res.json(parsed);

  } catch (error) {
    console.error('[Emotions] Analysis error:', error.message);
    console.error('[Emotions] Full error:', error.toString());
    res.status(500).json({ error: error.message });
  }
});

// GET /api/residents/:residentId/emotions — Get emotional state history
router.get('/residents/:residentId/emotions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const [rows] = await pool.execute(
      'SELECT * FROM emotional_states WHERE resident_id = ? ORDER BY recorded_at DESC LIMIT ?',
      [req.params.residentId, limit]
    );
    res.json(rows);
  } catch (error) {
    console.error('[Emotions] List error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/emotions — Record a new emotional state
router.post('/emotions', async (req, res) => {
  try {
    const { residentId, stateScore, emotionLabel, category, relatedMedicine, note } = req.body;

    if (!residentId || stateScore === undefined) {
      return res.status(400).json({ error: 'residentId and stateScore are required' });
    }

    if (stateScore < 0 || stateScore > 100) {
      return res.status(400).json({ error: 'stateScore must be between 0 and 100' });
    }

    // Try inserting with extended columns first
    let result;
    try {
      [result] = await pool.execute(
        'INSERT INTO emotional_states (resident_id, state_score, emotion_label, category, related_medicine, note) VALUES (?, ?, ?, ?, ?, ?)',
        [residentId, stateScore, emotionLabel || null, category || null, relatedMedicine || null, note || null]
      );
    } catch (colErr) {
      // If the extra columns don't exist yet, fall back to basic insert
      console.warn('[Emotions] Extended columns not available, using basic insert:', colErr.message);
      [result] = await pool.execute(
        'INSERT INTO emotional_states (resident_id, state_score) VALUES (?, ?)',
        [residentId, stateScore]
      );
    }

    res.status(201).json({
      message: 'Emotional state recorded',
      id: result.insertId,
      residentId,
      stateScore,
      emotionLabel: emotionLabel || null,
      category: category || null,
      relatedMedicine: relatedMedicine || null,
    });
  } catch (error) {
    console.error('[Emotions] Record error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── Wellness Alerts ──

/**
 * Resolve an ID that may be a caretaker_id ("CT001") or Firebase UID to the actual caretaker_id.
 */
async function resolveCaretakerId(id) {
  const [direct] = await pool.execute('SELECT caretaker_id FROM caretakers WHERE caretaker_id = ?', [id]);
  if (direct.length > 0) return direct[0].caretaker_id;

  const [userRows] = await pool.execute('SELECT email FROM users WHERE id = ?', [id]);
  if (userRows.length > 0) {
    const [ctRows] = await pool.execute('SELECT caretaker_id FROM caretakers WHERE email = ?', [userRows[0].email]);
    if (ctRows.length > 0) return ctRows[0].caretaker_id;
  }
  return null;
}

// POST /api/emotions/wellness-alert — Create a wellness alert for assigned caretakers
router.post('/emotions/wellness-alert', async (req, res) => {
  try {
    const { residentId, residentName, emotionLabel, stateScore, category, note } = req.body;

    if (!residentId || stateScore === undefined) {
      return res.status(400).json({ error: 'residentId and stateScore are required' });
    }

    // Determine severity
    let severity = 'info';
    if (stateScore <= 30) severity = 'critical';
    else if (stateScore <= 50) severity = 'warning';

    // Only create alert if warning or critical
    if (severity === 'info') {
      return res.json({ message: 'Patient condition is stable, no alert created', severity });
    }

    // Check for recent duplicate (avoid spamming — 2 min cooldown per resident)
    const [recent] = await pool.execute(
      `SELECT id FROM wellness_alerts 
       WHERE resident_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 2 MINUTE) 
       ORDER BY created_at DESC LIMIT 1`,
      [residentId]
    );

    if (recent.length > 0) {
      return res.json({ message: 'Alert cooldown active, skipped', severity, cooldown: true });
    }

    // Resolve resident name if not provided
    let name = residentName;
    if (!name) {
      const [rRows] = await pool.execute('SELECT name FROM residents WHERE resident_id = ?', [residentId]);
      name = rRows.length > 0 ? rRows[0].name : 'Unknown Patient';
    }

    const [result] = await pool.execute(
      `INSERT INTO wellness_alerts (resident_id, resident_name, emotion_label, state_score, category, note, severity) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [residentId, name, emotionLabel || null, stateScore, category || null, note || null, severity]
    );

    console.log(`[Wellness] 🚨 ${severity.toUpperCase()} alert created for ${name} (score: ${stateScore})`);

    // Also save to emotional_states for history
    try {
      await pool.execute(
        'INSERT INTO emotional_states (resident_id, state_score, emotion_label, category, note) VALUES (?, ?, ?, ?, ?)',
        [residentId, stateScore, emotionLabel || null, category || null, note || null]
      );
    } catch (e) {
      console.warn('[Wellness] Could not save emotional state:', e.message);
    }

    res.status(201).json({ 
      message: 'Wellness alert created', 
      alertId: result.insertId, 
      severity,
      residentName: name
    });
  } catch (error) {
    console.error('[Wellness] Create alert error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/emotions/wellness-alerts/:caretakerId — Get alerts for a caretaker's assigned patients
router.get('/emotions/wellness-alerts/:caretakerId', async (req, res) => {
  try {
    const caretakerId = await resolveCaretakerId(req.params.caretakerId);
    if (!caretakerId) {
      return res.status(404).json({ error: 'Caretaker not found' });
    }

    // Get assigned resident IDs
    const [assignments] = await pool.execute(
      'SELECT resident_id FROM caretaker_residents WHERE caretaker_id = ?',
      [caretakerId]
    );

    if (assignments.length === 0) {
      return res.json([]);
    }

    const residentIds = assignments.map(a => a.resident_id);
    const placeholders = residentIds.map(() => '?').join(',');

    // Fetch unacknowledged alerts for assigned residents (last 24 hours)
    const [alerts] = await pool.execute(
      `SELECT * FROM wellness_alerts 
       WHERE resident_id IN (${placeholders}) 
         AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
       ORDER BY 
         CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
         created_at DESC
       LIMIT 50`,
      residentIds
    );

    res.json(alerts);
  } catch (error) {
    console.error('[Wellness] Fetch alerts error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/emotions/wellness-alerts/:id/acknowledge — Acknowledge an alert
router.put('/emotions/wellness-alerts/:id/acknowledge', async (req, res) => {
  try {
    const { acknowledgedBy } = req.body;

    await pool.execute(
      `UPDATE wellness_alerts SET acknowledged = TRUE, acknowledged_by = ?, acknowledged_at = NOW() WHERE id = ?`,
      [acknowledgedBy || 'Caretaker', req.params.id]
    );

    res.json({ message: 'Alert acknowledged' });
  } catch (error) {
    console.error('[Wellness] Acknowledge error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
