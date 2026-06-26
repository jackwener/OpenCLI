import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

// Quark's auth cookies (__pus / __kp / __puus) are httpOnly. The account/info
// endpoint returns HTTP 200 with an empty `data` array when anonymous and a
// populated object once logged in, so the poll uses a no-nav probe of it.
const WHOAMI_PROBE = `(async () => {
  try {
    const r = await fetch('https://pan.quark.cn/account/info?fr=pc&platform=pc', { credentials: 'include', headers: { Accept: 'application/json' } });
    if (r.status === 401 || r.status === 403) return { kind: 'auth', detail: 'Quark account/info HTTP ' + r.status };
    if (!r.ok) return { kind: 'http', httpStatus: r.status };
    const d = await r.json();
    const data = d && d.data;
    const isEmpty = !data || Array.isArray(data) || Object.keys(data).length === 0;
    if (isEmpty) return { kind: 'auth', detail: 'Quark account/info returned empty data — anonymous' };
    const nickname = String(data.nickname || data.nick_name || data.name || '');
    if (!nickname) return { kind: 'render-error', detail: 'Quark account/info populated but no nickname field — response shape drift' };
    return { ok: true, nickname };
  } catch (e) {
    return { kind: 'exception', detail: String(e && e.message || e) };
  }
})()`;

async function verifyQuarkIdentity(page) {
  await page.goto('https://pan.quark.cn/');
  await page.wait(2);
  const probe = await page.evaluate(WHOAMI_PROBE);
  if (probe?.kind === 'auth') throw new AuthRequiredError('quark.cn', probe.detail);
  if (probe?.kind === 'http') throw new CommandExecutionError(`HTTP ${probe.httpStatus} from Quark account/info`);
  if (probe?.kind === 'render-error') throw new CommandExecutionError(probe.detail);
  if (probe?.kind === 'exception') throw new CommandExecutionError(`Quark whoami failed: ${probe.detail}`);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected Quark probe: ${JSON.stringify(probe)}`);
  return { nickname: probe.nickname };
}

registerSiteAuthCommands({
  site: 'quark',
  domain: 'quark.cn',
  loginUrl: 'https://pan.quark.cn/',
  columns: ['nickname'],
  verify: verifyQuarkIdentity,
  poll: async (page) => {
    const probe = await page.evaluate(WHOAMI_PROBE);
    if (!probe?.ok) throw new AuthRequiredError('quark.cn', 'Waiting for Quark login');
    return { nickname: probe.nickname };
  },
});
