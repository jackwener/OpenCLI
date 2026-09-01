// tiktok-symphony credits — Symphony credit balance and current plan.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { CREATE_URL, DEEP_QUERY_SRC, HOST, waitForValue } from './utils.js';

cli({
    site: 'tiktok-symphony',
    name: 'credits',
    description: 'Symphony Creative Studio credit balance and plan',
    access: 'read',
    example: 'opencli tiktok-symphony credits',
    domain: HOST,
    strategy: Strategy.UI,
    browser: true,
    navigateBefore: CREATE_URL,
    args: [],
    columns: ['credits', 'plan', 'account'],
    func: async (page) => {
        // Field names here deliberately avoid the `columns` vocabulary: this is
        // a scratch parse object, not a row, and reusing column names would let
        // a future edit mistake it for one.
        const header = await waitForValue(page, `(() => {
            ${DEEP_QUERY_SRC}
            const coin = __deepAll(document, (el) => __ksTag(el, 'ks-icon') && el.getAttribute('name') === 'coin')[0];
            const balanceText = coin && coin.parentElement ? coin.parentElement.textContent.trim() : null;

            // "Basic plan" / "Plus plan" lives in the credit popover, which is
            // rendered into the DOM without having to open it.
            const planEl = __deepAll(document, (el) => /^[A-Z][a-z]+ plan$/.test(__ownText(el)))[0];

            const nameEl = __deepAll(document, (el) => el.tagName === 'P' && __ownText(el).length > 0
                && !!(el.closest && el.closest('nav')))[0];

            const signedOut = /\\bLog in\\b|\\bSign up\\b/i.test(document.body.innerText || '');

            // Keep polling while the header is still hydrating; settle as soon
            // as we can tell "signed out" from "balance visible".
            if (balanceText === null && !signedOut) return null;

            return {
                balanceText,
                planLabel: planEl ? __ownText(planEl) : null,
                accountLabel: nameEl ? __ownText(nameEl) : null,
                signedOut,
            };
        })()`, { label: 'Symphony header', timeoutMs: 30000 });

        if (!header) {
            throw new CommandExecutionError('Page evaluation returned nothing — the tab may have navigated away');
        }
        if (header.balanceText === null && header.signedOut) {
            throw new AuthRequiredError(HOST, 'Log in to Symphony Creative Studio in this browser first');
        }
        if (header.balanceText === null) {
            throw new CommandExecutionError(
                'Could not find the credit indicator (ks-icon[name="coin"]) — the header layout may have changed',
            );
        }

        const digits = String(header.balanceText).replace(/[^\d]/g, '');
        if (digits === '') {
            throw new CommandExecutionError(`Credit indicator was not numeric: "${header.balanceText}"`);
        }

        return [{
            credits: Number(digits),
            plan: header.planLabel,
            account: header.accountLabel,
        }];
    },
});
