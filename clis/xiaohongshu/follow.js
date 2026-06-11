/**
 * Xiaohongshu follow — clicks the follow button on a user's profile page.
 *
 * xhs public web APIs require `x-s`/`x-t`/`x-s-common` signing that the page
 * context can produce but cannot be replayed reliably from outside, so we drive
 * the UI instead (same approach as delete-note.js / publish.js).
 *
 * Flow:
 *   1. Navigate to https://www.xiaohongshu.com/user/profile/<userId>
 *   2. Detect login redirect (xhs bounces to /login on auth failure)
 *   3. Walk visible <button>/[role=button] elements, restricted to profile-header
 *      containers when present, and text-match against follow / following labels
 *   4. If already following → return 'already-following' without clicking
 *   5. Otherwise click and poll button text for the flip to 已关注 within 5s
 *
 * Requires: logged into www.xiaohongshu.com in Chrome.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CliError, CommandExecutionError } from '@jackwener/opencli/errors';
import { normalizeXhsUserId } from './user-helpers.js';

const PROFILE_SETTLE_MS = 2500;
const STATE_FLIP_TIMEOUT_MS = 5000;
const USER_ID_RE = /^[a-zA-Z0-9]{8,32}$/;

function isXiaohongshuHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'xiaohongshu.com' || host.endsWith('.xiaohongshu.com');
}

function unwrapEvaluateResult(payload) {
    if (payload && typeof payload === 'object' && 'session' in payload && 'data' in payload) {
        return payload.data;
    }
    return payload;
}

function requireActionResult(payload, context) {
    const inner = unwrapEvaluateResult(payload);
    if (!inner || typeof inner !== 'object' || Array.isArray(inner) || typeof inner.ok !== 'boolean') {
        throw new CommandExecutionError(`xiaohongshu/follow: malformed ${context} payload`);
    }
    return inner;
}

function assertUserId(raw) {
    const input = String(raw ?? '').trim();
    if (/^https?:\/\//i.test(input)) {
        let parsed;
        try {
            parsed = new URL(input);
        } catch {
            throw new ArgumentError('xiaohongshu/follow: invalid profile URL');
        }
        if (parsed.protocol !== 'https:' || !isXiaohongshuHost(parsed.hostname)) {
            throw new ArgumentError('xiaohongshu/follow: profile URL must be an exact https://*.xiaohongshu.com URL');
        }
        const match = parsed.pathname.match(/^\/user\/profile\/([a-zA-Z0-9]{8,32})\/?$/);
        if (!match) {
            throw new ArgumentError('xiaohongshu/follow: profile URL must be /user/profile/<userId>');
        }
        return match[1];
    }
    const userId = normalizeXhsUserId(raw);
    if (!userId || !USER_ID_RE.test(userId)) {
        throw new ArgumentError(
            'xiaohongshu/follow: user-id must be a Xiaohongshu user ID (e.g. 5d8f88dc0000000001005d3a) or full profile URL',
        );
    }
    return userId;
}

/**
 * The injected page script. Lives in the browser context, so it can't import
 * anything — every helper is inlined. Returns `{ ok, state, reason? }` where
 * `state` is one of: 'followed' | 'already-following' | 'failed'.
 */
