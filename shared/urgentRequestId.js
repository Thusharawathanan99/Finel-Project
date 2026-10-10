// Idempotency identifiers are generated from secure browser randomness; they
// contain no patient data and are never used as authentication credentials.
export function createUrgentRequestId(cryptoApi=globalThis.crypto) {
  if(typeof cryptoApi?.randomUUID==='function') {
    try {const id=cryptoApi.randomUUID();if(typeof id==='string'&&/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(id))return id.toLowerCase();} catch { /* Fall back to secure random bytes. */ }
  }
  if(typeof cryptoApi?.getRandomValues!=='function')throw Error('SECURE_RANDOM_UNAVAILABLE');
  const bytes=new Uint8Array(16);cryptoApi.getRandomValues(bytes);
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
  return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
}
