import { beforeEach, describe, expect, it, vi } from 'vitest';
const { mockGetNotebooklmPageState, mockReadCurrentNotebooklm, mockRequireNotebooklmSession, } = vi.hoisted(() => ({
    mockGetNotebooklmPageState: vi.fn(),
    mockReadCurrentNotebooklm: vi.fn(),
    mockRequireNotebooklmSession: vi.fn(),
}));
vi.mock('./utils.js', async () => {
    const actual = await vi.importActual('./utils.js');
    return {
        ...actual,
        getNotebooklmPageState: mockGetNotebooklmPageState,
        readCurrentNotebooklm: mockReadCurrentNotebooklm,
        requireNotebooklmSession: mockRequireNotebooklmSession,
    };
});
import { getRegistry } from '@jackwener/opencli/registry';
import './open.js';
describe('notebooklm open', () => {
    const command = getRegistry().get('notebooklm/open');
    beforeEach(() => {
        mockGetNotebooklmPageState.mockReset();
        mockReadCurrentNotebooklm.mockReset();
        mockRequireNotebooklmSession.mockReset();
        mockRequireNotebooklmSession.mockResolvedValue(undefined);
        mockGetNotebooklmPageState.mockResolvedValue({
            url: 'https://notebooklm.google.com/notebook/17e2b882-1234-1234-1234-abcdef012345',
            title: 'Browser Automation',
            hostname: 'notebooklm.google.com',
            kind: 'notebook',
            notebookId: '17e2b882-1234-1234-1234-abcdef012345',
            loginRequired: false,
            notebookCount: 1,
        });
        mockReadCurrentNotebooklm.mockResolvedValue({
            id: '17e2b882-1234-1234-1234-abcdef012345',
            title: 'Browser Automation',
            url: 'https://notebooklm.google.com/notebook/17e2b882-1234-1234-1234-abcdef012345',
            source: 'current-page',
        });
    });
    it('opens a notebook by id in the adapter session', async () => {
        const page = {
            goto: vi.fn(async () => { }),
            wait: vi.fn(async () => { }),
        };
        const result = await command.func(page, { notebook: '17e2b882-1234-1234-1234-abcdef012345' });
        expect(page.goto).toHaveBeenCalledWith('https://notebooklm.google.com/notebook/17e2b882-1234-1234-1234-abcdef012345');
        expect(result).toEqual([{
                id: '17e2b882-1234-1234-1234-abcdef012345',
                title: 'Browser Automation',
                url: 'https://notebooklm.google.com/notebook/17e2b882-1234-1234-1234-abcdef012345',
                source: 'current-page',
            }]);
    });
    it('accepts a full notebook url', async () => {
        const page = {
            goto: vi.fn(async () => { }),
            wait: vi.fn(async () => { }),
        };
        await command.func(page, { notebook: 'https://notebooklm.google.com/notebook/17e2b882-1234-1234-1234-abcdef012345?pli=1' });
        expect(page.goto).toHaveBeenCalledWith('https://notebooklm.google.com/notebook/17e2b882-1234-1234-1234-abcdef012345');
    });
});
