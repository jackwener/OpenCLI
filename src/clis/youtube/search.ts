/**
 * YouTube search — innertube API via browser session.
 * Source: bb-sites/youtube/search.js
 */
import { cli, Strategy } from '../../registry.js';

cli({
  site: 'youtube',
  name: 'search',
  description: 'Search YouTube videos',
  domain: 'www.youtube.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'query', required: true, help: 'Search query' },
    { name: 'limit', type: 'int', default: 20, help: 'Max results (max 50)' },
  ],
  columns: ['rank', 'title', 'channel', 'views', 'duration', 'url'],
  func: async (page, kwargs) => {
    const limit = Math.min(kwargs.limit || 20, 50);
    await page.goto('https://www.youtube.com');
    await page.wait(2);
    const data = await page.evaluate(`
      (async () => {
        const cfg = window.ytcfg?.data_ || {};
        const apiKey = cfg.INNERTUBE_API_KEY;
        const context = cfg.INNERTUBE_CONTEXT;
        if (!apiKey || !context) return {error: 'YouTube config not found'};

        const resp = await fetch('/youtubei/v1/search?key=' + apiKey + '&prettyPrint=false', {
          method: 'POST', credentials: 'include',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({context, query: '${kwargs.query.replace(/'/g, "\\'")}'})
        });
        if (!resp.ok) return {error: 'HTTP ' + resp.status};

        const data = await resp.json();
        const contents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
        const videos = [];
        for (const section of contents) {
          for (const item of (section.itemSectionRenderer?.contents || [])) {
            if (item.videoRenderer && videos.length < ${limit}) {
              const v = item.videoRenderer;
              videos.push({
                rank: videos.length + 1,
                title: v.title?.runs?.[0]?.text || '',
                channel: v.ownerText?.runs?.[0]?.text || '',
                views: v.viewCountText?.simpleText || v.shortViewCountText?.simpleText || '',
                duration: v.lengthText?.simpleText || 'LIVE',
                url: 'https://www.youtube.com/watch?v=' + v.videoId
              });
            }
          }
        }
        return videos;
      })()
    `);
    if (!Array.isArray(data)) return [];
    return data;
  },
});
