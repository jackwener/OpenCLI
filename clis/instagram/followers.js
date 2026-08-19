import { cli } from '@jackwener/opencli/registry';
import { buildResolveInstagramUserIdJs } from './_shared/user-id.js';
cli({
    site: 'instagram',
    name: 'followers',
    access: 'read',
    description: 'List followers of an Instagram user',
    domain: 'www.instagram.com',
    args: [
        { name: 'username', required: true, positional: true, help: 'Instagram username' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of followers' },
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

  ${buildResolveInstagramUserIdJs()}

  const r2 = await fetch(
    'https://www.instagram.com/api/v1/friendships/' + userId + '/followers/?count=' + limit,
    opts
  );
  if (!r2.ok) throw new Error('Failed to fetch followers: HTTP ' + r2.status);
  const d2 = await r2.json();
  if (!d2 || typeof d2 !== 'object' || !Array.isArray(d2.users)) {
    throw new Error('Instagram followers returned malformed users payload');
  }
  return d2.users.slice(0, limit).map((u, i) => {
    if (!u || typeof u !== 'object') {
      throw new Error('Instagram followers returned malformed user row');
    }
    const pkRaw = u.pk ?? u.pk_id ?? u.id;
    const pk = typeof pkRaw === 'number' ? String(pkRaw) : (typeof pkRaw === 'string' ? pkRaw.trim() : '');
    const usernameValue = typeof u.username === 'string' ? u.username.trim() : '';
    if (!/^\\d+$/.test(pk) || !usernameValue) {
      throw new Error('Instagram followers returned malformed user row');
    }
    return {
      rank: i + 1,
      username: usernameValue,
      name: typeof u.full_name === 'string' ? u.full_name : '',
      verified: u.is_verified ? 'Yes' : 'No',
      private: u.is_private ? 'Yes' : 'No',
    };
  });
})()
` },
    ],
});
