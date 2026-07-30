import { cli, Strategy } from '@woosau/opencli/registry';

cli({
  site: 'test-xhs',
  name: 'note-comments',
  description: '小红书笔记详情 + 评论（多步合并输出）',
  domain: 'www.xiaohongshu.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'id', type: 'string', default: '6745a82f000000000800b6ed', positional: true, help: 'Note ID' },
    { name: 'limit', type: 'int', default: 5, help: 'Max comments' },
  ],
  columns: ['section', 'title', 'author', 'likes', 'text'],
  func: async (page, kwargs) => {
    const noteId = kwargs.id ?? '6745a82f000000000800b6ed';
    const commentLimit = kwargs.limit ?? 5;
    // Step 1: Navigate to note detail page
    await page.goto('https://www.xiaohongshu.com/explore/' + noteId);
    await page.wait(3);
    // Step 2: Extract note metadata (title, author, likes)
    const meta = await page.evaluate(`(function() {
      return {
        title: (document.querySelector('#detail-title') || document.querySelector('.title') || {}).textContent?.trim() || '',
        author: (document.querySelector('.author-container .username') || document.querySelector('.user-nickname') || {}).textContent?.trim() || '',
        likes: (document.querySelector('[data-type="like"] .count') || document.querySelector('.like-wrapper .count') || {}).textContent?.trim() || '0',
      };
    })()`) as any;
    // Step 3: Scroll the note container to trigger comment loading
    for (let i = 0; i < 3; i++) {
      await page.evaluate(`(function() {
        var scroller = document.querySelector('.note-scroller') || document.querySelector('.container');
        if (scroller && scroller.scrollTo) { scroller.scrollTo(0, 99999); } else { window.scrollTo(0, document.body.scrollHeight); }
      })()`);
      await page.wait(1);
    }
    // Step 4: Extract comments from DOM
    const comments = await page.evaluate(`(function() {
      var results = [];
      var commentEls = document.querySelectorAll('.parent-comment, .comment-item-root');
      commentEls.forEach(function(el) {
        var item = el.querySelector('.comment-item') || el.querySelector('.comment-inner');
        if (!item) return;
        var authorEl = item.querySelector('.author-wrapper .name') || item.querySelector('.user-name');
        var textEl = item.querySelector('.content') || item.querySelector('.note-text');
        var likesEl = item.querySelector('.count');
        var author = (authorEl ? authorEl.textContent || '' : '').trim();
        var text = (textEl ? textEl.textContent || '' : '').replace(/\\s+/g, ' ').trim();
        var likes = (likesEl ? likesEl.textContent || '0' : '0').trim();
        if (text) results.push({ author: author, text: text.slice(0, 80), likes: likes });
      });
      return results;
    })()`) as any[];
    // Step 5: Merge note meta + comments into unified output
    const rows: any[] = [{ section: 'note', title: meta.title, author: meta.author, likes: meta.likes, text: '' }];
    for (const c of (comments || []).slice(0, commentLimit)) {
      rows.push({ section: 'comment', title: '', author: c.author, likes: c.likes, text: c.text });
    }
    return rows;
  },
});
