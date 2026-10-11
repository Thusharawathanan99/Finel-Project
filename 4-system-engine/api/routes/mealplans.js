import { Router } from 'express';
import pool from '../db.js';
import { canAccessResident } from '../middleware/authorization.js';
import { normalizeMealContext, mealPlanFingerprint, validateWeeklyMealPlan, MEAL_SLOTS } from './mealPlanSafety.js';
const router = Router();
const list = value => {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (parsed == null) return [];
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) throw new Error('Invalid resident planning records');
  return parsed;
};
export async function residentMealContext(residentId, calorieTarget = 2000) {
  const [rows] = await pool.execute('SELECT resident_id, name, age, allergies, dietary_restrictions, medical_history FROM residents WHERE resident_id = ?', [residentId]);
  if (!rows.length) throw new Error('Resident not found');
  const [medications] = await pool.execute('SELECT m.drug_name AS name, m.dosage, m.frequency, m.instructions, m.route FROM medications m JOIN prescriptions p ON p.prescription_id = m.prescription_id WHERE p.resident_id = ? ORDER BY m.id', [residentId]);
  const resident = rows[0];
  return normalizeMealContext({ residentId, residentName: resident.name, age: resident.age || 0, medications,
    allergies: list(resident.allergies), dietaryRestrictions: list(resident.dietary_restrictions), medicalHistory: resident.medical_history || '', calorieTarget });
}
router.get('/residents/:residentId/meal-plan', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT plan_json, medication_count, generated_at FROM meal_plans WHERE resident_id = ?', [req.params.residentId]);
    if (!rows.length) return res.json({ plan: null });
    let plan;
    try { plan = JSON.parse(rows[0].plan_json); } catch { return res.json({ plan: null, stale: true }); }
    const current = await residentMealContext(req.params.residentId, plan.inputContext?.calorieTarget);
    if (plan.inputFingerprint !== mealPlanFingerprint(current)) return res.json({ plan: null, stale: true, reason: 'Resident or medication information changed. Generate a new plan.' });
    try { plan = validateWeeklyMealPlan(plan, current); } catch { return res.json({ plan: null, stale: true, reason: 'Saved plan requires regeneration.' }); }
    plan.generatedAt = rows[0].generated_at;
    return res.json({ plan, medicationCount: current.medications.length, generatedAt: rows[0].generated_at });
  } catch { return res.status(500).json({ error: 'Meal plan could not be retrieved' }); }
});
router.post('/residents/:residentId/meal-plan', async (req, res) => {
  try {
    const input = req.body?.plan;
    if (!input || typeof input !== 'object' || JSON.stringify(input).length > 1_000_000) return res.status(400).json({ error: 'Provide a complete meal plan under 1 MB' });
    const current = await residentMealContext(req.params.residentId, input.inputContext?.calorieTarget);
    if (input.inputFingerprint !== mealPlanFingerprint(current)) return res.status(409).json({ error: 'Planning information changed. Generate a new plan before saving.' });
    let plan;
    try { plan = validateWeeklyMealPlan(input, current); } catch (error) { return res.status(400).json({ error: error.message }); }
    await pool.execute('INSERT INTO meal_plans (resident_id, plan_json, medication_count, generated_at) VALUES (?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE plan_json = VALUES(plan_json), medication_count = VALUES(medication_count), generated_at = NOW()',
      [req.params.residentId, JSON.stringify(plan), current.medications.length]);
    return res.json({ message: 'Meal plan saved', residentId: req.params.residentId });
  } catch { return res.status(500).json({ error: 'Meal plan could not be saved' }); }
});
router.delete('/residents/:residentId/meal-plan', async (req, res) => {
  try {
    await pool.execute('DELETE FROM meal_plans WHERE resident_id = ?', [req.params.residentId]);
    return res.json({ message: 'Meal plan deleted', residentId: req.params.residentId });
  } catch { return res.status(500).json({ error: 'Meal plan could not be deleted' }); }
});
export function mobileMealPlan(plan) {
  const shorts = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return { ...plan, clinicalNotes: [plan.dietaryNotes, ...plan.medicationConsiderations, ...plan.reviewReasons],
    days: Object.fromEntries(plan.days.map((day, index) => [shorts[index], { meals: MEAL_SLOTS.map(slot => ({ ...day[slot], id: slot,
      label: { breakfast: 'Breakfast', morningSnack: 'Morning Snack', lunch: 'Lunch', afternoonSnack: 'Afternoon Snack', dinner: 'Dinner' }[slot] })) }])) };
}
router.post('/generate-meal-plan', async (req, res) => {
  const body = req.body || {};
  if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 100_000 ||
      body.medications !== undefined && (typeof body.medications !== 'string' || body.medications.length > 20_000)) {
    return res.status(400).json({ error: 'Provide a bounded text prompt and optional medication text' });
  }
  const residentId = body.residentId || req.user?.profile?.resident_id;
  if (!canAccessResident(req, residentId)) return res.status(403).json({ error: 'Select an assigned resident for meal planning' });
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  if (!key || !/^[a-z0-9][a-z0-9.-]{1,79}$/i.test(model)) return res.status(503).json({ error: 'Meal generation is unavailable. Ask your care team for a suitable meal plan.', code: 'MEAL_ANALYSIS_UNAVAILABLE' });
  let current;
  try { current = await residentMealContext(residentId, body.inputContext?.calorieTarget ?? body.calorieTarget); }
  catch { return res.status(400).json({ error: 'Complete resident planning information is required' }); }
  const prompt = `Prepare a varied seven-day draft meal plan for caregiver review using this resident context: ${JSON.stringify(current)}.
Respect ALL declared allergies, dietary restrictions and medication food/timing instructions. Do not invent a clinically verified diet or diagnosis.
Return raw JSON: {"days":[{"day":"Monday","breakfast":MEAL,"morningSnack":MEAL,"lunch":MEAL,"afternoonSnack":MEAL,"dinner":MEAL}, ...Tuesday through Sunday],"dietaryNotes":"review guidance","medicationConsiderations":["specific considerations requiring review"]}.
Each MEAL requires name,description,rationale,ingredients(string list listing every ingredient),calories,protein,carbs,fat,fiber(all finite numeric estimates),tags(string list),warnings(string list). No placeholder meals. Input calorie target is ${current.calorieTarget}.`;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45_000);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, signal: controller.signal,
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 16384 } }) });
      if (!result.ok) { if (attempt === 0 && (result.status === 429 || result.status >= 500)) continue; throw new Error('Provider unavailable'); }
      const data = await result.json(), candidate = data.candidates?.[0];
      if (candidate?.finishReason === 'MAX_TOKENS') throw new Error('Incomplete plan');
      const text = candidate?.content?.parts?.filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join('\n');
      if (!text || text.length > 1_000_000) throw new Error('Invalid plan');
      const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
      const plan = validateWeeklyMealPlan(parsed, current);
      return res.json({ plan: mobileMealPlan(plan), canonicalPlan: plan, source: 'gemini', reviewRequired: true });
    }
    throw new Error('Provider unavailable');
  } catch { return res.status(503).json({ error: 'A complete suitable meal plan could not be generated. Please retry or ask your care team.', code: 'MEAL_ANALYSIS_UNAVAILABLE' }); }
  finally { clearTimeout(timer); }
});
export default router;
