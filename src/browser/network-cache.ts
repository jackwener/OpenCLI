/**
 * Persistent cache for browser network captures.
 *
 * The live capture buffer (JS interceptor / daemon ring) can be cleared
 * by navigation or lost between CLI invocations. Agents still need
 * stable references to request bodies after running other commands,
 * so every `browser network` call snapshots its results to disk.
 *
 * Layout: <cacheDir>/browser-network/<workspace>.json
 * Entries expire after DEFAULT_TTL_MS (24h).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface CachedNetworkEntry {
    key: string;
    url: string;
    method: string;
    status: number;
    /** Full body size in chars (may exceed stored body length when truncated). */
    size: number;
    ct: string;
    body: unknown;
    /**
     * Truncation signals use snake_case so `--raw` (which emits cache entries
     * verbatim) matches the agent-facing contract used by list / --detail.
     */
    body_truncated?: boolean;
    body_full_size?: number;
    timestamp?: number;
}

export interface NetworkCacheFile {
    version: 1;
    workspace: string;
    savedAt: string;
    entries: CachedNetworkEntry[];
}

function getDefaultCacheDir(): string {
    return process.env.OPENCLI_CACHE_DIR || path.join(os.homedir(), '.opencli', 'cache');
}

export function getCachePath(workspace: string, baseDir: string = getDefaultCacheDir()): string {
    const safe = workspace.replace(/[^a-zA-Z0-9_-]+/g, '_');
    return path.join(baseDir, 'browser-network', `${safe}.json`);
}

export function saveNetworkCache(
    workspace: string,
    entries: CachedNetworkEntry[],
    baseDir?: string,
): void {
    const target = getCachePath(workspace, baseDir);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const payload: NetworkCacheFile = {
        version: 1,
        workspace,
        savedAt: new Date().toISOString(),
        entries,
    };
    fs.writeFileSync(target, JSON.stringify(payload), 'utf-8');
}

export interface LoadOptions {
    baseDir?: string;
    ttlMs?: number;
    now?: number;
}

export interface LoadResult {
    status: 'ok' | 'missing' | 'expired' | 'corrupt';
    file?: NetworkCacheFile;
    ageMs?: number;
}

export function loadNetworkCache(workspace: string, opts: LoadOptions = {}): LoadResult {
    const target = getCachePath(workspace, opts.baseDir);
    let raw: string;
    try { raw = fs.readFileSync(target, 'utf-8'); }
    catch { return { status: 'missing' }; }

    let parsed: NetworkCacheFile;
    try {
        const obj = JSON.parse(raw);
        if (!obj || obj.version !== 1 || !Array.isArray(obj.entries)) {
            return { status: 'corrupt' };
        }
        parsed = obj as NetworkCacheFile;
    } catch {
        return { status: 'corrupt' };
    }

    const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
    const now = opts.now ?? Date.now();
    const savedAt = Date.parse(parsed.savedAt);
    if (!Number.isFinite(savedAt)) return { status: 'corrupt' };
    const ageMs = now - savedAt;
    if (ageMs > ttl) return { status: 'expired', file: parsed, ageMs };

    return { status: 'ok', file: parsed, ageMs };
}

export function findEntry(file: NetworkCacheFile, key: string): CachedNetworkEntry | null {
    return file.entries.find((e) => e.key === key) ?? null;
}
