/**
 * CTC (Connectionist Temporal Classification) Decoder
 * Decodes the raw CRNN output probabilities into readable text.
 */

// Standard character set for prescription text recognition
const CHARSET = [
  '', // CTC blank token (index 0)
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j',
  'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't',
  'u', 'v', 'w', 'x', 'y', 'z',
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
  'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T',
  'U', 'V', 'W', 'X', 'Y', 'Z',
  ' ', '.', ',', '-', '/', '(', ')', ':', ';', '#',
  '%', '+', '=', '@', '&', '!', '?', '\'', '"',
];

export const BLANK_INDEX = 0;

/**
 * Greedy CTC decoder — picks the most probable character at each timestep,
 * then collapses duplicates and removes blanks.
 */
export function greedyDecode(logits: Float32Array, timesteps: number, numClasses: number): string {
  const indices: number[] = [];

  for (let t = 0; t < timesteps; t++) {
    let maxIdx = 0;
    let maxVal = -Infinity;
    for (let c = 0; c < numClasses; c++) {
      const val = logits[t * numClasses + c];
      if (val > maxVal) {
        maxVal = val;
        maxIdx = c;
      }
    }
    indices.push(maxIdx);
  }

  // Collapse consecutive duplicate indices, then remove blanks
  const collapsed: number[] = [];
  let prev = -1;
  for (const idx of indices) {
    if (idx !== prev) {
      if (idx !== BLANK_INDEX) {
        collapsed.push(idx);
      }
      prev = idx;
    }
  }

  return collapsed.map(idx => CHARSET[idx] || '').join('');
}

/**
 * Compute per-character confidence scores from the logit probabilities.
 * Returns the average probability of the selected characters.
 */
export function computeConfidence(logits: Float32Array, timesteps: number, numClasses: number): number {
  let totalConf = 0;
  let count = 0;

  for (let t = 0; t < timesteps; t++) {
    // Softmax for this timestep
    let maxVal = -Infinity;
    for (let c = 0; c < numClasses; c++) {
      const val = logits[t * numClasses + c];
      if (val > maxVal) maxVal = val;
    }

    let expSum = 0;
    for (let c = 0; c < numClasses; c++) {
      expSum += Math.exp(logits[t * numClasses + c] - maxVal);
    }

    // Get the probability of the most likely class
    let bestProb = 0;
    let bestIdx = 0;
    for (let c = 0; c < numClasses; c++) {
      const prob = Math.exp(logits[t * numClasses + c] - maxVal) / expSum;
      if (prob > bestProb) {
        bestProb = prob;
        bestIdx = c;
      }
    }

    // Only count non-blank predictions
    if (bestIdx !== BLANK_INDEX) {
      totalConf += bestProb;
      count++;
    }
  }

  return count > 0 ? totalConf / count : 0;
}

/**
 * Beam search CTC decoder — explores top-k paths for better accuracy.
 * More computationally expensive but produces better results.
 */
export function beamSearchDecode(
  logits: Float32Array,
  timesteps: number,
  numClasses: number,
  beamWidth: number = 10
): { text: string; score: number }[] {
  interface Beam {
    sequence: number[];
    lastRawIndex: number;
    score: number;
  }

  let beams: Beam[] = [{ sequence: [], lastRawIndex: -1, score: 1.0 }];

  for (let t = 0; t < timesteps; t++) {
    // Softmax for this timestep
    let maxVal = -Infinity;
    for (let c = 0; c < numClasses; c++) {
      const val = logits[t * numClasses + c];
      if (val > maxVal) maxVal = val;
    }
    let expSum = 0;
    const probs: number[] = [];
    for (let c = 0; c < numClasses; c++) {
      const p = Math.exp(logits[t * numClasses + c] - maxVal);
      probs.push(p);
      expSum += p;
    }
    for (let c = 0; c < numClasses; c++) {
      probs[c] /= expSum;
    }

    // Get top-k classes for this timestep
    const topK = probs
      .map((p, i) => ({ prob: p, idx: i }))
      .sort((a, b) => b.prob - a.prob)
      .slice(0, beamWidth);

    const newBeams: Beam[] = [];
    for (const beam of beams) {
      for (const { prob, idx } of topK) {
        const newSequence = [...beam.sequence];

        if (idx !== beam.lastRawIndex) {
          if (idx !== BLANK_INDEX) {
            newSequence.push(idx);
          }
        }

        newBeams.push({
          sequence: newSequence,
          lastRawIndex: idx,
          score: beam.score * prob,
        });
      }
    }

    // Merge duplicate paths with the same decoded sequence and lastRawIndex
    const mergedMap = new Map<string, Beam>();
    for (const b of newBeams) {
      const key = `${b.sequence.join(',')}|${b.lastRawIndex}`;
      const existing = mergedMap.get(key);
      if (existing) {
        existing.score += b.score;
      } else {
        mergedMap.set(key, { ...b });
      }
    }

    // Keep only top beamWidth beams
    beams = Array.from(mergedMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, beamWidth);
  }

  return beams.map(beam => ({
    text: beam.sequence.map(idx => CHARSET[idx] || '').join(''),
    score: beam.score,
  }));
}

export { CHARSET };
