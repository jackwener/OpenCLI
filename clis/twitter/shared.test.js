import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { __test__ } from './shared.js';
import { ArgumentError } from '@jackwener/opencli/errors';

const { extractMedia, parseTweetUrl, buildTwitterArticleScopeSource } = __test__;

describe('twitter parseTweetUrl', () => {
    it('accepts exact Twitter/X tweet URLs and preserves query parameters', () => {
        expect(parseTweetUrl('https://x.com/alice/status/2040254679301718161?s=20')).toEqual({
            id: '2040254679301718161',
            url: 'https://x.com/alice/status/2040254679301718161?s=20',
        });
        expect(parseTweetUrl('https://mobile.twitter.com/i/status/2040318731105313143')).toEqual({
            id: '2040318731105313143',
            url: 'https://mobile.twitter.com/i/status/2040318731105313143',
        });
    });

    it('rejects non-https, off-domain, host-suffix, embedded, and path-suffix URLs', () => {
        const invalid = [
            'http://x.com/alice/status/2040254679301718161',
            'https://evil.com/alice/status/2040254679301718161',
            'https://x.com.evil.com/alice/status/2040254679301718161',
            'https://evil.com/?next=https://x.com/alice/status/2040254679301718161',
            'https://x.com/alice/status/2040254679301718161/photo/1',
        ];
        for (const url of invalid) {
            expect(() => parseTweetUrl(url)).toThrow(ArgumentError);
        }
    });
});

describe('twitter buildTwitterArticleScopeSource', () => {
    // JSDOM-based tests prove the returned source actually works on real DOM —
    // mocked `evaluate` tests in adapter specs only verify the script string
    // contains expected tokens, but cannot catch silent matching bugs (cf.
    // dianping #1312: mocked-evaluate single tests miss in-browser logic bugs).
    function loadHelpers(tweetId, dom) {
        const source = buildTwitterArticleScopeSource(tweetId);
        const probe = new Function(
            'document',
            'window',
            'URL',
            `${source}\nreturn { findTargetArticle, __twHasLinkToTarget, __twGetStatusIdFromHref };`,
        );
        return probe(dom.window.document, dom.window, dom.window.URL);
    }
    function makeDom(html) {
        return new JSDOM(`<html><body>${html}</body></html>`, { url: 'https://x.com/alice/status/2040254679301718161' });
    }

    it('finds the article whose link exactly matches the requested status id', () => {
        const dom = makeDom(`
            <article id="a"><a href="https://x.com/alice/status/2040254679301718161">link</a></article>
            <article id="b"><a href="https://x.com/bob/status/9999999999999999999">link</a></article>
        `);
        const helpers = loadHelpers('2040254679301718161', dom);
        const article = helpers.findTargetArticle();
        expect(article?.id).toBe('a');
    });

    it('rejects substring matches — tweet id 123 must not match /status/1234567', () => {
        // This is the codex-mini0 #1400 catch (substring vulnerability):
        // `/status/123` was accepted as a substring of `/status/1234567`.
        const dom = makeDom('<article><a href="https://x.com/alice/status/1234567">link</a></article>');
        const helpers = loadHelpers('123', dom);
        expect(helpers.findTargetArticle()).toBeUndefined();
    });

    it('rejects path-suffix attack — /status/<id>/photo/1 must not match status <id>', () => {
        // Same regex anchor that parseTweetUrl uses — guards against attached
        // paths like `/photo/1` that would otherwise pass with a loose suffix.
        const dom = makeDom('<article><a href="https://x.com/alice/status/2040254679301718161/photo/1">link</a></article>');
        const helpers = loadHelpers('2040254679301718161', dom);
        expect(helpers.findTargetArticle()).toBeUndefined();
    });

    it('rejects off-domain links even when the path has the requested status id', () => {
        const dom = makeDom('<article><a href="https://evil.com/alice/status/2040254679301718161">link</a></article>');
        const helpers = loadHelpers('2040254679301718161', dom);
        expect(helpers.findTargetArticle()).toBeUndefined();
    });

    it('rejects host-suffix and non-https status links', () => {
        const dom = makeDom(`
            <article id="suffix"><a href="https://x.com.evil.com/alice/status/2040254679301718161">link</a></article>
            <article id="http"><a href="http://x.com/alice/status/2040254679301718161">link</a></article>
        `);
        const helpers = loadHelpers('2040254679301718161', dom);
        expect(helpers.findTargetArticle()).toBeUndefined();
    });

    it('accepts exact Twitter/X status links with query and hash suffixes', () => {
        const dom = makeDom('<article id="ok"><a href="https://mobile.twitter.com/alice/status/2040254679301718161?s=20#fragment">link</a></article>');
        const helpers = loadHelpers('2040254679301718161', dom);
        expect(helpers.findTargetArticle()?.id).toBe('ok');
    });

    it('matches /i/status/<id> URL form', () => {
        const dom = makeDom('<article><a href="https://x.com/i/status/2040318731105313143">link</a></article>');
        const helpers = loadHelpers('2040318731105313143', dom);
        expect(helpers.findTargetArticle()).toBeTruthy();
    });

    it('__twHasLinkToTarget reports true on any descendant <a> matching tweet id', () => {
        // Used by quote-card guard in quote.js — the quoted tweet card is not
        // inside an <article>, but somewhere on the compose page.
        const dom = makeDom(`
            <div data-testid="card.wrapper">
                <a href="https://x.com/alice/status/2040254679301718161">quoted card</a>
            </div>
        `);
        const helpers = loadHelpers('2040254679301718161', dom);
        expect(helpers.__twHasLinkToTarget(dom.window.document)).toBe(true);
    });

    it('__twGetStatusIdFromHref returns null on non-status URLs', () => {
        const dom = makeDom('');
        const helpers = loadHelpers('123', dom);
        expect(helpers.__twGetStatusIdFromHref('https://x.com/alice/home')).toBeNull();
        expect(helpers.__twGetStatusIdFromHref('https://x.com/alice/status/123/photo/1')).toBeNull();
        expect(helpers.__twGetStatusIdFromHref('https://evil.com/alice/status/123')).toBeNull();
        expect(helpers.__twGetStatusIdFromHref('https://x.com.evil.com/alice/status/123')).toBeNull();
        expect(helpers.__twGetStatusIdFromHref('http://x.com/alice/status/123')).toBeNull();
        expect(helpers.__twGetStatusIdFromHref('not a url')).toBeNull();
    });

    it('emits the canonical regex anchor — guards future maintainers from dropping ^ or $', () => {
        const source = buildTwitterArticleScopeSource('123');
        // Source-level assertion complements the JSDOM behavioural tests above.
        // If a future refactor relaxes the anchor (e.g. drops ^ or $), the
        // JSDOM tests would still pass on benign inputs but fail on adversarial
        // cases. This token check ensures the regex shape itself is preserved.
        expect(source).toContain('/^\\/(?:[^/]+|i)\\/status\\/(\\d+)\\/?$/');
    });
});

