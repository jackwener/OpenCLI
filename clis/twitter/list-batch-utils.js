import { ArgumentError, AuthRequiredError } from '@jackwener/opencli/errors';

const USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;
const DEFAULT_INTERVAL_SECONDS = 5;
const MAX_INTERVAL_SECONDS = 600;

export function parseCommaSeparatedUsernames(rawValue, example) {
    const raw = String(rawValue || '').trim();
    if (!raw) {
        throw new ArgumentError('At least one username is required', example);
    }

    const values = raw
        .split(',')
        .map((part) => part.trim().replace(/^@/, ''))
        .filter(Boolean);

    if (values.length === 0) {
        throw new ArgumentError('At least one username is required', example);
    }

    const seen = new Set();
    const usernames = [];
    for (const username of values) {
        if (!USERNAME_RE.test(username)) {
            throw new ArgumentError(`Invalid Twitter/X username: ${JSON.stringify(username)}`, example);
        }
        const key = username.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        usernames.push(username);
    }

    return usernames;
}

export function parseBatchIntervalSeconds(rawValue) {
    const value = rawValue === undefined || rawValue === null || rawValue === ''
        ? DEFAULT_INTERVAL_SECONDS
        : Number(rawValue);
    if (!Number.isInteger(value) || value < 0 || value > MAX_INTERVAL_SECONDS) {
        throw new ArgumentError(`Invalid interval: ${JSON.stringify(rawValue)}. Expected an integer from 0 to ${MAX_INTERVAL_SECONDS}.`);
    }
    return value;
}

export function toBatchFailureRow({ listId, username, error }) {
    return {
        listId,
        username,
        userId: '',
        status: 'failed',
        message: error?.message || String(error),
    };
}

function isGlobalBatchFailure(error) {
    if (error instanceof ArgumentError || error instanceof AuthRequiredError) {
        return true;
    }
    const message = error?.message || String(error);
    return /Invalid listId|Could not fetch lists|List \d+ not found among your lists|Not logged into x\.com/i.test(message);
}

export async function waitBetweenBatchItems(page, seconds) {
    if (seconds <= 0) return;
    if (page && typeof page.wait === 'function') {
        await page.wait(seconds);
        return;
    }
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

export async function runListBatch({ page, listId, usernames, interval, operation }) {
    const rows = [];

    for (let i = 0; i < usernames.length; i++) {
        const username = usernames[i];
        try {
            const result = await operation(page, { listId, username });
            rows.push(...result);
        } catch (error) {
            if (isGlobalBatchFailure(error)) {
                throw error;
            }
            rows.push(toBatchFailureRow({ listId, username, error }));
        }

        if (i < usernames.length - 1) {
            await waitBetweenBatchItems(page, interval);
        }
    }

    return rows;
}
