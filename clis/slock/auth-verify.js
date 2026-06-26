import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { buildFetchSnippet } from './in-page.js';
import { SLOCK_DOMAIN, SLOCK_HOME_URL } from './shared.js';

// site-auth's whoami sets navigateBefore:false, so verify owns navigation.
export async function verifySlockSession(page) {
  await page.goto(SLOCK_HOME_URL);
  const snippet = buildFetchSnippet({ method: 'GET', path: '/auth/me', serverScoped: false });
  const r = await page.evaluate(`(async () => { ${snippet} })()`);
  if (r && r.kind === 'auth') throw new AuthRequiredError(SLOCK_DOMAIN, r.detail);
  // unknown / null envelope = contract drift; same typed class as dispatchEvaluateResult
  if (!r || r.kind !== 'ok') throw new CommandExecutionError(`unexpected /auth/me result: ${JSON.stringify(r)}`);
  const me = r.rows ?? {};
  return {
    id: me.id ?? null,
    name: me.name ?? me.displayName ?? me.username ?? null,
    email: me.email ?? null,
  };
}