describe('twitter extractMedia', () => {
    it('returns false + empty list when legacy has no media', () => {
        expect(extractMedia({})).toEqual({ has_media: false, media_urls: [] });
        expect(extractMedia(undefined)).toEqual({ has_media: false, media_urls: [] });
        expect(extractMedia({ extended_entities: { media: [] } })).toEqual({
            has_media: false,
            media_urls: [],
        });
    });

    it('extracts photo urls from extended_entities', () => {
        const result = extractMedia({
            extended_entities: {
                media: [
                    { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/a.jpg' },
                    { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/b.jpg' },
                ],
            },
        });
        expect(result.has_media).toBe(true);
        expect(result.media_urls).toEqual([
            'https://pbs.twimg.com/media/a.jpg',
            'https://pbs.twimg.com/media/b.jpg',
        ]);
    });

    it('prefers mp4 variant for video and animated_gif', () => {
        const result = extractMedia({
            extended_entities: {
                media: [
                    {
                        type: 'video',
                        media_url_https: 'https://pbs.twimg.com/media/thumb.jpg',
                        video_info: {
                            variants: [
                                { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/x.m3u8' },
                                { content_type: 'video/mp4', url: 'https://video.twimg.com/x.mp4' },
                            ],
                        },
                    },
                    {
                        type: 'animated_gif',
                        media_url_https: 'https://pbs.twimg.com/tweet_video_thumb/g.jpg',
                        video_info: {
                            variants: [
                                { content_type: 'video/mp4', url: 'https://video.twimg.com/g.mp4' },
                            ],
                        },
                    },
                ],
            },
        });
        expect(result.has_media).toBe(true);
        expect(result.media_urls).toEqual([
            'https://video.twimg.com/x.mp4',
            'https://video.twimg.com/g.mp4',
        ]);
    });

    it('falls back to media_url_https when no mp4 variant is available', () => {
        const result = extractMedia({
            extended_entities: {
                media: [
                    {
                        type: 'video',
                        media_url_https: 'https://pbs.twimg.com/media/thumb.jpg',
                        video_info: { variants: [] },
                    },
                ],
            },
        });
        expect(result).toEqual({
            has_media: true,
            media_urls: ['https://pbs.twimg.com/media/thumb.jpg'],
        });
    });

    it('falls back to entities.media when extended_entities is missing', () => {
        const result = extractMedia({
            entities: {
                media: [
                    { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/c.jpg' },
                ],
            },
        });
        expect(result).toEqual({
            has_media: true,
            media_urls: ['https://pbs.twimg.com/media/c.jpg'],
        });
    });
});
