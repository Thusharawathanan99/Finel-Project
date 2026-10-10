// Extraction is provisional until someone checks it against the prescription.
export function medicationDetailsComplete(medication) {
  return ['drugName', 'dosage', 'frequency'].every(field => {
    const value = medication?.[field];
    return typeof value === 'string' && value.trim().length > 0 &&
      !/^(needs review|unknown|not found|n\/a)$/i.test(value.trim());
  });
}

export function medicationReadyToSave(medication) {
  return medicationDetailsComplete(medication) && medication.reviewed === true;
}

export function editMedication(medication, field, value) {
  return { ...medication, [field]: value, reviewed: false };
}
