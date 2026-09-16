/**
 * Shared navigation recovery for browser-driven adapters.
 *
 * The Browser Bridge's `page.goto` can reject with "Navigation rejected"
 * when the automation tab/window is in a transient race (seen on xiaohongshu
 * note reads: once one navigation is rejected, every retry through the same
 * tab fails too). The stuck state only clears when the automation window is
 * closed or a fresh tab takes over.
 *
 * `gotoWithRecovery` implements the recovery ladder first shipped in
 * `clis/google/images.js`: plain goto → closeWindow + goto → newTab +
 * setActivePage. Anything that is not a "Navigation rejected" error is
 * rethrown untouched.
 */

export function isNavigationRejected(error) {
    return /Navigation rejected/i.test(String(error?.message || error));
}

/**
 * Navigate to `url`, recovering from bridge "Navigation rejected" races.
 *
 * Ladder: `page.goto` → on rejection, close the automation window and retry →
 * on rejection again, open a new tab and activate it. Non-rejection errors
 * propagate immediately. Throws the last rejection when the page handle does
 * not expose the recovery primitives (closeWindow / newTab / setActivePage).
 */
export async function gotoWithRecovery(page, url) {
    try {
        await page.goto(url);
        return;
    } catch (error) {
        if (!isNavigationRejected(error)) {
            throw error;
        }
    }

    if (typeof page.closeWindow === 'function') {
        await page.closeWindow().catch(() => {});
    }

    try {
        await page.goto(url);
        return;
    } catch (error) {
        if (!isNavigationRejected(error)) {
            throw error;
        }
        if (typeof page.newTab === 'function' && typeof page.setActivePage === 'function') {
            const pageId = await page.newTab(url);
            if (pageId) {
                await page.setActivePage(pageId);
                return;
            }
        }
        throw error;
    }
}

export const __test__ = { isNavigationRejected, gotoWithRecovery };
