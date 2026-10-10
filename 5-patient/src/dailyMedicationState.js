export function localDateKey(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function millisecondsToNextDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime() - date.getTime() + 50;
}

export function medicationStorageKey(uid, date = new Date()) {
  return uid ? '@medications_taken_today_' + encodeURIComponent(uid) + '_' + localDateKey(date) : null;
}

// One in-memory snapshot and one storage key per account and local day.
export function createDailyMedicationStore({ storage, getUid, now = () => new Date(), onChange }) {
  let scope = null;
  let state = new Set();
  let loaded = false;
  let pending = null;
  let generation = 0;
  let writeQueue = Promise.resolve();
  const currentScope = () => medicationStorageKey(getUid(), now());
  const emit = () => onChange(new Set(state));

  async function refresh(force = false) {
    const requestedScope = currentScope();
    if (scope !== requestedScope) {
      scope = requestedScope;
      state = new Set();
      loaded = false;
      pending = null;
      generation += 1;
      emit();
    }
    if (!scope || (loaded && !force)) return new Set(state);
    if (pending && !force) return pending;
    const ticket = ++generation;
    const promise = (async () => {
      const stored = await storage.getItem(requestedScope);
      let values = [];
      try { const parsed = stored ? JSON.parse(stored) : []; values = Array.isArray(parsed) ? parsed : []; } catch { /* Ignore a damaged local snapshot. */ }
      if (scope === requestedScope && currentScope() === requestedScope && ticket === generation) {
        state = new Set(values);
        loaded = true;
        emit();
      }
      return new Set(state);
    })();
    pending = promise;
    try { return await promise; } finally { if (pending === promise) pending = null; }
  }

  function toggle(medicationId) {
    const clickedScope = currentScope();
    const operation = writeQueue.then(async () => {
      await refresh();
      if (!scope || currentScope() !== clickedScope || scope !== clickedScope) return;
      const updated = new Set(state);
      if (updated.has(medicationId)) updated.delete(medicationId); else updated.add(medicationId);
      const previous = state;
      const writeScope = scope;
      state = updated;
      emit();
      try {
        await storage.setItem(writeScope, JSON.stringify([...updated]));
      } catch (error) {
        if (scope === writeScope && state === updated) {
          state = previous;
          emit();
        }
        throw error;
      }
    });
    writeQueue = operation.catch(() => {});
    return operation;
  }

  return { refresh, toggle };
}
