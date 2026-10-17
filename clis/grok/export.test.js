import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { __test__ as exportTest } from './export.js';
import { __test__ as exportAllTest } from './export-all.js';
import {
    normalizeConversationRows,
    normalizeManifestRows,
    requireObjectEvaluateResult,
} from './export-utils.js';

const ID = '7c4197f2-10a1-4ebb-a84a-fea89f4f1d06';
const ID2 = '8c4197f2-10a1-4ebb-a84a-fea89f4f1d07';

describe('grok export helpers', () => {
    it('validates export arguments without silent clamps', () => {
        expect(exportTest.normalizeLimit(0)).toBe(0);
        expect(exportTest.normalizeLimit(25)).toBe(25);
        expect(() => exportTest.normalizeLimit(-1)).toThrow(ArgumentError);
        expect(() => exportTest.normalizeLimit(1.5)).toThrow(ArgumentError);
        expect(exportTest.normalizeMaxScrolls(undefined)).toBe(80);
        expect(() => exportTest.normalizeMaxScrolls(0)).toThrow(ArgumentError);
        expect(() => exportTest.normalizeMaxScrolls(501)).toThrow(ArgumentError);
    });

    it('unwraps Browser Bridge evaluate envelopes', () => {
        expect(requireObjectEvaluateResult({ session: 's1', data: { ok: true } }, 'label')).toEqual({ ok: true });
    });

    it('typed-fails malformed history rows instead of filtering them to empty', () => {
        expect(() => normalizeConversationRows({}, 'grok export')).toThrow(CommandExecutionError);
        expect(() => normalizeConversationRows([{ title: 'missing id' }], 'grok export')).toThrow(CommandExecutionError);
        expect(() => normalizeConversationRows([{ id: ID, url: `https://evil.com/c/${ID}` }], 'grok export')).toThrow(CommandExecutionError);
        expect(() => normalizeConversationRows([{ id: ID, url: `https://grok.com/c/${ID2}` }], 'grok export')).toThrow(CommandExecutionError);
    });

    it('normalizes valid history rows', () => {
        expect(normalizeConversationRows([{ id: ID.toUpperCase(), title: 123, date: null }], 'grok export')).toEqual([
            { id: ID, title: '123', date: '', url: `https://grok.com/c/${ID}` },
        ]);
    });

    it('validates manifest rows as input arguments', () => {
        expect(() => normalizeManifestRows({})).toThrow(ArgumentError);
        expect(() => normalizeManifestRows([{ id: 'bad' }])).toThrow(ArgumentError);
        expect(normalizeManifestRows([{ id: ID, title: 'Hello' }])).toEqual([
            { id: ID, title: 'Hello', date: '', url: `https://grok.com/c/${ID}` },
        ]);
    });
});

describe('grok export-all command', () => {
    let tempDir = '';

    afterEach(() => {
        if (tempDir) {
            rmSync(tempDir, { recursive: true, force: true });
            tempDir = '';
        }
    });

    function writeManifest(rows) {
        tempDir = mkdtempSync(join(tmpdir(), 'opencli-grok-export-test-'));
        const path = join(tempDir, 'manifest.json');
        writeFileSync(path, JSON.stringify(rows), 'utf8');
        return path;
    }

    it('reads and slices a valid manifest', () => {
        const path = writeManifest([
            { id: ID, title: 'One' },
            { id: ID2, title: 'Two' },
        ]);
        expect(exportAllTest.readManifest(path, { offset: 1, limit: 1 })).toEqual([
            { id: ID2, title: 'Two', date: '', url: `https://grok.com/c/${ID2}` },
        ]);
    });

    it('rejects invalid manifest rows instead of silently dropping them', () => {
        const path = writeManifest([{ title: 'missing id' }]);
        expect(() => exportAllTest.readManifest(path, { offset: 0, limit: 0 })).toThrow(ArgumentError);
    });

});
