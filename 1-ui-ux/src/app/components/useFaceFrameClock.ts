import { useEffect, useState } from 'react';
import type { TrackedLiveFrame } from '../../../../shared/liveFace';
import { LIVE_FACE_QUALITY_THRESHOLDS } from '../../../../shared/liveFaceQuality';

export function isFaceFrameStale(frame: TrackedLiveFrame | null, now: number): boolean {
  if (!frame) return false;
  const captured = Date.parse(frame.capturedAt);
  return !Number.isFinite(captured) || !Number.isFinite(now) ||
    now - captured > LIVE_FACE_QUALITY_THRESHOLDS.staleAfterMs;
}

// This clock keeps aging when inference stalls. It never captures or uploads.
export function useFaceFrameClock(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
