import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'instagram',
    name: 'explore',
    description: 'Instagram explore/discover trending posts',
    domain: 'www.instagram.com',
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of posts' },
    ],
    columns: ['rank', 'user', 'caption', 'likes', 'comments', 'type'],
    pipeline: [
        { navigate: 'https://www.instagram.com' },
        { evaluate: `(async () => {
  const limit = \${{ args.limit }};
  const res = await fetch(
    'https://www.instagram.com/api/v1/discover/web/explore_grid/',
    {
      credentials: 'include',
      headers: { 'X-IG-App-ID': '936619743392459' }
    }
  );
  if (!res.ok) throw new Error('HTTP ' + res.status + ' - make sure you are logged in to Instagram');
  const data = await res.json();
  const posts = [];
  for (const sec of (data?.sectional_items || [])) {
    for (const m of (sec?.layout_content?.medias || [])) {
      const media = m?.media;
      if (media) posts.push({
        user: media.user?.username || '',
        caption: (media.caption?.text || '').replace(/\\n/g, ' ').substring(0, 100),
        likes: media.like_count ?? 0,
        comments: media.comment_count ?? 0,
        type: media.media_type === 1 ? 'photo' : media.media_type === 2 ? 'video' : 'carousel',
      });
    }
  }
  return posts.slice(0, limit).map((p, i) => ({ rank: i + 1, ...p }));
})()
` },
    ],
});
