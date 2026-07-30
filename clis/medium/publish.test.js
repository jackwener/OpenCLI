import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

import './publish.js';

function makePage(evaluateResults = [], overrides = {}) {
    const evaluate = vi.fn();
    for (const result of evaluateResults) evaluate.mockResolvedValueOnce(result);
    evaluate.mockResolvedValue({ ok: true, url: 'https://medium.com/@writer/a-story' });
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate,
        ...overrides,
    };
}

describe('medium publish command', () => {
    const getCommand = () => getRegistry().get('medium/publish');

    it('writes a story and confirms that Medium published it', async () => {
        const page = makePage([
            { hasEditor: true, url: 'https://medium.com/new-story' },
            { ok: true, actualTitle: 'A practical title', actualBody: 'Story body' },
            { ok: true },
            { ok: true, label: 'Publish now' },
            { ok: true, url: 'https://medium.com/@writer/a-practical-title-123' },
        ]);

        const result = await getCommand().func(page, { title: 'A practical title', content: 'Story body' });

        expect(result).toEqual([{
            status: 'published',
            title: 'A practical title',
            url: 'https://medium.com/@writer/a-practical-title-123',
        }]);
        expect(page.goto).toHaveBeenCalledWith('https://medium.com/new-story');
        expect(page.evaluate.mock.calls[1][0]).toContain('editorTitleParagraph');
        expect(page.evaluate.mock.calls[1][0]).toContain('A practical title');
        expect(page.evaluate.mock.calls[1][0]).not.toContain('range.collapse');
        expect(page.evaluate.mock.calls[3][0]).toContain('publish now');
    });

    it('adds every requested tag after the publish dialog opens', async () => {
        const page = makePage([
            { hasEditor: true, url: 'https://medium.com/new-story' },
            { ok: true, actualTitle: 'Title', actualBody: 'Body' },
            { ok: true },
            { ok: true },
            { ok: true },
            { ok: true, label: 'Publish' },
            { ok: true, url: 'https://medium.com/@writer/story-123' },
        ]);

        await getCommand().func(page, { title: 'Title', content: 'Body', tags: 'ai, writing,ai' });

        expect(page.evaluate.mock.calls[3][0]).toContain('"ai"');
        expect(page.evaluate.mock.calls[4][0]).toContain('"writing"');
        expect(page.evaluate).toHaveBeenCalledTimes(7);
    });

    it('uses native browser input for each editor paragraph when it is available', async () => {
        const insertText = vi.fn().mockResolvedValue(undefined);
        const page = makePage([
            { hasEditor: true, url: 'https://medium.com/new-story' },
            { ok: true },
            { ok: true, actual: 'Title' },
            { ok: true },
            { ok: true },
            { ok: true },
            { ok: true, actual: 'Body' },
            { ok: true },
            { ok: true, label: 'Publish' },
            { ok: true, url: 'https://medium.com/@writer/story-123' },
        ], { insertText });

        await getCommand().func(page, { title: 'Title', content: 'Body' });

        expect(insertText).toHaveBeenNthCalledWith(1, 'Title');
        expect(insertText).toHaveBeenNthCalledWith(2, 'Body');
        expect(page.evaluate.mock.calls[1][0]).toContain('editorTitleParagraph');
        expect(page.evaluate.mock.calls[5][0]).toContain('p.graf--p');
    });

    it('fills the editor root in one native operation when fillText is available', async () => {
        const fillText = vi.fn().mockResolvedValue({ verified: true, actual: 'Title\nBody' });
        const page = makePage([
            { hasEditor: true, url: 'https://medium.com/new-story' },
            { ok: true },
            { ok: true, label: 'Publish' },
            { ok: true, url: 'https://medium.com/@writer/story-123' },
        ], { fillText });

        await getCommand().func(page, { title: 'Title', content: 'Body' });

        expect(fillText).toHaveBeenCalledWith('[role="textbox"][contenteditable="true"]', 'Title\nBody');
    });

    it('validates arguments before opening the editor', async () => {
        const page = makePage();
        const command = getCommand();

        await expect(command.func(page, { title: '', content: 'Body' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func(page, { title: 'Title', content: ' ', tags: 'one,two,three,four,five,six' })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('reports an expired session when the editor cannot be loaded', async () => {
        const page = makePage(Array(30).fill({ hasEditor: false, url: 'https://medium.com/signin' }));

        await expect(getCommand().func(page, { title: 'Title', content: 'Body' })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('does not claim success when Medium cannot confirm publication', async () => {
        const page = makePage([
            { hasEditor: true, url: 'https://medium.com/new-story' },
            { ok: true, actualTitle: 'Title', actualBody: 'Body' },
            { ok: true },
            { ok: true, label: 'Publish' },
            { ok: false, error: 'Medium reported a publish failure' },
        ]);

        await expect(getCommand().func(page, { title: 'Title', content: 'Body' })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
