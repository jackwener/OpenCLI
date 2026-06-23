import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

// Hugging Face's `token` cookie is httpOnly; gate the login poll on the
// documented /api/whoami-v2 endpoint (401 when anonymous) via a no-nav probe.
const WHOAMI_PROBE = `(async () => {
  try {
    const r = await fetch('/api/whoami-v2', { credentials: 'include', headers: { Accept: 'application/json' } });
    if (r.status === 401 || r.status === 403) return { kind: 'auth', detail: 'HF /api/whoami-v2 HTTP ' + r.status };
    if (!r.ok) return { kind: 'http', httpStatus: r.status };
    const d = await r.json();
    if (!d || !d.name || d.type === undefined) return { kind: 'auth', detail: 'HF /api/whoami-v2 has no name — anonymous' };
    return { ok: true, username: String(d.name), fullname: String(d.fullname || ''), type: String(d.type || '') };
  } catch (e) {
    return { kind: 'exception', detail: String(e && e.message || e) };
  }
})()`;

async function verifyHfIdentity(page) {
  await page.goto('https://huggingface.co/');
  await page.wait(1);
  const probe = await page.evaluate(WHOAMI_PROBE);
  if (probe?.kind === 'auth') throw new AuthRequiredError('huggingface.co', probe.detail);
  if (probe?.kind === 'http') throw new CommandExecutionError(`HTTP ${probe.httpStatus} from HF /api/whoami-v2`);
  if (probe?.kind === 'exception') throw new CommandExecutionError(`HF whoami failed: ${probe.detail}`);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected HF probe: ${JSON.stringify(probe)}`);
  return { username: probe.username, fullname: probe.fullname, type: probe.type };
}

registerSiteAuthCommands({
  site: 'hf',
  domain: 'huggingface.co',
  loginUrl: 'https://huggingface.co/login',
  columns: ['username', 'fullname', 'type'],
  verify: verifyHfIdentity,
  poll: async (page) => {
    const probe = await page.evaluate(WHOAMI_PROBE);
    if (!probe?.ok) throw new AuthRequiredError('huggingface.co', 'Waiting for Hugging Face login');
    return { username: probe.username, fullname: probe.fullname, type: probe.type };
  },
});
