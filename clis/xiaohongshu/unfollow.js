/**
 * Xiaohongshu unfollow — clicks the 已关注 button on a user's profile page and
 * confirms the resulting "取消关注" modal.
 *
 * Mirror of follow.js. The extra step versus follow is the confirmation modal:
 * xhs pops a "确定不再关注 TA 了吗" dialog rendered in a `.d-modal-footer`
 * container (same widget used by delete-note's confirmation). We find the
 * 确定 button within that footer and click it, then verify the profile-header
 * button flipped back to 关注.
 *
 * Requires: logged into www.xiaohongshu.com in Chrome.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CliError, CommandExecutionError } from '@jackwener/opencli/errors';
import { normalizeXhsUserId } from './user-helpers.js';

const PROFILE_SETTLE_MS = 2500;
const MODAL_SETTLE_MS = 1500;
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
        throw new CommandExecutionError(`xiaohongshu/unfollow: malformed ${context} payload`);
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
            throw new ArgumentError('xiaohongshu/unfollow: invalid profile URL');
        }
        if (parsed.protocol !== 'https:' || !isXiaohongshuHost(parsed.hostname)) {
            throw new ArgumentError('xiaohongshu/unfollow: profile URL must be an exact https://*.xiaohongshu.com URL');
        }
        const match = parsed.pathname.match(/^\/user\/profile\/([a-zA-Z0-9]{8,32})\/?$/);
        if (!match) {
            throw new ArgumentError('xiaohongshu/unfollow: profile URL must be /user/profile/<userId>');
        }
        return match[1];
    }
    const userId = normalizeXhsUserId(raw);
    if (!userId || !USER_ID_RE.test(userId)) {
        throw new ArgumentError(
            'xiaohongshu/unfollow: user-id must be a Xiaohongshu user ID (e.g. 5d8f88dc0000000001005d3a) or full profile URL',
        );
    }
    return userId;
}

/**
 * Click the 已关注 / 已互关 button on the profile (idempotent if not following).
 * Returns `{ ok, state }` where state is 'unfollow-clicked' | 'not-following' | 'failed'.
 */
function buildClickUnfollowScript() {
    return `
(() => {
  const FOLLOW_LABELS = ['关注', '+ 关注', '+关注'];
  const FOLLOWING_LABELS = ['已关注', '已互关', '互相关注'];

  const isVisible = (el) => !!el && el.offsetParent !== null;
  const textOf = (el) => (el.innerText || el.textContent || '').trim();

  const SCOPE_SELECTORS = [
    '.user-info', '.profile-info', '.user-detail', '.profile-page',
    '[class*="user-info"]', '[class*="profile"]',
  ];
  const scopes = SCOPE_SELECTORS.flatMap((sel) => Array.from(document.querySelectorAll(sel)));
  const visibleScopes = scopes.filter(isVisible);
  const roots = visibleScopes.length > 0 ? visibleScopes : [document];

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

  if (findButtonByLabels(FOLLOW_LABELS)) {
    return { ok: true, state: 'not-following' };
  }
  const btn = findButtonByLabels(FOLLOWING_LABELS);
  if (!btn) {
    return {
      ok: false,
      state: 'failed',
      reason: 'Follow-state button not found on profile (logged out, blocked, or selectors changed).',
    };
  }
  btn.click();
  return { ok: true, state: 'unfollow-clicked' };
})()
`;
}

/**
 * Click 确定 in the `.d-modal-footer` confirmation modal. xhs shows this
 * modal after the 已关注 button is clicked, asking the user to confirm
 * unfollow. Returns `{ ok, kind?, labels? }`.
 */
function buildConfirmModalScript() {
    return `
(() => {
  const isVisible = (el) => !!el && el.offsetParent !== null;
  const footer = Array.from(document.querySelectorAll('.d-modal-footer')).find(isVisible);
  if (!footer) return { ok: false, kind: 'no_modal' };
  const buttons = Array.from(footer.querySelectorAll('button, [role="button"]')).filter(isVisible);
  const confirmBtn = buttons.find((b) => {
    const t = (b.innerText || b.textContent || '').trim();
    return t === '确定' || t === '不再关注' || t === '取消关注';
  });
  if (!confirmBtn) {
    return { ok: false, kind: 'no_confirm', labels: buttons.map((b) => (b.innerText || '').trim()) };
  }
  confirmBtn.click();
  return { ok: true };
})()
`;
}

