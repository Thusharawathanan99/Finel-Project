import {useEffect, useRef} from 'react';
import {AppState} from 'react-native';
export function useScreenRefresh(navigation, refresh) {
  const latest = useRef(refresh); latest.current = refresh;
  useEffect(() => {
    let active = true, pending = false;
    const load = async () => { if (!active || pending) return; pending=true; try { await latest.current(); } finally { pending=false; } };
    load();
    const unsubscribe = navigation?.addListener?.('focus', load);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') load(); });
    return () => { active=false; unsubscribe?.(); subscription.remove(); };
  }, [navigation]);
}
