// Pure reconciliation shared by the API and browser prescription readers.
// Confidence describes extraction evidence, never clinical approval of a dose.
const FIELDS = ['dosage', 'frequency', 'duration', 'instructions', 'route'];
const WEIGHTS = { donut: 0.40, regex: 0.25, gemini: 0.35 };
const SOURCE_ORDER = ['gemini', 'donut', 'regex'];
const MISSING = new Set(['', 'needs review', 'missing', 'n/a', 'unknown', 'not specified', 'not available', 'none', '-', 'as directed', 'follow doctor guidance']);
const ABBREVIATIONS = { bid: 'twice daily', tid: 'three times daily', qid: 'four times daily', qd: 'once daily', od: 'once daily', prn: 'as needed', hs: 'at bedtime', qhs: 'at bedtime', qam: 'every morning', qpm: 'every evening', qwk: 'once weekly', pc: 'after meals', ac: 'before meals' };

export function cleanPrescriptionField(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return MISSING.has(text.toLowerCase().replace(/\s+/g, ' ')) ? '' : text;
}

export function parseRegimenTail(raw, abbreviations = ABBREVIATIONS) {
  const original = typeof raw === 'string' ? raw.trim() : '';
  let frequency = original;
  const durationMatch = frequency.match(/\b(?:for\s+|x\s*)?(\d+\s*(?:days?|weeks?|months?))\b/i);
  const duration = durationMatch ? durationMatch[1].trim() : 'As directed';
  if (durationMatch) frequency = frequency.replace(durationMatch[0], ' ');
  // Include negation in the captured instruction; never turn "do not take with food" into "with food".
  const foodPattern = /\b(?:(?:do\s+not|must\s+not|don't|never|not|avoid)\s+(?:(?:take|consume|use)\s+)?)?(?:after|before|with)\s+(?:(?:a\s+)?(?:full\s+)?glass\s+of\s+)?(?:meals?|food|breakfast|lunch|dinner|water)\b/gi;
  const foodInstructions = [...frequency.matchAll(foodPattern)].map(match => match[0].trim());
  frequency = frequency.replace(foodPattern, ' ');
  const instructions = foodInstructions.join(', ') || 'Follow doctor guidance';
  frequency = frequency.replace(/\b(?:po|oral|im|iv|sc|sl|inh|top)\b/gi, ' ').replace(/\s+/g, ' ').replace(/^[,;:\s]+|[,;:\s]+$/g, '').trim();
  const schedule = frequency.match(/^(\d+(?:\.\d+)?|\.\d+)\s*-\s*(\d+(?:\.\d+)?|\.\d+)\s*-\s*(\d+(?:\.\d+)?|\.\d+)$/);
  let recognized = false;
  if (schedule) {
    const parts = [];
    if (Number(schedule[1]) !== 0) parts.push(`${schedule[1]} in the morning`);
    if (Number(schedule[2]) !== 0) parts.push(`${schedule[2]} in the afternoon`);
    if (Number(schedule[3]) !== 0) parts.push(`${schedule[3]} at night`);
    frequency = parts.join(', ');
    recognized = parts.length > 0;
  } else {
    frequency = frequency.split(/\s+/).map(word => abbreviations[word.toLowerCase().replace(/[.,;:]/g, '')] || word).join(' ');
    recognized = /^(?:(?:once|twice|three times|four times) daily|at bedtime|as needed|every (?:morning|evening)|once weekly|every \d+ hours?|q\d+h|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:[, /]+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))*)$/i.test(frequency);
  }
  const negated = /\b(?:not|never|avoid)\b/i.test(original);
  return { frequency: frequency || 'Needs Review', duration, instructions, needsReview: !recognized || negated,
    reviewReasons: !recognized ? ['The written schedule requires verification.'] : negated ? ['Verify the complete negative instruction against the prescription.'] : [] };
}

