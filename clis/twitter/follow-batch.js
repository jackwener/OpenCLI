import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { unwrapBrowserResult } from './shared.js';

const USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;
const DEFAULT_DELAY_MS = 3000;
const MAX_DELAY_MS = 60000;

export function parseBatchUsernames(input) {
    const raw = String(input || '').trim();
    if (!raw) {
        throw new ArgumentError('At least one Twitter/X username is required');
    }

    const usernames = [];
    const seen = new Set();
    for (const part of raw.split(',')) {
        const username = part.trim().replace(/^@+/, '');
        if (!username) continue;
        if (!USERNAME_RE.test(username)) {
            throw new ArgumentError(`Invalid Twitter/X username: ${JSON.stringify(part.trim())}`);
        }
        const key = username.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        usernames.push(username);
    }

    if (!usernames.length) {
        throw new ArgumentError('At least one Twitter/X username is required');
    }
    return usernames;
}

async function readFollowState(page, username) {
    return unwrapBrowserResult(await page.evaluate(`(async () => {
        try {
            let attempts = 0;
            while (attempts < 20) {
                const unfollowBtn = document.querySelector('[data-testid$="-unfollow"]');
                if (unfollowBtn) {
                    return { ok: true, status: 'noop', message: 'Already following @${username}.' };
                }

                const followBtn = document.querySelector('[data-testid$="-follow"]');
                if (followBtn) {
                    return { ok: false, followButtonVisible: true };
                }

                await new Promise(r => setTimeout(r, 500));
                attempts++;
            }

            return { ok: false, followButtonVisible: false };
        } catch (e) {
            return { ok: false, message: e.toString() };
        }
    })()`));
}

async function clickFollowAndVerify(page, username) {
    return unwrapBrowserResult(await page.evaluate(`(async () => {
        try {
            const followBtn = document.querySelector('[data-testid$="-follow"]');
            if (!followBtn) {
                return { ok: false, retryAfterRefresh: true, message: 'Could not find Follow button after loading profile.' };
            }

            followBtn.click();
            for (let attempts = 0; attempts < 20; attempts++) {
                await new Promise(r => setTimeout(r, 500));
                const verify = document.querySelector('[data-testid$="-unfollow"]');
                if (verify) {
                    return { ok: true, status: 'success', message: 'Successfully followed @${username}.' };
                }
            }

            return { ok: false, retryAfterRefresh: true, message: 'Follow action initiated but UI did not update.' };
        } catch (e) {
            return { ok: false, message: e.toString() };
        }
    })()`));
}

export async function followOne(page, username) {
    await page.goto(`https://x.com/${username}`);
    await page.wait({ selector: '[data-testid="primaryColumn"]' });

    let result = await readFollowState(page, username);
    if (!result.ok && result.followButtonVisible) {
        result = await clickFollowAndVerify(page, username);
    }
    if (!result.ok && result.retryAfterRefresh) {
        await page.goto(`https://x.com/${username}`);
        await page.wait({ selector: '[data-testid="primaryColumn"]' });
        const refreshed = await readFollowState(page, username);
        if (refreshed.ok) {
            result = { ...refreshed, status: 'success', message: `Successfully followed @${username}.` };
        }
    }
    if (!result.ok && !result.message) {
        result = { ...result, message: 'Could not find Follow button. Are you logged in?' };
    }

    if (result.ok) {
        await page.wait(1);
    }

    return {
        username,
        status: result.ok ? result.status : 'failed',
        message: result.message,
    };
}

export function parseDelayMs(input) {
    if (input === undefined || input === null || input === '') {
        return DEFAULT_DELAY_MS;
    }
    const value = Number(input);
    if (!Number.isInteger(value) || value < 0 || value > MAX_DELAY_MS) {
        throw new ArgumentError(`delay-ms must be an integer between 0 and ${MAX_DELAY_MS}`);
    }
    return value;
}

cli({
    site: 'twitter',
    name: 'follow-batch',
    access: 'write',
    description: 'Follow multiple Twitter/X users from a comma-separated username list',
    domain: 'x.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'usernames', type: 'string', positional: true, required: true, help: 'Comma-separated Twitter/X screen names, with or without @' },
        { name: 'delay-ms', type: 'int', default: DEFAULT_DELAY_MS, help: 'Delay between follow attempts in milliseconds' },
    ],
    columns: ['username', 'status', 'message'],
    func: async (page, kwargs) => {
        if (!page) {
            throw new CommandExecutionError('Browser session required for twitter follow-batch');
        }

        const usernames = parseBatchUsernames(kwargs.usernames);
        const delayMs = parseDelayMs(kwargs['delay-ms']);
        const cookies = await page.getCookies({ url: 'https://x.com' });
        const ct0 = cookies.find((cookie) => cookie.name === 'ct0')?.value || null;
        if (!ct0) {
            throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');
        }

        const rows = [];
        for (const [index, username] of usernames.entries()) {
            if (index > 0 && delayMs > 0) {
                await page.wait(delayMs / 1000);
            }
            rows.push(await followOne(page, username));
        }
        return rows;
    }
});
