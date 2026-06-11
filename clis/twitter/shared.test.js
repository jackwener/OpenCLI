import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { __test__ } from './shared.js';
import { ArgumentError } from '@jackwener/opencli/errors';

const {
    extractMedia,
    extractCard,
    extractQuotedTweet,
    parseTweetUrl,
    buildTwitterArticleScopeSource,
    unwrapBrowserResult,
    normalizeTwitterGraphqlPayload,
    normalizeTwitterScreenName,
    normalizeTwitterOperationFlags,
    sanitizeTwitterOperationMetadata,
    looksLikePrivateTwitterTimeline,
    parseOperationFromBundleText,
    describeTwitterApiError,
} = __test__;

function makeCardTweet({ name, bindings, expandedUrl, urls }) {
    const tweet = {
        card: { legacy: { name, binding_values: bindings } },
    };
    if (urls !== undefined) {
        tweet.legacy = { entities: { urls } };
        return tweet;
    }
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

describe('twitter browser result helpers', () => {
    it('unwraps Browser Bridge exec envelopes', () => {
        expect(unwrapBrowserResult({ session: 'site:twitter', data: '123' })).toBe('123');
        expect(unwrapBrowserResult({ data: { user: true } })).toEqual({ data: { user: true } });
    });

    it('sanitizes operation metadata after unwrapping Browser Bridge envelopes', () => {
        const result = sanitizeTwitterOperationMetadata({
            session: 'site:twitter',
            data: {
                queryId: 'abc_123',
                features: { feature: true },
                fieldToggles: { field: true },
            },
        }, { queryId: 'fallback', features: {}, fieldToggles: {} });
        expect(result).toEqual({
            queryId: 'abc_123',
            features: { feature: true },
            fieldToggles: { field: true },
        });
    });

    it('falls back to baked features / fieldToggles when the bundle parser returns empty maps', () => {
        const result = sanitizeTwitterOperationMetadata({
            queryId: 'newQueryId',
            features: {},
            fieldToggles: {},
        }, {
            queryId: 'fallback',
            features: { fallback_feature: true },
            fieldToggles: { fallback_field: true },
        });
        expect(result).toEqual({
            queryId: 'newQueryId',
            features: { fallback_feature: true },
            fieldToggles: { fallback_field: true },
        });
    });

    it('falls back when resolved features are non-object falsy values', () => {
        const result = sanitizeTwitterOperationMetadata({
            queryId: 'newQueryId',
            features: null,
            fieldToggles: undefined,
        }, {
            queryId: 'fallback',
            features: { fallback_feature: true },
            fieldToggles: { fallback_field: true },
        });
        expect(result.features).toEqual({ fallback_feature: true });
        expect(result.fieldToggles).toEqual({ fallback_field: true });
    });

    it('normalizes operation feature arrays and boolean maps without losing false flags', () => {
        expect(normalizeTwitterOperationFlags(['feature_a', 'feature_b'])).toEqual({
            feature_a: true,
            feature_b: true,
        });
        expect(normalizeTwitterOperationFlags({
            rweb_video_screen_enabled: false,
            responsive_web_graphql_timeline_navigation_enabled: true,
            ignored_non_boolean: 'true',
        })).toEqual({
            rweb_video_screen_enabled: false,
            responsive_web_graphql_timeline_navigation_enabled: true,
        });
    });

    it('keeps GitHub placeholder-style features boolean maps instead of falling back', () => {
        const result = sanitizeTwitterOperationMetadata({
            queryId: 'newQueryId',
            features: {
                rweb_video_screen_enabled: false,
                responsive_web_graphql_timeline_navigation_enabled: true,
            },
            fieldToggles: {
                withArticlePlainText: true,
            },
        }, {
            queryId: 'fallback',
            features: { fallback_feature: true },
            fieldToggles: { fallback_field: true },
        });
        expect(result).toEqual({
            queryId: 'newQueryId',
            features: {
                rweb_video_screen_enabled: false,
                responsive_web_graphql_timeline_navigation_enabled: true,
            },
            fieldToggles: {
                withArticlePlainText: true,
            },
        });
    });

    it('normalizes GraphQL payloads when the bridge strips the top-level data key', () => {
        expect(normalizeTwitterGraphqlPayload({ user: { result: {} } })).toEqual({
            data: { user: { result: {} } },
        });
        expect(normalizeTwitterGraphqlPayload({ search_by_raw_query: { search_timeline: {} } })).toEqual({
            data: { search_by_raw_query: { search_timeline: {} } },
        });
        expect(normalizeTwitterGraphqlPayload({ data: { user: {} } })).toEqual({ data: { user: {} } });
    });
});

describe('parseOperationFromBundleText (bundle queryId resolver)', () => {
    it('extracts queryId + featureSwitches + fieldToggles when queryId precedes operationName', () => {
        const bundle = 'something={queryId:"FRESH_ID_AAA",operationName:"SearchTimeline",metadata:{featureSwitches:["feat_one","feat_two"],fieldToggles:["ft_one"]}};other';
        const result = parseOperationFromBundleText(bundle, 'SearchTimeline');
        expect(result).toEqual({
            queryId: 'FRESH_ID_AAA',
            features: { feat_one: true, feat_two: true },
            fieldToggles: { ft_one: true },
        });
    });

    it('extracts queryId when operationName precedes queryId (reverse order)', () => {
        const bundle = 'mod={operationName:"SearchTimeline",queryId:"REVERSED_ID_BBB",metadata:{featureSwitches:["x"],fieldToggles:[]}};tail';
        const result = parseOperationFromBundleText(bundle, 'SearchTimeline');
        expect(result?.queryId).toBe('REVERSED_ID_BBB');
        expect(result?.features).toEqual({ x: true });
    });

    it("does not return another operation's queryId from a neighboring module (cross-module pollution)", () => {
        // Regression guard: the previous resolver cut a snippet via lastIndexOf('e.exports=')
        // / indexOf('}}}') around the operationName marker, then ran /queryId:"..."/
        // unanchored. That returned the first queryId in the snippet — often
        // belonging to a different operation in the same chunk. Twitter then
        // rejected the request as a stale queryId, surfacing as "queryId expired".
        const bundle = [
            'e.exports={queryId:"OTHER_QID_AAA",operationName:"UserTweets",metadata:{}};',
            'e.exports={queryId:"SEARCH_QID_BBB",operationName:"SearchTimeline",metadata:{featureSwitches:["f1"],fieldToggles:[]}};',
        ].join('');
        const result = parseOperationFromBundleText(bundle, 'SearchTimeline');
        expect(result?.queryId).toBe('SEARCH_QID_BBB');
        expect(result?.queryId).not.toBe('OTHER_QID_AAA');
    });

    it('returns null when operationName is absent from the bundle', () => {
        const bundle = 'no operation here, just queryId:"STRAY_QID" floating around';
        expect(parseOperationFromBundleText(bundle, 'SearchTimeline')).toBeNull();
    });

    it('returns null when queryId is too far from operationName (cross-object)', () => {
        // The [^}]{0,400} separator prevents matches that cross object boundaries
        // (a `}` between queryId and operationName means they belong to different
        // objects/modules).
        const bundle = 'e.exports={queryId:"WRONG_QID"};lots_of_other_code={};e.exports={operationName:"SearchTimeline",noQueryIdHere:true};';
        expect(parseOperationFromBundleText(bundle, 'SearchTimeline')).toBeNull();
    });

    it('falls back to empty features when featureSwitches array is not in the window', () => {
        // sanitizeTwitterOperationMetadata then uses the baked fallback features.
        const bundle = 'e.exports={queryId:"BARE_QID",operationName:"SearchTimeline"};';
        const result = parseOperationFromBundleText(bundle, 'SearchTimeline');
        expect(result?.queryId).toBe('BARE_QID');
        expect(result?.features).toEqual({});
        expect(result?.fieldToggles).toEqual({});
    });

    it('escapes regex metacharacters in operationName', () => {
        // Defensive — operationName values are controlled by callers but escaping
        // protects against future operation names with special chars.
        const bundle = 'queryId:"ESCAPED_QID"___operationName:"Foo.Bar"___';
        const result = parseOperationFromBundleText(bundle, 'Foo.Bar');
        expect(result?.queryId).toBe('ESCAPED_QID');
    });

    it('returns null for empty / invalid input', () => {
        expect(parseOperationFromBundleText('', 'SearchTimeline')).toBeNull();
        expect(parseOperationFromBundleText('text', '')).toBeNull();
        expect(parseOperationFromBundleText(null, 'SearchTimeline')).toBeNull();
    });
});

describe('twitter normalizeTwitterScreenName', () => {
    it('accepts exact handles and exact Twitter/X profile URLs', () => {
        expect(normalizeTwitterScreenName('@viewer')).toBe('viewer');
        expect(normalizeTwitterScreenName('/viewer')).toBe('viewer');
        expect(normalizeTwitterScreenName('https://x.com/viewer')).toBe('viewer');
        expect(normalizeTwitterScreenName('https://twitter.com/viewer?lang=en')).toBe('viewer');
        expect(normalizeTwitterScreenName('https://mobile.twitter.com/viewer')).toBe('viewer');
    });

    it('rejects route collisions, malformed handles, and non-exact profile URLs', () => {
        const invalid = [
            '/home',
            '/viewer/extra',
            'viewer/extra',
            'viewer?tab=posts',
            'https://x.com/home',
            'https://x.com/viewer/status/1',
            'http://x.com/viewer',
            'https://evil.com/viewer',
            'https://x.com.evil.com/viewer',
            'https://x.com:444/viewer',
            'https://user:pass@x.com/viewer',
            'bad-handle',
            'abcdefghijklmnop',
        ];
        for (const value of invalid) {
            expect(normalizeTwitterScreenName(value)).toBe('');
        }
    });
});

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
            urls: [{ url: 'https://t.co/abc', expanded_url: 'https://github.com/jackwener/OpenCLI' }],
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
                strBinding('card_url', 'https://t.co/youtube'),
                imgBinding('photo_image_full_size_large', 'https://pbs.twimg.com/card_img/yt.jpg'),
            ],
            urls: [{ url: 'https://t.co/youtube', expanded_url: 'https://www.youtube.com/watch?v=abc' }],
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

    it('matches card_url to the correct URL entity instead of assuming the first tweet URL', () => {
        const tweet = makeCardTweet({
            name: 'summary_large_image',
            bindings: [
                strBinding('title', 'OpenCLI release'),
                strBinding('card_url', 'https://t.co/card123'),
            ],
            urls: [
                { url: 'https://t.co/unrelated', expanded_url: 'https://example.com/unrelated' },
                { url: 'https://t.co/card123', expanded_url: 'https://github.com/jackwener/OpenCLI/releases' },
            ],
        });
        const card = extractCard(tweet);
        expect(card.url).toBe('https://github.com/jackwener/OpenCLI/releases');
        expect(card.domain).toBe('github.com');
    });

    it('falls back to card_url itself when no matching URL entity is present', () => {
        const tweet = makeCardTweet({
            name: 'summary_large_image',
            bindings: [
                strBinding('title', 'Unmatched card'),
                strBinding('card_url', 'https://t.co/card123'),
            ],
            urls: [
                { url: 'https://t.co/unrelated', expanded_url: 'https://example.com/unrelated' },
            ],
        });
        const card = extractCard(tweet);
        expect(card.url).toBe('https://t.co/card123');
        expect(card.domain).toBe('t.co');
    });

    it('omits missing fields rather than emitting undefined values', () => {
        const tweet = makeCardTweet({
            name: 'summary',
            bindings: [
                strBinding('title', 'Just a title'),
                strBinding('description', 'Just a description'),
                strBinding('card_url', 'https://t.co/example'),
            ],
            urls: [{ url: 'https://t.co/example', expanded_url: 'https://example.com/x' }],
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
            bindings: [
                strBinding('title', 'broken url card'),
                strBinding('card_url', 'https://t.co/broken'),
            ],
            urls: [{ url: 'https://t.co/broken', expanded_url: 'not a url' }],
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
        expect(card).toBeNull();
    });
});

