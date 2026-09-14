import { registerSiteAuthCommands } from '../_shared/site-auth.js';
import { LARK, ensureConsole, getIdentity } from './utils.js';

// ── lark-console whoami / login ─────────────────────────────────────────
//
// Identity comes from /napi/check/login, which returns the signed-in user id and
// tenant id off the session cookie. ensureConsole() puts the bound tab on the
// console host first so the request is same-origin.
async function verifyConsoleIdentity(page) {
  await ensureConsole(page, LARK);
  return getIdentity(page, LARK);
}

registerSiteAuthCommands({
  site: 'lark-console',
  domain: LARK,
  loginUrl: `https://${LARK}/app`,
  columns: ['user_id', 'tenant_id'],
  whoamiDescription: 'Show the current Lark Open Platform developer-console login (user + tenant id)',
  loginDescription: 'Open the Lark Open Platform developer console and wait until the browser session is signed in',
  verify: verifyConsoleIdentity,
  poll: verifyConsoleIdentity,
});
