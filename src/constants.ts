/**
 * Shared constants used across explore, synthesize, and pipeline modules.
 */

/** Default daemon port for HTTP/WebSocket communication with browser extension */
export const DEFAULT_DAEMON_PORT = 19825;

/** URL query params that are volatile/ephemeral and should be stripped from patterns */
export const VOLATILE_PARAMS = new Set([
  'w_rid', 'wts', '_', 'callback', 'timestamp', 't', 'nonce', 'sign',
]);

/** Search-related query parameter names */
export const SEARCH_PARAMS = new Set([
  'q', 'query', 'keyword', 'search', 'wd', 'kw', 'search_query', 'w',
]);

/** Pagination-related query parameter names */
export const PAGINATION_PARAMS = new Set([
  'page', 'pn', 'offset', 'cursor', 'next', 'page_num',
]);

/** Limit/page-size query parameter names */
export const LIMIT_PARAMS = new Set([
  'limit', 'count', 'size', 'per_page', 'page_size', 'ps', 'num',
]);

/** Field role → common API field names mapping */
export const FIELD_ROLES: Record<string, string[]> = {
  title:    ['title', 'name', 'text', 'content', 'desc', 'description', 'headline', 'subject'],
  url:      ['url', 'uri', 'link', 'href', 'permalink', 'jump_url', 'web_url', 'share_url'],
  author:   ['author', 'username', 'user_name', 'nickname', 'nick', 'owner', 'creator', 'up_name', 'uname'],
  score:    ['score', 'hot', 'heat', 'likes', 'like_count', 'view_count', 'views', 'play', 'favorite_count', 'reply_count'],
  time:     ['time', 'created_at', 'publish_time', 'pub_time', 'date', 'ctime', 'mtime', 'pubdate', 'created'],
  id:       ['id', 'aid', 'bvid', 'mid', 'uid', 'oid', 'note_id', 'item_id'],
  cover:    ['cover', 'pic', 'image', 'thumbnail', 'poster', 'avatar'],
  category: ['category', 'tag', 'type', 'tname', 'channel', 'section'],
};
