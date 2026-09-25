import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'reddit',
    name: 'hot',
    access: 'read',
    description: 'Reddit 热门帖子',
    domain: 'www.reddit.com',
    args: [
        {
            name: 'subreddit',
            default: '',
            help: 'Subreddit name (e.g. programming). Empty for r/popular',
        },
        { name: 'limit', type: 'int', default: 20, help: 'Number of posts' },
    ],
    columns: ['rank', 'title', 'subreddit', 'score', 'comments', 'postId', 'author', 'url', 'post_hint', 'url_overridden_by_dest', 'preview_image_url', 'gallery_urls'],
    pipeline: [
        { navigate: 'https://www.reddit.com' },
        { evaluate: `(async () => {
  function decodeHtml(s) {
    if (typeof s !== 'string' || !s) return '';
    return s
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/gi, "'")
      .replace(/&#39;/g, "'");
  }
  function extractRedditMedia(d) {
    const post_hint = d?.post_hint || '';
    const url_overridden_by_dest = d?.url_overridden_by_dest || '';
    const preview_image_url = decodeHtml(d?.preview?.images?.[0]?.source?.url || '');
    const gallery_urls = [];
    const items = d?.gallery_data?.items;
    const meta = d?.media_metadata;
    if (Array.isArray(items) && meta) {
      for (const it of items) {
        const m = it && meta[it.media_id];
        const u = m?.s?.u;
        if (u) gallery_urls.push(decodeHtml(u));
      }
    }
    return { post_hint, url_overridden_by_dest, preview_image_url, gallery_urls };
  }
  const sub = \${{ args.subreddit | json }};
  const path = sub ? '/r/' + sub + '/hot.json' : '/r/popular/hot.json';
  const limit = \${{ args.limit }};
  const res = await fetch(path + '?limit=' + limit + '&raw_json=1', {
    credentials: 'include'
  });
  if (!res.ok) throw new Error('Reddit hot request failed: HTTP ' + res.status + ' from ' + path);
  const d = await res.json();
  if (d?.kind !== 'Listing' || !Array.isArray(d?.data?.children)) {
    throw new Error('Reddit hot returned an invalid Listing from ' + path);
  }
  if (d.data.children.length === 0) {
    throw new Error('Reddit hot returned an empty Listing (dist=' + d.data.dist + ') from ' + path + '; try --subreddit <name>');
  }
  return d.data.children.map(c => ({
    title: c.data.title,
    subreddit: c.data.subreddit_name_prefixed,
    score: c.data.score,
    comments: c.data.num_comments,
    author: c.data.author,
    postId: c.data.id,
    url: 'https://www.reddit.com' + c.data.permalink,
    ...extractRedditMedia(c.data),
  }));
})()
` },
        { map: {
                rank: '${{ index + 1 }}',
                title: '${{ item.title }}',
                subreddit: '${{ item.subreddit }}',
                score: '${{ item.score }}',
                comments: '${{ item.comments }}',
                postId: '${{ item.postId }}',
                author: '${{ item.author }}',
                url: '${{ item.url }}',
                post_hint: '${{ item.post_hint }}',
                url_overridden_by_dest: '${{ item.url_overridden_by_dest }}',
                preview_image_url: '${{ item.preview_image_url }}',
                gallery_urls: '${{ item.gallery_urls }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
