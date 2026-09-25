import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

export const IDENTITY_PROBE_JS = `
    (() => {
      if (/auth\\.1point3acres\\.com\\/login/.test(location.href)) {
        return { kind: 'auth', detail: '1point3acres bbs redirected to auth login' };
      }
      const loginLink = document.querySelector('a[href*="auth.1point3acres.com/login"], a[href*="member.php?mod=logging&action=login"]');
      if (loginLink && /登录/.test(loginLink.innerText || '')) {
        return { kind: 'auth', detail: '1point3acres bbs shows 登录 link — anonymous' };
      }
      const nameEl = document.querySelector('a[title="访问我的空间"], #um .vwmy h4 a, a.username, .vwmy a');
      const username = (nameEl?.innerText || nameEl?.textContent || '').trim();
      const uid = (nameEl?.getAttribute('href') || '').match(/uid[=-](\\d+)/)?.[1] || '';
      if (uid || username) return { ok: true, user_id: uid, username };

      const onRedesignedUi = /^\\/home\\b/.test(location.pathname) || !!document.getElementById('__NEXT_DATA__');
      const hasLoggedInMenu = !!document.querySelector('#g_upmine, #extcreditmenu');
      if (!hasLoggedInMenu && !onRedesignedUi) {
        return { kind: 'auth', detail: '1point3acres bbs rendered but no logged-in identity' };
      }

      // Only once the page itself shows a signed-in surface: the Discuz avatar path
      // encodes the zero-padded uid, and it counts only when every avatar agrees, so
      // a feed of other members cannot be read as the viewer (#2528).
      const avatarUids = new Set(
        Array.from(document.images)
          .map((img) => { try { return new URL(img.src, location.href); } catch { return null; } })
          .filter((url) => url && url.hostname === 'avatar.1p3a.com')
          .map((url) => url.pathname.match(/^\\/(\\d{3})\\/(\\d{2})\\/(\\d{2})\\/(\\d{2})_avatar/))
          .filter(Boolean)
          .map((parts) => String(Number(parts.slice(1).join('')))),
      );
      avatarUids.delete('0');
      if (avatarUids.size === 1) return { ok: true, user_id: [...avatarUids][0], username };

      // Reached only after the *_auth cookie check, so a missing element is drift.
      return {
        kind: 'shape',
        detail: onRedesignedUi
          ? '1point3acres served the redesigned UI with no recognizable identity'
          : '1point3acres bbs rendered logged-in menus but no identity link',
      };
    })()
  `;

async function has1Point3AcresAuthCookie(page) {
  const host = await page.getCookies({ url: 'https://www.1point3acres.com' });
  const root = await page.getCookies({ url: 'https://.1point3acres.com' });
  return [...host, ...root].some(c => /_auth$/.test(c.name) && c.value);
}

async function verify1Point3AcresIdentity(page) {
  if (!await has1Point3AcresAuthCookie(page)) {
    throw new AuthRequiredError('1point3acres.com', '1point3acres Discuz *_auth cookie missing');
  }
  // Bare /bbs/ redirects logged-in users to the /home SPA, which carries no identity
  // markup. This Discuz-native page still serves the user panel, and unlike
  // ?forum_ui=classic it does not rewrite the reader's saved UI preference (#2528).
  await page.goto('https://www.1point3acres.com/bbs/home.php?mod=space');
  await page.wait(2);
  const probe = await page.evaluate(IDENTITY_PROBE_JS);
  if (probe?.kind === 'auth') throw new AuthRequiredError('1point3acres.com', probe.detail);
  if (probe?.kind === 'shape') throw new CommandExecutionError(probe.detail);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected 1point3acres probe: ${JSON.stringify(probe)}`);
  return { user_id: probe.user_id, username: probe.username };
}

registerSiteAuthCommands({
  site: '1point3acres',
  domain: '1point3acres.com',
  loginUrl: 'https://auth.1point3acres.com/login',
  columns: ['user_id', 'username'],
  quickCheck: has1Point3AcresAuthCookie,
  verify: verify1Point3AcresIdentity,
  poll: async (page) => {
    if (!await has1Point3AcresAuthCookie(page)) {
      throw new AuthRequiredError('1point3acres.com', 'Waiting for 1point3acres Discuz *_auth cookie');
    }
    return verify1Point3AcresIdentity(page);
  },
});
