import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import './usage.js';

function makePage(evaluateResult) {
    const evaluate = evaluateResult instanceof Error
        ? vi.fn(async () => { throw evaluateResult; })
        : vi.fn(async () => evaluateResult);
    return {
        evaluate,
        goto: vi.fn(async () => {}),
        wait: vi.fn(async () => {}),
    };
}

describe('deepseek usage command', () => {
    const usageCommand = getRegistry().get('deepseek/usage');

    it('registers as a read command for the platform domain', () => {
        expect(usageCommand.access).toBe('read');
        expect(usageCommand.domain).toBe('platform.deepseek.com');
        expect(usageCommand.siteSession).toBe('persistent');
    });

    it('returns platform usage as a single read row', async () => {
        const page = makePage({
            balance: '12.30',
            bonusBalance: '0.00',
            cumulativeSpend: '45.60',
            monthlySpend: '7.80',
            monthlyApiCalls: '123',
            monthlyTokens: '456789',
            currentTokenEstimation: '987654',
            timePeriod: '近 7 天',
            periodSpend: '1.20',
            periodApiCalls: '34',
            periodTokens: '5678',
        });

        await expect(usageCommand.func(page)).resolves.toEqual([{
            balance: '12.30',
            bonusBalance: '0.00',
            cumulativeSpend: '45.60',
            monthlySpend: '7.80',
            monthlyApiCalls: '123',
            monthlyTokens: '456789',
            currentTokenEstimation: '987654',
            timePeriod: '近 7 天',
            periodSpend: '1.20',
            periodApiCalls: '34',
            periodTokens: '5678',
        }]);
        expect(page.goto).toHaveBeenCalledWith('https://platform.deepseek.com/usage');
    });

    it('typed-fails malformed payloads instead of returning default zeros', async () => {
        await expect(usageCommand.func(makePage(null))).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(usageCommand.func(makePage({ balance: '12.30' })))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(usageCommand.func(makePage({
            balance: '12.30',
            bonusBalance: '0.00',
            cumulativeSpend: '45.60',
            monthlySpend: '7.80',
            monthlyApiCalls: '123',
            monthlyTokens: 'not numeric',
            currentTokenEstimation: '987654',
            timePeriod: '近 7 天',
            periodSpend: '1.20',
            periodApiCalls: '34',
            periodTokens: '5678',
        }))).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('maps platform auth failures to AuthRequiredError', async () => {
        await expect(usageCommand.func(makePage(new Error('HTTP 401'))))
            .rejects.toBeInstanceOf(AuthRequiredError);
    });
});
