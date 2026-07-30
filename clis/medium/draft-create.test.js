import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, TimeoutError } from '@jackwener/opencli/errors';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import './draft-create.js';

function makePage(evaluateResults = [], overrides = {}) {
    const evaluate = vi.fn();
    for (const result of evaluateResults) evaluate.mockResolvedValueOnce(result);
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate,
        ...overrides,
    };
}

describe('medium draft-create command', () => {
    const getCommand = () => getRegistry().get('medium/draft-create');

    it('writes a story, confirms its autosave, and never opens publish UI', async () => {
        const page = makePage([
            { hasEditor: true, url: 'https://medium.com/new-story' },
            { ok: true, actualTitle: 'Draft title', actualBody: 'Draft body' },
            { ok: true, url: 'https://medium.com/p/draft-id/edit' },
        ]);

        const result = await getCommand().func(page, { title: 'Draft title', content: 'Draft body' });

        expect(result).toEqual([{
            status: 'draft_created',
            title: 'Draft title',
            images: 0,
            url: 'https://medium.com/p/draft-id/edit',
        }]);
        expect(getRegistry().get('medium/draft_create')).toBe(getCommand());
        expect(page.goto).toHaveBeenCalledWith('https://medium.com/new-story');
        expect(page.evaluate.mock.calls).toHaveLength(3);
        expect(page.evaluate.mock.calls[2][0]).toContain('hasSaveAcknowledgement');
        expect(page.evaluate.mock.calls[2][0]).not.toContain('publishButton');
    });

    it('uploads each requested inline image before confirming the draft save', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-medium-draft-'));
        const imagePath = path.join(dir, 'story.png');
        fs.writeFileSync(imagePath, 'not-a-real-png');
        const setFileInput = vi.fn().mockResolvedValue(undefined);
        const page = makePage([
            { hasEditor: true, url: 'https://medium.com/new-story' },
            { ok: true, actualTitle: 'Title', actualBody: 'Body' },
            { ok: true, selector: '[data-opencli-medium-image-upload="draft-image"]', imageCount: 0 },
            { ok: true, count: 1 },
            { ok: true, url: 'https://medium.com/p/draft-id/edit' },
        ], { setFileInput });

        const result = await getCommand().func(page, { title: 'Title', content: 'Body', image: imagePath });

        expect(setFileInput).toHaveBeenCalledWith([imagePath], '[data-opencli-medium-image-upload="draft-image"]');
        expect(result[0]).toMatchObject({ status: 'draft_created', images: 1 });
    });

    it('validates input before opening the editor', async () => {
        const page = makePage();

        await expect(getCommand().func(page, { title: '', content: 'Body' })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('fails closed when Medium never confirms the draft autosave', async () => {
        const page = makePage([
            { hasEditor: true, url: 'https://medium.com/new-story' },
            { ok: true, actualTitle: 'Title', actualBody: 'Body' },
            ...Array(60).fill({ ok: false, url: 'https://medium.com/new-story' }),
        ]);

        await expect(getCommand().func(page, { title: 'Title', content: 'Body' })).rejects.toBeInstanceOf(TimeoutError);
    });
});
