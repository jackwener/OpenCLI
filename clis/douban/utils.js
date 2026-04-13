/**
 * Douban adapter utilities.
 */
import { ArgumentError, CliError, EmptyResultError } from '@jackwener/opencli/errors';
import { clamp } from '../_shared/common.js';
const DOUBAN_PHOTO_PAGE_SIZE = 30;
const MAX_DOUBAN_PHOTOS = 500;
const clampLimit = (limit) => clamp(limit || 20, 1, 50);
const clampPhotoLimit = (limit) => clamp(limit || 120, 1, MAX_DOUBAN_PHOTOS);
const DOUBAN_SEARCH_READY_SELECTOR = '.item-root .title-text, .item-root .title a, .result-list .result-item h3 a';
const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
function firstNonEmpty(values) {
    for (const value of values) {
        const normalized = normalizeText(value);
        if (normalized)
            return normalized;
    }
    return '';
}
function splitDoubanPeople(value) {
    return normalizeText(value)
        .split(/\s*\/\s*/)
        .map((entry) => normalizeText(entry))
        .filter(Boolean);
}
function parseDoubanBookInfoText(infoText) {
    const lines = String(infoText || '')
        .replace(/\r/g, '\n')
        .split('\n')
        .map((line) => normalizeText(line))
        .filter(Boolean);
    const map = {};
    for (const line of lines) {
        const match = line.match(/^([^:：]+)\s*[:：]\s*(.*)$/);
        if (!match)
            continue;
        const label = normalizeText(match[1]);
        const value = normalizeText(match[2]);
        if (!label)
            continue;
        map[label] = value;
    }
    return map;
}
function parseDoubanRating(value) {
    const normalized = normalizeText(value);
    if (!normalized)
        return 0;
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
}
function parseDoubanCount(value) {
    const normalized = normalizeText(value).replace(/[^\d]/g, '');
    if (!normalized)
        return 0;
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) ? parsed : 0;
}
function parseDoubanPageCount(value) {
    const match = normalizeText(value).match(/(\d+)/);
    if (!match)
        return null;
    const parsed = Number.parseInt(match[1], 10);
    return Number.isFinite(parsed) ? parsed : null;
}
function extractDoubanPublishYear(value) {
    const match = normalizeText(value).match(/\b(19|20)\d{2}\b/);
    return match?.[0] || '';
}
function splitDoubanTitle(fullTitle) {
    const normalized = normalizeText(fullTitle);
    if (!normalized)
        return { title: '', originalTitle: '' };
    const match = normalized.match(/^([\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+(?:\s*[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef·：:！？]+)*)\s+(.+)$/);
    if (!match) {
        return { title: normalized, originalTitle: '' };
    }
    return {
        title: normalizeText(match[1]),
        originalTitle: normalizeText(match[2]),
    };
}
async function ensureDoubanReady(page) {
    const state = await page.evaluate(`
    (() => {
      const title = (document.title || '').trim();
      const href = (location.href || '').trim();
      const blocked = href.includes('sec.douban.com') || /登录跳转/.test(title) || /异常请求/.test(document.body?.innerText || '');
      return { blocked, title, href };
    })()
  `);
    if (state?.blocked) {
        throw new CliError('AUTH_REQUIRED', 'Douban requires a logged-in browser session before these commands can load data.', 'Please sign in to douban.com in the browser that opencli reuses, then rerun the command.');
    }
}
function isDetachedPageError(error) {
    const message = error instanceof Error ? error.message : String(error || '');
    return /Detached while handling command|Debugger is not attached to the tab|Target closed|No tab with id/i.test(message);
}
async function withDetachedRetry(task, options = {}) {
    const attempts = Math.max(1, options.attempts || 2);
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            return await task();
        }
        catch (error) {
            lastError = error;
            if (attempt >= attempts - 1 || !isDetachedPageError(error)) {
                throw error;
            }
        }
    }
    throw lastError;
}
function buildDoubanSearchUrl(type, keyword) {
    const url = new URL(`https://search.douban.com/${encodeURIComponent(type)}/subject_search`);
    url.searchParams.set('search_text', String(keyword || ''));
    if (String(type || '').trim() === 'book') {
        url.searchParams.set('cat', '1001');
    }
    return url.toString();
}
export function normalizeDoubanSubjectId(subjectId) {
    const normalized = String(subjectId || '').trim();
    if (!/^\d+$/.test(normalized)) {
        throw new ArgumentError(`Invalid Douban subject ID: ${subjectId}`);
    }
    return normalized;
}
export function promoteDoubanPhotoUrl(url, size = 'l') {
    const normalized = String(url || '').trim();
    if (!normalized)
        return '';
    if (/^[a-z]+:/i.test(normalized) && !/^https?:/i.test(normalized))
        return '';
    return normalized.replace(/\/view\/photo\/[^/]+\/public\//, `/view/photo/${size}/public/`);
}
export function resolveDoubanPhotoAssetUrl(candidates, baseUrl = '') {
    for (const candidate of candidates) {
        const normalized = String(candidate || '').trim();
        if (!normalized)
            continue;
        let resolved = normalized;
        try {
            resolved = baseUrl
                ? new URL(normalized, baseUrl).toString()
                : new URL(normalized).toString();
        }
        catch {
            resolved = normalized;
        }
        if (/^https?:\/\//i.test(resolved)) {
            return resolved;
        }
    }
    return '';
}
export function getDoubanPhotoExtension(url) {
    const normalized = String(url || '').trim();
    if (!normalized)
        return '.jpg';
    try {
        const ext = new URL(normalized).pathname.match(/\.(jpe?g|png|gif|webp|avif|bmp)$/i)?.[0];
        return ext || '.jpg';
    }
    catch {
        const ext = normalized.match(/\.(jpe?g|png|gif|webp|avif|bmp)(?:$|[?#])/i)?.[0];
        return ext ? ext.replace(/[?#].*$/, '') : '.jpg';
    }
}
export function normalizeDoubanBookSubject(raw) {
    const info = parseDoubanBookInfoText(raw?.infoText);
    const title = firstNonEmpty([raw?.title]);
    const subtitle = firstNonEmpty([raw?.subtitle, info['副标题']]);
    const originalTitle = firstNonEmpty([raw?.originalTitle, info['原作名']]);
    const authors = splitDoubanPeople(firstNonEmpty([info['作者']]));
    const translators = splitDoubanPeople(firstNonEmpty([info['译者']]));
    const publisher = firstNonEmpty([info['出版社'], info['出品方']]);
    const publishDate = firstNonEmpty([info['出版年']]);
    const publishYear = extractDoubanPublishYear(publishDate);
    const pageCount = parseDoubanPageCount(info['页数']);
    const binding = firstNonEmpty([info['装帧']]);
    const price = firstNonEmpty([info['定价']]);
    const series = firstNonEmpty([info['丛书']]);
    const isbnRaw = firstNonEmpty([info['ISBN']]).replace(/[^\dxX]/g, '');
    const isbn10 = isbnRaw.length === 10 ? isbnRaw : '';
    const isbn13 = isbnRaw.length === 13 ? isbnRaw : '';
    return {
        id: normalizeDoubanSubjectId(raw?.id),
        type: 'book',
        title,
        subtitle,
        originalTitle,
        authors,
        translators,
        publisher,
        publishDate,
        publishYear,
        pageCount,
        binding,
        price,
        series,
        isbn10,
        isbn13,
        rating: parseDoubanRating(raw?.rating),
        ratingCount: parseDoubanCount(raw?.ratingCount),
        summary: normalizeText(raw?.summary),
        cover: firstNonEmpty([raw?.cover]),
        url: firstNonEmpty([raw?.url]),
    };
}
async function loadDoubanMovieSubject(page, subjectId) {
    const normalizedId = normalizeDoubanSubjectId(subjectId);
    const data = await withDetachedRetry(async () => {
        await page.goto(`https://movie.douban.com/subject/${normalizedId}/`, { waitUntil: 'load', settleMs: 1500 });
        await ensureDoubanReady(page);
        await page.wait({ selector: 'span[property="v:itemreviewed"], #info', timeout: 8 }).catch(() => { });
        return page.evaluate(`
    (() => {
      const id = ${JSON.stringify(normalizedId)};
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const { title, originalTitle } = (${splitDoubanTitle.toString()})(normalize(document.querySelector('span[property="v:itemreviewed"]')?.textContent || ''));
      const year = normalize(document.querySelector('.year')?.textContent).replace(/[()（）]/g, '');
      const rating = parseFloat(normalize(document.querySelector('strong[property="v:average"]')?.textContent || '0')) || 0;
      const ratingCount = parseInt(normalize(document.querySelector('span[property="v:votes"]')?.textContent || '0'), 10) || 0;
      const genres = Array.from(document.querySelectorAll('span[property="v:genre"]'))
        .map((node) => normalize(node.textContent))
        .filter(Boolean)
        .join(',');
      const directors = Array.from(document.querySelectorAll('a[rel="v:directedBy"]'))
        .map((node) => normalize(node.textContent))
        .filter(Boolean)
        .join(',');
      const casts = Array.from(document.querySelectorAll('a[rel="v:starring"]'))
        .slice(0, 5)
        .map((node) => normalize(node.textContent))
        .filter(Boolean);
      const infoText = document.querySelector('#info')?.textContent || '';
      let country = [];
      const countryMatch = infoText.match(/制片国家\\/地区:\\s*([^\\n]+)/);
      if (countryMatch) {
        country = countryMatch[1].trim().split(/\\s*\\/\\s*/).filter(Boolean);
      }
      const durationRaw = normalize(document.querySelector('span[property="v:runtime"]')?.textContent || '');
      const durationMatch = durationRaw.match(/(\\d+)/);
      const summary = normalize(document.querySelector('span[property="v:summary"]')?.textContent || '');
      return {
        id,
        type: 'movie',
        title,
        originalTitle,
        year,
        rating,
        ratingCount,
        genres,
        directors,
        casts,
        country,
        duration: durationMatch ? parseInt(durationMatch[1], 10) : null,
        summary: summary.slice(0, 200),
        url: 'https://movie.douban.com/subject/' + id + '/',
      };
    })()
  `);
    });
    return data;
}
async function loadDoubanBookSubject(page, subjectId) {
    const normalizedId = normalizeDoubanSubjectId(subjectId);
    const data = await withDetachedRetry(async () => {
        await page.goto(`https://book.douban.com/subject/${normalizedId}/`, { waitUntil: 'load', settleMs: 1500 });
        await ensureDoubanReady(page);
        await page.wait({ selector: 'h1 span, #info', timeout: 8 }).catch(() => { });
        return page.evaluate(`
    (() => {
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const pickSummary = () => {
        const nodes = Array.from(document.querySelectorAll('#link-report .intro, .related_info .intro'));
        for (let i = nodes.length - 1; i >= 0; i -= 1) {
          const text = normalize(nodes[i]?.textContent);
          if (text) return text;
        }
        return '';
      };
      return {
        id: ${JSON.stringify(normalizedId)},
        title: normalize(document.querySelector('h1 span')?.textContent || document.querySelector('h1')?.textContent || ''),
        subtitle: '',
        originalTitle: '',
        infoText: document.querySelector('#info')?.innerText || document.querySelector('#info')?.textContent || '',
        rating: normalize(document.querySelector('strong.rating_num, strong[property="v:average"]')?.textContent || ''),
        ratingCount: normalize(document.querySelector('a.rating_people > span, span[property="v:votes"]')?.textContent || ''),
        summary: pickSummary(),
        cover: document.querySelector('#mainpic img')?.getAttribute('src') || '',
        url: location.href,
      };
    })()
  `);
    });
    return normalizeDoubanBookSubject(data);
}
export async function loadDoubanSubjectDetail(page, subjectId, subjectType = 'movie') {
    const type = String(subjectType || 'movie').trim() === 'book' ? 'book' : 'movie';
    if (type === 'book') {
        return loadDoubanBookSubject(page, subjectId);
    }
    return loadDoubanMovieSubject(page, subjectId);
}
export async function loadDoubanSubjectPhotos(page, subjectId, options = {}) {
    const normalizedId = normalizeDoubanSubjectId(subjectId);
    const type = String(options.type || 'Rb').trim() || 'Rb';
    const targetPhotoId = String(options.targetPhotoId || '').trim();
    const safeLimit = targetPhotoId ? Number.MAX_SAFE_INTEGER : clampPhotoLimit(Number(options.limit) || 120);
    const resolvePhotoAssetUrlSource = resolveDoubanPhotoAssetUrl.toString();
    const galleryUrl = `https://movie.douban.com/subject/${normalizedId}/photos?type=${encodeURIComponent(type)}`;
    await page.goto(galleryUrl);
    await page.wait(2);
    await ensureDoubanReady(page);
    const data = await page.evaluate(`
    (async () => {
      const subjectId = ${JSON.stringify(normalizedId)};
      const type = ${JSON.stringify(type)};
      const limit = ${safeLimit};
      const targetPhotoId = ${JSON.stringify(targetPhotoId)};
      const pageSize = ${DOUBAN_PHOTO_PAGE_SIZE};
      const resolveDoubanPhotoAssetUrl = ${resolvePhotoAssetUrlSource};

      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const toAbsoluteUrl = (value) => {
        if (!value) return '';
        try {
          return new URL(value, location.origin).toString();
        } catch {
          return value;
        }
      };
      const promotePhotoUrl = (value) => {
        const absolute = toAbsoluteUrl(value);
        if (!absolute) return '';
        if (/^[a-z]+:/i.test(absolute) && !/^https?:/i.test(absolute)) return '';
        return absolute.replace(/\\/view\\/photo\\/[^/]+\\/public\\//, '/view/photo/l/public/');
      };
      const buildPageUrl = (start) => {
        const url = new URL(location.href);
        url.searchParams.set('type', type);
        if (start > 0) url.searchParams.set('start', String(start));
        else url.searchParams.delete('start');
        return url.toString();
      };
      const getTitle = (doc) => {
        const raw = normalize(doc.querySelector('#content h1')?.textContent)
          || normalize(doc.querySelector('title')?.textContent);
        return raw.replace(/\\s*\\(豆瓣\\)\\s*$/, '');
      };
      const extractPhotos = (doc, pageNumber) => {
        const nodes = Array.from(doc.querySelectorAll('.poster-col3 li, .poster-col3l li, .article li'));
        const rows = [];
        for (const node of nodes) {
          const link = node.querySelector('a[href*="/photos/photo/"]');
          const img = node.querySelector('img');
          if (!link || !img) continue;

          const detailUrl = toAbsoluteUrl(link.getAttribute('href') || '');
          const photoId = detailUrl.match(/\\/photo\\/(\\d+)/)?.[1] || '';
          const thumbUrl = resolveDoubanPhotoAssetUrl([
            img.getAttribute('data-origin'),
            img.getAttribute('data-src'),
            img.getAttribute('src'),
          ], location.href);
          const imageUrl = promotePhotoUrl(thumbUrl);
          const title = normalize(link.getAttribute('title'))
            || normalize(img.getAttribute('alt'))
            || (photoId ? 'photo_' + photoId : 'photo_' + String(rows.length + 1));

          if (!detailUrl || !thumbUrl || !imageUrl) continue;

          rows.push({
            photoId,
            title,
            imageUrl,
            thumbUrl,
            detailUrl,
            page: pageNumber,
          });
        }
        return rows;
      };

      const subjectTitle = getTitle(document);
      const seen = new Set();
      const photos = [];

      for (let pageIndex = 0; photos.length < limit; pageIndex += 1) {
        let doc = document;
        if (pageIndex > 0) {
          const response = await fetch(buildPageUrl(pageIndex * pageSize), { credentials: 'include' });
          if (!response.ok) break;
          const html = await response.text();
          doc = new DOMParser().parseFromString(html, 'text/html');
        }

        const pagePhotos = extractPhotos(doc, pageIndex + 1);
        if (!pagePhotos.length) break;

        let appended = 0;
        let foundTarget = false;
        for (const photo of pagePhotos) {
          const key = photo.photoId || photo.detailUrl || photo.imageUrl;
          if (seen.has(key)) continue;
          seen.add(key);
          photos.push({
            index: photos.length + 1,
            ...photo,
          });
          appended += 1;
          if (targetPhotoId && photo.photoId === targetPhotoId) {
            foundTarget = true;
            break;
          }
          if (photos.length >= limit) break;
        }

        if (foundTarget || pagePhotos.length < pageSize || appended === 0) break;
      }

      return {
        subjectId,
        subjectTitle,
        type,
        photos,
      };
    })()
  `);
    const photos = Array.isArray(data?.photos) ? data.photos : [];
    if (!photos.length) {
        throw new EmptyResultError('douban photos', 'No photos found. Try a different subject ID or a different --type value such as Rb.');
    }
    return {
        subjectId: normalizedId,
        subjectTitle: String(data?.subjectTitle || '').trim(),
        type,
        photos,
    };
}
export async function loadDoubanBookHot(page, limit) {
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
export async function loadDoubanMovieHot(page, limit) {
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
export function inferDoubanSearchResultType(searchType, item = {}) {
    const fallbackType = String(searchType || '').trim() || 'movie';
    if (fallbackType !== 'movie') {
        return fallbackType;
    }
    const moreUrl = String(item.moreUrl || item.more_url || '').trim();
    const isTv = moreUrl.match(/is_tv:\s*['"]?([01])['"]?/)?.[1] || '';
    if (isTv === '1') {
        return 'tvshow';
    }
    const labels = Array.isArray(item.labels)
        ? item.labels
            .map((label) => typeof label === 'string' ? label.trim() : String(label?.text || '').trim())
            .filter(Boolean)
        : [];
    return labels.includes('剧集') ? 'tvshow' : fallbackType;
}
export async function searchDouban(page, type, keyword, limit) {
    const safeLimit = clampLimit(limit);
    const inferDoubanSearchResultTypeSource = inferDoubanSearchResultType.toString();
    const searchUrl = buildDoubanSearchUrl(type, keyword);
    const data = await withDetachedRetry(async () => {
        await page.goto(searchUrl, { waitUntil: 'load', settleMs: 1500 });
        await ensureDoubanReady(page);
        await page.wait({ selector: DOUBAN_SEARCH_READY_SELECTOR, timeout: 8 }).catch(() => { });
        return page.evaluate(`
    (async () => {
      const type = ${JSON.stringify(type)};
      const inferDoubanSearchResultType = ${inferDoubanSearchResultTypeSource};
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const seen = new Set();
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const rawItems = Array.isArray(window.__DATA__?.items) ? window.__DATA__.items : [];
      const rawItemsById = new Map(
        rawItems
          .map((item) => [String(item?.id || '').trim(), item])
          .filter(([id]) => id),
      );

      for (let i = 0; i < 20; i += 1) {
        if (document.querySelector('.item-root .title-text, .item-root .title a')) break;
        await sleep(300);
      }

      const items = Array.from(document.querySelectorAll('.item-root, .result-list .result-item'));

      const results = [];
      for (const el of items) {
        const titleEl = el.querySelector('.title-text, .title a, .title h3 a, h3 a, a[title]');
        const title = normalize(titleEl?.textContent) || normalize(titleEl?.getAttribute('title'));
        let url = titleEl?.getAttribute('href') || el.querySelector('a[href*="/subject/"]')?.getAttribute('href') || '';
        if (!title || !url) continue;
        if (!url.startsWith('http')) url = 'https://search.douban.com' + url;
        if (!url.includes('/subject/') || seen.has(url)) continue;
        seen.add(url);
        const id = url.match(/subject\\/(\\d+)/)?.[1] || '';
        const rawItem = rawItemsById.get(id) || {};
        const ratingText = normalize(el.querySelector('.rating_nums')?.textContent);
        const abstract = normalize(
          el.querySelector('.meta.abstract, .meta, .abstract, .subject-abstract, p')?.textContent,
        );
        results.push({
          rank: results.length + 1,
          id,
          type: inferDoubanSearchResultType(type, rawItem),
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
    });
    return Array.isArray(data) ? data : [];
}
/**
 * Get current user's Douban ID from movie.douban.com/mine page
 */
export async function getSelfUid(page) {
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