function comparable(value) {
  return cleanPrescriptionField(value).toLowerCase()
    .replace(/\b(bid|tid|qid|qd|od|prn|hs|qhs|qam|qpm|qwk|pc|ac)\b/g, word => ABBREVIATIONS[word])
    .replace(/\b(?:per day|daily)\b/g, 'daily')
    .replace(/\b(?:once a day|once per day)\b/g, 'once daily')
    .replace(/[^a-z0-9.]+/g, '');
}

function key(candidate) {
  return FIELDS.map(field => comparable(candidate[field])).join('|');
}

function rank(a, b) {
  return b.confidence - a.confidence || SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source);
}

function agrees(a, b) {
  return FIELDS.every(field => !comparable(a[field]) || !comparable(b[field]) || comparable(a[field]) === comparable(b[field]));
}

function splitRegimens(candidates) {
  const bySource = new Map();
  for (const candidate of candidates) {
    if (!bySource.has(candidate.source)) bySource.set(candidate.source, new Map());
    const entries = bySource.get(candidate.source);
    if (!entries.has(key(candidate))) entries.set(key(candidate), []);
    entries.get(key(candidate)).push(candidate);
  }
  const sources = [...bySource.entries()].sort((a, b) => b[1].size - a[1].size || SOURCE_ORDER.indexOf(a[0]) - SOURCE_ORDER.indexOf(b[0]));
  // Disjoint named weekdays can describe separate doses even when each source
  // read only one line. Keep both as uncorroborated regimens requiring review.
  if (sources[0][1].size === 1) {
    const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const scheduled = candidates.map(candidate => ({ candidate, days: weekdays.filter(day => new RegExp(`\\b${day}\\b`, 'i').test(candidate.frequency || '')) }));
    const schedules = new Map(scheduled.map(entry => [entry.days.join(','), entry.days]));
    const days = [...schedules.values()];
    const disjoint = days.length > 1 && days.every(list => list.length) && days.every((list, index) => days.slice(index + 1).every(other => !list.some(day => other.includes(day))));
    if (disjoint) return [...schedules.keys()].map(schedule => ({ candidates: scheduled.filter(entry => entry.days.join(',') === schedule).map(entry => entry.candidate), ambiguous: true }));
    return [{ candidates, ambiguous: false }];
  }

  // A source containing multiple regimens is evidence that each must survive.
  const [referenceSource, reference] = sources[0];
  const groups = [...reference.values()].map(entries => ({ candidates: [...entries], ambiguous: false }));
  for (const candidate of candidates.filter(entry => entry.source !== referenceSource)) {
    let matches = groups.filter(group => group.candidates.some(entry => key(entry) === key(candidate)));
    if (!matches.length) matches = groups.filter(group => group.candidates.some(entry => agrees(entry, candidate)));
    // A matching schedule aligns a differing dose to the correct regimen,
    // so the disagreement is reviewed instead of becoming a confident extra dose.
    if (!matches.length && comparable(candidate.frequency)) matches = groups.filter(group => group.candidates.some(entry => comparable(entry.frequency) === comparable(candidate.frequency)));
    if (!matches.length && comparable(candidate.dosage)) matches = groups.filter(group => group.candidates.some(entry => comparable(entry.dosage) === comparable(candidate.dosage)));
    if (matches.length === 1) {
      matches[0].candidates.push(candidate);
    } else {
      // Keep unmatched evidence and all reference regimens, with explicit review.
      groups.forEach(group => { group.ambiguous = true; });
      groups.push({ candidates: [candidate], ambiguous: true });
    }
  }
  return groups;
}

