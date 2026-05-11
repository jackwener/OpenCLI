import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'reddit',
    name: 'search',
    access: 'read',
    description: 'Search Reddit Posts',
    domain: 'reddit.com',
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    args: [
        { name: 'query', type: 'string', required: true, positional: true, help: 'Reddit search query' },
        {
            name: 'subreddit',
            type: 'string',
            default: '',
            help: 'Search within a specific subreddit',
        },
        {
            name: 'sort',
            type: 'string',
            default: 'relevance',
            help: 'Sort order: relevance, hot, top, new, comments',
        },
        {
            name: 'time',
            type: 'string',
            default: 'all',
            help: 'Time filter: hour, day, week, month, year, all',
        },
        { name: 'limit', type: 'int', default: 15 },
    ],
    columns: ['title', 'subreddit', 'author', 'score', 'comments', 'url', 'post_hint', 'url_overridden_by_dest', 'preview_image_url', 'gallery_urls'],
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
  const q = encodeURIComponent(\${{ args.query | json }});
  const sub = \${{ args.subreddit | json }};
  const sort = \${{ args.sort | json }};
  const time = \${{ args.time | json }};
  const limit = \${{ args.limit }};
  const basePath = sub ? '/r/' + sub + '/search.json' : '/search.json';
  const params = 'q=' + q + '&sort=' + sort + '&t=' + time + '&limit=' + limit
    + '&restrict_sr=' + (sub ? 'on' : 'off') + '&raw_json=1';
  const res = await fetch(basePath + '?' + params, { credentials: 'include' });
  const d = await res.json();
  return (d?.data?.children || []).map(c => ({
    title: c.data.title,
    subreddit: c.data.subreddit_name_prefixed,
    author: c.data.author,
    score: c.data.score,
    comments: c.data.num_comments,
    url: 'https://www.reddit.com' + c.data.permalink,
    ...extractRedditMedia(c.data),
  }));
})()
` },
        { map: {
                title: '${{ item.title }}',
                subreddit: '${{ item.subreddit }}',
                author: '${{ item.author }}',
                score: '${{ item.score }}',
                comments: '${{ item.comments }}',
                url: '${{ item.url }}',
                post_hint: '${{ item.post_hint }}',
                url_overridden_by_dest: '${{ item.url_overridden_by_dest }}',
                preview_image_url: '${{ item.preview_image_url }}',
                gallery_urls: '${{ item.gallery_urls }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
