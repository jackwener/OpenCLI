import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    DEFAULT_TTL_MS,
    findEntry,
    getCachePath,
    loadNetworkCache,
    saveNetworkCache,
    type CachedNetworkEntry,
    type NetworkCacheFile,
} from './network-cache.js';

function makeEntry(key: string, body: unknown = { ok: true }): CachedNetworkEntry {
    return { key, url: `https://x.com/${key}`, method: 'GET', status: 200, size: 2, ct: 'application/json', body };
}

describe('network-cache', () => {
    let baseDir: string;

    beforeEach(() => {
        baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-netcache-'));
    });
    afterEach(() => {
        fs.rmSync(baseDir, { recursive: true, force: true });
    });

    it('sanitizes session names into safe filenames', () => {
        const p = getCachePath('twitter/agent 1', baseDir);
        expect(path.basename(p)).toBe('twitter_agent_1.json');
    });

    it('round-trips entries through save + load', () => {
        saveNetworkCache('ws', [makeEntry('UserTweets'), makeEntry('UserByScreenName')], baseDir);
        const res = loadNetworkCache('ws', { baseDir });
        expect(res.status).toBe('ok');
        expect(res.file?.entries).toHaveLength(2);
        expect(res.file?.entries[0].key).toBe('UserTweets');
    });

    it('reports missing when cache file does not exist', () => {
        expect(loadNetworkCache('nope', { baseDir }).status).toBe('missing');
    });

    it('reports expired when the cache is older than ttl', () => {
        saveNetworkCache('ws', [makeEntry('A')], baseDir);
        const future = Date.now() + DEFAULT_TTL_MS + 60_000;
        const res = loadNetworkCache('ws', { baseDir, now: future });
        expect(res.status).toBe('expired');
        expect(res.file?.entries).toHaveLength(1);
    });

    it('reports corrupt for malformed json', () => {
        const file = getCachePath('ws', baseDir);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '{not json');
        expect(loadNetworkCache('ws', { baseDir }).status).toBe('corrupt');
    });

    it('reports corrupt for wrong schema version', () => {
        const file = getCachePath('ws', baseDir);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ version: 0, entries: [] }));
        expect(loadNetworkCache('ws', { baseDir }).status).toBe('corrupt');
    });

    it('findEntry returns matching entry or null', () => {
        const file: NetworkCacheFile = {
            version: 1, session: 'ws', savedAt: new Date().toISOString(),
            entries: [makeEntry('A'), makeEntry('B')],
        };
        expect(findEntry(file, 'B')?.key).toBe('B');
        expect(findEntry(file, 'missing')).toBeNull();
    });
});