describe('twitter extractQuotedTweet', () => {
    it('returns null on plain tweets (is_quote_status absent or false)', () => {
        expect(extractQuotedTweet({})).toBeNull();
        expect(extractQuotedTweet({ legacy: {} })).toBeNull();
        expect(extractQuotedTweet({ legacy: { is_quote_status: false } })).toBeNull();
        // is_quote_status true but no nested result (deleted / restricted): still null
        expect(extractQuotedTweet({
            legacy: { is_quote_status: true, quoted_status_id_str: '99' },
        })).toBeNull();
    });

    it('returns null on tombstoned / unavailable quoted tweets', () => {
        // GraphQL emits TweetTombstone / TweetUnavailable when the quoted tweet
        // is deleted, suspended, or privacy-restricted. The wrapper has no
        // `legacy` / `rest_id` — null-coalesces in the helper cover this.
        const tweet = {
            legacy: { is_quote_status: true, quoted_status_id_str: '99' },
            quoted_status_result: { result: { __typename: 'TweetTombstone' } },
        };
        expect(extractQuotedTweet(tweet)).toBeNull();
    });

    it('returns null when the quoted tweet lacks author identity', () => {
        const tweet = {
            legacy: { is_quote_status: true, quoted_status_id_str: '99' },
            quoted_status_result: {
                result: {
                    rest_id: '99',
                    legacy: { full_text: 'real quoted text' },
                    core: { user_results: { result: { legacy: {} } } },
                },
            },
        };
        expect(extractQuotedTweet(tweet)).toBeNull();
    });

    it('returns null when the quoted tweet author identity has the wrong shape', () => {
        const tweet = {
            legacy: { is_quote_status: true, quoted_status_id_str: '99' },
            quoted_status_result: {
                result: {
                    rest_id: '99',
                    legacy: { full_text: 'real quoted text' },
                    core: {
                        user_results: {
                            result: {
                                legacy: { screen_name: { value: 'alice' }, name: { value: 'Alice' } },
                            },
                        },
                    },
                },
            },
        };
        expect(extractQuotedTweet(tweet)).toBeNull();
    });

    it('returns null when the quoted tweet author handle is not a valid screen name', () => {
        const tweet = {
            legacy: { is_quote_status: true, quoted_status_id_str: '99' },
            quoted_status_result: {
                result: {
                    rest_id: '99',
                    legacy: { full_text: 'real quoted text' },
                    core: { user_results: { result: { legacy: { screen_name: 'not/a/user' } } } },
                },
            },
        };
        expect(extractQuotedTweet(tweet)).toBeNull();
    });

    it('returns null when the quoted tweet lacks renderable content', () => {
        const tweet = {
            legacy: { is_quote_status: true, quoted_status_id_str: '99' },
            quoted_status_result: {
                result: {
                    rest_id: '99',
                    legacy: {},
                    core: { user_results: { result: { legacy: { screen_name: 'alice' } } } },
                },
            },
        };
        expect(extractQuotedTweet(tweet)).toBeNull();
    });

    it('extracts a minimal quoted tweet shape with author, text, url', () => {
        const tweet = {
            legacy: { is_quote_status: true, quoted_status_id_str: '2040254679301718161' },
            quoted_status_result: {
                result: {
                    rest_id: '2040254679301718161',
                    legacy: {
                        full_text: '罗某官二代背景考',
                        created_at: 'Wed May 13 22:00:00 +0000 2026',
                    },
                    core: {
                        user_results: {
                            result: { legacy: { screen_name: 'alice', name: 'Alice' } },
                        },
                    },
                },
            },
        };
        expect(extractQuotedTweet(tweet)).toEqual({
            id: '2040254679301718161',
            author: 'alice',
            name: 'Alice',
            text: '罗某官二代背景考',
            created_at: 'Wed May 13 22:00:00 +0000 2026',
            url: 'https://x.com/alice/status/2040254679301718161',
            has_media: false,
            media_urls: [],
        });
    });

    it('extracts media from the quoted tweet via extractMedia', () => {
        const tweet = {
            legacy: { is_quote_status: true },
            quoted_status_result: {
                result: {
                    rest_id: '99',
                    legacy: {
                        full_text: '日本电车实录',
                        extended_entities: {
                            media: [
                                { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/a.jpg' },
                                { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/b.jpg' },
                            ],
                        },
                    },
                    core: { user_results: { result: { legacy: { screen_name: 'rwayne' } } } },
                },
            },
        };
        const q = extractQuotedTweet(tweet);
        expect(q.has_media).toBe(true);
        expect(q.media_urls).toEqual([
            'https://pbs.twimg.com/media/a.jpg',
            'https://pbs.twimg.com/media/b.jpg',
        ]);
    });

    it('extracts the quoted tweet card when present', () => {
        const tweet = {
            legacy: { is_quote_status: true },
            quoted_status_result: {
                result: {
                    rest_id: '100',
                    legacy: {
                        full_text: '',
                        entities: {
                            urls: [{ url: 'https://t.co/abc', expanded_url: 'https://github.com/x/y' }],
                        },
                    },
                    core: { user_results: { result: { legacy: { screen_name: 'bob' } } } },
                    card: {
                        legacy: {
                            name: 'summary_large_image',
                            binding_values: [
                                { key: 'title', value: { type: 'STRING', string_value: 'x/y' } },
                                { key: 'card_url', value: { type: 'STRING', string_value: 'https://t.co/abc' } },
                            ],
                        },
                    },
                },
            },
        };
        const q = extractQuotedTweet(tweet);
        expect(q.card).toEqual({
            name: 'summary_large_image',
            title: 'x/y',
            url: 'https://github.com/x/y',
            domain: 'github.com',
        });
    });

    it('prefers long-form note_tweet text over truncated legacy full_text', () => {
        const tweet = {
            legacy: { is_quote_status: true },
            quoted_status_result: {
                result: {
                    rest_id: '101',
                    legacy: { full_text: 'short…' },
                    note_tweet: { note_tweet_results: { result: { text: 'full long body of the quoted tweet' } } },
                    core: { user_results: { result: { legacy: { screen_name: 'carol' } } } },
                },
            },
        };
        expect(extractQuotedTweet(tweet)?.text).toBe('full long body of the quoted tweet');
    });

    it('unwraps TweetWithVisibilityResults — quoted_status_result.result.tweet shim', () => {
        // Mirrors the top-level `tw.tweet || tw` shim that callers do for sensitive content.
        const tweet = {
            legacy: { is_quote_status: true },
            quoted_status_result: {
                result: {
                    __typename: 'TweetWithVisibilityResults',
                    tweet: {
                        rest_id: '102',
                        legacy: { full_text: 'sensitive content quoted' },
                        core: { user_results: { result: { legacy: { screen_name: 'dave' } } } },
                    },
                },
            },
        };
        const q = extractQuotedTweet(tweet);
        expect(q?.id).toBe('102');
        expect(q?.author).toBe('dave');
        expect(q?.text).toBe('sensitive content quoted');
    });

    it('does NOT recurse — a quote of a quote drops the inner-inner quote', () => {
        // Avoid payload explosion on threads where every reply re-quotes the root.
        // Level-1 quote is preserved; level-2 (a quote inside the quoted tweet)
        // is intentionally not surfaced.
        const tweet = {
            legacy: { is_quote_status: true },
            quoted_status_result: {
                result: {
                    rest_id: '200',
                    legacy: {
                        full_text: 'level-1 quote text',
                        is_quote_status: true,
                    },
                    core: { user_results: { result: { legacy: { screen_name: 'l1' } } } },
                    quoted_status_result: {
                        result: {
                            rest_id: '300',
                            legacy: { full_text: 'level-2 should be dropped' },
                            core: { user_results: { result: { legacy: { screen_name: 'l2' } } } },
                        },
                    },
                },
            },
        };
        const q = extractQuotedTweet(tweet);
        expect(q?.id).toBe('200');
        expect(q?.text).toBe('level-1 quote text');
        expect(q).not.toHaveProperty('quoted_tweet');
    });
});

describe('looksLikePrivateTwitterTimeline', () => {
    it('returns true when result.timeline is an empty object', () => {
        expect(looksLikePrivateTwitterTimeline({
            data: { user: { result: { __typename: 'User', timeline: {} } } },
        })).toBe(true);
    });
    it('returns false when timeline.timeline.instructions is present', () => {
        expect(looksLikePrivateTwitterTimeline({
            data: { user: { result: { timeline: { timeline: { instructions: [] } } } } },
        })).toBe(false);
    });
    it('returns false when timeline_v2.timeline.instructions is present', () => {
        expect(looksLikePrivateTwitterTimeline({
            data: { user: { result: { timeline_v2: { timeline: { instructions: [] } } } } },
        })).toBe(false);
    });
    it('returns false when result is missing entirely', () => {
        expect(looksLikePrivateTwitterTimeline({})).toBe(false);
        expect(looksLikePrivateTwitterTimeline(null)).toBe(false);
        expect(looksLikePrivateTwitterTimeline({ data: { user: {} } })).toBe(false);
    });
    it('returns false for non-empty malformed timeline objects', () => {
        expect(looksLikePrivateTwitterTimeline({
            data: { user: { result: { timeline: { unexpected: true } } } },
        })).toBe(false);
        expect(looksLikePrivateTwitterTimeline({
            data: { user: { result: { timeline: { timeline: {} } } } },
        })).toBe(false);
    });
    it('returns true when timeline_v2.timeline is an empty object', () => {
        expect(looksLikePrivateTwitterTimeline({
            data: { user: { result: { timeline_v2: { timeline: {} } } } },
        })).toBe(true);
    });
});

describe('describeTwitterApiError', () => {
    it('429 -> rate-limited language so callers cool down instead of treating as queryId expiry', () => {
        const msg = describeTwitterApiError('SearchTimeline', 429);
        expect(msg).toContain('HTTP 429');
        expect(msg).toContain('SearchTimeline');
        expect(msg).toContain('rate-limited');
        expect(msg).toContain('cooldown');
        expect(msg).not.toContain('queryId');
    });

    it('401 -> auth-failed language so callers trigger re-login instead of retrying', () => {
        const msg = describeTwitterApiError('TweetDetail', 401);
        expect(msg).toContain('HTTP 401');
        expect(msg).toContain('auth failed');
        expect(msg).toContain('re-login');
    });

    it('403 -> forbidden language with cookie-scope hint', () => {
        const msg = describeTwitterApiError('Likes', 403);
        expect(msg).toContain('HTTP 403');
        expect(msg).toContain('forbidden');
    });

    it('404 -> not-found language so callers map to empty/missing', () => {
        const msg = describeTwitterApiError('UserByScreenName', 404);
        expect(msg).toContain('HTTP 404');
        expect(msg).toContain('not found');
    });

    it('5xx (500) -> server-error language so callers retry later', () => {
        const msg = describeTwitterApiError('Bookmarks', 500);
        expect(msg).toContain('HTTP 500');
        expect(msg).toContain('server error');
    });

    it('5xx (503) -> server-error language', () => {
        const msg = describeTwitterApiError('UserTweets', 503);
        expect(msg).toContain('HTTP 503');
        expect(msg).toContain('server error');
    });

    it('unknown code -> falls back to queryId/schema-change hint (the original guess, now scoped)', () => {
        const msg = describeTwitterApiError('SearchTimeline', 999);
        expect(msg).toContain('HTTP 999');
        expect(msg).toContain('queryId');
        expect(msg).toContain('schema change');
    });

    it('numeric-string status (e.g. "429" from JSON) still routes to rate-limited branch', () => {
        const msg = describeTwitterApiError('SearchTimeline', '429');
        expect(msg).toContain('rate-limited');
    });

    it('appends adapter-specific extraHint in parentheses after the generic suffix', () => {
        const msg = describeTwitterApiError('ListLatestTweetsTimeline', 404, 'list may be private');
        expect(msg).toContain('not found');
        expect(msg).toContain('(list may be private)');
    });

    it('runtime-interpolated extraHint (e.g. folder id) is preserved verbatim', () => {
        const msg = describeTwitterApiError('BookmarkFolderTimeline', 404, 'folder=abc123');
        expect(msg).toContain('(folder=abc123)');
    });

    it('preserves "HTTP <status>:" prefix for backward-compat string matching by downstream pipelines', () => {
        // Downstream callers (ml-scout, ad-hoc scripts) may regex-match
        // /HTTP (\d+):/ to extract status code. The refactor must keep
        // that prefix verbatim so existing log parsers don't break.
        const cases = [400, 401, 403, 404, 429, 500, 503, 999];
        for (const code of cases) {
            const msg = describeTwitterApiError('SearchTimeline', code);
            expect(msg).toMatch(/^HTTP \d+: /);
            expect(msg).toContain(`HTTP ${code}:`);
        }
    });
});
