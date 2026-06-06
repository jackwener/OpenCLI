import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasClaudeSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://claude.ai' });
  return cookies.some(c => c.name === 'sessionKey' && c.value);
}

async function verifyClaudeIdentity(page) {
  if (!await hasClaudeSessionCookie(page)) {
    throw new AuthRequiredError('claude.ai', 'Claude sessionKey cookie missing');
  }
  await page.goto('https://claude.ai/');
  await page.wait(2);
  const result = await page.evaluate(`(async () => {
    try {
      const res = await fetch('/api/organizations', { credentials: 'include' });
      if (res.status === 401 || res.status === 403) {
        return { kind: 'auth', detail: 'Claude /api/organizations HTTP ' + res.status };
      }
      if (!res.ok) return { kind: 'http', httpStatus: res.status };
      const d = await res.json();
      if (!Array.isArray(d) || d.length === 0) {
        return { kind: 'auth', detail: 'Claude /api/organizations empty' };
      }
      const userIdCookie = (document.cookie.split('; ').find(c => c.startsWith('ajs_user_id=')) || '').split('=')[1] || '';
      const activeOrgCookie = (document.cookie.split('; ').find(c => c.startsWith('lastActiveOrg=')) || '').split('=')[1] || '';
      const activeOrg = d.find(o => o.uuid === activeOrgCookie) || d[0];
      return { ok: true, user_id: userIdCookie, org_name: activeOrg.name || '', org_uuid: activeOrg.uuid || '' };
    } catch (e) {
      return { kind: 'exception', detail: String(e && e.message || e) };
    }
  })()`);
  if (result?.kind === 'auth') throw new AuthRequiredError('claude.ai', result.detail);
  if (result?.kind === 'http') throw new CommandExecutionError(`HTTP ${result.httpStatus} from /api/organizations`);
  if (result?.kind === 'exception') throw new CommandExecutionError(`Claude whoami failed: ${result.detail}`);
  if (!result?.ok) throw new CommandExecutionError(`Unexpected Claude probe: ${JSON.stringify(result)}`);
  if (!result.user_id) throw new AuthRequiredError('claude.ai', 'Claude session incomplete — ajs_user_id cookie missing');
  return { user_id: String(result.user_id), org_name: String(result.org_name), org_uuid: String(result.org_uuid) };
}

registerSiteAuthCommands({
  site: 'claude',
  domain: 'claude.ai',
  loginUrl: 'https://claude.ai/login',
  columns: ['user_id', 'org_name', 'org_uuid'],
  quickCheck: hasClaudeSessionCookie,
  verify: verifyClaudeIdentity,
  poll: async (page) => {
    if (!await hasClaudeSessionCookie(page)) {
      throw new AuthRequiredError('claude.ai', 'Waiting for Claude sessionKey cookie');
    }
    return verifyClaudeIdentity(page);
  },
});
