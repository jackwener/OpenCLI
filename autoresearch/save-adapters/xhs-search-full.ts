import { cli, Strategy } from '@woosau/opencli/registry';

cli({
  site: 'test-xhs',
  name: 'search-full',
  description: '小红书搜索 + 滚动加载 + 去重',
  domain: 'www.xiaohongshu.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'query', type: 'string', default: '咖啡', positional: true, help: 'Search query' },
    { name: 'limit', type: 'int', default: 10, help: 'Number of results' },
  ],
  columns: ['rank', 'title', 'author', 'likes', 'url'],
  func: async (page, kwargs) => {
    const query = encodeURIComponent(kwargs.query ?? '咖啡');
    const limit = kwargs.limit ?? 10;
    // Step 1: Navigate to search page
    await page.goto('https://www.xiaohongshu.com/search_result?keyword=' + query + '&source=web_search_result_notes');
    // Step 2: Wait for async render via MutationObserver
    await page.evaluate(`new Promise(function(resolve) {
      var check = function() { return document.querySelectorAll('section.note-item').length > 0; };
      if (check()) return resolve(true);
      var observer = new MutationObserver(function(m, obs) { if (check()) { obs.disconnect(); resolve(true); } });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(function() { observer.disconnect(); resolve(false); }, 8000);
    })`);
    // Step 3: Scroll 3x to load more content
    for (let i = 0; i < 3; i++) {
      await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
      await page.wait(1);
    }
    // Step 4: Extract from DOM with deduplication
    const result = await page.evaluate(`(function() {
      var seen = {};
      var items = [];
      document.querySelectorAll('section.note-item').forEach(function(el) {
        var linkEl = el.querySelector('a[href]');
        var href = linkEl ? linkEl.getAttribute('href') || '' : '';
        var m = href.match(/explore\\/([a-f0-9]+)/);
        var noteId = m ? m[1] : href;
        if (!noteId || seen[noteId]) return;
        seen[noteId] = true;
        var titleEl = el.querySelector('.title span') || el.querySelector('a.title');
        var authorEl = el.querySelector('.author-wrapper .name') || el.querySelector('.author .name');
        var likesEl = el.querySelector('.like-wrapper .count') || el.querySelector('.interact-container .count');
        if (titleEl) {
          items.push({
            title: (titleEl.textContent || '').trim(),
            author: (authorEl ? authorEl.textContent || '' : '').trim(),
            likes: (likesEl ? likesEl.textContent || '0' : '0').trim(),
            url: 'https://www.xiaohongshu.com' + href,
          });
        }
      });
      return items;
    })()`);
    return (result as any[]).slice(0, limit).map((item: any, i: number) => ({
      rank: i + 1, title: item.title, author: item.author, likes: item.likes, url: item.url,
    }));
  },
});
