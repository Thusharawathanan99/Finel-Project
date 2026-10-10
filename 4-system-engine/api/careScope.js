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
