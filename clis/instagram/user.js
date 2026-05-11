import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'instagram',
    name: 'user',
    access: 'read',
    description: 'Get recent posts from an Instagram user',
    domain: 'www.instagram.com',
    args: [
        { name: 'username', required: true, positional: true, help: 'Instagram username' },
        { name: 'limit', type: 'int', default: 12, help: 'Number of posts' },
    ],
    columns: ['index', 'caption', 'likes', 'comments', 'type', 'date'],
    pipeline: [
        { navigate: 'https://www.instagram.com' },
        { evaluate: `(async () => {
  const username = \${{ args.username | json }};
  const limit = \${{ args.limit }};
  const headers = { 'X-IG-App-ID': '936619743392459' };
  const opts = { credentials: 'include', headers };

  // Get user ID first
  const r1 = await fetch(
    'https://www.instagram.com/api/v1/users/web_profile_info/?username=' + encodeURIComponent(username),
    opts
  );
  if (!r1.ok) throw new Error('HTTP ' + r1.status + ' - make sure you are logged in to Instagram');
  const d1 = await r1.json();
  const userId = d1?.data?.user?.id;
  if (!userId) throw new Error('User not found: ' + username);

  // Get user feed
  const r2 = await fetch(
    'https://www.instagram.com/api/v1/feed/user/' + userId + '/?count=' + limit,
    opts
  );
  if (!r2.ok) throw new Error('Failed to fetch user feed: HTTP ' + r2.status);
  const d2 = await r2.json();
  return (d2?.items || []).slice(0, limit).map((p, i) => ({
    index: i + 1,
    caption: (p.caption?.text || '').replace(/\\n/g, ' ').substring(0, 100),
    likes: p.like_count ?? 0,
    comments: p.comment_count ?? 0,
    type: p.media_type === 1 ? 'photo' : p.media_type === 2 ? 'video' : 'carousel',
    date: p.taken_at ? new Date(p.taken_at * 1000).toLocaleDateString() : '',
  }));
})()
` },
    ],
});
