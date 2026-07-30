import { cli, Strategy } from '@woosau/opencli/registry';

cli({
  site: 'test-xhs',
  name: 'explore-deep',
  description: '小红书探索页深度提取 + 去重 + 按互动排序',
  domain: 'www.xiaohongshu.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 15, help: 'Number of items' },
  ],
  columns: ['rank', 'title', 'author', 'likes', 'url'],
  func: async (page, kwargs) => {
    const limit = kwargs.limit ?? 15;
    // Step 1: Navigate to explore page
    await page.goto('https://www.xiaohongshu.com/explore');
    // Step 2: Wait for initial content via MutationObserver
    await page.evaluate(`new Promise(function(resolve) {
      var check = function() { return document.querySelectorAll('section.note-item').length > 0; };
      if (check()) return resolve(true);
      var observer = new MutationObserver(function(m, obs) { if (check()) { obs.disconnect(); resolve(true); } });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(function() { observer.disconnect(); resolve(false); }, 8000);
    })`);
    // Step 3: Multi-round adaptive scroll (early stop when no new content)
    let prevCount = 0;
    for (let round = 0; round < 5; round++) {
      await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
      await page.wait(1.5);
      const count = await page.evaluate('document.querySelectorAll("section.note-item").length') as number;
      if (count >= limit * 2 || count === prevCount) break;
      prevCount = count;
    }
    // Step 4: Extract with noteId deduplication + parse likes as integers
    const result = await page.evaluate(`(function() {
      var seen = {};
      var items = [];
      document.querySelectorAll('section.note-item').forEach(function(el) {
        var linkEl = el.querySelector('a[href]');
        var href = linkEl ? linkEl.getAttribute('href') || '' : '';
        var m = href.match(/explore\\/([a-f0-9]+)/);
        var noteId = m ? m[1] : '';
        if (!noteId || seen[noteId]) return;
        seen[noteId] = true;
        var titleEl = el.querySelector('.title span') || el.querySelector('a.title');
        var authorEl = el.querySelector('.author-wrapper .name') || el.querySelector('.author .name');
        var likesEl = el.querySelector('.like-wrapper .count') || el.querySelector('.interact-container .count');
        var title = (titleEl ? titleEl.textContent || '' : '').trim();
        var author = (authorEl ? authorEl.textContent || '' : '').trim();
        var likesRaw = (likesEl ? likesEl.textContent || '0' : '0').trim();
        var likes = parseInt(likesRaw.replace(/[^0-9]/g, '')) || 0;
        items.push({ title: title, author: author, likes: likes, url: 'https://www.xiaohongshu.com/explore/' + noteId });
      });
      return items;
    })()`);
    // Step 5: Sort by likes descending
    const sorted = (result as any[] || []).sort((a: any, b: any) => b.likes - a.likes);
    // Step 6: Slice and format
    return sorted.slice(0, limit).map((item: any, i: number) => ({
      rank: i + 1, title: item.title, author: item.author, likes: String(item.likes), url: item.url,
    }));
  },
});
