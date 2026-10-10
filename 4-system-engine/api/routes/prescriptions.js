// Prescriptions API routes
import { Router } from 'express';
import { validPrescriptionImageReference } from '../prescriptionStorage.js';
import pool from '../db.js';
import { createHash } from 'crypto';
import { canonicalJSON, validDate, validText } from '../validation.js';

const router = Router();
const decoded = value => typeof value === 'string' ? JSON.parse(value) : value;
export function hydrateMedication(med) {
  const evidence = decoded(med.evidence) || {};
  return { ...med, ...evidence, drugName: med.drug_name, needsReview: Boolean(med.needs_review),
    reviewReasons: decoded(med.review_reasons) || [], confirmed: Boolean(med.confirmed) };
}
function prepareMedication(med) {
  const drugName = med?.drugName || med?.drug_name;
  if (!validText(drugName, 255) || !validText(med.dosage, 100, true) || !validText(med.frequency, 255, true) ||
      !validText(med.duration, 100, true) || !validText(med.instructions, 5000, true) || !validText(med.source, 100, true) || !validText(med.route, 100, true) ||
      med.confidence !== undefined && med.confidence !== null && (typeof med.confidence !== 'number' || !Number.isFinite(med.confidence) || med.confidence < 0 || med.confidence > 1)) throw new Error('Invalid medication fields');
  const reviewReasons = med.reviewReasons || med.review_reasons || [];
  if (!Array.isArray(reviewReasons) || reviewReasons.length > 50 || reviewReasons.some(reason => !validText(reason, 1000))) throw new Error('Invalid medication review reasons');
  const evidence = { ...(med.evidence || {}), fieldEvidence: med.fieldEvidence || null, conflictingFields: med.conflictingFields || [],
    rawMatch: med.rawMatch || null, candidates: med.candidates || null, warnings: med.warnings || [], reviewedFields: med.reviewedFields || [] };
  if (canonicalJSON(evidence).length > 100_000) throw new Error('Medication evidence is too large');
  const needsReview = Boolean(med.needsReview || med.needs_review || reviewReasons.length || evidence.conflictingFields?.length ||
    (med.confidence != null && med.confidence < 0.65) || !med.dosage?.trim() || !med.frequency?.trim() || /needs review/i.test(`${med.dosage} ${med.frequency}`));
  const confirmed = med.confirmed === true;
  if (needsReview && !confirmed) throw new Error('Confirm each medication requiring review before saving');
  return { drugName: drugName.trim(), dosage: med.dosage || '', frequency: med.frequency || '', duration: med.duration || '', instructions: med.instructions || '',
    confidence: med.confidence ?? null, needsReview, reviewReasons, evidence, source: med.source || null, route: med.route || null, confirmed };
}

