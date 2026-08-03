import { beforeEach, describe, expect, it, vi } from 'vitest';
const { mockGetNotebooklmPageState } = vi.hoisted(() => ({
    mockGetNotebooklmPageState: vi.fn(),
}));
vi.mock('./utils.js', async () => {
    const actual = await vi.importActual('./utils.js');
    return {
        ...actual,
        getNotebooklmPageState: mockGetNotebooklmPageState,
    };
});
import { getRegistry } from '@jackwener/opencli/registry';
import './status.js';
describe('notebooklm status', () => {
    const command = getRegistry().get('notebooklm/status');
    beforeEach(() => {
        mockGetNotebooklmPageState.mockReset().mockResolvedValue({
            url: 'https://notebook.google.com/?pli=1',
            title: 'NotebookLM',
            hostname: 'notebook.google.com',
            kind: 'home',
            notebookId: '',
            loginRequired: false,
            notebookCount: 2,
        });
    });
    it('keeps redirected NotebookLM home pages connected without re-navigation', async () => {
        const page = {
            getCurrentUrl: vi.fn().mockResolvedValue('https://notebook.google.com/?pli=1'),
            goto: vi.fn(),
            wait: vi.fn(),
        };
        await expect(command.func(page, {})).resolves.toEqual([{
            status: 'Connected',
            login: 'OK',
            page: 'home',
            url: 'https://notebook.google.com/?pli=1',
            title: 'NotebookLM',
            notebooks: 2,
        }]);
        expect(page.goto).not.toHaveBeenCalled();
        expect(mockGetNotebooklmPageState).toHaveBeenCalledTimes(1);
    });
});
