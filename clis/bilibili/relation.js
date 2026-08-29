import { CommandExecutionError } from '@jackwener/opencli/errors';
import { fetchJson, requireOkPayload } from './utils.js';

const RELATION_VERIFY_TIMEOUT_MS = 5000;
const RELATION_VERIFY_POLL_MS = 500;

export function parseSpaceMidUrl(raw) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) return '';
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    let parsed;
    try {
        parsed = new URL(candidate);
    } catch {
        return '';
    }
    if (parsed.hostname.toLowerCase() !== 'space.bilibili.com') return '';
    const match = parsed.pathname.match(/^\/(\d+)\/?$/);
    return match ? match[1] : '';
}

export async function fetchRelationAttribute(page, mid) {
    const payload = await fetchJson(page, `https://api.bilibili.com/x/relation?fid=${mid}`);
    requireOkPayload(payload, 'relation query');
    const attribute = payload?.data?.attribute;
    if (typeof attribute !== 'number') {
        throw new CommandExecutionError('Bilibili relation query returned a malformed attribute');
    }
    return attribute;
}

export async function waitForRelation(page, mid, predicate, expectedLabel) {
    const deadline = Date.now() + RELATION_VERIFY_TIMEOUT_MS;
    let lastAttribute;
    while (Date.now() <= deadline) {
        lastAttribute = await fetchRelationAttribute(page, mid);
        if (predicate(lastAttribute)) return lastAttribute;
        if (typeof page.wait !== 'function') break;
        await page.wait({ time: RELATION_VERIFY_POLL_MS / 1000 });
    }
    throw new CommandExecutionError(
        `Bilibili relation modify did not verify ${expectedLabel}; last attribute=${lastAttribute}`,
    );
}
