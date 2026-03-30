/**
 * YouTube search — innertube API via browser session.
 */
import { cli, Strategy } from '../../registry.js';

cli({
  site: 'youtube',
  name: 'search',
  description: 'Search YouTube videos',
  domain: 'www.youtube.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search query' },
    { name: 'limit', type: 'int', default: 20, help: 'Max results (max 50)' },
    { name: 'type', default: '', help: 'Filter type: shorts, video, channel, playlist' },
    { name: 'upload', default: '', help: 'Upload date: hour, today, week, month, year' },
    { name: 'sort', default: '', help: 'Sort by: relevance, date, views, rating' },
  ],
  columns: ['rank', 'title', 'channel', 'views', 'duration', 'url'],
  func: async (page, kwargs) => {
    const limit = Math.min(kwargs.limit || 20, 50);
    const query = encodeURIComponent(kwargs.query);

    // Build search URL with filter params
    // YouTube uses sp= parameter for filters — we use the URL approach for reliability
    const spMap: Record<string, string> = {
      // type filters
      'shorts': 'EgIQCQ%3D%3D',    // Shorts (type=9)
      'video': 'EgIQAQ%3D%3D',
      'channel': 'EgIQAg%3D%3D',
      'playlist': 'EgIQAw%3D%3D',
      // upload date filters (can be combined with type via URL)
      'hour': 'EgIIAQ%3D%3D',
      'today': 'EgIIAg%3D%3D',
      'week': 'EgIIAw%3D%3D',
      'month': 'EgIIBA%3D%3D',
      'year': 'EgIIBQ%3D%3D',
    };
    const sortMap: Record<string, string> = {
      'date': 'CAI%3D',
      'views': 'CAM%3D',
      'rating': 'CAE%3D',
    };

    let url = `https://www.youtube.com/results?search_query=${query}`;
    if (kwargs.type && spMap[kwargs.type]) url += `&sp=${spMap[kwargs.type]}`;
    else if (kwargs.upload && spMap[kwargs.upload]) url += `&sp=${spMap[kwargs.upload]}`;
    if (kwargs.sort && sortMap[kwargs.sort]) url += `&sp=${sortMap[kwargs.sort]}`;

    const isShorts = kwargs.type === 'shorts';

    await page.goto(url);
    await page.wait(3);
    const data = await page.evaluate(`
      (async () => {
        const data = window.ytInitialData;
        if (!data) return {error: 'YouTube data not found'};

        const contents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
        const videos = [];
        for (const section of contents) {
          const items = section.itemSectionRenderer?.contents || section.reelShelfRenderer?.items || [];
          for (const item of items) {
            if (videos.length >= ${limit}) break;
            if (item.videoRenderer) {
              const v = item.videoRenderer;
              videos.push({
                rank: videos.length + 1,
                title: v.title?.runs?.[0]?.text || '',
                channel: v.ownerText?.runs?.[0]?.text || '',
                views: v.viewCountText?.simpleText || v.shortViewCountText?.simpleText || '',
                duration: v.lengthText?.simpleText || 'LIVE',
                url: 'https://www.youtube.com/watch?v=' + v.videoId
              });
            } else if (item.reelItemRenderer) {
              const r = item.reelItemRenderer;
              videos.push({
                rank: videos.length + 1,
                title: r.headline?.simpleText || '',
                channel: r.navigationEndpoint?.reelWatchEndpoint?.overlay?.reelPlayerOverlayRenderer?.reelPlayerHeaderSupportedRenderers?.reelPlayerHeaderRenderer?.channelTitleText?.runs?.[0]?.text || '',
                views: r.viewCountText?.simpleText || '',
                duration: 'SHORT',
                url: 'https://www.youtube.com/shorts/' + r.videoId
              });
            }
          }
        }
        return videos;
      })()
    `);
    if (!Array.isArray(data)) return [];

    // For Shorts: convert URL to /shorts/ format
    if (isShorts) {
      return data.map((v: any) => ({
        ...v,
        url: v.url.replace('youtube.com/watch?v=', 'youtube.com/shorts/'),
      }));
    }
    return data;
  },
});
