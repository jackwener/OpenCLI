/**
 * Z-Library Desktop profile-set-md5 command.
 *
 * Enables MD5 hash in download filename format by updating the user's
 * profile setting via the internal /eapi/user/update endpoint.
 *
 * Flow:
 *   1. Acquire lock
 *   2. Read current state via extractQuotaFromDom() — if already enabled, return already_enabled
 *   3. Get dynamic origin via getCurrentHttpOrigin()
 *   4. Navigate to /profileEdit/others (natural referrer for browser fetch)
 *   5. Build POST URL with downloadFilenameFormat=%t (%a)__MD5_%m__
 *   6. Execute browser-side fetch via page.evaluate() with JSON.stringify-safe interpolation
 *   7. Verify by re-reading /users/downloads via extractQuotaFromDom()
 *
 * URL Security Boundary:
 *   - Internal: relative URLs only (/users/downloads, /profileEdit/others, /eapi/user/update)
 *   - Output: plain text field/value pairs (no URLs in output)
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { extractQuotaFromDom } from './_shared/quota/checker.js';
import { acquireLockOrThrow } from './_shared/infra/pid-lock.js';
import { getCurrentHttpOrigin, assertSameOriginNotLoginWall } from './_shared/infra/url-boundary.js';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { PROFILE_MD5_FILENAME_FORMAT_API, PROFILE_MD5_FILENAME_FORMAT_DISPLAY, hasMd5InFilenameFormat } from './_shared/infra/md5-format.js';

cli({
    site: 'zlibrary-app',
    name: 'profile-set-md5',
    access: 'write',
    description: 'Enable MD5 hash in your Z-Library download filename format',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    columns: ['field', 'value'],
    func: async (page) => {
        const lock = await acquireLockOrThrow('zlibrary-app profile-set-md5');
        try {
            // Step 1: Read current state
            const currentQuota = await extractQuotaFromDom(page);

            // Check if already enabled
            if (hasMd5InFilenameFormat(currentQuota.filenameFormatText)) {
                return [
                    { field: 'Status', value: 'already_enabled' },
                    { field: 'MD5 Filename Format', value: 'enabled' },
                    { field: 'Filename Format', value: currentQuota.filenameFormatText },
                    { field: 'Target Format', value: PROFILE_MD5_FILENAME_FORMAT_DISPLAY },
                ];
            }

            // Step 2: Get dynamic origin
            const origin = await getCurrentHttpOrigin(page);

            // Step 3: Navigate to referrer page (/profileEdit/others)
            const referrerUrl = new URL('/profileEdit/others', origin.origin).href;
            await page.goto(referrerUrl, { waitUntil: 'load', settleMs: 3000 });
            await assertSameOriginNotLoginWall(page, origin, 'zlibrary-app profile-set-md5');

            // Step 4: Build POST URL
            const updateUrl = new URL('/eapi/user/update', origin.origin);
            updateUrl.searchParams.set('downloadFilenameFormat', PROFILE_MD5_FILENAME_FORMAT_API);

            // Step 5: Execute POST via browser fetch (with JSON.stringify for safety)
            const postResult = await page.evaluate(`
                (async () => {
                    const response = await fetch(${JSON.stringify(updateUrl.href)}, {
                        method: 'POST',
                        credentials: 'include'
                    });
                    const text = await response.text();
                    return { ok: response.ok, status: response.status, text };
                })()
            `);

            if (!postResult.ok) {
                throw new CommandExecutionError(
                    `Failed to update MD5 filename format (HTTP ${postResult.status})`,
                    postResult.text.slice(0, 500)
                );
            }

            // Step 6: Verify the change was applied
            const verifiedQuota = await extractQuotaFromDom(page);

            if (!hasMd5InFilenameFormat(verifiedQuota.filenameFormatText)) {
                throw new CommandExecutionError(
                    'Failed to verify MD5 filename format was applied',
                    'The server accepted the request but the format was not updated. Current format: ' +
                    (verifiedQuota.filenameFormatText || '(not found)')
                );
            }

            return [
                { field: 'Status', value: 'updated' },
                { field: 'MD5 Filename Format', value: 'enabled' },
                { field: 'Filename Format', value: verifiedQuota.filenameFormatText },
                { field: 'Target Format', value: PROFILE_MD5_FILENAME_FORMAT_DISPLAY },
            ];
        } finally {
            await lock.release();
        }
    },
});