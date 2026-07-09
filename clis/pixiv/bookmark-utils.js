import { CommandExecutionError } from '@jackwener/opencli/errors';
import { getCurrentPixivUser, pixivFetch } from './utils.js';

export function normalizeBookmarkType(value) {
  const type = String(value ?? 'illust').trim();
  if (type !== 'illust' && type !== 'novel') {
    throw new CommandExecutionError(`Invalid bookmark type: ${type}. Expected "illust" or "novel".`);
  }
  return type;
}

export function dateOnly(value) {
  return typeof value === 'string' && value ? value.split('T')[0] : '';
}

export function tagsToString(tags) {
  if (Array.isArray(tags)) {
    return tags.map(t => typeof t === 'string' ? t : t?.tag).filter(Boolean).join(', ');
  }
  if (Array.isArray(tags?.tags)) {
    return tags.tags.map(t => typeof t === 'string' ? t : t?.tag).filter(Boolean).join(', ');
  }
  return '';
}

export function normalizeBookmarkWorks(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.works)) return body.works;
  if (body?.works && typeof body.works === 'object') return Object.values(body.works);
  return [];
}

export function bookmarkRow(work, index, type) {
  const id = String(work?.id ?? work?.illustId ?? work?.novelId ?? '');
  const isNovel = type === 'novel';
  return {
    rank: index + 1,
    type,
    title: work?.title || work?.illustTitle || '',
    author: work?.userName || work?.user_name || '',
    user_id: String(work?.userId ?? work?.user_id ?? ''),
    illust_id: isNovel ? '' : id,
    novel_id: isNovel ? id : '',
    pages: isNovel ? '' : (work?.pageCount ?? work?.page_count ?? 1),
    words: isNovel ? (work?.wordCount ?? work?.textCount ?? work?.characterCount ?? '') : '',
    bookmarks: work?.bookmarkCount ?? work?.totalBookmarks ?? 0,
    tags: tagsToString(work?.tags),
    created: dateOnly(work?.createDate ?? work?.created_at),
    url: isNovel ? `https://www.pixiv.net/novel/show.php?id=${id}` : `https://www.pixiv.net/artworks/${id}`,
  };
}

export async function fetchCurrentBookmarks(page, kwargs = {}) {
  const type = normalizeBookmarkType(kwargs.type);
  const limit = Math.max(1, Math.min(Number(kwargs.limit) || 20, 100));
  const offset = Math.max(0, Number(kwargs.offset) || 0);
  const visibility = String(kwargs.visibility ?? kwargs.rest ?? 'show');
  if (visibility !== 'show' && visibility !== 'hide') {
    throw new CommandExecutionError(`Invalid bookmark visibility: ${visibility}. Expected "show" or "hide".`);
  }
  const user = await getCurrentPixivUser(page);
  const path = type === 'novel'
    ? `/ajax/user/${user.id}/novels/bookmarks`
    : `/ajax/user/${user.id}/illusts/bookmarks`;
  const body = await pixivFetch(page, path, {
    params: { tag: '', offset, limit, rest: visibility },
  });
  return normalizeBookmarkWorks(body).slice(0, limit).map((work, i) => bookmarkRow(work, offset + i, type));
}
