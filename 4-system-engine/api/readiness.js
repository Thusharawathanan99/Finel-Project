export async function readiness(pool, authenticationReady, schemaReady) {
  let database = false, schema = false;
  const controller = new AbortController();
  const timeout = new Promise(resolve => controller.signal.addEventListener('abort', () => resolve(false), { once: true }));
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    database = await Promise.race([pool.execute('SELECT 1').then(() => true).catch(() => false), timeout]);
    if (database) schema = await Promise.race([schemaReady(), timeout]);
    const authentication = Boolean(authenticationReady());
    return { status: database && schema && authentication ? 'ready' : 'unavailable', database, authentication, schema,
      timestamp: new Date().toISOString() };
  } finally { clearTimeout(timer); }
}