function buildVerifyFollowFlippedScript() {
    return `
(async () => {
  const FOLLOW_LABELS = ['关注', '+ 关注', '+关注'];
  const STATE_FLIP_TIMEOUT_MS = ${STATE_FLIP_TIMEOUT_MS};
  const STATE_POLL_MS = 250;

  const isVisible = (el) => !!el && el.offsetParent !== null;
  const textOf = (el) => (el.innerText || el.textContent || '').trim();

  const SCOPE_SELECTORS = [
    '.user-info', '.profile-info', '.user-detail', '.profile-page',
    '[class*="user-info"]', '[class*="profile"]',
  ];
  const findFollowButton = () => {
    const scopes = SCOPE_SELECTORS.flatMap((sel) => Array.from(document.querySelectorAll(sel)));
    const visibleScopes = scopes.filter(isVisible);
    const roots = visibleScopes.length > 0 ? visibleScopes : [document];
    for (const root of roots) {
      for (const btn of root.querySelectorAll('button, [role="button"]')) {
        if (!isVisible(btn)) continue;
        if (FOLLOW_LABELS.includes(textOf(btn))) return btn;
      }
    }
    return null;
  };

  const deadline = Date.now() + STATE_FLIP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (findFollowButton()) return { ok: true };
    await new Promise((r) => setTimeout(r, STATE_POLL_MS));
  }
  return { ok: false, reason: 'Unfollow click did not flip button back to 关注 within ' + (STATE_FLIP_TIMEOUT_MS / 1000) + 's' };
})()
`;
}

cli({
    site: 'xiaohongshu',
    name: 'unfollow',
    access: 'write',
    description: '取消关注小红书用户 (profile UI automation)',
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
            throw new CommandExecutionError('Browser session required for xiaohongshu unfollow');
        }
        try {
            const userId = assertUserId(kwargs['user-id']);
            const url = `https://www.xiaohongshu.com/user/profile/${userId}`;
            await page.goto(url);
            await page.wait({ time: PROFILE_SETTLE_MS / 1000 });

            const hrefRaw = unwrapEvaluateResult(await page.evaluate('() => location.href'));
            if (typeof hrefRaw !== 'string') {
                throw new CommandExecutionError('xiaohongshu/unfollow: malformed current-url payload');
            }
            const parsedHref = new URL(hrefRaw);
            if (parsedHref.protocol !== 'https:' || !isXiaohongshuHost(parsedHref.hostname)) {
                throw new CommandExecutionError(
                    `xiaohongshu/unfollow: expected Xiaohongshu profile host, got ${parsedHref.hostname}`,
                );
            }
            if (/\/login(?:[/?#]|$)/i.test(parsedHref.pathname)) {
                throw new AuthRequiredError('www.xiaohongshu.com');
            }
            const currentProfile = parsedHref.pathname.match(/^\/user\/profile\/([a-zA-Z0-9]{8,32})\/?$/);
            if (currentProfile?.[1] !== userId) {
                throw new CommandExecutionError(
                    `xiaohongshu/unfollow: expected profile ${userId}, got ${parsedHref.pathname}`,
                );
            }

            // Step 1: click 已关注 (idempotent — bails out if 关注 is visible)
            const clickResult = requireActionResult(
                await page.evaluate(buildClickUnfollowScript()),
                'click-unfollow',
            );
            if (!clickResult.ok) {
                throw new CommandExecutionError(
                    `xiaohongshu/unfollow failed: ${clickResult.reason ?? 'unknown reason'}`,
                );
            }
            if (clickResult.state === 'not-following') {
                return [{ status: 'not-following', user_id: userId, url }];
            }

            // Step 2: confirm the unfollow modal. Wait for the modal to mount
            // first — xhs uses a CSS transition before the footer becomes
            // interactive.
            await page.wait({ time: MODAL_SETTLE_MS / 1000 });
            const confirmResult = requireActionResult(
                await page.evaluate(buildConfirmModalScript()),
                'confirm-modal',
            );
            if (!confirmResult.ok) {
                throw new CommandExecutionError(
                    `xiaohongshu/unfollow: confirmation modal step failed (${confirmResult.kind ?? 'no kind reported'})`,
                );
            }

            // Step 3: verify the profile button text flipped back to 关注.
            const verifyRaw = unwrapEvaluateResult(await page.evaluate(buildVerifyFollowFlippedScript()));
            if (!verifyRaw || typeof verifyRaw !== 'object' || verifyRaw.ok !== true) {
                throw new CommandExecutionError(
                    `xiaohongshu/unfollow: ${verifyRaw?.reason ?? 'state verification failed'}`,
                );
            }
            return [{ status: 'unfollowed', user_id: userId, url }];
        } catch (err) {
            if (err instanceof CliError) throw err;
            throw new CommandExecutionError(
                `xiaohongshu/unfollow failed: ${err?.message ?? String(err)}`,
            );
        }
    },
});

export const __test__ = {
    assertUserId,
    buildClickUnfollowScript,
    buildConfirmModalScript,
    buildVerifyFollowFlippedScript,
};
