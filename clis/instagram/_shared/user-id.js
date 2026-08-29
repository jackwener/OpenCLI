/**
 * In-page snippet that resolves `username` to a numeric user id in `userId`.
 *
 * `web_profile_info` answers HTTP 400 for business and professional accounts,
 * so the commands that need an id fall back to feed-by-username. Its root
 * `user.pk` is the profile owner; `items[0].user.pk` can be a pinned collab
 * author. Callers must already have `username` and `opts` in scope.
 */
export function buildResolveInstagramUserIdJs() {
    return `
  function normalizeInstagramUserId(value, label) {
    const id = typeof value === 'number' ? String(value) : (typeof value === 'string' ? value.trim() : '');
    if (!/^\\d+$/.test(id)) throw new Error(label);
    return id;
  }
  async function readInstagramJson(response, label) {
    try {
      return await response.json();
    } catch {
      throw new Error(label + ' returned invalid JSON');
    }
  }
  function throwInstagramHttpError(response, label, username) {
    if (response.status === 404) throw new Error('User not found: ' + username);
    if (response.status === 401 || response.status === 403) {
      throw new Error('HTTP ' + response.status + ' - make sure you are logged in to Instagram');
    }
    throw new Error(label + ' failed: HTTP ' + response.status);
  }
  const r1 = await fetch('https://www.instagram.com/api/v1/users/web_profile_info/?username=' + encodeURIComponent(username), opts);
  if (r1.status === 404) throw new Error('User not found: ' + username);
  if (!r1.ok && r1.status !== 400) throwInstagramHttpError(r1, 'Instagram web_profile_info', username);
  let userId = r1.ok ? normalizeInstagramUserId((await readInstagramJson(r1, 'Instagram web_profile_info'))?.data?.user?.id, 'Instagram web_profile_info returned no valid user id for: ' + username) : '';
  if (!userId) {
    const r1b = await fetch('https://www.instagram.com/api/v1/feed/user/' + encodeURIComponent(username) + '/username/?count=1', opts);
    if (!r1b.ok) throwInstagramHttpError(r1b, 'Instagram feed-by-username', username);
    userId = normalizeInstagramUserId((await readInstagramJson(r1b, 'Instagram feed-by-username'))?.user?.pk, 'Instagram feed returned no valid profile owner for: ' + username);
  }`;
}
