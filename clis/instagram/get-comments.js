/**
 * Instagram get-comments — fetch comments on one of a user's recent posts.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

function readLimit(raw) {
    const limit = Number(raw ?? 20);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new ArgumentError('Argument "limit" must be an integer in [1, 50].');
    }
    return limit;
}

function parseInstagramTarget(raw) {
    const value = String(raw || '').trim();
    if (!value) {
        throw new ArgumentError('Instagram username or post URL is required');
    }
    if (/^https?:\/\//i.test(value)) {
        let url;
        try {
            url = new URL(value);
        }
        catch {
            throw new ArgumentError(`Invalid Instagram URL: ${value}`);
        }
        if (!/(^|\.)instagram\.com$/i.test(url.hostname)) {
            throw new ArgumentError(`URL must be on instagram.com (got ${url.hostname})`);
        }
        const match = url.pathname.match(/^\/(?:p|reel|tv)\/([^/?#]+)/i);
        if (!match) {
            throw new ArgumentError('Instagram URL must point to /p/<shortcode>, /reel/<shortcode>, or /tv/<shortcode>');
        }
        return { kind: 'shortcode', shortcode: match[1], navigationUrl: `https://www.instagram.com/p/${match[1]}/` };
    }
    if (/^[A-Za-z0-9_-]{5,}$/.test(value) && !value.includes('.') && !value.startsWith('@')) {
        // Ambiguous values are preserved as usernames for backward compatibility.
        return { kind: 'username', username: value.replace(/^@+/, ''), navigationUrl: `https://www.instagram.com/${value.replace(/^@+/, '')}/` };
    }
    const username = value.replace(/^@+/, '');
    if (!/^[A-Za-z0-9._]{1,30}$/.test(username)) {
        throw new ArgumentError(`Invalid Instagram username or shortcode: ${value}`);
    }
    return { kind: 'username', username, navigationUrl: `https://www.instagram.com/${username}/` };
}

export function buildInstagramCommentsScript(target, index, limit) {
    return `(async () => {
      const target = ${JSON.stringify(target)};
      const idx = ${index} - 1;
      const limit = ${limit};
      const cleanText = (value, max = 300) => String(value ?? '').replace(/\\s+/g, ' ').trim().slice(0, max);
      const getCookie = (name) => {
        const prefix = name + '=';
        let cookieText = '';
        try {
          cookieText = document.cookie || '';
        } catch {
          return '';
        }
        for (const part of cookieText.split('; ')) {
          if (part.startsWith(prefix)) return decodeURIComponent(part.slice(prefix.length));
        }
        return '';
      };
      const html = document.documentElement?.outerHTML || '';
      const pick = (patterns) => {
        for (const pattern of patterns) {
          const match = html.match(pattern);
          if (match) return match[1] || '';
        }
        return '';
      };
      const appId = pick([/"X-IG-App-ID":"(\\d+)"/, /"appId":"(\\d+)"/, /"instagramWebAppId":"(\\d+)"/]) || '936619743392459';
      const csrf = getCookie('csrftoken') || pick([/"csrf_token":"([^"]+)"/, /"csrfToken":"([^"]+)"/]);
      const headers = {
        'Accept': 'application/json,text/plain,*/*',
        'X-IG-App-ID': appId,
        'X-ASBD-ID': '129477',
        'X-Requested-With': 'XMLHttpRequest',
      };
      if (csrf) headers['X-CSRFToken'] = csrf;

      async function fetchJson(url) {
        const res = await fetch(new URL(url, 'https://www.instagram.com').toString(), {
          credentials: 'include',
          headers,
        });
        const text = await res.text();
        if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + url + ': ' + text.slice(0, 160));
        if (!text.trim()) return {};
        try {
          return JSON.parse(text);
        } catch (error) {
          throw new Error('invalid JSON from ' + url + ': ' + String(error?.message || error));
        }
      }

      function walkObjects(root, visit) {
        const stack = [root];
        const seen = new Set();
        while (stack.length) {
          const current = stack.pop();
          if (!current || typeof current !== 'object' || seen.has(current)) continue;
          seen.add(current);
          if (visit(current) === true) return true;
          if (Array.isArray(current)) {
            for (const item of current) stack.push(item);
          } else {
            for (const value of Object.values(current)) {
              if (value && typeof value === 'object') stack.push(value);
            }
          }
        }
        return false;
      }

      function normalizeMediaPk(value) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        return raw.includes('_') ? raw.split('_')[0] : raw;
      }

      function findMediaOnPage(shortcode) {
        let found = null;
        for (const script of Array.from(document.querySelectorAll('script'))) {
          const text = script.textContent || '';
          if (!text.includes(shortcode)) continue;
          const trimmed = text.trim();
          if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) {
            const local = text.match(/"(?:pk|id|media_id)"\\s*:\\s*"?([0-9_]+)"?/);
            if (local) return { pk: normalizeMediaPk(local[1]), shortcode };
            continue;
          }
          try {
            const data = JSON.parse(trimmed);
            walkObjects(data, (node) => {
              const code = String(node.shortcode || node.code || '').trim();
              if (code !== shortcode) return false;
              const pk = normalizeMediaPk(node.pk || node.id || node.media_id);
              if (!pk) return false;
              found = { pk, shortcode };
              return true;
            });
            if (found) return found;
          } catch {
            // Keep scanning other script tags.
          }
        }
        return null;
      }

      async function resolveMedia() {
        if (target.kind === 'shortcode') {
          const fromPage = findMediaOnPage(target.shortcode);
          if (fromPage?.pk) return fromPage;
          try {
            const info = await fetchJson('/api/v1/media/' + encodeURIComponent(target.shortcode) + '/info/');
            const item = info.items?.[0] || info.media || info.data;
            const pk = normalizeMediaPk(item?.pk || item?.id || item?.media_id);
            if (pk) return { pk, shortcode: target.shortcode };
          } catch {
            // Fall through to the explicit error below.
          }
          throw new Error('Could not resolve media id for shortcode ' + target.shortcode);
        }

        const userData = await fetchJson('/api/v1/users/web_profile_info/?username=' + encodeURIComponent(target.username));
        const user = userData?.data?.user;
        if (!user?.id) throw new Error('User ID not found for ' + target.username);
        const edges = user.edge_owner_to_timeline_media?.edges || [];
        const node = edges[idx]?.node;
        if (node?.id) return { pk: normalizeMediaPk(node.id), shortcode: node.shortcode || '' };

        const feed = await fetchJson('/api/v1/feed/user/' + user.id + '/?count=' + (idx + 1));
        const posts = feed.items || [];
        if (idx >= posts.length) throw new Error('Post index ' + (idx + 1) + ' not found for ' + target.username);
        return { pk: normalizeMediaPk(posts[idx].pk || posts[idx].id), shortcode: posts[idx].code || posts[idx].shortcode || '' };
      }

      const pageText = cleanText(document.body?.innerText || '', 1000);
      if (/log in|login|sign up|captcha|challenge/i.test(pageText) && !getCookie('sessionid')) {
        throw new Error('AUTH_REQUIRED: Instagram comments require a logged-in browser session');
      }

      const media = await resolveMedia();
      if (!media.pk) throw new Error('Could not resolve Instagram media id');
      const commentsData = await fetchJson('/api/v1/media/' + media.pk + '/comments/?can_support_threading=true&count=' + limit);
      const comments = commentsData.comments || commentsData.comment_list || [];
      return comments.slice(0, limit).map(function(c, i) {
        return {
          rank: i + 1,
          comment_id: String(c.pk || c.id || ''),
          author: c.user?.username || c.user?.full_name || '',
          text: cleanText(c.text || c.comment_text || '', 300),
          likes: c.comment_like_count || c.like_count || 0,
          replies_count: c.child_comment_count || c.preview_child_comments?.length || 0,
          time: c.created_at ? new Date(c.created_at * 1000).toISOString().replace('T', ' ').substring(0, 19) : '',
        };
      }).filter(row => row.comment_id && row.text);
    })()`;
}

export const command = cli({
    site: 'instagram',
    name: 'get-comments',
    access: 'read',
    description: 'Get comments on an Instagram post with reply-able IDs',
    domain: 'www.instagram.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'username', type: 'string', required: true, positional: true, help: 'Username of the post author, or a post/reel URL' },
        { name: 'index', type: 'int', default: 1, help: 'Post index (1 = most recent)' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of comments to return' },
    ],
    columns: ['rank', 'comment_id', 'author', 'text', 'likes', 'replies_count', 'time'],
    func: async (page, kwargs) => {
        const target = parseInstagramTarget(kwargs.username);
        const index = Math.max(1, Number(kwargs.index ?? 1));
        const limit = readLimit(kwargs.limit);
        await page.goto(target.navigationUrl);
        try {
            const rows = await page.evaluate(buildInstagramCommentsScript(target, index, limit));
            if (!Array.isArray(rows) || rows.length === 0) {
                throw new EmptyResultError('instagram/get-comments', 'No comments found');
            }
            return rows;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (/AUTH_REQUIRED|HTTP 401|HTTP 403|login|challenge|captcha/i.test(message)) {
                throw new AuthRequiredError('www.instagram.com', 'Instagram comments require a logged-in browser session');
            }
            if (/No comments found/i.test(message)) {
                throw new EmptyResultError('instagram/get-comments', message);
            }
            throw new CommandExecutionError(`Instagram comments read failed: ${message}`);
        }
    },
});

export const __test__ = {
    buildInstagramCommentsScript,
    parseInstagramTarget,
};
