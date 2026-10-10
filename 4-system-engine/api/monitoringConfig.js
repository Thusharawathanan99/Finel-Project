// These are prototype operating settings, not clinically validated thresholds.
export const DEFAULT_SETTINGS = Object.freeze({
  inactivitySeconds: 300, fallDropThreshold: 0.40, fallWindowSeconds: 1,
  fallConfirmSeconds: 1, minPoseVisibility: 0.75, eventIntervalSeconds: 30,
  maxObservationGapSeconds: 1, walkingSpeed: 0.12, restingSeconds: 30,
  wanderingSeconds: 180, wanderingBodyLengths: 6, offlineTimeoutSeconds: 90,
});
export const parseJSON = value => {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
};
export const isEnabled = value => value === true || Number(value) === 1;
export const validInstant = value => typeof value === 'string' &&
  /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value));
export function validatedSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Settings must be an object');
  const bounds = { inactivitySeconds: [30, 86400], fallDropThreshold: [0.05, 0.8],
    fallWindowSeconds: [0.1, 5], fallConfirmSeconds: [0.3, 10], minPoseVisibility: [0.4, 1],
    eventIntervalSeconds: [1, 300], maxObservationGapSeconds: [0.1, 2], walkingSpeed: [0.01, 3],
    restingSeconds: [5, 3600], wanderingSeconds: [30, 86400], wanderingBodyLengths: [1, 100], offlineTimeoutSeconds: [30, 3600] };
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'enabledActivities') {
      const allowed = ['walking','sitting','standing','lying','resting','inactivity','wandering','collapse','fall','abnormal_movement','restricted_entry','unknown'];
      if (!Array.isArray(value) || value.length > allowed.length || value.some(x => !allowed.includes(x))) throw new Error('Invalid enabled activities');
      result[key] = [...new Set(value)];
    } else {
      const range = bounds[key];
      if (!range || !Number.isFinite(value) || value < range[0] || value > range[1]) throw new Error(`Invalid setting: ${key}`);
      result[key] = value;
    }
  }
  return result;
}
export function validPolygon(value) {
  return Array.isArray(value) && value.length >= 3 && value.length <= 20 &&
    value.every(point => Array.isArray(point) && point.length === 2 && point.every(n => Number.isFinite(n) && n >= 0 && n <= 1));
}
