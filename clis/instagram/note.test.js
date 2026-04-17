import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './note.js';
function createPageMock() {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
        getCookies: vi.fn().mockResolvedValue([]),
        snapshot: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        typeText: vi.fn().mockResolvedValue(undefined),
        pressKey: vi.fn().mockResolvedValue(undefined),
        scrollTo: vi.fn().mockResolvedValue(undefined),
        getFormState: vi.fn().mockResolvedValue({ forms: [], orphanFields: [] }),
        wait: vi.fn().mockResolvedValue(undefined),
        tabs: vi.fn().mockResolvedValue([]),
        closeTab: vi.fn().mockResolvedValue(undefined),
        newTab: vi.fn().mockResolvedValue(undefined),
        selectTab: vi.fn().mockResolvedValue(undefined),
        networkRequests: vi.fn().mockResolvedValue([]),
        consoleMessages: vi.fn().mockResolvedValue([]),
        scroll: vi.fn().mockResolvedValue(undefined),
        autoScroll: vi.fn().mockResolvedValue(undefined),
        installInterceptor: vi.fn().mockResolvedValue(undefined),
        getInterceptedRequests: vi.fn().mockResolvedValue([]),
        waitForCapture: vi.fn().mockResolvedValue(undefined),
        screenshot: vi.fn().mockResolvedValue(''),
        setFileInput: vi.fn().mockResolvedValue(undefined),
        insertText: vi.fn().mockResolvedValue(undefined),
        getCurrentUrl: vi.fn().mockResolvedValue(null),
    };
}
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
