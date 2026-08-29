import { CliError } from '@jackwener/opencli/errors';

/**
 * Xiaohongshu risk-control pacing shared by the note / comments / download
 * detail-page commands.
 *
 * XHS gates note-detail navigation behind velocity-based risk control: reading a
 * run of notes back-to-back trips a soft block that redirects to
 * `website-login/error?error_code=300017` / `300031` or renders "安全限制" /
 * "访问链接异常" (issues #1825, #962). Those soft blocks are frequently transient
 * per-request challenges — a single reload after a real cooldown clears many of
 * them. So instead of failing on the first block, retry ONCE after a long
 * randomized cooldown.
 *
 * The retry is deliberately capped at one: hammering a hot risk state is exactly
 * what escalates it toward the account-violation / ban path (#842, #677). This
 * helper only makes each read gentler and recovers transient blocks — it does
 * NOT cap request velocity across separate CLI invocations (that needs
 * session-level throttling, tracked as a follow-up).
 */

/** Randomized delay in seconds within [minS, maxS]. `rand` is injectable for tests. */
export function jitterSeconds(minS, maxS, rand = Math.random) {
    return minS + rand() * (maxS - minS);
}

/** A detail-page extract payload signals risk control via `securityBlock: true`. */
export function isSecurityBlock(data) {
    return Boolean(data && typeof data === 'object' && !Array.isArray(data) && data.securityBlock);
}

/**
 * Navigate to a XHS detail page and run `extractJs`, retrying once through a long
 * randomized cooldown when risk control soft-blocks the page. Returns the extract
 * payload (never a security-block payload — that path throws SECURITY_BLOCK after
 * the single retry is exhausted). Callers keep their own loginWall / notFound /
 * shape handling on the returned payload.
 *
 * @param {object} page Browser Bridge page handle.
 * @param {object} opts
 * @param {string} opts.url            Fully-built note/detail URL to navigate to.
 * @param {string} opts.extractJs      Page-side extraction IIFE returning `{ securityBlock, ... }`.
 * @param {string} [opts.securityHelp] Hint attached to the thrown SECURITY_BLOCK error.
 * @param {number} [opts.settleMinS]   Min settle delay after navigation (seconds).
 * @param {number} [opts.settleMaxS]   Max settle delay after navigation (seconds).
 * @param {boolean} [opts.retryOnBlock] Do the single cooldown reload on a soft block (default true); false = fail fast.
 * @param {number} [opts.cooldownMinS] Min cooldown before the retry (seconds).
 * @param {number} [opts.cooldownMaxS] Max cooldown before the retry (seconds).
 * @param {() => number} [opts.rand]   Injectable RNG for deterministic tests.
 */
export async function readXhsDetailPage(page, {
    url,
    extractJs,
    securityHelp,
    settleMinS = 2,
    settleMaxS = 5,
    retryOnBlock = true,
    cooldownMinS = 8,
    cooldownMaxS = 18,
    rand = Math.random,
} = {}) {
    const readOnce = async () => {
        await page.goto(url);
        await page.wait({ time: jitterSeconds(settleMinS, settleMaxS, rand) });
        return page.evaluate(extractJs);
    };

    let data = await readOnce();
    // At most ONE retry — a single `if`, never a loop. Hammering a hot risk state
    // is exactly what escalates it toward account-violation / ban (#842, #677),
    // so the one-cooldown-reload cap is enforced structurally, not by a caller's
    // choice of retry count.
    if (retryOnBlock && isSecurityBlock(data)) {
        await page.wait({ time: jitterSeconds(cooldownMinS, cooldownMaxS, rand) });
        data = await readOnce();
    }

    if (isSecurityBlock(data)) {
        throw new CliError(
            'SECURITY_BLOCK',
            'Xiaohongshu security block: the note detail page was blocked by risk control.',
            securityHelp,
        );
    }
    return data;
}

export const __test__ = { jitterSeconds, isSecurityBlock, readXhsDetailPage };
