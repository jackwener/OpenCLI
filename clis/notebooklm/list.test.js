import { beforeEach, describe, expect, it, vi } from 'vitest';
const { mockEnsureNotebooklmHome, mockListNotebooklmLinks, mockListNotebooklmViaRpc, mockReadCurrentNotebooklm, mockRequireNotebooklmSession, } = vi.hoisted(() => ({
    mockEnsureNotebooklmHome: vi.fn(),
    mockListNotebooklmLinks: vi.fn(),
    mockListNotebooklmViaRpc: vi.fn(),
    mockReadCurrentNotebooklm: vi.fn(),
    mockRequireNotebooklmSession: vi.fn(),
}));
vi.mock('./utils.js', async () => {
    const actual = await vi.importActual('./utils.js');
    return {
        ...actual,
        ensureNotebooklmHome: mockEnsureNotebooklmHome,
        listNotebooklmLinks: mockListNotebooklmLinks,
        listNotebooklmViaRpc: mockListNotebooklmViaRpc,
        readCurrentNotebooklm: mockReadCurrentNotebooklm,
        requireNotebooklmSession: mockRequireNotebooklmSession,
    };
});
import { getRegistry } from '@jackwener/opencli/registry';
import { AuthRequiredError, CliError, EmptyResultError } from '@jackwener/opencli/errors';
import './list.js';
describe('notebooklm list', () => {
    const command = getRegistry().get('notebooklm/list');
    const row = (id, source) => ({
        id,
        title: id,
        url: `https://notebook.google.com/notebook/${id}`,
        source,
        is_owner: true,
        created_at: null,
    });
    beforeEach(() => {
        mockEnsureNotebooklmHome.mockReset().mockResolvedValue(undefined);
        mockListNotebooklmLinks.mockReset().mockResolvedValue([]);
        mockListNotebooklmViaRpc.mockReset().mockResolvedValue([]);
        mockReadCurrentNotebooklm.mockReset().mockResolvedValue(null);
        mockRequireNotebooklmSession.mockReset().mockResolvedValue(undefined);
    });
    it('falls back to DOM rows after an RPC failure on the redirected host', async () => {
        const rows = [row('nb-dom', 'home-links')];
        mockListNotebooklmViaRpc.mockRejectedValueOnce(new Error('RPC unavailable on redirected host'));
        mockListNotebooklmLinks.mockResolvedValueOnce(rows);
        await expect(command.func({}, {})).resolves.toEqual(rows);
    });

    it('preserves the RPC typed error when every fallback is empty', async () => {
        const rpcError = new CliError('NOTEBOOKLM_RPC', 'transport failed');
        mockListNotebooklmViaRpc.mockRejectedValueOnce(rpcError);
        await expect(command.func({}, {})).rejects.toBe(rpcError);
    });

    it('recovers an RPC failure with a valid current-notebook row', async () => {
        const current = row('nb-current', 'current-page');
        mockReadCurrentNotebooklm.mockResolvedValueOnce(current);
        mockListNotebooklmViaRpc.mockRejectedValueOnce(new CliError('NOTEBOOKLM_RPC', 'transport failed'));
        await expect(command.func({}, {})).resolves.toEqual([current]);
    });

    it('reports a genuine authenticated empty state as EmptyResultError', async () => {
        await expect(command.func({}, {})).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('never downgrades authentication failures into DOM fallback rows', async () => {
        const authError = new AuthRequiredError('notebook.google.com');
        mockListNotebooklmViaRpc.mockRejectedValueOnce(authError);
        mockListNotebooklmLinks.mockResolvedValueOnce([row('nb-dom', 'home-links')]);
        await expect(command.func({}, {})).rejects.toBe(authError);
        expect(mockListNotebooklmLinks).not.toHaveBeenCalled();
    });
});
