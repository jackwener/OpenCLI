import { ArgumentError, AuthRequiredError, CliError } from '@jackwener/opencli/errors';
const SITE_DOMAIN = 'wx.zsxq.com';
const SITE_URL = 'https://wx.zsxq.com';
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
function pickArray(...values) {
    for (const value of values) {
        if (Array.isArray(value)) {
            return value;
        }
    }
    return [];
}
export async function ensureZsxqPage(page) {
    await page.goto(SITE_URL);
}
export async function ensureZsxqAuth(page) {
    // zsxq uses httpOnly cookies that may be on different subdomains.
    // Verify auth by attempting a lightweight API call instead of checking cookies.
    try {
        const result = await page.evaluate(`
      (async () => {
        try {
          const r = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', 'https://api.zsxq.com/v2/groups', true);
            xhr.withCredentials = true;
            xhr.setRequestHeader('accept', 'application/json');
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                try { resolve(JSON.parse(xhr.responseText)); }
                catch { resolve(null); }
              } else { resolve(null); }
            };
            xhr.onerror = () => resolve(null);
            xhr.send();
          });
          return r !== null;
        } catch { return false; }
      })()
    `);
        if (!result) {
            throw new AuthRequiredError('zsxq.com');
        }
    }
    catch (err) {
        if (err instanceof AuthRequiredError)
            throw err;
        throw new AuthRequiredError('zsxq.com');
    }
}
export async function getCookieValue(page, name) {
    const cookies = await page.getCookies({ domain: SITE_DOMAIN });
    return cookies.find(cookie => cookie.name === name)?.value;
}
export async function getActiveGroupId(page) {
    const groupId = await page.evaluate(`
    (() => {
      const target = localStorage.getItem('target_group');
      if (target) {
        try {
          const parsed = JSON.parse(target);
          if (parsed.group_id) return String(parsed.group_id);
        } catch {}
      }
      return null;
    })()
  `);
    if (groupId)
        return groupId;
    throw new ArgumentError('Cannot determine active group_id', 'Pass --group_id <id> or open the target 知识星球 page in Chrome first');
}
export async function browserJsonRequest(page, path) {
    return await page.evaluate(`
    (async () => {
      const path = ${JSON.stringify(path)};

      try {
        return await new Promise((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', path, true);
          xhr.withCredentials = true;
          xhr.setRequestHeader('accept', 'application/json, text/plain, */*');
          xhr.onload = () => {
            let parsed = null;
            if (xhr.responseText) {
              try { parsed = JSON.parse(xhr.responseText); }
              catch {}
            }

            resolve({
              ok: xhr.status >= 200 && xhr.status < 300,
              url: path,
              status: xhr.status,
              data: parsed,
              error: xhr.status >= 200 && xhr.status < 300 ? undefined : 'HTTP ' + xhr.status,
            });
          };
          xhr.onerror = () => resolve({
            ok: false,
            url: path,
            error: 'Network error',
          });
          xhr.send();
        });
      } catch (error) {
        return {
          ok: false,
          url: path,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })()
  `);
}
export async function fetchFirstJson(page, paths) {
    let lastFailure = null;
    for (const path of paths) {
        const result = await browserJsonRequest(page, path);
        if (result.ok) {
            return result;
        }
        lastFailure = result;
    }
    if (!lastFailure) {
        throw new CliError('FETCH_ERROR', 'No candidate endpoint returned JSON', `Checked endpoints: ${paths.join(', ')}`);
    }
    throw new CliError('FETCH_ERROR', lastFailure.error || 'Failed to fetch ZSXQ API', `Checked endpoints: ${paths.join(', ')}`);
}
export function unwrapRespData(payload) {
    const record = asRecord(payload);
    if (!record) {
        throw new CliError('PARSE_ERROR', 'Invalid ZSXQ API response');
    }
    if (record.succeeded === false) {
        const code = typeof record.code === 'number' ? String(record.code) : 'API_ERROR';
        const message = typeof record.info === 'string'
            ? record.info
            : typeof record.error === 'string'
                ? record.error
                : 'ZSXQ API returned an error';
        throw new CliError(code, message);
    }
    return (record.resp_data ?? record.data ?? payload);
}
export function getTopicsFromResponse(payload) {
    const data = unwrapRespData(payload);
    if (Array.isArray(data))
        return data;
    return pickArray(data.topics, data.list, data.records, data.items, data.search_result);
}
export function getCommentsFromResponse(payload) {
    const data = unwrapRespData(payload);
    if (Array.isArray(data))
        return data;
    return pickArray(data.comments, data.list, data.items);
}
export function getGroupsFromResponse(payload) {
    const data = unwrapRespData(payload);
    if (Array.isArray(data))
        return data;
    return pickArray(data.groups, data.list, data.items);
}
export function getTopicFromResponse(payload) {
    const data = unwrapRespData(payload);
    if (Array.isArray(data))
        return data[0] ?? null;
    if (typeof data.topic_id === 'number' || typeof data.topic_id === 'string')
        return data;
    const record = asRecord(data);
    if (!record)
        return null;
    const topic = record.topic;
    return topic && typeof topic === 'object' ? topic : null;
}
export function getTopicAuthor(topic) {
    return (topic.owner?.name ||
        topic.talk?.owner?.name ||
        topic.question?.owner?.name ||
        topic.answer?.owner?.name ||
        topic.task?.owner?.name ||
        topic.solution?.owner?.name ||
        '');
}
export function getTopicText(topic) {
    const primary = [
        topic.title,
        topic.talk?.text,
        topic.question?.text,
        topic.answer?.text,
        topic.task?.text,
        topic.solution?.text,
    ].find(value => typeof value === 'string' && value.trim());
    return (primary || '').replace(/\s+/g, ' ').trim();
}
export function getTopicUrl(topicId) {
    return topicId ? `${SITE_URL}/topic/${topicId}` : SITE_URL;
}
export function summarizeComments(comments, limit = 3) {
    return comments
        .slice(0, limit)
        .map((comment) => {
        const author = comment.owner?.name || '匿名';
        const target = comment.repliee?.name ? ` -> ${comment.repliee.name}` : '';
        const text = (comment.text || '').replace(/\s+/g, ' ').trim();
        return `${author}${target}: ${text}`;
    })
        .join(' | ');
}
export function toTopicRow(topic) {
    const topicId = topic.topic_id ?? '';
    const comments = pickArray(topic.show_comments, topic.comments);
    return {
        topic_id: topicId,
        type: topic.type || '',
        group: topic.group?.name || '',
        author: getTopicAuthor(topic),
        title: getTopicText(topic).slice(0, 120),
        content: getTopicText(topic),
        comments: topic.comments_count ?? comments.length ?? 0,
        likes: topic.likes_count ?? 0,
        readers: topic.readers_count ?? topic.reading_count ?? 0,
        time: topic.create_time || '',
        comment_preview: summarizeComments(comments),
        url: getTopicUrl(topicId),
    };
}
