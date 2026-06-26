import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

// Nowcoder's logged-in token cookie is `t`. The numeric uid is not in any
// readable cookie (NOWCODERUID is a device hash), so identity is resolved from
// the server-rendered nav avatar link `/users/<uid>` (first /users/ link in
// DOM order, ahead of body feed recommendations) and confirmed through the
// gateway profile API.
async function hasNowcoderSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://www.nowcoder.com' });
  return cookies.some(cookie => cookie.name === 't' && cookie.value);
}

const WHOAMI_PROBE = `(async () => {
  try {
    const link = document.querySelector('a[href*="/users/"]');
    const href = link ? (link.getAttribute('href') || '') : '';
    const match = href.match(/\\/users\\/(\\d+)/);
    if (!match) {
      return { kind: 'auth', detail: 'No logged-in nowcoder profile link in nav (anonymous)' };
    }
    const uid = match[1];
    const r = await fetch('https://gw-c.nowcoder.com/api/sparta/user/profile/' + uid, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (r.status === 401 || r.status === 403) return { kind: 'auth', detail: 'nowcoder profile HTTP ' + r.status };
    if (!r.ok) return { kind: 'http', httpStatus: r.status };
    const d = await r.json();
    if (!d || !d.success || !d.data || !d.data.id) {
      return { kind: 'auth', detail: 'nowcoder profile returned no user data (anonymous)' };
    }
    return { ok: true, user_id: String(d.data.id), nickname: String(d.data.nickname || '') };
  } catch (e) {
    return { kind: 'exception', detail: String(e && e.message || e) };
  }
})()`;

async function verifyNowcoderIdentity(page) {
  if (!await hasNowcoderSessionCookie(page)) {
    throw new AuthRequiredError('nowcoder.com', 'Nowcoder t cookie missing (anonymous)');
  }
  await page.goto('https://www.nowcoder.com/');
  await page.wait(2);
  const probe = await page.evaluate(WHOAMI_PROBE);
  if (probe?.kind === 'auth') throw new AuthRequiredError('nowcoder.com', probe.detail);
  if (probe?.kind === 'http') throw new CommandExecutionError(`HTTP ${probe.httpStatus} from nowcoder profile API`);
  if (probe?.kind === 'exception') throw new CommandExecutionError(`Nowcoder whoami failed: ${probe.detail}`);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected nowcoder probe: ${JSON.stringify(probe)}`);
  return { user_id: probe.user_id, nickname: probe.nickname };
}

registerSiteAuthCommands({
  site: 'nowcoder',
  domain: 'nowcoder.com',
  loginUrl: 'https://www.nowcoder.com/login',
  columns: ['user_id', 'nickname'],
  verify: verifyNowcoderIdentity,
  poll: async (page) => {
    if (!await hasNowcoderSessionCookie(page)) {
      throw new AuthRequiredError('nowcoder.com', 'Waiting for Nowcoder login');
    }
    return verifyNowcoderIdentity(page);
  },
});
