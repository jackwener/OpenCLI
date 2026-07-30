import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
  getCurrentPixivUser,
  normalizePixivNonNegativeInteger,
  normalizePixivPositiveInteger,
  pixivFetch,
  requirePixivId,
  requirePixivPayloadObject,
  requirePixivString,
} from './utils.js';

export function normalizeBookmarkType(value) {
  const type = String(value ?? 'illust').trim();
  if (type !== 'illust' && type !== 'novel') {
    throw new ArgumentError(`Invalid bookmark type: ${type}. Expected "illust" or "novel".`);
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
  throw new CommandExecutionError('Pixiv bookmarks returned malformed payload');
}

export function bookmarkRow(work, index, type) {
  const item = requirePixivPayloadObject(work, 'Pixiv bookmark item');
  const isNovel = type === 'novel';
  const id = requirePixivId(item.id ?? (isNovel ? item.novelId : item.illustId), 'Pixiv bookmark item');
  const title = requirePixivString(item.title ?? item.illustTitle, 'Pixiv bookmark item');
  const author = requirePixivString(item.userName ?? item.user_name, 'Pixiv bookmark item');
  const userId = requirePixivId(item.userId ?? item.user_id, 'Pixiv bookmark item');
  return {
    rank: index + 1,
    type,
    title,
    author,
    user_id: userId,
    illust_id: isNovel ? '' : id,
    novel_id: isNovel ? id : '',
    pages: isNovel ? '' : (item.pageCount ?? item.page_count ?? 1),
    words: isNovel ? (item.wordCount ?? item.textCount ?? item.characterCount ?? '') : '',
    bookmarks: item.bookmarkCount ?? item.totalBookmarks ?? 0,
    tags: tagsToString(item.tags),
    created: dateOnly(item.createDate ?? item.created_at),
    url: isNovel ? `https://www.pixiv.net/novel/show.php?id=${id}` : `https://www.pixiv.net/artworks/${id}`,
  };
}

export async function fetchCurrentBookmarks(page, kwargs = {}) {
  const type = normalizeBookmarkType(kwargs.type);
  const limit = normalizePixivPositiveInteger(kwargs.limit, 20, 'limit', { max: 100 });
  const offset = normalizePixivNonNegativeInteger(kwargs.offset, 0, 'offset');
  const visibility = String(kwargs.visibility ?? kwargs.rest ?? 'show');
  if (visibility !== 'show' && visibility !== 'hide') {
    throw new ArgumentError(`Invalid bookmark visibility: ${visibility}. Expected "show" or "hide".`);
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
