import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

// Maimai server-renders the logged-in member into an inline script as
// `userObj = JSON.parse('{...}')`. It is declared with `let` so it never lands
// on window, and the userCardStr global is corrupted to "[object Object]". The
// probe parses that inline JSON, which is only injected for an authenticated
// session, so its presence doubles as the login signal.
const WHOAMI_PROBE = `(async () => {
  try {
    const scripts = Array.from(document.querySelectorAll('script')).map(s => s.textContent || '');
    let user = null;
    for (const s of scripts) {
      const m = s.match(/userObj\\s*=\\s*JSON\\.parse\\('(\\{[\\s\\S]*?\\})'\\)/);
      if (m) { try { user = JSON.parse(m[1]); } catch {} break; }
    }
    if (!user || !user.id) return { kind: 'auth', detail: 'Maimai userObj missing from page (anonymous)' };
    return {
      ok: true,
      user_id: String(user.id),
      name: String(user.name || ''),
      company: String(user.company || ''),
    };
  } catch (e) {
    return { kind: 'exception', detail: String(e && e.message || e) };
  }
})()`;

async function verifyMaimaiIdentity(page) {
  await page.goto('https://maimai.cn/');
  await page.wait(2);
  const probe = await page.evaluate(WHOAMI_PROBE);
  if (probe?.kind === 'auth') throw new AuthRequiredError('maimai.cn', probe.detail);
  if (probe?.kind === 'http') throw new CommandExecutionError(`HTTP ${probe.httpStatus} from Maimai`);
  if (probe?.kind === 'exception') throw new CommandExecutionError(`Maimai whoami failed: ${probe.detail}`);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected Maimai probe: ${JSON.stringify(probe)}`);
  return { user_id: probe.user_id, name: probe.name, company: probe.company };
}

registerSiteAuthCommands({
  site: 'maimai',
  domain: 'maimai.cn',
  loginUrl: 'https://maimai.cn/',
  columns: ['user_id', 'name', 'company'],
  verify: verifyMaimaiIdentity,
  poll: verifyMaimaiIdentity,
});
