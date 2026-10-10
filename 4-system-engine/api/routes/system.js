// System Components API routes
import { Router } from 'express';
import pool from '../db.js';
import { randomUUID } from 'crypto';
import { validText } from '../validation.js';

const router = Router();

// GET /api/system/components — List all system components
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM system_components ORDER BY name');
    res.json(rows);
  } catch (error) {
    console.error('[System] List error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/system/components/:id — Update component status
router.put('/:id', async (req, res) => {
  try {
    if(req.user?.role!=='admin')return res.status(403).json({error:'Only admin can update components'});
    const { status, version, description } = req.body;
    if(status!==undefined&&!['online','offline','maintenance'].includes(status)||version!==undefined&&!validText(version,50,true)||description!==undefined&&!validText(description,10000,true))return res.status(400).json({error:'Provide a valid component status, version and description'});
    const fields = [];
    const values = [];

    if (status) { fields.push('status = ?'); values.push(status); }
    if (version) { fields.push('version = ?'); values.push(version); }
    if (description) { fields.push('description = ?'); values.push(description); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.params.id);
    const [updated]=await pool.execute(`UPDATE system_components SET ${fields.join(', ')} WHERE component_id = ?`, values);
    if(updated.affectedRows===0)return res.status(404).json({error:'Component not found'});

    res.json({ message: 'Component updated' });
  } catch (error) {
    console.error('[System] Update error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admin can add components' });
    const { componentId, name, version, description, status = 'online' } = req.body;
    if (!String(name || '').trim() || !['online', 'offline', 'maintenance'].includes(status)) {
      return res.status(400).json({ error: 'Name and a valid status are required' });
    }
    const id = componentId || `SC-${randomUUID()}`;
    if (String(id).length > 50) return res.status(400).json({ error: 'Invalid component ID' });
    await pool.execute('INSERT INTO system_components (component_id, name, version, description, status) VALUES (?, ?, ?, ?, ?)',
      [id, name.trim(), version || null, description || null, status]);
    return res.status(201).json({ message: 'Component created', componentId: id });
  } catch (error) {
    console.error('[System] Create error:', error.message);
    return res.status(error.code === 'ER_DUP_ENTRY' ? 409 : 500).json({ error: 'Could not create component' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admin can delete components' });
    const [result] = await pool.execute('DELETE FROM system_components WHERE component_id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Component not found' });
    return res.json({ message: 'Component deleted' });
  } catch (error) {
    console.error('[System] Delete error:', error.message);
    return res.status(500).json({ error: 'Could not delete component' });
  }
});

export default router;
