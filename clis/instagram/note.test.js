import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './note.js';
import { createPageMock } from '../test-utils.js';
describe('instagram note registration', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });
    it('registers the note command with a required positional content arg', () => {
        const cmd = getRegistry().get('instagram/note');
        expect(cmd).toBeDefined();
        expect(cmd?.browser).toBe(true);
        expect(cmd?.args.some((arg) => arg.name === 'content' && arg.positional && arg.required)).toBe(true);
    });
    it('rejects missing note content before browser work', async () => {
        const page = createPageMock();
        const cmd = getRegistry().get('instagram/note');
        await expect(cmd.func(page, {})).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });
    it('rejects blank note content before browser work', async () => {
        const page = createPageMock();
        const cmd = getRegistry().get('instagram/note');
        await expect(cmd.func(page, { content: '   ' })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });
    it('rejects note content longer than 60 characters before browser work', async () => {
        const page = createPageMock();
        const cmd = getRegistry().get('instagram/note');
        await expect(cmd.func(page, { content: 'x'.repeat(61) })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });
    it('publishes a note through the web inbox mutation', async () => {
        const page = createPageMock();
        const cmd = getRegistry().get('instagram/note');
        vi.mocked(page.evaluate).mockResolvedValue({
            ok: true,
            noteId: '17849203563031468',
        });
        const rows = await cmd.func(page, { content: 'hello note' });
        expect(page.goto).toHaveBeenCalledWith('https://www.instagram.com/direct/inbox/');
        expect(page.evaluate).toHaveBeenCalledTimes(1);
        expect(rows).toEqual([{
                status: '✅ Posted',
                detail: 'Instagram note published successfully',
                noteId: '17849203563031468',
            }]);
    });
});
