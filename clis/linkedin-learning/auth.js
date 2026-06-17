import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasLinkedinSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://www.linkedin.com' });
  return cookies.some(c => c.name === 'li_at' && c.value);
}

async function verifyLinkedinLearningIdentity(page) {
  if (!await hasLinkedinSessionCookie(page)) {
    throw new AuthRequiredError('linkedin.com', 'LinkedIn li_at cookie missing');
  }
  await page.goto('https://www.linkedin.com/learning/');
  await page.wait(2);
  const result = await page.evaluate(`(async () => {
    try {
      const jsessionRaw = (document.cookie.split('; ').find(c => c.startsWith('JSESSIONID=')) || '').split('=')[1] || '';
      const csrf = jsessionRaw.replace(/^"|"$/g, '');
      if (!csrf) return { kind: 'auth', detail: 'LinkedIn JSESSIONID missing — csrf token unavailable' };
      const res = await fetch('/voyager/api/me', { credentials: 'include', headers: { 'csrf-token': csrf, 'Accept': 'application/json' } });
      if (res.status === 401 || res.status === 403) {
        return { kind: 'auth', detail: 'LinkedIn /voyager/api/me HTTP ' + res.status };
      }
      if (!res.ok) return { kind: 'http', httpStatus: res.status };
      const d = await res.json();
      const mini = d && d.miniProfile;
      if (!mini || !mini.publicIdentifier) {
        return { kind: 'auth', detail: 'LinkedIn /voyager/api/me 200 but miniProfile missing' };
      }
      const firstName = (mini.firstName && (mini.firstName.text || mini.firstName)) || '';
      const lastName = (mini.lastName && (mini.lastName.text || mini.lastName)) || '';
      return {
        ok: true,
        public_id: String(mini.publicIdentifier),
        plain_id: String(d.plainId || ''),
        name: String((firstName + ' ' + lastName).trim()),
      };
    } catch (e) {
      return { kind: 'exception', detail: String(e && e.message || e) };
    }
  })()`);
  if (result?.kind === 'auth') throw new AuthRequiredError('linkedin.com', result.detail);
  if (result?.kind === 'http') throw new CommandExecutionError(`HTTP ${result.httpStatus} from /voyager/api/me`);
  if (result?.kind === 'exception') throw new CommandExecutionError(`LinkedIn Learning whoami failed: ${result.detail}`);
  if (!result?.ok) throw new CommandExecutionError(`Unexpected LinkedIn Learning probe: ${JSON.stringify(result)}`);
  return { public_id: result.public_id, plain_id: result.plain_id, name: result.name };
}

registerSiteAuthCommands({
  site: 'linkedin-learning',
  domain: 'linkedin.com',
  loginUrl: 'https://www.linkedin.com/login?session_redirect=%2Flearning%2F',
  columns: ['public_id', 'plain_id', 'name'],
  quickCheck: hasLinkedinSessionCookie,
  verify: verifyLinkedinLearningIdentity,
  poll: async (page) => {
    if (!await hasLinkedinSessionCookie(page)) {
      throw new AuthRequiredError('linkedin.com', 'Waiting for LinkedIn li_at cookie');
    }
    return verifyLinkedinLearningIdentity(page);
  },
});
