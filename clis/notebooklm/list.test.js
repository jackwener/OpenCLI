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
import './list.js';
describe('notebooklm list', () => {
    const command = getRegistry().get('notebooklm/list');
    beforeEach(() => {
        mockEnsureNotebooklmHome.mockReset().mockResolvedValue(undefined);
        mockListNotebooklmLinks.mockReset().mockResolvedValue([]);
        mockListNotebooklmViaRpc.mockReset().mockResolvedValue([]);
        mockReadCurrentNotebooklm.mockReset().mockResolvedValue(null);
        mockRequireNotebooklmSession.mockReset().mockResolvedValue(undefined);
    });
    it('returns RPC rows before considering DOM fallback', async () => {
        const rpcRows = [{
            id: 'nb-rpc',
            title: 'RPC notebook',
            url: 'https://notebooklm.google.com/notebook/nb-rpc',
            source: 'rpc',
            is_owner: true,
            created_at: null,
        }];
        mockListNotebooklmViaRpc.mockResolvedValueOnce(rpcRows);
        mockListNotebooklmLinks.mockResolvedValueOnce([{
            id: 'nb-dom',
            title: 'DOM notebook',
            url: 'https://notebooklm.google.com/notebook/nb-dom',
            source: 'home-links',
            is_owner: true,
            created_at: null,
        }]);
        const result = await command.func({}, {});
        expect(result).toEqual(rpcRows);
        expect(mockListNotebooklmViaRpc).toHaveBeenCalledTimes(1);
        expect(mockListNotebooklmLinks).not.toHaveBeenCalled();
        expect(mockRequireNotebooklmSession).toHaveBeenCalledTimes(1);
    });
    it('falls back to DOM rows after an RPC failure on the redirected host', async () => {
        const rows = [{
            id: 'nb-demo',
            title: 'Browser Automation',
            url: 'https://notebook.google.com/notebook/nb-demo',
            source: 'home-links',
            is_owner: true,
            created_at: null,
        }];
        mockRequireNotebooklmSession.mockResolvedValueOnce({
            hostname: 'notebook.google.com',
            kind: 'home',
        });
        mockListNotebooklmViaRpc.mockRejectedValueOnce(new Error('RPC unavailable on redirected host'));
        mockListNotebooklmLinks.mockResolvedValueOnce(rows);
        const result = await command.func({}, {});
        expect(result).toEqual(rows);
        expect(mockListNotebooklmViaRpc).toHaveBeenCalledTimes(1);
        expect(mockListNotebooklmLinks).toHaveBeenCalledTimes(1);
        expect(mockRequireNotebooklmSession).toHaveBeenCalledTimes(1);
    });
});