function buildFollowScript() {
    return `
(async () => {
  const FOLLOW_LABELS = ['关注', '+ 关注', '+关注'];
  const FOLLOWING_LABELS = ['已关注', '已互关', '互相关注'];
  const STATE_FLIP_TIMEOUT_MS = ${STATE_FLIP_TIMEOUT_MS};
  const STATE_POLL_MS = 250;

  const isVisible = (el) => !!el && el.offsetParent !== null;
  const textOf = (el) => (el.innerText || el.textContent || '').trim();

  // Restrict the search to plausible profile-header containers when any are
  // present. This stops the walker from picking up the "关注" tab label
  // (rendered as a div / span in the user-detail timeline tabs) which would
  // misclick into the tab nav instead of the follow CTA. If none of the
  // containers match the page layout we fall back to a global button sweep.
  const SCOPE_SELECTORS = [
    '.user-info', '.profile-info', '.user-detail', '.profile-page',
    '[class*="user-info"]', '[class*="profile"]',
  ];
  const scopes = SCOPE_SELECTORS.flatMap((sel) => Array.from(document.querySelectorAll(sel)));
  const visibleScopes = scopes.filter(isVisible);
  const roots = visibleScopes.length > 0 ? visibleScopes : [document];

  // Collect candidate buttons within scopes. Only real buttons and ARIA
  // buttons are considered — text nodes inside divs (tab labels) are skipped.
  const collectButtons = () => {
    const out = new Set();
    for (const root of roots) {
      const els = root.querySelectorAll('button, [role="button"]');
      for (const el of els) {
        if (isVisible(el)) out.add(el);
      }
    }
    return Array.from(out);
  };
  const findButtonByLabels = (labels) => {
    for (const btn of collectButtons()) {
      const t = textOf(btn);
      if (labels.includes(t)) return btn;
    }
    return null;
  };

  // Idempotent fast path: viewer already follows the target.
  if (findButtonByLabels(FOLLOWING_LABELS)) {
    return { ok: true, state: 'already-following' };
  }

  const followBtn = findButtonByLabels(FOLLOW_LABELS);
  if (!followBtn) {
    return {
      ok: false,
      state: 'failed',
      reason: 'Follow button not found on profile (logged out, blocked, or selectors changed). Re-run after login or update follow.js label/scope list.',
    };
  }
  followBtn.click();

  // Verify the button text flipped to 已关注 / 已互关 within the timeout.
  // Polling rather than mutation-observing keeps the script resilient to
  // xhs's React re-renders that swap the underlying DOM node.
  const deadline = Date.now() + STATE_FLIP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, STATE_POLL_MS));
    if (findButtonByLabels(FOLLOWING_LABELS)) {
      return { ok: true, state: 'followed' };
    }
  }
  return {
    ok: false,
    state: 'failed',
    reason: 'Follow button click did not flip to 已关注 within ' + (STATE_FLIP_TIMEOUT_MS / 1000) + 's',
  };
})()
`;
}

cli({
    site: 'xiaohongshu',
    name: 'follow',
    access: 'write',
    description: '关注小红书用户 (profile UI automation)',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    browser: true,
    args: [
        {
            name: 'user-id',
            required: true,
            positional: true,
            help: 'User ID (e.g. 5d8f88dc0000000001005d3a) or profile URL',
        },
    ],
    columns: ['status', 'user_id', 'url'],
    func: async (page, kwargs) => {
        if (!page) {
            throw new CommandExecutionError('Browser session required for xiaohongshu follow');
        }
        try {
            const userId = assertUserId(kwargs['user-id']);
            const url = `https://www.xiaohongshu.com/user/profile/${userId}`;
            await page.goto(url);
            await page.wait({ time: PROFILE_SETTLE_MS / 1000 });

            const hrefRaw = unwrapEvaluateResult(await page.evaluate('() => location.href'));
            if (typeof hrefRaw !== 'string') {
                throw new CommandExecutionError('xiaohongshu/follow: malformed current-url payload');
            }
            const parsedHref = new URL(hrefRaw);
            if (parsedHref.protocol !== 'https:' || !isXiaohongshuHost(parsedHref.hostname)) {
                throw new CommandExecutionError(
                    `xiaohongshu/follow: expected Xiaohongshu profile host, got ${parsedHref.hostname}`,
                );
            }
            if (/\/login(?:[/?#]|$)/i.test(parsedHref.pathname)) {
                throw new AuthRequiredError('www.xiaohongshu.com');
            }
            const currentProfile = parsedHref.pathname.match(/^\/user\/profile\/([a-zA-Z0-9]{8,32})\/?$/);
            if (currentProfile?.[1] !== userId) {
                throw new CommandExecutionError(
                    `xiaohongshu/follow: expected profile ${userId}, got ${parsedHref.pathname}`,
                );
            }

            const result = requireActionResult(
                await page.evaluate(buildFollowScript()),
                'follow-action',
            );
            if (!result.ok) {
                throw new CommandExecutionError(
                    `xiaohongshu/follow failed: ${result.reason ?? 'unknown reason'}`,
                );
            }
            return [{ status: result.state, user_id: userId, url }];
        } catch (err) {
            if (err instanceof CliError) throw err;
            throw new CommandExecutionError(
                `xiaohongshu/follow failed: ${err?.message ?? String(err)}`,
            );
        }
    },
});

export const __test__ = {
    assertUserId,
    buildFollowScript,
};
