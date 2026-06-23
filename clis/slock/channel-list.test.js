import { describe, it, expect, vi } from 'vitest';
import { AuthRequiredError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './channel-list.js';

function makePage(result = { kind: 'ok', rows: [] }) {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(result),
  };
}

describe('slock channel-list', () => {
  const command = getRegistry().get('slock/channel-list');

  it('returns rows from /channels/ on happy path', async () => {
    const page = makePage({ kind: 'ok', rows: [
      { id: 'c1', name: 'general', topic: 'misc' },
      { id: 'c2', name: 'random' },
    ]});
    const rows = await command.func(page, {});
    expect(rows).toEqual([
      { id: 'c1', name: 'general', topic: 'misc' },
      { id: 'c2', name: 'random', topic: '' },
    ]);
  });

  it('maps kind:"auth" → AuthRequiredError', async () => {
    const page = makePage({ kind: 'auth', detail: '401' });
    await expect(command.func(page, {})).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('[anti-drift] non-array rows throws instead of silently returning empty', async () => {
    const page = makePage({ kind: 'ok', rows: { wrong: 'shape' } });
    await expect(command.func(page, {})).rejects.toThrow(/expected array/);
  });
});
