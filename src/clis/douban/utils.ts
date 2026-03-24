/**
 * Douban adapter utilities.
 */

import { CliError } from '../../errors.js';
import type { IPage } from '../../types.js';

function clampLimit(limit: number): number {
  return Math.max(1, Math.min(limit || 20, 50));
}

async function ensureDoubanReady(page: IPage): Promise<void> {
  const state = await page.evaluate(`
    (() => {
      const title = (document.title || '').trim();
      const href = (location.href || '').trim();
      const blocked = href.includes('sec.douban.com') || /登录跳转/.test(title) || /异常请求/.test(document.body?.innerText || '');
      return { blocked, title, href };
    })()
  `);
  if (state?.blocked) {
    throw new CliError(
      'AUTH_REQUIRED',
      'Douban requires a logged-in browser session before these commands can load data.',
      'Please sign in to douban.com in the browser that opencli reuses, then rerun the command.',
    );
  }
}

export async function loadDoubanBookHot(page: IPage, limit: number): Promise<any[]> {
  const safeLimit = clampLimit(limit);
  await page.goto('https://book.douban.com/chart');
  await page.wait(4);
  await ensureDoubanReady(page);
  const data = await page.evaluate(`
    (() => {
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const books = [];
      for (const el of Array.from(document.querySelectorAll('.media.clearfix'))) {
        try {
          const titleEl = el.querySelector('h2 a[href*="/subject/"]');
          const title = normalize(titleEl?.textContent);
          let url = titleEl?.getAttribute('href') || '';
          if (!title || !url) continue;
          if (!url.startsWith('http')) url = 'https://book.douban.com' + url;

          const info = normalize(el.querySelector('.subject-abstract, .pl, .pub')?.textContent);
          const infoParts = info.split('/').map((part) => part.trim()).filter(Boolean);
          const ratingText = normalize(el.querySelector('.subject-rating .font-small, .rating_nums, .rating')?.textContent);
          const quote = Array.from(el.querySelectorAll('.subject-tags .tag'))
            .map((node) => normalize(node.textContent))
            .filter(Boolean)
            .join(' / ');

          books.push({
            rank: parseInt(normalize(el.querySelector('.green-num-box')?.textContent), 10) || books.length + 1,
            title,
            rating: parseFloat(ratingText) || 0,
            quote,
            author: infoParts[0] || '',
            publisher: infoParts.find((part) => /出版社|出版公司|Press/i.test(part)) || infoParts[2] || '',
            year: infoParts.find((part) => /\\d{4}(?:-\\d{1,2})?/.test(part))?.match(/\\d{4}/)?.[0] || '',
            price: infoParts.find((part) => /元|USD|\\$|￥/.test(part)) || '',
            url,
            cover: el.querySelector('img')?.getAttribute('src') || '',
          });
        } catch {}
      }
      return books.slice(0, ${safeLimit});
    })()
  `);
  return Array.isArray(data) ? data : [];
}

export async function loadDoubanMovieHot(page: IPage, limit: number): Promise<any[]> {
  const safeLimit = clampLimit(limit);
  await page.goto('https://movie.douban.com/chart');
  await page.wait(4);
  await ensureDoubanReady(page);
  const data = await page.evaluate(`
    (() => {
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const results = [];
      for (const el of Array.from(document.querySelectorAll('.item'))) {
        const titleEl = el.querySelector('.pl2 a');
        const title = normalize(titleEl?.textContent);
        let url = titleEl?.getAttribute('href') || '';
        if (!title || !url) continue;
        if (!url.startsWith('http')) url = 'https://movie.douban.com' + url;

        const info = normalize(el.querySelector('.pl2 p')?.textContent);
        const infoParts = info.split('/').map((part) => part.trim()).filter(Boolean);
        const releaseIndex = (() => {
          for (let i = infoParts.length - 1; i >= 0; i -= 1) {
            if (/\\d{4}-\\d{2}-\\d{2}|\\d{4}\\/\\d{2}\\/\\d{2}/.test(infoParts[i])) return i;
          }
          return -1;
        })();
        const directorPart = releaseIndex >= 1 ? infoParts[releaseIndex - 1] : '';
        const regionPart = releaseIndex >= 2 ? infoParts[releaseIndex - 2] : '';
        const yearMatch = info.match(/\\b(19|20)\\d{2}\\b/);
        results.push({
          rank: results.length + 1,
          title,
          rating: parseFloat(normalize(el.querySelector('.rating_nums')?.textContent)) || 0,
          quote: normalize(el.querySelector('.inq')?.textContent),
          director: directorPart.replace(/^导演:\\s*/, ''),
          year: yearMatch?.[0] || '',
          region: regionPart,
          url,
          cover: el.querySelector('img')?.getAttribute('src') || '',
        });
        if (results.length >= ${safeLimit}) break;
      }
      return results;
    })()
  `);
  return Array.isArray(data) ? data : [];
}

