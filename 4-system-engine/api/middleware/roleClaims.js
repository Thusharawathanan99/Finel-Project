import admin from 'firebase-admin';
// SQL changes remain uncommitted until identity/claim updates succeed. Revoking
// sessions is deliberately not undone when a later SQL commit fails.
export async function synchronizeRole(uid, role, expectedEmail) {
  const auth = admin.auth();
  let account;
  try { account = await auth.getUser(uid); }
  catch (error) { if (role === null && error.code === 'auth/user-not-found') return async () => {}; throw error; }
  if (role !== null && (account.disabled || String(account.email || '').toLowerCase() !== String(expectedEmail || '').toLowerCase() ||
      role === 'admin' && !account.emailVerified)) throw new Error('The profile must match an active Firebase identity; administrator email must be verified');
  const previous = account.customClaims || {};
  const claims = { ...previous };
  if (role === null) delete claims.role; else claims.role = role;
  const restore = () => auth.setCustomUserClaims(uid, previous);
  try {
    await auth.setCustomUserClaims(uid, claims);
    await auth.revokeRefreshTokens(uid);
  } catch (error) {
    await restore().catch(() => { console.error('[Users] Claim restoration failed; inspect the exact account before retrying.'); });
    throw error;
  }
  return restore;
}
