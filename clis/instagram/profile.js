import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'instagram',
    name: 'profile',
    access: 'read',
    description: 'Get Instagram user profile info',
    domain: 'www.instagram.com',
    args: [
        { name: 'username', required: true, positional: true, help: 'Instagram username' },
    ],
    columns: ['username', 'name', 'followers', 'following', 'posts', 'verified', 'bio'],
    pipeline: [
        { navigate: 'https://www.instagram.com' },
        { evaluate: `(async () => {
  const username = \${{ args.username | json }};
  const opts = { credentials: 'include', headers: { 'X-IG-App-ID': '936619743392459' } };
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
  function throwInstagramHttpError(response, label) {
    if (response.status === 404) throw new Error('User not found: ' + username);
    if (response.status === 401 || response.status === 403) {
      throw new Error('HTTP ' + response.status + ' - make sure you are logged in to Instagram');
    }
    throw new Error(label + ' failed: HTTP ' + response.status);
  }
  function mapProfileUser(u, countFields) {
    if (!u || typeof u !== 'object' || typeof u.username !== 'string' || !u.username.trim()) {
      throw new Error('Instagram profile returned malformed user payload for: ' + username);
    }
    return {
      username: u.username,
      name: typeof u.full_name === 'string' ? u.full_name : '',
      bio: (typeof u.biography === 'string' ? u.biography : '').replace(/\\n/g, ' ').substring(0, 120),
      followers: countFields.followers(u),
      following: countFields.following(u),
      posts: countFields.posts(u),
      verified: u.is_verified ? 'Yes' : 'No',
    };
  }
  const r1 = await fetch(
    'https://www.instagram.com/api/v1/users/web_profile_info/?username=' + encodeURIComponent(username),
    opts
  );
  if (r1.status === 404) throw new Error('User not found: ' + username);
  if (!r1.ok && r1.status !== 400) throwInstagramHttpError(r1, 'Instagram web_profile_info');
  if (r1.ok) {
    const data = await readInstagramJson(r1, 'Instagram web_profile_info');
    const u = data?.data?.user;
    return [mapProfileUser(u, {
      followers: (user) => user.edge_followed_by?.count ?? 0,
      following: (user) => user.edge_follow?.count ?? 0,
      posts: (user) => user.edge_owner_to_timeline_media?.count ?? 0,
    })];
  }
  // web_profile_info answers HTTP 400 for business/professional accounts.
  // Resolve the id via feed-by-username (its root user.pk is the profile
  // owner), then read the full profile from users/<id>/info/.
  const r2 = await fetch(
    'https://www.instagram.com/api/v1/feed/user/' + encodeURIComponent(username) + '/username/?count=1',
    opts
  );
  if (!r2.ok) throwInstagramHttpError(r2, 'Instagram feed-by-username');
  const pk = normalizeInstagramUserId((await readInstagramJson(r2, 'Instagram feed-by-username'))?.user?.pk, 'Instagram feed returned no valid profile owner for: ' + username);
  const r3 = await fetch('https://www.instagram.com/api/v1/users/' + pk + '/info/', opts);
  if (!r3.ok) throwInstagramHttpError(r3, 'Instagram users info');
  const u = (await readInstagramJson(r3, 'Instagram users info'))?.user;
  return [mapProfileUser(u, {
    followers: (user) => user.follower_count ?? 0,
    following: (user) => user.following_count ?? 0,
    posts: (user) => user.media_count ?? 0,
  })];
})()
` },
    ],
});
