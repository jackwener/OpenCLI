import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'instagram',
    name: 'following',
    access: 'read',
    description: 'List accounts an Instagram user is following',
    domain: 'www.instagram.com',
    args: [
        { name: 'username', required: true, positional: true, help: 'Instagram username' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of accounts' },
    ],
    columns: ['rank', 'username', 'name', 'verified', 'private'],
    pipeline: [
        { navigate: 'https://www.instagram.com' },
        { evaluate: `(async () => {
  const username = \${{ args.username | json }};
  const limit = \${{ args.limit }};
  if (!Number.isInteger(limit) || limit < 1) throw new Error('limit must be a positive integer');
  const headers = { 'X-IG-App-ID': '936619743392459' };
  const opts = { credentials: 'include', headers };

  const r1 = await fetch(
    'https://www.instagram.com/api/v1/users/web_profile_info/?username=' + encodeURIComponent(username),
    opts
  );
  if (!r1.ok) throw new Error('HTTP ' + r1.status + ' - make sure you are logged in to Instagram');
  const d1 = await r1.json();
  const userId = d1?.data?.user?.id;
  if (!userId) throw new Error('User not found: ' + username);

  const PAGE_SIZE = 50;
  const results = [];
  const seen = new Set();
  const seenCursors = new Set();
  let maxId = undefined;
  const baseUrl = 'https://www.instagram.com/api/v1/friendships/' + userId + '/following/';

  while (results.length < limit) {
    const params = new URLSearchParams({ count: String(PAGE_SIZE) });
    if (maxId) params.set('max_id', maxId);
    const r2 = await fetch(baseUrl + '?' + params.toString(), opts);
    if (!r2.ok) throw new Error('Failed to fetch following: HTTP ' + r2.status);
    const d2 = await r2.json();
    if (!d2 || typeof d2 !== 'object' || !Array.isArray(d2.users)) {
      throw new Error('Instagram following returned malformed users payload');
    }
    const users = d2.users;
    const sizeBefore = results.length;
    for (const u of users) {
      if (!u || typeof u !== 'object') {
        throw new Error('Instagram following returned malformed user row');
      }
      const pk = String(u.pk ?? u.pk_id ?? u.id ?? '');
      const usernameValue = typeof u.username === 'string' ? u.username.trim() : '';
      if (!pk || !usernameValue) {
        throw new Error('Instagram following returned malformed user row');
      }
      if (!pk || seen.has(pk)) continue;
      seen.add(pk);
      results.push({
        rank: results.length + 1,
        username: usernameValue,
        name: typeof u.full_name === 'string' ? u.full_name : '',
        verified: u.is_verified ? 'Yes' : 'No',
        private: u.is_private ? 'Yes' : 'No',
      });
      if (results.length >= limit) break;
    }
    if (results.length >= limit) break;
    if (results.length === sizeBefore) break;  // no new unique users this page
    if (d2.next_max_id != null && typeof d2.next_max_id !== 'string' && typeof d2.next_max_id !== 'number') {
      throw new Error('Instagram following returned malformed pagination cursor');
    }
    if (d2.has_more != null && typeof d2.has_more !== 'boolean') {
      throw new Error('Instagram following returned malformed has_more flag');
    }
    const nextCursor = d2.next_max_id == null ? '' : String(d2.next_max_id);
    const hasMore = typeof d2.has_more === 'boolean' ? d2.has_more : !!nextCursor;
    if (!hasMore || users.length === 0) break;
    if (!nextCursor) throw new Error('Instagram following returned has_more without pagination cursor');
    if (seenCursors.has(nextCursor)) break;  // cursor loop guard
    seenCursors.add(nextCursor);
    maxId = nextCursor;
    await new Promise(r => setTimeout(r, 400));
  }
  return results.slice(0, limit);
})()
` },
    ],
});
