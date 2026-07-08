import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { parseBoolFlag, sendWithFile, selectModel, requireConversationId, requireNonEmptyPrompt, requirePositiveInt } from './utils.js';

describe('claude parseBoolFlag', () => {
    it('returns booleans unchanged', () => {
        expect(parseBoolFlag(true)).toBe(true);
        expect(parseBoolFlag(false)).toBe(false);
    });

    it('treats only "true" string (case-insensitive) as true', () => {
        expect(parseBoolFlag('true')).toBe(true);
        expect(parseBoolFlag('TRUE')).toBe(true);
        expect(parseBoolFlag('1')).toBe(false);
        expect(parseBoolFlag('yes')).toBe(false);
        expect(parseBoolFlag('')).toBe(false);
        expect(parseBoolFlag(null)).toBe(false);
        expect(parseBoolFlag(undefined)).toBe(false);
    });
});

describe('claude argument helpers', () => {
    it('rejects blank prompts', () => {
        expect(() => requireNonEmptyPrompt('   ', 'claude ask')).toThrow(ArgumentError);
    });

    it('rejects non-positive integers for numeric flags', () => {
        expect(() => requirePositiveInt(0, 'claude ask --timeout')).toThrow(ArgumentError);
        expect(() => requirePositiveInt(-1, 'claude history --limit')).toThrow(ArgumentError);
    });

    it('rejects missing conversation ids', () => {
        expect(() => requireConversationId('   ')).toThrow(ArgumentError);
    });
});

describe('claude sendWithFile', () => {
    const tempDirs = [];

    afterEach(() => {
        vi.restoreAllMocks();
        while (tempDirs.length) {
            fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
        }
    });

    it('prefers page.setFileInput, then sends after preview appears', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-claude-'));
        tempDirs.push(dir);
        const filePath = path.join(dir, 'cat.png');
        fs.writeFileSync(filePath, 'fake');

        const page = {
            nativeType: vi.fn().mockResolvedValue(undefined),
            setFileInput: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({ ok: true, via: 'react' }) // React onChange fired after setFileInput
                .mockResolvedValueOnce(true)                       // waitForFilePreview hit
                .mockResolvedValueOnce(true)                       // composer ready
                .mockResolvedValueOnce({ ok: true }),              // send button click
        };

        const result = await sendWithFile(page, filePath, 'describe this');

        expect(result).toEqual({ ok: true });
        expect(page.setFileInput).toHaveBeenCalledWith([filePath], 'input[data-testid="file-upload"]');
        expect(page.nativeType).toHaveBeenCalledWith('describe this');
    });

    it('returns file-not-found when path does not exist', async () => {
        const page = { setFileInput: vi.fn(), evaluate: vi.fn(), wait: vi.fn() };
        const result = await sendWithFile(page, '/no/such/file.png', 'hi');
        expect(result.ok).toBe(false);
        expect(result.reason).toContain('File not found');
    });

    it('rejects oversized files before any upload attempt', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-claude-'));
        tempDirs.push(dir);
        const filePath = path.join(dir, 'big.bin');
        fs.writeFileSync(filePath, Buffer.alloc(31 * 1024 * 1024));

        const page = { setFileInput: vi.fn(), evaluate: vi.fn(), wait: vi.fn() };
        const result = await sendWithFile(page, filePath, 'hi');

        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/too large/);
        expect(page.setFileInput).not.toHaveBeenCalled();
    });
});

describe('claude selectModel', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('rejects unknown model keys without touching the page', async () => {
        const page = { evaluate: vi.fn() };

        const result = await selectModel(page, 'gpt5');

        expect(result).toEqual({ ok: false });
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('returns toggled=false when the dropdown already shows the requested model', async () => {
        const page = {
            evaluate: vi.fn().mockResolvedValueOnce({ ok: true, toggled: false }),
            wait: vi.fn(),
        };

        const result = await selectModel(page, 'sonnet');

        expect(result).toEqual({ ok: true, toggled: false });
        expect(page.wait).not.toHaveBeenCalled();
    });

    it('opens the dropdown and clicks the matching radio', async () => {
        const page = {
            evaluate: vi.fn()
                .mockResolvedValueOnce({ ok: true, opened: true })
                .mockResolvedValueOnce({ ok: true, toggled: true }),
            wait: vi.fn().mockResolvedValue(undefined),
        };

        const result = await selectModel(page, 'haiku');

        expect(result).toEqual({ ok: true, toggled: true });
        expect(page.evaluate).toHaveBeenCalledTimes(2);
    });

    it('flags upgrade-required when picking a paid model on free tier', async () => {
        const page = {
            evaluate: vi.fn()
                .mockResolvedValueOnce({ ok: true, opened: true })
                .mockResolvedValueOnce({ ok: false, upgrade: true }),
            wait: vi.fn().mockResolvedValue(undefined),
        };

        const result = await selectModel(page, 'opus');

        expect(result).toEqual({ ok: false, upgrade: true });
    });
});
