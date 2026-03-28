import type { IPage } from '../../types.js';
import { clamp } from '../_shared/common.js';

const clampLimit = (limit: number) => clamp(limit || 20, 1, 50);

export function buildSinaBlogSearchUrl(keyword: string): string {
  return `https://search.sina.com.cn/search?q=${encodeURIComponent(keyword)}&tp=mix`;
}

export function buildSinaBlogUserUrl(uid: string): string {
  return `https://blog.sina.com.cn/s/articlelist_${encodeURIComponent(uid)}_0_1.html`;
}

export async function loadSinaBlogArticle(page: IPage, url: string): Promise<any> {
  await page.goto(url);
  await page.wait({ selector: 'h1', timeout: 3 });
  return page.evaluate(`
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const title = normalize(document.querySelector('.articalTitle h2, .title h2, h1, h2.titName')?.textContent);
      const titleParts = normalize(document.title).split('_').map((part) => normalize(part)).filter(Boolean);
      const author = titleParts[1] || title.split(/[：:]/)[0] || '';
      const timeText = normalize(document.querySelector('.time, .articalInfo .time')?.textContent).replace(/[()]/g, '');
      const date = timeText || normalize(document.body.innerText.match(/\\b\\d{4}-\\d{2}-\\d{2}(?:\\s+\\d{2}:\\d{2}:\\d{2})?\\b/)?.[0]);
      const category = normalize(document.querySelector('.articalTag .blog_class a, .blog_class a')?.textContent);
      const tags = Array.from(document.querySelectorAll('.blog_tag h3, .blog_tag a, .tag a, .artical_tag a'))
        .map((node) => normalize(node.textContent))
        .filter(Boolean);
      const content = normalize(document.querySelector('.articalContent, .blog_content, .content, #sina_keyword_ad_area2')?.textContent).slice(0, 500);
      const images = Array.from(document.querySelectorAll('.articalContent img, .blog_content img, .content img'))
        .map((img) => img.getAttribute('src') || img.getAttribute('real_src') || '')
        .filter((src) => src && !src.includes('icon'))
        .slice(0, 5);
      return {
        title,
        author,
        date,
        category,
        tags: tags.join(', '),
        readCount: '',
        commentCount: '',
        content: content + (content.length >= 500 ? '...' : ''),
        images: images.join(', '),
        url: ${JSON.stringify(url)},
      };
    })()
  `);
}

export async function loadSinaBlogHot(page: IPage, limit: number): Promise<any[]> {
  const safeLimit = clampLimit(limit);
  await page.goto('https://blog.sina.com.cn/');
  await page.wait({ selector: 'h1', timeout: 3 });
  const data = await page.evaluate(`
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const limit = ${safeLimit};
      const abs = (href) => {
        if (!href) return '';
        if (href.startsWith('//')) return 'https:' + href;
        if (href.startsWith('http')) return href;
        return 'https://blog.sina.com.cn' + (href.startsWith('/') ? '' : '/') + href;
      };
      const parseArticle = (doc, fallback) => {
        const title = normalize(doc.querySelector('.articalTitle h2, .title h2, h1, h2.titName')?.textContent) || fallback.title;
        const titleParts = normalize(doc.title).split('_').map((part) => normalize(part)).filter(Boolean);
        const timeText = normalize(doc.querySelector('.time, .articalInfo .time')?.textContent).replace(/[()]/g, '');
        const articleId = fallback.url.match(/blog_([a-zA-Z0-9]+)\\.html/)?.[1] || '';
        return {
          articleId,
          title,
          author: titleParts[1] || title.split(/[：:]/)[0] || '',
          date: timeText || '',
          readCount: '',
          description: normalize(doc.querySelector('.articalContent, .blog_content, .content, #sina_keyword_ad_area2')?.textContent).slice(0, 150),
        };
      };

      const seeds = [];
      const seen = new Set();
      for (const link of Array.from(document.querySelectorAll('.day-hot-rank .art-list a[href*="/s/blog_"], .hot-rank .art-list a[href*="/s/blog_"]'))) {
        const title = normalize(link.textContent);
        const url = abs(link.getAttribute('href') || '');
        if (!title || !url || seen.has(url)) continue;
        seen.add(url);
        seeds.push({ rank: seeds.length + 1, title, url });
        if (seeds.length >= limit) break;
      }

      const results = [];
      for (const item of seeds) {
        let merged = {
          rank: item.rank,
          articleId: item.url.match(/blog_([a-zA-Z0-9]+)\\.html/)?.[1] || '',
          title: item.title,
          author: '',
          date: '',
          readCount: '',
          description: '',
          url: item.url,
        };
        try {
          const resp = await fetch(item.url, { credentials: 'include' });
          if (resp.ok) {
            const html = await resp.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            merged = Object.assign(merged, parseArticle(doc, item));
          }
        } catch {}
        results.push(merged);
      }
      return results;
    })()
  `);

  return Array.isArray(data) ? data : [];
}

export async function loadSinaBlogSearch(page: IPage, keyword: string, limit: number): Promise<any[]> {
  const safeLimit = clampLimit(limit);
  await page.goto(buildSinaBlogSearchUrl(keyword));
  await page.wait({ selector: '.result-item', timeout: 5 });
  const data = await page.evaluate(`
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      for (let i = 0; i < 20; i += 1) {
        if (document.querySelector('.result-item')) break;
        await sleep(500);
      }
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const limit = ${safeLimit};
      const items = Array.from(document.querySelectorAll('.result-item'));
      const results = [];
      for (const item of items) {
        const link = item.querySelector('.result-title a[href*="blog.sina.com.cn/s/blog_"]');
        const title = normalize(link?.textContent);
        const url = link?.getAttribute('href') || '';
        if (!title || !url) continue;
        results.push({
          rank: results.length + 1,
          title,
          author: normalize(item.querySelector('.result-meta .source')?.textContent),
          date: normalize(item.querySelector('.result-meta .time')?.textContent),
          description: normalize(item.querySelector('.result-intro')?.textContent).slice(0, 150),
          url,
        });
        if (results.length >= limit) break;
      }
      return results;
    })()
  `);

  return Array.isArray(data) ? data : [];
}

export async function loadSinaBlogUser(page: IPage, uid: string, limit: number): Promise<any[]> {
  const safeLimit = clampLimit(limit);
  await page.goto(buildSinaBlogUserUrl(uid));
  await page.wait({ selector: 'h1', timeout: 3 });
  const data = await page.evaluate(`
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const limit = ${safeLimit};
      const author = normalize(document.title).split('_').map((part) => normalize(part)).filter(Boolean)[1] || '';
      const abs = (href) => {
        if (!href) return '';
        if (href.startsWith('//')) return 'https:' + href;
        if (href.startsWith('http')) return href;
        return 'https://blog.sina.com.cn' + (href.startsWith('/') ? '' : '/') + href;
      };
      const results = [];
      for (const item of Array.from(document.querySelectorAll('.articleList .articleCell'))) {
        const link = item.querySelector('.atc_title a[href*="/s/blog_"]');
        const title = normalize(link?.textContent);
        const url = abs(link?.getAttribute('href') || '');
        if (!title || !url) continue;
        results.push({
          rank: results.length + 1,
          articleId: url.match(/blog_([a-zA-Z0-9]+)\\.html/)?.[1] || '',
          title,
          author,
          date: normalize(item.querySelector('.atc_tm')?.textContent),
          readCount: '',
          description: '',
          url,
        });
        if (results.length >= limit) break;
      }
      return results;
    })()
  `);

  return Array.isArray(data) ? data : [];
}
