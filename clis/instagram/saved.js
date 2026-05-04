import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'instagram',
    name: 'saved',
    description: 'Get your saved Instagram posts (optionally from a specific collection)',
    domain: 'www.instagram.com',
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of saved posts' },
        { name: 'collection', help: 'Collection name (case-insensitive). Omit for the default "All posts" feed.' },
    ],
    columns: ['index', 'user', 'caption', 'likes', 'comments', 'type'],
    pipeline: [
        { navigate: 'https://www.instagram.com' },
        { evaluate: `(async () => {
  const limit = \${{ args.limit }};
  const collectionArg = \${{ args.collection | json }};
  const headers = { 'X-IG-App-ID': '936619743392459' };
  const opts = { credentials: 'include', headers };

  let endpoint = 'https://www.instagram.com/api/v1/feed/saved/posts/';
  if (collectionArg && String(collectionArg).trim()) {
    const wanted = String(collectionArg).trim().toLowerCase();
    const listRes = await fetch('https://www.instagram.com/api/v1/collections/list/?collection_types=%5B%22MEDIA%22%2C%22ALL_MEDIA_AUTO_COLLECTION%22%5D', opts);
    if (!listRes.ok) throw new Error('Failed to list collections: HTTP ' + listRes.status + ' - make sure you are logged in to Instagram');
    const listData = await listRes.json();
    const collections = listData?.items || [];
    const match = collections.find((c) => String(c?.collection_name || '').trim().toLowerCase() === wanted);
    if (!match) {
      const names = collections.map((c) => c?.collection_name).filter(Boolean);
      throw new Error('Collection not found: ' + collectionArg + '. Available: ' + (names.length ? names.join(', ') : '(none)'));
    }
    endpoint = 'https://www.instagram.com/api/v1/feed/collection/' + encodeURIComponent(match.collection_id) + '/posts/';
  }

  const res = await fetch(endpoint, opts);
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
