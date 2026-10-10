export async function resolveInitialSession({ auth, user, apiFetch, expectedRole, requireResident = false }) {
  if (!user) return { route: 'Login', invalidate: false };

  const assertCurrentUser = () => {
    if (auth.currentUser?.uid !== user.uid) throw new Error('Your session changed. Please try again.');
  };

  const response = await apiFetch(`/users/${encodeURIComponent(user.uid)}`);
  assertCurrentUser();
  if ([401, 403, 404].includes(response.status)) {
    return { route: 'Login', invalidate: true };
  }
  if (!response.ok) {
    throw new Error('CareConnect could not verify your saved session. Check your connection and try again.');
  }

  const profile = await response.json();
  assertCurrentUser();
  if (profile.role !== expectedRole || (requireResident && !profile.resident_id)) {
    return { route: 'Login', invalidate: true };
  }
  return { route: 'Dashboard', invalidate: false };
}
