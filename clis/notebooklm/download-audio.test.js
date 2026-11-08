import { describe, expect, it } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { __test__ } from './download-audio.js';

const {
    parseNotebookTarget,
    buildNotebookUrl,
    requirePositiveInt,
    buildRpcBody,
    parseChunkedResponse,
    extractRpcResult,
    parseSourceIds,
    parseArtifactRows,
    parseAudioArtifact,
    pickAudioUrl,
    buildCookieHeader,
} = __test__;

const NOTEBOOK_ID = '17e2b882-6a01-4c6c-9262-0738dfa2abee';
const SOURCE_ID = '7c7666bd-59e1-42ab-879d-bacfe33325eb';

describe('notebooklm download-audio', () => {
    it('parseNotebookTarget accepts a bare notebook uuid', () => {
        expect(parseNotebookTarget(NOTEBOOK_ID)).toBe(NOTEBOOK_ID);
        expect(parseNotebookTarget(NOTEBOOK_ID.toUpperCase())).toBe(NOTEBOOK_ID);
    });

    it('parseNotebookTarget accepts a notebook url', () => {
        expect(parseNotebookTarget(`https://notebook.google.com/notebook/${NOTEBOOK_ID}`)).toBe(NOTEBOOK_ID);
    });

    it('parseNotebookTarget rejects empty, non-url and wrong-host input', () => {
        expect(() => parseNotebookTarget('')).toThrow(ArgumentError);
        expect(() => parseNotebookTarget('not-a-notebook')).toThrow(ArgumentError);
        expect(() => parseNotebookTarget(`https://example.com/notebook/${NOTEBOOK_ID}`)).toThrow(ArgumentError);
        expect(() => parseNotebookTarget(`http://notebook.google.com/notebook/${NOTEBOOK_ID}`)).toThrow(ArgumentError);
    });

    it('buildNotebookUrl points at the canonical notebook page', () => {
        expect(buildNotebookUrl(NOTEBOOK_ID)).toBe(`https://notebook.google.com/notebook/${NOTEBOOK_ID}`);
    });

    it('requirePositiveInt falls back for empty values and rejects non-positive input', () => {
        expect(requirePositiveInt(undefined, 'timeout', 900)).toBe(900);
        expect(requirePositiveInt('', 'timeout', 900)).toBe(900);
        expect(requirePositiveInt('30', 'timeout', 900)).toBe(30);
        expect(() => requirePositiveInt(0, 'timeout', 900)).toThrow(ArgumentError);
        expect(() => requirePositiveInt(-5, 'timeout', 900)).toThrow(ArgumentError);
    });

    it('buildRpcBody encodes the request frame and the csrf token', () => {
        const body = buildRpcBody('abc123', { notebookId: NOTEBOOK_ID }, 'token/1');
        expect(body.startsWith('f.req=')).toBe(true);
        expect(body).toContain('at=token%2F1');
        const encoded = body.slice('f.req='.length, body.indexOf('&at='));
        expect(JSON.parse(decodeURIComponent(encoded))).toEqual([[['abc123', JSON.stringify({ notebookId: NOTEBOOK_ID }), null, 'generic']]]);
    });

    it('parseChunkedResponse reads size-prefixed chunks', () => {
        const raw = ['5', '[1,2]', '3', '[3]'].join('\n');
        expect(parseChunkedResponse(raw)).toEqual([[1, 2], [3]]);
    });

    it('parseChunkedResponse strips the anti-xssi prefix', () => {
        expect(parseChunkedResponse(")]}'\n[1,2]")).toEqual([[1, 2]]);
    });

    it('extractRpcResult returns the payload of the matching rpc frame', () => {
        const raw = JSON.stringify([['wrb.fr', 'abc123', { ok: true }]]);
        expect(extractRpcResult(raw, 'abc123')).toEqual({ ok: true });
    });

    it('extractRpcResult raises a typed error when no frame matches', () => {
        const raw = JSON.stringify([[['wrb.fr', 'other', { ok: true }]]]);
        expect(() => extractRpcResult(raw, 'abc123')).toThrow(/abc123/);
    });

    it('parseSourceIds pulls source uuids out of the nested detail payload', () => {
        const detail = [null, [[SOURCE_ID]], [[SOURCE_ID]]];
        expect(parseSourceIds([detail])).toEqual([SOURCE_ID]);
    });

    it('parseArtifactRows keeps only rows whose first cell is a uuid', () => {
        const row = [NOTEBOOK_ID, 'Audio Overview', 1];
        expect(parseArtifactRows([[row]])).toEqual([row]);
        expect(parseArtifactRows([[['not-a-uuid', 'x']]])).toEqual([]);
    });

    it('parseAudioArtifact maps the artifact row onto the manifest shape', () => {
        const row = [
            NOTEBOOK_ID,
            'Audio Overview',
            1,
            null,
            3,
            null,
            [null, null, null, null, null, [['https://lh3.example/audio.m4a', 1, 'audio/mp4']], [120, 500_000_000]],
        ];
        const artifact = parseAudioArtifact(row);
        expect(artifact.artifactId).toBe(NOTEBOOK_ID);
        expect(artifact.artifactTitle).toBe('Audio Overview');
        expect(artifact.artifactStatusLabel).toBe('ready');
        expect(artifact.artifactDurationSeconds).toBeCloseTo(120.5, 3);
        expect(artifact.artifactMedia[0]).toEqual({ url: 'https://lh3.example/audio.m4a', kind: 1, mime: 'audio/mp4' });
    });

    it('pickAudioUrl prefers the progressive file over streaming manifests', () => {
        expect(pickAudioUrl({
            artifactMedia: [
                { url: 'https://example/manifest.m3u8', kind: 4, mime: 'application/x-mpegURL' },
                { url: 'https://example/audio.m4a', kind: 1, mime: 'audio/mp4' },
            ],
            artifactAudioUrl: 'https://example/audio.m4a',
        })).toBe('https://example/audio.m4a');
    });

    it('buildCookieHeader only keeps cookies scoped to the requested host', () => {
        const cookies = [
            { domain: '.googleusercontent.com', name: 'SID', value: 'a' },
            { domain: '.google.com', name: 'OTHER', value: 'b' },
            { domain: 'other.example', name: 'NOPE', value: 'c' },
        ];
        // A .google.com cookie is not sent to googleusercontent.com (browser scoping).
        expect(buildCookieHeader(cookies, 'lh3.googleusercontent.com')).toBe('SID=a');
        expect(buildCookieHeader(cookies, 'notebook.google.com')).toBe('OTHER=b');
    });
});