export function reconcileCandidates(candidates, canonicalDrugName = name => name) {
  const drugs = new Map();
  for (const input of Array.isArray(candidates) ? candidates : []) {
    if (!input || typeof input.drugName !== 'string' || !input.drugName.trim() || !Number.isFinite(input.confidence)) continue;
    const name = canonicalDrugName(input.drugName.trim());
    const drugKey = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!drugKey) continue;
    const candidate = { ...input, drugName: name, originalDrugName: input.drugName.trim(), route: cleanPrescriptionField(input.route || input.extra?.route), confidence: Math.max(0, Math.min(1, input.confidence)) };
    if (!drugs.has(drugKey)) drugs.set(drugKey, []);
    drugs.get(drugKey).push(candidate);
  }

  const results = [];
  for (const drug of drugs.values()) {
    for (const { candidates: regimen, ambiguous } of splitRegimens(drug)) {
      const best = [...regimen].sort(rank)[0];
      const conflicts = FIELDS.filter(field => new Set(regimen.map(candidate => comparable(candidate[field])).filter(Boolean)).size > 1);
      const sourceDetails = {};
      const strongest = new Map();
      for (const candidate of regimen) {
        const prior = strongest.get(candidate.source);
        if (!prior || candidate.confidence > prior.confidence) strongest.set(candidate.source, candidate);
        if (!sourceDetails[candidate.source]) sourceDetails[candidate.source] = { confidence: 0, candidates: [] };
        const evidence = { drugName: candidate.originalDrugName, dosage: candidate.dosage || '', frequency: candidate.frequency || '', duration: candidate.duration || '', instructions: candidate.instructions || '', route: candidate.route || candidate.extra?.route || '', confidence: candidate.confidence, needsReview: Boolean(candidate.needsReview), rawMatch: candidate.rawMatch || candidate.extra?.rawMatch || '' };
        sourceDetails[candidate.source].confidence = Math.max(sourceDetails[candidate.source].confidence, candidate.confidence);
        sourceDetails[candidate.source].candidates.push(evidence);
        if (candidate.extra?.drugClass) sourceDetails[candidate.source].drugClass = candidate.extra.drugClass;
        if (candidate.extra?.warnings) sourceDetails[candidate.source].warnings = candidate.extra.warnings;
      }
      const sources = [...strongest.keys()];
      let weighted = 0, weight = 0;
      for (const candidate of strongest.values()) {
        const sourceWeight = WEIGHTS[candidate.source] || 0.25;
        weighted += candidate.confidence * sourceWeight;
        weight += sourceWeight;
      }
      // Regex reads the OCR text; it is not an independent image observation.
      const independentSources = new Set([...strongest.values()]
        .filter(candidate => comparable(candidate.dosage) && comparable(candidate.frequency) &&
          comparable(candidate.dosage) === comparable(best.dosage) && comparable(candidate.frequency) === comparable(best.frequency))
        .map(candidate => candidate.source === 'regex' ? 'donut' : candidate.source)).size;
      const baseConfidence = weight ? weighted / weight : 0;
      const conflict = conflicts.length > 0 || ambiguous;
      const confidence = conflict ? Math.min(0.64, baseConfidence) : Math.min(0.99, baseConfidence * (independentSources > 1 ? 1.15 : 1));
      const dosage = cleanPrescriptionField(best.dosage) || 'Needs Review';
      const frequency = cleanPrescriptionField(best.frequency) || 'Needs Review';
      const reviewReasons = [];
      if (conflicts.length) reviewReasons.push(`Conflicting ${conflicts.join(', ')} readings; verify against the prescription.`);
      if (ambiguous) reviewReasons.push('Multiple regimens could not be aligned across extraction sources.');
      if (dosage === 'Needs Review' || frequency === 'Needs Review') reviewReasons.push('Dose or schedule is missing or uncertain.');
      if (best.needsReview) reviewReasons.push('The selected extraction requires review.');
      if (confidence < 0.65) reviewReasons.push('Extraction confidence is below the review threshold.');
      const fallbackField = field => [...regimen].sort(rank).map(candidate => cleanPrescriptionField(candidate[field])).find(Boolean) || '';
      results.push({ drugName: best.drugName, dosage, frequency, duration: fallbackField('duration') || 'As directed', instructions: fallbackField('instructions') || 'Follow doctor guidance', route: fallbackField('route'), confidence, needsReview: reviewReasons.length > 0, reviewReasons, conflictingFields: conflicts, sources, sourceDetails });
    }
  }
  // Low confidence entries remain visible for review; never silently lose a dose.
  return results.sort((a, b) => b.confidence - a.confidence);
}
