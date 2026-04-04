/**
 * Douban adapter utilities.
 */

import { ArgumentError, CliError, EmptyResultError } from '../../errors.js';
import type { IPage } from '../../types.js';
import { clamp } from '../_shared/common.js';

const DOUBAN_PHOTO_PAGE_SIZE = 30;
const MAX_DOUBAN_PHOTOS = 500;

const clampLimit = (limit: number) => clamp(limit || 20, 1, 50);
const clampPhotoLimit = (limit: number) => clamp(limit || 120, 1, MAX_DOUBAN_PHOTOS);

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

export interface DoubanSubjectPhoto {
  index: number;
  photoId: string;
  title: string;
  imageUrl: string;
  thumbUrl: string;
  detailUrl: string;
  page: number;
}

export interface DoubanSubjectPhotosResult {
  subjectId: string;
  subjectTitle: string;
  type: string;
  photos: DoubanSubjectPhoto[];
}

export interface LoadDoubanSubjectPhotosOptions {
  type?: string;
  limit?: number;
  targetPhotoId?: string;
}

export function normalizeDoubanSubjectId(subjectId: string): string {
  const normalized = String(subjectId || '').trim();
  if (!/^\d+$/.test(normalized)) {
    throw new ArgumentError(`Invalid Douban subject ID: ${subjectId}`);
  }
  return normalized;
}

export function promoteDoubanPhotoUrl(url: string, size: 's' | 'm' | 'l' = 'l'): string {
  const normalized = String(url || '').trim();
  if (!normalized) return '';
  if (/^[a-z]+:/i.test(normalized) && !/^https?:/i.test(normalized)) return '';
  return normalized.replace(/\/view\/photo\/[^/]+\/public\//, `/view/photo/${size}/public/`);
}

export function resolveDoubanPhotoAssetUrl(
  candidates: Array<string | null | undefined>,
  baseUrl = '',
): string {
  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim();
    if (!normalized) continue;

    let resolved = normalized;
    try {
      resolved = baseUrl
        ? new URL(normalized, baseUrl).toString()
        : new URL(normalized).toString();
    } catch {
      resolved = normalized;
    }

    if (/^https?:\/\//i.test(resolved)) {
      return resolved;
    }
  }

  return '';
}

export function getDoubanPhotoExtension(url: string): string {
  const normalized = String(url || '').trim();
  if (!normalized) return '.jpg';

  try {
    const ext = new URL(normalized).pathname.match(/\.(jpe?g|png|gif|webp|avif|bmp)$/i)?.[0];
    return ext || '.jpg';
  } catch {
    const ext = normalized.match(/\.(jpe?g|png|gif|webp|avif|bmp)(?:$|[?#])/i)?.[0];
    return ext ? ext.replace(/[?#].*$/, '') : '.jpg';
  }
}

export async function loadDoubanSubjectPhotos(
  page: IPage,
  subjectId: string,
  options: LoadDoubanSubjectPhotosOptions = {},
): Promise<DoubanSubjectPhotosResult> {
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
    throw new EmptyResultError(
      'douban photos',
      'No photos found. Try a different subject ID or a different --type value such as Rb.',
    );
  }

  return {
    subjectId: normalizedId,
    subjectTitle: String(data?.subjectTitle || '').trim(),
    type,
    photos,
  };
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
