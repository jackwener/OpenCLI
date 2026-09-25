/**
 * Navigate to `url`, forcing a REAL page load even when the persistent tab
 * already sits at that exact URL. The extension fast-paths a goto to the
 * tab's current URL without loading anything, which is right for cookie-only
 * commands but wrong for page-state readers (Pinia stores, __INITIAL_STATE__
 * snapshots) — they would reread the same stale document forever. If the
 * in-place reload cannot be issued (context destroyed mid-evaluate), fall
 * back to a plain goto, which at worst degrades to the fast-path status quo.
 */
export async function navigateFresh(page, url) {
    const current = typeof page.getCurrentUrl === 'function'
        ? await page.getCurrentUrl().catch(() => null)
        : null;
    if (current === url) {
        try {
            await page.evaluate('location.reload()');
            return;
        }
        catch {
            // fall through to the plain goto below
        }
    }
    await page.goto(url);
}

/**
 * Unwrap a Browser Bridge `{ session, data }` envelope while preserving raw
 * payload identity. Named array properties do not survive Bridge/CDP JSON.
 */
export function unwrapEvaluateResult(payload) {
    if (payload && !Array.isArray(payload) && typeof payload === 'object' && 'session' in payload && 'data' in payload) {
        return payload.data;
    }
    return payload;
}
