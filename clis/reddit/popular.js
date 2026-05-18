import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'reddit',
    name: 'popular',
    access: 'read',
    description: 'Reddit Popular posts (/r/popular)',
    domain: 'reddit.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 20 },
    ],
    columns: ['rank', 'id', 'title', 'subreddit', 'score', 'comments', 'author', 'url', 'created_utc', 'selftext', 'post_hint', 'url_overridden_by_dest', 'preview_image_url', 'gallery_urls'],
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
  const limit = \${{ args.limit }};
  const res = await fetch('/r/popular.json?limit=' + limit + '&raw_json=1', {
    credentials: 'include'
  });
  const d = await res.json();
  return (d?.data?.children || []).map(c => ({
    id: c.data.id,
    title: c.data.title,
    subreddit: c.data.subreddit_name_prefixed,
    score: c.data.score,
    comments: c.data.num_comments,
    author: c.data.author,
    url: 'https://www.reddit.com' + c.data.permalink,
    created_utc: c.data.created_utc,
    selftext: c.data.selftext || '',
    ...extractRedditMedia(c.data),
  }));
})()
` },
        { map: {
                rank: '${{ index + 1 }}',
                id: '${{ item.id }}',
                title: '${{ item.title }}',
                subreddit: '${{ item.subreddit }}',
                score: '${{ item.score }}',
                comments: '${{ item.comments }}',
                author: '${{ item.author }}',
                url: '${{ item.url }}',
                created_utc: '${{ item.created_utc }}',
                selftext: '${{ item.selftext }}',
                post_hint: '${{ item.post_hint }}',
                url_overridden_by_dest: '${{ item.url_overridden_by_dest }}',
                preview_image_url: '${{ item.preview_image_url }}',
                gallery_urls: '${{ item.gallery_urls }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
