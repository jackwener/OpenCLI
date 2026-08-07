import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'instagram',
    name: 'explore',
    access: 'read',
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

  // Instagram no longer populates the flat layout_content.medias[] path. Media
  // objects are now nested across mixed layout shapes (one_by_two_item.clips.
  // items[].media, fill_items[].media, etc.), so recursively walk each sectional
  // item collecting every distinct node.media and dedupe by pk/id/code. See #2091.
  const seen = new Set();
  const medias = [];
  const collect = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 8) return;
    if (Array.isArray(node)) {
      for (const item of node) collect(item, depth + 1);
      return;
    }
    const media = node.media;
    if (media && typeof media === 'object' && !Array.isArray(media)) {
      const key = media.pk ?? media.id ?? media.code;
      if (key != null && !seen.has(key)) {
        seen.add(key);
        medias.push(media);
      }
    }
    for (const [k, value] of Object.entries(node)) {
      // Don't descend into a collected media object — a carousel's child items
      // carry their own .media and would otherwise be counted as separate posts.
      if (k === 'media') continue;
      if (value && typeof value === 'object') collect(value, depth + 1);
    }
  };
  for (const sec of (data?.sectional_items || [])) collect(sec, 0);

  const posts = medias.map((media) => ({
    user: media.user?.username || '',
    caption: (media.caption?.text || '').replace(/\\n/g, ' ').substring(0, 100),
    // Clips/reels report engagement via play_count rather than like_count.
    likes: media.like_count ?? media.play_count ?? 0,
    comments: media.comment_count ?? 0,
    type: media.media_type === 1 ? 'photo' : media.media_type === 2 ? 'video' : 'carousel',
  }));
  return posts.slice(0, limit).map((p, i) => ({ rank: i + 1, ...p }));
})()
` },
    ],
});