// GET /api/residents/:residentId/prescriptions — List prescriptions for a resident
router.get('/residents/:residentId/prescriptions', async (req, res) => {
  try {
    const [prescriptions] = await pool.execute(
      'SELECT * FROM prescriptions WHERE resident_id = ? ORDER BY date_issued DESC',
      [req.params.residentId]
    );

    for (const rx of prescriptions) {
      const [meds] = await pool.execute(
        'SELECT * FROM medications WHERE prescription_id = ?',
        [rx.prescription_id]
      );
      rx.medications = meds.map(hydrateMedication);
    }

    res.json(prescriptions);
  } catch (error) {
    console.error('[Prescriptions] List error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/prescriptions — Create prescription with medications
router.post('/prescriptions', async (req, res) => {
  let connection;
  try {
    const { prescriptionId, residentId, dateIssued, doctorName, patientName, rawText, imageUrl, imagePath, medications } = req.body;

    if (!validText(prescriptionId, 50) || !validText(residentId, 50) || !validDate(dateIssued) ||
        !validText(doctorName, 255, true) || !validText(patientName, 255, true) || !validText(rawText, 100_000, true) ||
        !validText(imageUrl, 5000, true) || !validText(imagePath, 5000, true)) {
      return res.status(400).json({ error: 'prescriptionId, residentId, and dateIssued are required' });
    }
    if(!validPrescriptionImageReference(residentId,imagePath,imageUrl))return res.status(400).json({error:'Prescription image must use the configured private Firebase bucket and this resident\'s exact storage path'});
    let prepared;
    try { prepared = (medications || []).map(prepareMedication); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    const requestHash = createHash('sha256').update(canonicalJSON({ residentId, dateIssued, doctorName: doctorName || null,
      patientName: patientName || null, rawText: rawText || null, imageUrl: imageUrl || null, imagePath: imagePath || null, medications: prepared })).digest('hex');
    if (medications !== undefined && (!Array.isArray(medications) || medications.length > 100 ||
      medications.some(med => !med || typeof (med.drugName || med.drug_name) !== 'string' || !(med.drugName || med.drug_name).trim()))) {
      return res.status(400).json({ error: 'Provide up to 100 medications with valid drug names' });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [residents] = await connection.execute('SELECT resident_id FROM residents WHERE resident_id = ? FOR UPDATE', [residentId]);
    if (!residents.length) { await connection.rollback(); return res.status(404).json({ error: 'Resident not found' }); }
    const [existing] = await connection.execute('SELECT resident_id, request_hash FROM prescriptions WHERE prescription_id = ? FOR UPDATE', [prescriptionId]);
    if (existing.length) {
      await connection.rollback();
      if (existing[0].resident_id !== residentId || existing[0].request_hash !== requestHash) return res.status(409).json({ error: 'Prescription ID already belongs to different data' });
      return res.json({ message: 'Prescription already saved', prescriptionId, medicationsCount: prepared.length, existing: true });
    }

    // Insert prescription
    await connection.execute(
      'INSERT INTO prescriptions (prescription_id, resident_id, date_issued, doctor_name, patient_name, raw_text, image_url, image_path, request_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [prescriptionId, residentId, dateIssued, doctorName || null, patientName || null, rawText || null, imageUrl || null, imagePath || null, requestHash]
    );

    // Insert medications
    if (prepared.length) {
      for (const med of prepared) {
        await connection.execute(
          'INSERT INTO medications (prescription_id, drug_name, dosage, frequency, duration, instructions, confidence, needs_review, review_reasons, evidence, source, route, confirmed, confirmed_by_uid, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [prescriptionId, med.drugName, med.dosage, med.frequency, med.duration, med.instructions, med.confidence, med.needsReview,
            JSON.stringify(med.reviewReasons), JSON.stringify(med.evidence), med.source, med.route, med.confirmed,
            med.confirmed ? req.user.uid : null, med.confirmed ? new Date() : null]
        );
      }
    }

    await connection.commit();

    res.status(201).json({
      message: 'Prescription created',
      prescriptionId,
      medicationsCount: medications?.length || 0,
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('[Prescriptions] Create error:', error.message);
    res.status(error.code === 'ER_DUP_ENTRY' ? 409 : 500).json({ error: 'Could not save prescription. Existing records were preserved.' });
  } finally {
    connection?.release();
  }
});

// DELETE /api/prescriptions/:prescriptionId/medications — mark one medication as finished
router.delete('/prescriptions/:prescriptionId/medications', async (req, res) => {
  let connection;
  try {
    const { prescriptionId } = req.params;
    const { medicationId, drugName, dosage, frequency } = req.body || {};

    if (!medicationId && !drugName) {
      return res.status(400).json({ error: 'medicationId or drugName is required' });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [prescriptionRows] = await connection.execute(
      'SELECT resident_id FROM prescriptions WHERE prescription_id = ? LIMIT 1 FOR UPDATE',
      [prescriptionId]
    );

    if (!prescriptionRows.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'Prescription not found' });
    }

    const residentId = prescriptionRows[0].resident_id;
    let medicationRow;

    if (medicationId) {
      const [rows] = await connection.execute(
        'SELECT id, drug_name, dosage, frequency FROM medications WHERE id = ? AND prescription_id = ? LIMIT 1 FOR UPDATE',
        [medicationId, prescriptionId]
      );
      medicationRow = rows[0];
    } else {
      const [rows] = await connection.execute(
        'SELECT id, drug_name, dosage, frequency FROM medications WHERE prescription_id = ? AND drug_name = ? AND dosage = ? AND frequency = ? LIMIT 1 FOR UPDATE',
        [prescriptionId, drugName, dosage || '', frequency || '']
      );
      medicationRow = rows[0];
    }

    if (!medicationRow) {
      await connection.rollback();
      return res.status(404).json({ error: 'Medication not found' });
    }

    const finishedAt = new Date();
    const [insertResult] = await connection.execute(
      'INSERT INTO finished_medications (resident_id, prescription_id, drug_name, dosage, frequency, finished_at) VALUES (?, ?, ?, ?, ?, ?)',
      [residentId, prescriptionId, medicationRow.drug_name, medicationRow.dosage || '', medicationRow.frequency || '', finishedAt]
    );

    await connection.execute(
      'DELETE FROM medications WHERE id = ? AND prescription_id = ? LIMIT 1',
      [medicationRow.id, prescriptionId]
    );

    await connection.commit();

    res.json({
      message: 'Medication marked as finished',
      finishedMedication: {
        id: insertResult.insertId,
        residentId,
        prescriptionId,
        drugName: medicationRow.drug_name,
        dosage: medicationRow.dosage || '',
        frequency: medicationRow.frequency || '',
        finishedAt: finishedAt.toISOString(),
      },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('[Prescriptions] Finish medication error:', error.message);
    res.status(500).json({ error: 'Could not finish medication. Existing records were preserved.' });
  } finally {
    connection?.release();
  }
});

// DELETE /api/prescriptions/:id — Delete prescription (cascade deletes medications)
router.delete('/prescriptions/:id', async (req, res) => {
  try {
    const [result] = await pool.execute(
      'DELETE FROM prescriptions WHERE prescription_id = ?',
      [req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Prescription not found' });
    }

    res.json({ message: 'Prescription deleted' });
  } catch (error) {
    console.error('[Prescriptions] Delete error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
