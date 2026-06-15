/**
 * Bilibili follow — establishes a follow relation via the official write API.
 * Authenticated by logged-in cookie + bili_jct CSRF token (handled by apiPost).
 *
 * Accepts target as: numeric uid, username, or a space.bilibili.com profile URL.
 * Pre-checks the current relation so the result row reports `already-following`
 * accurately instead of relying on the modify API's idempotent silent success.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { apiPost, fetchJson, getSelfUid, requireOkPayload, resolveUid } from './utils.js';

const RELATION_VERIFY_TIMEOUT_MS = 5000;
const RELATION_VERIFY_POLL_MS = 500;

function parseSpaceMidUrl(raw) {
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

/**
 * Pull a uid out of a `space.bilibili.com/<uid>` URL before falling back to the
 * generic resolver. `resolveUid` only handles bare digits or usernames; without
 * this short-circuit a profile URL would get sent to the user-search endpoint
 * and likely return nothing.
 */
async function resolveTargetMid(page, raw) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) {
        throw new ArgumentError('bilibili follow target cannot be empty');
    }
    if (/^(?:https?:\/\/)?space\.bilibili\.com\//i.test(trimmed)) {
        const mid = parseSpaceMidUrl(trimmed);
        if (!mid) {
            throw new ArgumentError('bilibili follow target must be a valid space.bilibili.com/<uid> URL');
        }
        return mid;
    }
    try {
        return await resolveUid(page, trimmed);
    } catch (error) {
        if (error instanceof EmptyResultError) throw error;
        throw new ArgumentError(
            `Cannot resolve Bilibili target from input: ${trimmed}`,
            error instanceof Error ? error.message : String(error),
        );
    }
}

/**
 * `attribute` from /x/relation encodes the viewer→target relation:
 *   0 = no relation, 2 = following, 6 = mutual follow, 128 = blocked.
 * `2` and `6` both count as "already following" from the follow command's POV.
 */
async function fetchRelationAttribute(page, mid) {
    const payload = await fetchJson(page, `https://api.bilibili.com/x/relation?fid=${mid}`);
    requireOkPayload(payload, 'relation query');
    const attribute = payload?.data?.attribute;
    if (typeof attribute !== 'number') {
        throw new CommandExecutionError('Bilibili relation query returned a malformed attribute');
    }
    return attribute;
}

async function waitForRelation(page, mid, predicate, expectedLabel) {
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

cli({
    site: 'bilibili',
    name: 'follow',
    access: 'write',
    description: '关注 B站用户（官方 API，需登录）',
    domain: 'www.bilibili.com',
    strategy: Strategy.COOKIE,
    args: [
        {
            name: 'target',
            required: true,
            positional: true,
            help: '目标 UID / 用户名 / space.bilibili.com 链接',
        },
    ],
    columns: ['mid', 'name', 'status', 'url'],
    func: async (page, kwargs) => {
        if (!page) {
            throw new CommandExecutionError('Browser session required for bilibili follow');
        }
        const mid = await resolveTargetMid(page, kwargs.target);
        const self = await getSelfUid(page);
        if (mid === self) {
            throw new ArgumentError('Cannot follow yourself');
        }
        const attribute = await fetchRelationAttribute(page, mid);
        const url = `https://space.bilibili.com/${mid}`;
        if (attribute === 2 || attribute === 6) {
            return [{ mid, name: '', status: 'already-following', url }];
        }
        if (attribute === 128) {
            throw new CommandExecutionError(
                `Bilibili user ${mid} is blocked; unblock first before following.`,
            );
        }
        // act=1 follow, act=2 unfollow. re_src=11 is the community-standard
        // "web" source value used by third-party libs (bilibili-api-python etc.);
        // omitting it makes the modify API reject with a vague code.
        const payload = await apiPost(page, '/x/relation/modify', {
            params: { fid: mid, act: 1, re_src: 11 },
        });
        requireOkPayload(payload, 'relation modify');
        await waitForRelation(page, mid, (nextAttribute) => nextAttribute === 2 || nextAttribute === 6, 'following');
        return [{ mid, name: '', status: 'followed', url }];
    },
});

export const __test__ = {
    resolveTargetMid,
    fetchRelationAttribute,
    waitForRelation,
};
