import { describe, expect, it } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { __test__, isOnGrok, normalizeBooleanFlag, parseGrokSessionId, sendMessage } from './utils.js';

describe('grok parseGrokSessionId', () => {
    const id = '7c4197f2-10a1-4ebb-a84a-fea89f4f1d06';

    it('returns a bare UUID unchanged', () => {
        expect(parseGrokSessionId(id)).toBe(id);
    });

    it('lowercases an upper-case ID', () => {
        expect(parseGrokSessionId(id.toUpperCase())).toBe(id);
    });

    it('extracts the session ID from a full grok.com chat URL', () => {
        expect(parseGrokSessionId(`https://grok.com/c/${id}`)).toBe(id);
        expect(parseGrokSessionId(`https://grok.com/c/${id}/`)).toBe(id);
        expect(parseGrokSessionId(`https://grok.com/c/${id}?rid=abc`)).toBe(id);
        expect(parseGrokSessionId(`https://x.grok.com/c/${id}`)).toBe(id);
    });

    it('throws ArgumentError on empty input', () => {
        expect(() => parseGrokSessionId('')).toThrow(ArgumentError);
        expect(() => parseGrokSessionId(null)).toThrow(ArgumentError);
        expect(() => parseGrokSessionId(undefined)).toThrow(ArgumentError);
        expect(() => parseGrokSessionId('   ')).toThrow(ArgumentError);
    });

    it('throws ArgumentError on non-UUID input', () => {
        expect(() => parseGrokSessionId('not-an-id')).toThrow(ArgumentError);
        expect(() => parseGrokSessionId('123')).toThrow(ArgumentError);
        // 32 hex chars (no dashes) — not the Grok UUID shape
        expect(() => parseGrokSessionId('7c4197f210a14ebba84afea89f4f1d06')).toThrow(ArgumentError);
        // UUID-shaped but bad hex
        expect(() => parseGrokSessionId('zc4197f2-10a1-4ebb-a84a-fea89f4f1d06')).toThrow(ArgumentError);
        // Bare-ID mode must not accept URL/query suffixes.
        expect(() => parseGrokSessionId(`${id}?next=abc`)).toThrow(ArgumentError);
        // URL with the wrong path shape must not silently fall through.
        expect(() => parseGrokSessionId('https://grok.com/somewhere/else')).toThrow(ArgumentError);
        expect(() => parseGrokSessionId(`http://grok.com/c/${id}`)).toThrow(ArgumentError);
        expect(() => parseGrokSessionId(`https://evil.com/c/${id}`)).toThrow(ArgumentError);
        expect(() => parseGrokSessionId(`https://fakegrok.com/c/${id}`)).toThrow(ArgumentError);
        expect(() => parseGrokSessionId(`https://grok.com.evil.com/c/${id}`)).toThrow(ArgumentError);
        expect(() => parseGrokSessionId(`https://evil.com/?next=https://grok.com/c/${id}`)).toThrow(ArgumentError);
        expect(() => parseGrokSessionId(`https://grok.com/c/${id}/extra`)).toThrow(ArgumentError);
        // URL embedding extra hex tail after the UUID must not silently truncate
        // and open the wrong conversation.
        expect(() => parseGrokSessionId(`https://grok.com/c/${id}0`)).toThrow(ArgumentError);
        expect(() => parseGrokSessionId(`https://grok.com/c/${id}-extra`)).toThrow(ArgumentError);
    });
});

describe('grok isOnGrok', () => {
    const fakePage = (url) => ({
        evaluate: () => url instanceof Error ? Promise.reject(url) : Promise.resolve(url),
    });

    it('returns true for grok.com URLs', async () => {
        expect(await isOnGrok(fakePage('https://grok.com/'))).toBe(true);
        expect(await isOnGrok(fakePage('https://grok.com/c/abc'))).toBe(true);
    });

    it('returns true for grok.com subdomains', async () => {
        expect(await isOnGrok(fakePage('https://api.grok.com/v1'))).toBe(true);
    });

    it('returns false for non-grok domains and rejects substring matches', async () => {
        expect(await isOnGrok(fakePage('https://fakegrok.com/'))).toBe(false);
        expect(await isOnGrok(fakePage('https://example.com/?next=grok.com'))).toBe(false);
        expect(await isOnGrok(fakePage('about:blank'))).toBe(false);
    });

    it('returns false when evaluate throws (detached tab)', async () => {
        expect(await isOnGrok(fakePage(new Error('detached')))).toBe(false);
    });
});

describe('grok normalizeBooleanFlag', () => {
    it('passes through actual booleans', () => {
        expect(normalizeBooleanFlag(true)).toBe(true);
        expect(normalizeBooleanFlag(false)).toBe(false);
    });

    it('returns the fallback for null/empty input', () => {
        expect(normalizeBooleanFlag(null)).toBe(false);
        expect(normalizeBooleanFlag(undefined)).toBe(false);
        expect(normalizeBooleanFlag('')).toBe(false);
        expect(normalizeBooleanFlag(null, true)).toBe(true);
    });

    it('parses common truthy strings', () => {
        for (const v of ['true', 'TRUE', '1', 'yes', 'on', ' Yes ']) {
            expect(normalizeBooleanFlag(v)).toBe(true);
        }
    });

    it('treats anything else as falsy', () => {
        for (const v of ['no', 'off', '0', 'false', 'random']) {
            expect(normalizeBooleanFlag(v)).toBe(false);
        }
    });
});

describe('grok getPinStateFromMenuLabels', () => {
    it('detects pinned state from unpin labels without substring collisions', () => {
        expect(__test__.getPinStateFromMenuLabels(['Open in new tab', 'Unpin', 'Delete'])).toBe('pinned');
        expect(__test__.getPinStateFromMenuLabels(['打开新标签页', '取消置顶', '删除'])).toBe('pinned');
    });

    it('detects unpinned state from pin labels', () => {
        expect(__test__.getPinStateFromMenuLabels(['Open in new tab', 'Pin', 'Delete'])).toBe('unpinned');
        expect(__test__.getPinStateFromMenuLabels(['打开新标签页', '置顶', '删除'])).toBe('unpinned');
    });

    it('returns empty string when neither state label is visible', () => {
        expect(__test__.getPinStateFromMenuLabels(['Open in new tab', 'Delete'])).toBe('');
        expect(__test__.getPinStateFromMenuLabels([])).toBe('');
    });
});

describe('grok sendMessage', () => {
    it('requires a submitted user turn after both submit-button and Enter fallback paths', async () => {
        let script = '';
        const page = {
            evaluate: async (value) => {
                script = String(value);
                return { ok: false, reason: 'test-capture' };
            },
        };

        await sendMessage(page, 'hello from test');

        expect(script).toContain('waitForSubmittedUserTurn');
        expect(script).toContain('Grok submit button was clicked but no new user turn appeared.');
        expect(script).toContain('Grok Enter-key fallback fired but no new user turn appeared.');
        expect(script).toContain('[data-testid="user-message"]');
        expect(script).toContain("submittedVia: 'submit-button'");
        expect(script).toContain("submittedVia: 'enter-key'");
    });
});
