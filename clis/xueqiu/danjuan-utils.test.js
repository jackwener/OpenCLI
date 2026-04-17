import { describe, expect, it, vi } from 'vitest';
import { fetchDanjuanAll } from './danjuan-utils.js';
describe('fetchDanjuanAll', () => {
    it('throws when no Danjuan accounts are visible', async () => {
        const mockPage = {
            evaluate: vi.fn().mockResolvedValue({ _emptyAccounts: true }),
        };
        await expect(fetchDanjuanAll(mockPage)).rejects.toThrow('No fund accounts found');
    });
    it('throws when any account detail request fails', async () => {
        const mockPage = {
            evaluate: vi.fn().mockResolvedValue({
                detailErrors: [
                    { accountName: '默认账户', accountId: 'acc-1', error: 403 },
                ],
            }),
        };
        await expect(fetchDanjuanAll(mockPage)).rejects.toThrow('Failed to fetch Danjuan account details: 默认账户 (acc-1): 403');
    });
    it('returns the combined snapshot when all account details succeed', async () => {
        const snapshot = {
            asOf: '2026-03-25',
            totalAssetAmount: 100,
            totalAssetDailyGain: 1,
            totalAssetHoldGain: 2,
            totalAssetTotalGain: 3,
            totalFundMarketValue: 80,
            accounts: [{ accountId: 'acc-1', accountName: '默认账户' }],
            holdings: [{ accountId: 'acc-1', fdCode: '000001', fdName: '示例基金' }],
            detailErrors: [],
        };
        const mockPage = {
            evaluate: vi.fn().mockResolvedValue(snapshot),
        };
        await expect(fetchDanjuanAll(mockPage)).resolves.toMatchObject({
            asOf: '2026-03-25',
            accounts: [{ accountId: 'acc-1', accountName: '默认账户' }],
            holdings: [{ accountId: 'acc-1', fdCode: '000001', fdName: '示例基金' }],
        });
    });
});
