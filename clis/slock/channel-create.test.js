import { describe, it, expect, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './channel-create.js';

function makePage(result = { kind: 'ok', rows: { id: 'c1', name: 'launch', type: 'channel' } }) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(result) };
}

describe('slock channel-create', () => {
  const command = getRegistry().get('slock/channel-create');

  it('empty name rejected before navigation', async () => {
    const page = makePage();
    await expect(command.func(page, { name: '   ' })).rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('defaults to public visibility', async () => {
    const page = makePage();
    const rows = await command.func(page, { name: 'launch' });
    expect(page.evaluate.mock.calls[0][0]).toContain('public');
    expect(rows[0]).toMatchObject({ id: 'c1', name: 'launch', result: 'created' });
  });

  it('--private sends visibility:private', async () => {
    const page = makePage();
    await command.func(page, { name: 'secret', private: true });
    const script = page.evaluate.mock.calls[0][0];
    expect(script).toContain('visibility');
    expect(script).toContain('private');
  });

  it('over-long --description is rejected', async () => {
    const page = makePage();
    await expect(command.func(page, { name: 'x', description: 'a'.repeat(501) }))
      .rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });
});