export async function searchDouban(page: IPage, type: string, keyword: string, limit: number): Promise<any[]> {
  const safeLimit = clampLimit(limit);
  await page.goto(`https://search.douban.com/${encodeURIComponent(type)}/subject_search?search_text=${encodeURIComponent(keyword)}`);
  await page.wait(2);
  await ensureDoubanReady(page);
  const data = await page.evaluate(`
    (async () => {
      const type = ${JSON.stringify(type)};
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const seen = new Set();
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      for (let i = 0; i < 20; i += 1) {
        if (document.querySelector('.item-root .title-text, .item-root .title a')) break;
        await sleep(300);
      }

      const items = Array.from(document.querySelectorAll('.item-root'));

      const results = [];
      for (const el of items) {
        const titleEl = el.querySelector('.title-text, .title a, a[title]');
        const title = normalize(titleEl?.textContent) || normalize(titleEl?.getAttribute('title'));
        let url = titleEl?.getAttribute('href') || '';
        if (!title || !url) continue;
        if (!url.startsWith('http')) url = 'https://search.douban.com' + url;
        if (!url.includes('/subject/') || seen.has(url)) continue;
        seen.add(url);
        const ratingText = normalize(el.querySelector('.rating_nums')?.textContent);
        const abstract = normalize(
          el.querySelector('.meta.abstract, .meta, .abstract, p')?.textContent,
        );
        results.push({
          rank: results.length + 1,
          id: url.match(/subject\\/(\\d+)/)?.[1] || '',
          type,
          title,
          rating: ratingText.includes('.') ? parseFloat(ratingText) : 0,
          abstract: abstract.slice(0, 100) + (abstract.length > 100 ? '...' : ''),
          url,
          cover: el.querySelector('img')?.getAttribute('src') || '',
        });
        if (results.length >= ${safeLimit}) break;
      }
      return results;
    })()
  `);
  return Array.isArray(data) ? data : [];
}

/**
 * Get current user's Douban ID from movie.douban.com/mine page
 */
export async function getSelfUid(page: IPage): Promise<string> {
  await page.goto('https://movie.douban.com/mine');
  await page.wait({ time: 2 });
  
  const uid = await page.evaluate(`
    (() => {
      // 方案1: 尝试从全局变量获取
      if (window.__DATA__ && window.__DATA__.uid) {
        return window.__DATA__.uid;
      }
      
      // 方案2: 从导航栏用户链接获取
      const navUserLink = document.querySelector('.nav-user-account a');
      if (navUserLink) {
        const href = navUserLink.href || '';
        const match = href.match(/people\\/([^/]+)/);
        if (match) return match[1];
      }
      
      // 方案3: 从页面中的个人主页链接获取
      const profileLink = document.querySelector('a[href*="/people/"]');
      if (profileLink) {
        const href = profileLink.getAttribute('href') || profileLink.href || '';
        const match = href.match(/people\\/([^/]+)/);
        if (match) return match[1];
      }
      
      // 方案4: 从头部用户名区域获取
      const userLink = document.querySelector('.global-nav-items a[href*="/people/"]');
      if (userLink) {
        const href = userLink.getAttribute('href') || userLink.href || '';
        const match = href.match(/people\\/([^/]+)/);
        if (match) return match[1];
      }
      
      return '';
    })()
  `);
  if (!uid) {
    throw new Error('Not logged in to Douban. Please login in Chrome first.');
  }
  return uid;
}

/**
 * Douban mark (viewing record) interface
 */
export interface DoubanMark {
  movieId: string;
  title: string;
  year: string;
  myRating: number | null;
  myStatus: 'collect' | 'wish' | 'do';
  myComment: string;
  myDate: string;
  url: string;
}

/**
 * Douban review interface
 */
export interface DoubanReview {
  reviewId: string;
  movieId: string;
  movieTitle: string;
  title: string;
  content: string;
  myRating: number;
  createdAt: string;
  votes: number;
  url: string;
}
