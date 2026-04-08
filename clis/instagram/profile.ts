import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'instagram',
  name: 'profile',
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
  const res = await fetch(
    'https://www.instagram.com/api/v1/users/web_profile_info/?username=' + encodeURIComponent(username),
    {
      credentials: 'include',
      headers: { 'X-IG-App-ID': '936619743392459' }
    }
  );
  if (!res.ok) throw new Error('HTTP ' + res.status + ' - make sure you are logged in to Instagram');
  const data = await res.json();
  const u = data?.data?.user;
  if (!u) throw new Error('User not found: ' + username);
  return [{
    username: u.username,
    name: u.full_name || '',
    bio: (u.biography || '').replace(/\\n/g, ' ').substring(0, 120),
    followers: u.edge_followed_by?.count ?? 0,
    following: u.edge_follow?.count ?? 0,
    posts: u.edge_owner_to_timeline_media?.count ?? 0,
    verified: u.is_verified ? 'Yes' : 'No',
    url: 'https://www.instagram.com/' + u.username,
  }];
})()
` },
  ],
});
