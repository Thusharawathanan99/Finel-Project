export const colomboDay = (now = new Date()) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0,10);

// Temporary coverage is derived from approved leave dates, never copied into
// permanent assignments; access expires automatically at Colombo midnight.
export async function effectiveResidentIds(connection, caretakerIds, day = colomboDay()) {
  if (!caretakerIds.length) return [];
  const placeholders=caretakerIds.map(()=>'?').join(',');
  const [rows]=await connection.execute(`SELECT DISTINCT resident_id FROM caretaker_residents
    WHERE caretaker_id IN (${placeholders}) AND NOT EXISTS (SELECT 1 FROM leave_requests l
      WHERE l.caretaker_id=caretaker_residents.caretaker_id AND l.status='approved' AND l.start_date<=? AND l.end_date>=?)
    UNION SELECT DISTINCT cr.resident_id FROM leave_requests l
      JOIN caretaker_residents cr ON cr.caretaker_id=l.caretaker_id
      JOIN caretakers c ON c.caretaker_id=l.caretaker_id AND c.is_active=TRUE
    WHERE l.temporary_replacement IN (${placeholders}) AND l.status='approved' AND l.start_date<=? AND l.end_date>=?
      AND NOT EXISTS (SELECT 1 FROM leave_requests own_leave WHERE own_leave.caretaker_id=l.temporary_replacement
        AND own_leave.status='approved' AND own_leave.start_date<=? AND own_leave.end_date>=?)`,
    [...caretakerIds,day,day,...caretakerIds,day,day,day,day]);
  return [...new Set(rows.map(row=>row.resident_id).filter(Boolean))];
}

export async function effectiveCaretakersForResident(connection, residentId, day = colomboDay()) {
  const [activePermanent] = await connection.execute(`
    SELECT c.caretaker_id, c.name, c.email, c.phone, c.specialization, c.is_active,
           FALSE AS is_temporary_replacement, NULL AS covering_for
    FROM caretakers c
    JOIN caretaker_residents cr ON cr.caretaker_id = c.caretaker_id
    WHERE cr.resident_id = ? AND c.is_active = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM leave_requests l
        WHERE l.caretaker_id = c.caretaker_id AND l.status = 'approved'
          AND l.start_date <= ? AND l.end_date >= ?
      )
  `, [residentId, day, day]);

  const [replacements] = await connection.execute(`
    SELECT rep.caretaker_id, rep.name, rep.email, rep.phone, rep.specialization, rep.is_active,
           TRUE AS is_temporary_replacement, orig.name AS covering_for
    FROM leave_requests l
    JOIN caretaker_residents cr ON cr.caretaker_id = l.caretaker_id
    JOIN caretakers orig ON orig.caretaker_id = l.caretaker_id
    JOIN caretakers rep ON rep.caretaker_id = l.temporary_replacement AND rep.is_active = TRUE
    WHERE cr.resident_id = ? AND l.status = 'approved'
      AND l.start_date <= ? AND l.end_date >= ?
      AND NOT EXISTS (
        SELECT 1 FROM leave_requests own_leave
        WHERE own_leave.caretaker_id = rep.caretaker_id AND own_leave.status = 'approved'
          AND own_leave.start_date <= ? AND own_leave.end_date >= ?
      )
  `, [residentId, day, day, day, day]);

  const all = [...activePermanent, ...replacements];
  const seen = new Set();
  return all.filter(c => {
    if (seen.has(c.caretaker_id)) return false;
    seen.add(c.caretaker_id);
    return true;
  });
}
