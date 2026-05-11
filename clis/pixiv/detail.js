import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'pixiv',
    name: 'detail',
    access: 'read',
    description: 'View illustration details (tags, stats, URLs)',
    domain: 'www.pixiv.net',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'id', required: true, positional: true, help: 'Illustration ID' },
    ],
    columns: [
        'illust_id',
        'title',
        'author',
        'type',
        'pages',
        'bookmarks',
        'likes',
        'views',
        'tags',
        'created',
        'url',
    ],
    pipeline: [
        { navigate: 'https://www.pixiv.net' },
        { evaluate: `(async () => {
  const id = \${{ args.id | json }};
  const res = await fetch(
    'https://www.pixiv.net/ajax/illust/' + id,
    { credentials: 'include' }
  );
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error('Authentication required — please log in to Pixiv in Chrome');
    if (res.status === 404) throw new Error('Illustration not found: ' + id);
    throw new Error('Pixiv request failed (HTTP ' + res.status + ')');
  }
  const data = await res.json();
  const b = data?.body;
  if (!b) throw new Error('Illustration not found');
  return [{
    illust_id: b.illustId,
    title: b.illustTitle,
    author: b.userName,
    user_id: b.userId,
    type: b.illustType === 0 ? 'illust' : b.illustType === 1 ? 'manga' : b.illustType === 2 ? 'ugoira' : String(b.illustType),
    pages: b.pageCount,
    bookmarks: b.bookmarkCount,
    likes: b.likeCount,
    views: b.viewCount,
    tags: (b.tags?.tags || []).map(t => t.tag).join(', '),
    created: b.createDate?.split('T')[0] || '',
    url: 'https://www.pixiv.net/artworks/' + b.illustId
  }];
})()
` },
    ],
});
