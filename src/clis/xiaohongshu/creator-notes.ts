/**
 * Xiaohongshu Creator Note List — per-note metrics from the creator backend.
 *
 * Navigates to the note manager page and extracts per-note data from
 * the rendered DOM. This approach bypasses the v2 API signature requirement.
 *
 * Returns: note title, publish date, views, likes, collects, comments.
 *
 * Requires: logged into creator.xiaohongshu.com in Chrome.
 */

import { cli, Strategy } from '../../registry.js';

cli({
  site: 'xiaohongshu',
  name: 'creator-notes',
  description: '小红书创作者笔记列表 + 每篇数据 (标题/日期/观看/点赞/收藏/评论)',
  domain: 'creator.xiaohongshu.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of notes to return' },
  ],
  columns: ['rank', 'title', 'date', 'views', 'likes', 'collects', 'comments'],
  func: async (page, kwargs) => {
    const limit = kwargs.limit || 20;

    // Navigate to note manager
    await page.goto('https://creator.xiaohongshu.com/new/note-manager');
    await page.wait(4);

    // Scroll to load more notes if needed
    await page.autoScroll({ times: Math.ceil(limit / 10), delayMs: 1500 });

    // Extract note data from rendered DOM
    const notes = await page.evaluate(`
      (() => {
        const results = [];
        // Note cards in the manager page contain title, date, and metric numbers
        // Each note card has a consistent structure with the title, date line,
        // and a row of 4 numbers (views, likes, collects, comments)
        const cards = document.querySelectorAll('[class*="note-item"], [class*="noteItem"], [class*="card"]');

        if (cards.length === 0) {
          // Fallback: parse from any container with note-like content
          const allText = document.body.innerText;
          const notePattern = /(.+?)\\s+发布于\\s+(\\d{4}年\\d{2}月\\d{2}日\\s+\\d{2}:\\d{2})\\s*(\\d+)\\s*(\\d+)\\s*(\\d+)\\s*(\\d+)/g;
          let match;
          while ((match = notePattern.exec(allText)) !== null) {
            results.push({
              title: match[1].trim(),
              date: match[2],
              views: parseInt(match[3]) || 0,
              likes: parseInt(match[4]) || 0,
              collects: parseInt(match[5]) || 0,
              comments: parseInt(match[6]) || 0,
            });
          }
          return results;
        }

        cards.forEach(card => {
          const text = card.innerText || '';
          // Try to extract structured data
          const lines = text.split('\\n').map(l => l.trim()).filter(Boolean);
          if (lines.length < 2) return;

          const title = lines[0];
          const dateLine = lines.find(l => l.includes('发布于'));
          const dateMatch = dateLine?.match(/发布于\\s+(\\d{4}年\\d{2}月\\d{2}日\\s+\\d{2}:\\d{2})/);

          // Find the metrics — typically 4 consecutive numbers
          const nums = text.match(/(?:^|\\s)(\\d+)(?:\\s|$)/g)?.map(n => parseInt(n.trim())) || [];

          if (title && !title.includes('全部笔记')) {
            results.push({
              title: title.replace(/\\s+/g, ' ').substring(0, 80),
              date: dateMatch ? dateMatch[1] : '',
              views: nums[0] || 0,
              likes: nums[1] || 0,
              collects: nums[2] || 0,
              comments: nums[3] || 0,
            });
          }
        });

        return results;
      })()
    `);

    if (!Array.isArray(notes) || notes.length === 0) {
      throw new Error('No notes found. Are you logged into creator.xiaohongshu.com?');
    }

    return notes
      .slice(0, limit)
      .map((n: any, i: number) => ({
        rank: i + 1,
        title: n.title,
        date: n.date,
        views: n.views,
        likes: n.likes,
        collects: n.collects,
        comments: n.comments,
      }));
  },
});
