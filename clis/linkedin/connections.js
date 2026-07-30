import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    LINKEDIN_DOMAIN,
    unwrapEvaluateResult,
    requireLinkedInCookie,
    normalizeWhitespace,
    parseLimit,
    assertLinkedInAuthenticated,
} from './shared.js';

const CONNECTIONS_PATH = '/voyager/api/relationships/connections';
const PAGE_SIZE = 40;

// Runs in-page: fetch the legacy voyager connections REST endpoint with the
// session csrf token. Returns { authRequired } / { error } / { json }.
async function fetchConnections(url, csrf) {
    try {
        const res = await fetch(url, {
            credentials: 'include',
            headers: {
                'csrf-token': csrf,
                accept: 'application/json',
                'x-restli-protocol-version': '2.0.0',
            },
        });
        if (res.status === 401 || res.status === 403) return { authRequired: true, error: 'HTTP ' + res.status };
        if (!res.ok) return { error: 'HTTP ' + res.status };
        const contentType = res.headers?.get?.('content-type') || '';
        if (/\btext\/html\b/i.test(contentType)) {
            return { authRequired: true, error: 'HTML auth/checkpoint response' };
        }
        try {
            return { json: await res.json() };
        } catch {
            return { error: 'response was not valid JSON' };
        }
    } catch (e) {
        return { error: 'fetch failed: ' + ((e && e.message) || String(e)) };
    }
}

function optionalText(value, field) {
    if (value == null) return '';
    if (typeof value !== 'string') {
        throw new CommandExecutionError(`LinkedIn connection miniProfile field ${field} was malformed`);
    }
    return normalizeWhitespace(value);
}

function mapConnection(element, index) {
    const mini = element && element.miniProfile;
    if (!mini || typeof mini !== 'object') {
        throw new CommandExecutionError('LinkedIn connections returned an element without a miniProfile');
    }
    const publicId = optionalText(mini.publicIdentifier, 'publicIdentifier');
    if (!publicId || /[\s/?#]/.test(publicId)) {
        throw new CommandExecutionError('LinkedIn connection element missing a stable public identifier');
    }
    const name = normalizeWhitespace([
        optionalText(mini.firstName, 'firstName'),
        optionalText(mini.lastName, 'lastName'),
    ].filter(Boolean).join(' ')) || publicId;
    return {
        rank: index + 1,
        name,
        occupation: optionalText(mini.occupation, 'occupation'),
        public_id: publicId,
        connected_at: Number.isFinite(element.createdAt) ? element.createdAt : 0,
        url: publicId ? `https://www.linkedin.com/in/${encodeURIComponent(publicId)}` : '',
    };
}

cli({
    site: 'linkedin',
    name: 'connections',
    access: 'read',
    description: 'List your LinkedIn first-degree connections (name, headline, profile URL)',
    domain: LINKEDIN_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of connections to return (max 500)' },
    ],
    columns: ['rank', 'name', 'occupation', 'public_id', 'connected_at', 'url'],
    func: async (page, kwargs) => {
        const limit = parseLimit(kwargs.limit, 20, 500);
        await page.goto('https://www.linkedin.com/mynetwork/invite-connect/connections/');
        await page.wait(2);
        await assertLinkedInAuthenticated(page, 'linkedin connections');
        const csrf = await requireLinkedInCookie(page, 'linkedin connections');
        const rows = [];
        let start = 0;
        while (rows.length < limit) {
            const remaining = limit - rows.length;
            const count = remaining < PAGE_SIZE ? remaining : PAGE_SIZE;
            const url = `${CONNECTIONS_PATH}?start=${start}&count=${count}`;
            const fetched = unwrapEvaluateResult(
                await page.evaluate(`(${fetchConnections.toString()})(${JSON.stringify(url)}, ${JSON.stringify(csrf)})`),
            );
            if (fetched && fetched.authRequired) {
                throw new AuthRequiredError(LINKEDIN_DOMAIN, 'LinkedIn connections API authentication failed: ' + fetched.error);
            }
            if (!fetched || fetched.error || !fetched.json) {
                throw new CommandExecutionError('LinkedIn connections API returned an unexpected response: ' + ((fetched && fetched.error) || 'no data'));
            }
            const elements = fetched.json.elements;
            if (!Array.isArray(elements)) {
                throw new CommandExecutionError('LinkedIn connections API returned a malformed payload: missing elements array');
            }
            if (elements.length === 0) break;
            for (const element of elements) {
                rows.push(mapConnection(element, rows.length));
                if (rows.length >= limit) break;
            }
            start += elements.length;
            if (elements.length < count) break;
        }
        if (rows.length === 0) {
            throw new EmptyResultError('linkedin connections', 'No LinkedIn connections were found.');
        }
        return rows;
    },
});

export const __test__ = { fetchConnections, mapConnection };
