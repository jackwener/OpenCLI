import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

/**
 * 即刻适配器公共定义
 *
 * JikePost 接口和 getPostData 函数在 feed.ts / search.ts 中复用，
 * 统一维护于此文件避免重复。
 */

const JIKE_IDENTITY_PROBE = `(async () => {
  try {
    const token = localStorage.getItem('JK_ACCESS_TOKEN') || '';
    if (!token) return { kind: 'auth', detail: 'Jike JK_ACCESS_TOKEN missing from localStorage (anonymous)' };
    const r = await fetch('https://api.ruguoapp.com/1.0/users/profile', {
      headers: { 'x-jike-access-token': token, Accept: 'application/json' },
    });
    if (r.status === 401 || r.status === 403) return { kind: 'auth', detail: 'Jike users/profile HTTP ' + r.status };
    if (!r.ok) return { kind: 'http', httpStatus: r.status };
    const d = await r.json();
    const u = d && d.user;
    if (!u || !u.id) return { kind: 'auth', detail: 'Jike users/profile returned no user (anonymous)' };
    return { ok: true, user_id: String(u.id), screen_name: String(u.screenName || ''), username: String(u.username || '') };
  } catch (e) {
    return { kind: 'exception', detail: String(e && e.message || e) };
  }
})()`;

export async function requireJikeIdentity(page) {
  const probe = await page.evaluate(JIKE_IDENTITY_PROBE);
  if (probe?.kind === 'auth') throw new AuthRequiredError('web.okjike.com', probe.detail);
  if (probe?.kind === 'http') throw new CommandExecutionError(`HTTP ${probe.httpStatus} from Jike users/profile`);
  if (probe?.kind === 'exception') throw new CommandExecutionError(`Jike identity probe failed: ${probe.detail}`);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected Jike identity probe: ${JSON.stringify(probe)}`);
  return { user_id: probe.user_id, screen_name: probe.screen_name, username: probe.username };
}

export function normalizeJikeLimit(raw, defaultValue = 20) {
  const limit = raw ?? defaultValue;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new ArgumentError('--limit must be a positive integer');
  }
  return limit;
}

export async function postJikeApi(page, path, requestBody, label) {
  const url = `https://api.ruguoapp.com${path}`;
  const outcome = await page.evaluate(`(async () => {
    const token = localStorage.getItem('JK_ACCESS_TOKEN') || '';
    const deviceId = localStorage.getItem('JK_DEVICE_ID') || '';
    if (!token) return { kind: 'auth', detail: 'Jike access token is missing' };
    const headers = {
      'content-type': 'application/json',
      'x-jike-access-token': token,
      platform: 'web',
    };
    if (deviceId) headers['x-jike-device-id'] = deviceId;
    try {
      const response = await fetch(${JSON.stringify(url)}, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(${JSON.stringify(requestBody)}),
      });
      let body;
      try {
        body = await response.json();
      } catch (error) {
        return { kind: 'json', status: response.status, detail: String(error?.message || error) };
      }
      return { kind: 'response', status: response.status, body };
    } catch (error) {
      return { kind: 'transport', detail: String(error?.message || error) };
    }
  })()`);
  if (outcome?.kind === 'auth' || outcome?.status === 401 || outcome?.status === 403) {
    throw new AuthRequiredError('web.okjike.com', outcome?.detail || `${label} returned HTTP ${outcome?.status}`);
  }
  if (outcome?.kind === 'transport') {
    throw new CommandExecutionError(`${label} request failed: ${outcome.detail}`);
  }
  if (outcome?.kind === 'json') {
    throw new CommandExecutionError(`${label} returned invalid JSON: ${outcome.detail}`);
  }
  if (outcome?.kind !== 'response' || !Number.isInteger(outcome.status)) {
    throw new CommandExecutionError(`${label} returned an unexpected response`);
  }
  if (outcome.status < 200 || outcome.status >= 300) {
    throw new CommandExecutionError(`${label} returned HTTP ${outcome.status}`);
  }
  return outcome.body;
}

/**
 * 注入浏览器 evaluate 的 JS 函数字符串。
 * 从 React fiber 树中向上最多走 10 层，找到含 id 字段的 props.data。
 */
export const getPostDataJs = `
function getPostData(element) {
  for (const key of Object.keys(element)) {
    if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
      let fiber = element[key];
      for (let i = 0; i < 10 && fiber; i++) {
        const props = fiber.memoizedProps || fiber.pendingProps;
        if (props && props.data && props.data.id) return props.data;
        fiber = fiber.return;
      }
    }
  }
  return null;
}
`.trim();
