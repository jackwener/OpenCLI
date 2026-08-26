/**
 * Left-panel navigation helper for Z-Library Desktop.
 *
 * Provides a consistent way for commands to navigate between sections
 * (Home, Search, Booklist, My Library, Z-Recommend, Download History)
 * by finding sidebar icon elements in the Electron renderer DOM and
 * clicking them.
 *
 * @module
 */

/**
 * @typedef {{ ok: boolean, reason?: string }} NavigationResult
 */

/**
 * @typedef {{ readonly selectors: readonly string[], readonly label: string }} PanelConfig
 */

/**
 * Valid panel navigation target names.
 * @typedef {'home' | 'search' | 'booklist' | 'my-library' | 'z-recommend' | 'downloads'} PanelTarget
 */

/**
 * Deep-freeze a PanelConfig value so its array cannot be mutated.
 * @param {PanelConfig} config
 * @returns {PanelConfig}
 */
function deepFreezeConfig(config) {
    return Object.freeze({ ...config, selectors: Object.freeze([...config.selectors]) });
}

/**
 * Panel icon selector strategies for Z-Library Desktop left navigation.
 *
 * Each target has a list of CSS selectors tried in order. If the first
 * selector doesn't match any element, the next is tried, and so on.
 *
 * @type {Readonly<Record<string, PanelConfig>>}
 */
export const PANELS = Object.freeze({
    home: deepFreezeConfig({
        selectors: [
            'a[href*="/home"]',
            '[data-testid="home"]',
            '.nav-icon-home',
        ],
        label: 'Home',
    }),
    search: deepFreezeConfig({
        selectors: [
            'a[href*="/search"]',
            '[data-testid="search"]',
            '.nav-icon-search',
        ],
        label: 'Search',
    }),
    booklist: deepFreezeConfig({
        selectors: [
            'a[href*="/booklist"]',
            '[data-testid="booklist"]',
            '.nav-icon-booklist',
        ],
        label: 'Booklist',
    }),
    'my-library': deepFreezeConfig({
        selectors: [
            'a[href*="/library"]',
            '[data-testid="my-library"]',
            '.nav-icon-library',
        ],
        label: 'My Library',
    }),
    'z-recommend': deepFreezeConfig({
        selectors: [
            'a[href*="/recommend"]',
            '[data-testid="z-recommend"]',
            '.nav-icon-recommend',
        ],
        label: 'Z-Recommend',
    }),
    downloads: deepFreezeConfig({
        selectors: [
            'a[href*="/downloads"]',
            '[data-testid="downloads"]',
            '.nav-icon-downloads',
        ],
        label: 'Download History',
    }),
});

/**
 * Navigate to a left-panel section by clicking its sidebar icon.
 *
 * Iterates through the target's configured selectors and uses
 * `page.evaluate()` to find and click the first matching element.
 * On success, waits briefly for the SPA page transition to settle
 * before returning.
 *
 * @param {import('@jackwener/opencli/browser').BrowserPage} page
 * @param {PanelTarget | string} target - Panel section to navigate to
 * @returns {Promise<NavigationResult>}
 */
/**
 * Safely extract a human-readable reason from a thrown value.
 * In JS, throw values can be Error, string, object, or undefined.
 * @param {unknown} error
 * @returns {string}
 */
function toReason(error) {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object' && 'message' in error) return String(error.message);
    return String(error);
}

export async function navigateTo(page, target) {
    if (!page || typeof page.evaluate !== 'function') {
        return { ok: false, reason: 'navigation error: invalid page object' };
    }

    if (!Object.hasOwn(PANELS, target)) {
        return { ok: false, reason: `unknown target: ${target}` };
    }
    const panel = PANELS[target];

    // Safely interpolate selectors into the evaluate string using JSON.stringify
    const safeSelectors = panel.selectors.map((s) => JSON.stringify(s));

    let found;
    try {
        found = await page.evaluate(`
            (() => {
                const selectors = [${safeSelectors.join(', ')}];
                for (let i = 0; i < selectors.length; i++) {
                    const el = document.querySelector(selectors[i]);
                    if (el) {
                        el.click();
                        return true;
                    }
                }
                return false;
            })()
        `);
    } catch (error) {
        return { ok: false, reason: `navigation error: ${toReason(error)}` };
    }

    if (found) {
        try {
            await page.wait(1.5);
        } catch {
            // post-click wait is best-effort settling  -  navigation succeeded
        }
        return { ok: true, reason: `clicked ${target} icon` };
    }
    return { ok: false, reason: `icon not found: ${target}` };
}
