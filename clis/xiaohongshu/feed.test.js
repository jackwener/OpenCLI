import { describe, expect, it } from 'vitest';

import { buildFeedNoteUrl } from './feed.js';

const HOST = 'www.xiaohongshu.com';

describe('xiaohongshu/feed buildFeedNoteUrl', () => {
    it('appends xsec_token and an empty xsec_source when a token is present', () => {
        expect(buildFeedNoteUrl(HOST, 'abc123', 'TOK')).toBe(
            `https://${HOST}/explore/abc123?xsec_token=TOK&xsec_source=`,
        );
    });

    it('falls back to a bare /explore URL when the token is empty', () => {
        expect(buildFeedNoteUrl(HOST, 'abc123', '')).toBe(`https://${HOST}/explore/abc123`);
    });

    it('URL-encodes xsec_token instead of interpolating raw query text', () => {
        expect(buildFeedNoteUrl(HOST, 'abc123', 'a&b=c d')).toBe(
            `https://${HOST}/explore/abc123?xsec_token=a%26b%3Dc+d&xsec_source=`,
        );
    });
});
