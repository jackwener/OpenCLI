import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

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
