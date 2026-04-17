import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'instagram',
    name: 'saved',
    description: 'Get your saved Instagram posts',
    domain: 'www.instagram.com',
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of saved posts' },
    ],
    columns: ['index', 'user', 'caption', 'likes', 'comments', 'type'],
    pipeline: [
        { navigate: 'https://www.instagram.com' },
        { evaluate: `(async () => {
  const limit = \${{ args.limit }};
  const res = await fetch(
    'https://www.instagram.com/api/v1/feed/saved/posts/',
    {
      credentials: 'include',
      headers: { 'X-IG-App-ID': '936619743392459' }
    }
  );
  if (!res.ok) throw new Error('HTTP ' + res.status + ' - make sure you are logged in to Instagram');
  const data = await res.json();
  return (data?.items || []).slice(0, limit).map((item, i) => {
    const m = item?.media;
    return {
      index: i + 1,
      user: m?.user?.username || '',
      caption: (m?.caption?.text || '').replace(/\\n/g, ' ').substring(0, 100),
      likes: m?.like_count ?? 0,
      comments: m?.comment_count ?? 0,
      type: m?.media_type === 1 ? 'photo' : m?.media_type === 2 ? 'video' : 'carousel',
    };
  });
})()
` },
    ],
});
