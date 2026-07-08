import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './search-talents.js';

function createPageMock(apiPayload) {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    getCookies: vi.fn().mockResolvedValue([{ name: 'csrftoken', value: 'csrf' }]),
    evaluate: vi.fn().mockResolvedValue(apiPayload),
  };
}

describe('maimai search-talents', () => {
  const command = getRegistry().get('maimai/search-talents');

  it('throws EmptyResultError for an explicit empty talent list', async () => {
    const page = createPageMock({ code: 200, data: { list: [] } });

    await expect(command.func(page, { query: 'Java' })).rejects.toBeInstanceOf(EmptyResultError);
  });

  it('throws CommandExecutionError when API payload is missing the talent list shape', async () => {
    const page = createPageMock({ code: 200, data: { items: [] } });

    await expect(command.func(page, { query: 'Java' })).rejects.toBeInstanceOf(CommandExecutionError);
  });
});
