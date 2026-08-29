import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
    DEFAULT_MAX_PAGINATION_PAGES,
    appendJsonlRows,
    ensureParentDir,
    loadJsonlArchiveState,
    removeResumeFile,
    resolveMaxPages,
    resolveOptionalFilePath,
} from './archive.js';

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-twitter-archive-'));
}

describe('twitter archive helpers', () => {
    it('resolves optional file paths and rejects blank explicit values', () => {
        expect(resolveOptionalFilePath(undefined, '--output-file')).toBe('');
        expect(resolveOptionalFilePath(null, '--output-file')).toBe('');
        expect(resolveOptionalFilePath('', '--output-file')).toBe('');
        expect(resolveOptionalFilePath('archive.jsonl', '--output-file')).toBe(path.resolve('archive.jsonl'));
        expect(() => resolveOptionalFilePath('   ', '--output-file')).toThrow(ArgumentError);
    });

    it('creates parent directories recursively', () => {
        const root = makeTempDir();
        try {
            const filePath = path.join(root, 'nested', 'archive', 'out.jsonl');
            ensureParentDir(filePath);
            expect(fs.statSync(path.dirname(filePath)).isDirectory()).toBe(true);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('loads JSONL state while ignoring blank lines and stringifying ids', () => {
        const root = makeTempDir();
        try {
            const filePath = path.join(root, 'archive.jsonl');
            fs.writeFileSync(filePath, '\n{"id":123}\n  \n{"id":"abc"}\n', 'utf8');
            const state = loadJsonlArchiveState(filePath);
            expect(state.count).toBe(2);
            expect([...state.seen]).toEqual(['123', 'abc']);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('fails JSONL loading with 1-based line errors for malformed records', () => {
        const root = makeTempDir();
        try {
            const missingId = path.join(root, 'missing-id.jsonl');
            fs.writeFileSync(missingId, '{"id":"ok"}\n{"text":"no id"}\n', 'utf8');
            expect(() => loadJsonlArchiveState(missingId)).toThrow(/line 2: missing id/);

            const badJson = path.join(root, 'bad-json.jsonl');
            fs.writeFileSync(badJson, '{"id":"ok"}\n{broken}\n', 'utf8');
            expect(() => loadJsonlArchiveState(badJson)).toThrow(CommandExecutionError);
            expect(() => loadJsonlArchiveState(badJson)).toThrow(/line 2:/);

            const duplicate = path.join(root, 'duplicate.jsonl');
            fs.writeFileSync(duplicate, '{"id":"same"}\n{"id":"same"}\n', 'utf8');
            expect(() => loadJsonlArchiveState(duplicate)).toThrow(/line 2: duplicate id same/);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('appends one physical JSONL line per row and escapes LS/PS', () => {
        const root = makeTempDir();
        try {
            const filePath = path.join(root, 'nested', 'archive.jsonl');
            appendJsonlRows(filePath, [
                { id: '1', text: 'line separator \u2028 paragraph \u2029 done' },
                { id: '2', text: 'second' },
            ]);
            appendJsonlRows(filePath, [{ id: '3', text: 'third' }]);
            const text = fs.readFileSync(filePath, 'utf8');
            const lines = text.split('\n');
            expect(lines).toHaveLength(4);
            expect(lines[3]).toBe('');
            expect(lines[0]).toContain('\\u2028');
            expect(lines[0]).toContain('\\u2029');
            expect(JSON.parse(lines[0])).toEqual({ id: '1', text: 'line separator \u2028 paragraph \u2029 done' });
            expect(JSON.parse(lines[2])).toEqual({ id: '3', text: 'third' });
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('removes resume files and ignores empty paths', () => {
        const root = makeTempDir();
        try {
            const filePath = path.join(root, 'resume.json');
            fs.writeFileSync(filePath, '{}\n', 'utf8');
            removeResumeFile(filePath);
            removeResumeFile('');
            expect(fs.existsSync(filePath)).toBe(false);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('resolves default and explicit max page bounds', () => {
        expect(resolveMaxPages({}, false)).toBe(DEFAULT_MAX_PAGINATION_PAGES);
        expect(resolveMaxPages({}, true)).toBe(100000);
        expect(resolveMaxPages({ 'max-pages': '' }, true)).toBe(100000);
        expect(resolveMaxPages({ 'max-pages': 1 }, false)).toBe(1);
        expect(resolveMaxPages({ 'max-pages': 100000 }, false)).toBe(100000);
        expect(() => resolveMaxPages({ 'max-pages': 0 }, false)).toThrow(ArgumentError);
        expect(() => resolveMaxPages({ 'max-pages': 1.5 }, false)).toThrow(ArgumentError);
        expect(() => resolveMaxPages({ 'max-pages': 100001 }, true)).toThrow(
            '--max-pages must be an integer between 1 and 100000',
        );
    });
});
