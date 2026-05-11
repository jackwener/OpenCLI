import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { __test__ } from './shared.js';
import { ArgumentError } from '@jackwener/opencli/errors';

const { extractMedia, extractCard, parseTweetUrl, buildTwitterArticleScopeSource } = __test__;

function makeCardTweet({ name, bindings, expandedUrl }) {
    const tweet = {
        card: { legacy: { name, binding_values: bindings } },
    };
    if (expandedUrl !== undefined) {
        tweet.legacy = { entities: { urls: [{ expanded_url: expandedUrl }] } };
    }
    return tweet;
}
function strBinding(key, string_value) {
    return { key, value: { type: 'STRING', string_value } };
}
function imgBinding(key, url) {
    return { key, value: { type: 'IMAGE', image_value: { url } } };
}

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

describe('twitter extractCard', () => {
    it('returns null when tweet has no card', () => {
        expect(extractCard({})).toBeNull();
        expect(extractCard(undefined)).toBeNull();
        expect(extractCard({ legacy: { full_text: 'hi' } })).toBeNull();
    });

    it('extracts full summary_large_image card with all bindings present', () => {
        const tweet = makeCardTweet({
            name: 'summary_large_image',
            bindings: [
                strBinding('title', 'jackwener/OpenCLI'),
                strBinding('description', 'Make Any Website & Tool Your CLI'),
                strBinding('domain', 'github.com'),
                strBinding('card_url', 'https://t.co/abc'),
                imgBinding('thumbnail_image_large', 'https://pbs.twimg.com/card_img/thumb_large.jpg'),
                imgBinding('photo_image_full_size_large', 'https://pbs.twimg.com/card_img/photo_large.jpg'),
                imgBinding('summary_photo_image_large', 'https://pbs.twimg.com/card_img/summary_large.jpg'),
            ],
            expandedUrl: 'https://github.com/jackwener/OpenCLI',
        });
        expect(extractCard(tweet)).toEqual({
            name: 'summary_large_image',
            title: 'jackwener/OpenCLI',
            description: 'Make Any Website & Tool Your CLI',
            image_url: 'https://pbs.twimg.com/card_img/thumb_large.jpg',
            url: 'https://github.com/jackwener/OpenCLI',
            domain: 'github.com',
        });
    });

    it('picks summary_photo_image_large when higher-priority image keys are missing', () => {
        const tweet = makeCardTweet({
            name: 'summary',
            bindings: [
                strBinding('title', 'Some article'),
                strBinding('description', 'Body text'),
                strBinding('domain', 'example.com'),
                imgBinding('summary_photo_image_large', 'https://pbs.twimg.com/card_img/fallback.jpg'),
            ],
            expandedUrl: 'https://example.com/article',
        });
        const card = extractCard(tweet);
        expect(card.image_url).toBe('https://pbs.twimg.com/card_img/fallback.jpg');
        expect(card.name).toBe('summary');
    });

    it('derives domain from expanded_url when domain binding is missing', () => {
        const tweet = makeCardTweet({
            name: 'promo_image_convo',
            bindings: [
                strBinding('title', 'YouTube video'),
                imgBinding('photo_image_full_size_large', 'https://pbs.twimg.com/card_img/yt.jpg'),
            ],
            expandedUrl: 'https://www.youtube.com/watch?v=abc',
        });
        const card = extractCard(tweet);
        expect(card.url).toBe('https://www.youtube.com/watch?v=abc');
        expect(card.domain).toBe('www.youtube.com');
        expect(card.image_url).toBe('https://pbs.twimg.com/card_img/yt.jpg');
    });

    it('falls back to card_url binding when there is no expanded_url', () => {
        const tweet = makeCardTweet({
            name: 'summary_large_image',
            bindings: [
                strBinding('title', 'arXiv paper'),
                strBinding('card_url', 'https://arxiv.org/abs/2305.12345'),
            ],
            expandedUrl: undefined,
        });
        const card = extractCard(tweet);
        expect(card.url).toBe('https://arxiv.org/abs/2305.12345');
        expect(card.domain).toBe('arxiv.org');
    });

    it('omits missing fields rather than emitting undefined values', () => {
        const tweet = makeCardTweet({
            name: 'summary',
            bindings: [
                strBinding('title', 'Just a title'),
                strBinding('description', 'Just a description'),
            ],
            expandedUrl: 'https://example.com/x',
        });
        const card = extractCard(tweet);
        expect('image_url' in card).toBe(false);
        expect(card).toEqual({
            name: 'summary',
            title: 'Just a title',
            description: 'Just a description',
            url: 'https://example.com/x',
            domain: 'example.com',
        });
    });

    it('returns null for a structurally empty card (no url, no title, no description)', () => {
        const tweet = makeCardTweet({
            name: 'summary',
            bindings: [
                imgBinding('thumbnail_image_large', 'https://pbs.twimg.com/card_img/x.jpg'),
            ],
            expandedUrl: undefined,
        });
        expect(extractCard(tweet)).toBeNull();
    });

    it('does not throw on a malformed expanded_url; domain is simply omitted', () => {
        const tweet = makeCardTweet({
            name: 'summary',
            bindings: [strBinding('title', 'broken url card')],
            expandedUrl: 'not a url',
        });
        const card = extractCard(tweet);
        expect(card.url).toBe('not a url');
        expect('domain' in card).toBe(false);
    });

    it('tolerates missing binding_values array', () => {
        const tweet = {
            card: { legacy: { name: 'summary' } },
            legacy: { entities: { urls: [{ expanded_url: 'https://example.com/' }] } },
        };
        const card = extractCard(tweet);
        // No title/description means the URL alone keeps the card alive
        expect(card).toEqual({
            name: 'summary',
            url: 'https://example.com/',
            domain: 'example.com',
        });
    });
});
