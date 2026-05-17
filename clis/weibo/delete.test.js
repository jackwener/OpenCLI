import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

import './delete.js';

function makePage(evaluateResult) {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(evaluateResult),
  };
}

describe('weibo delete command', () => {
  const getCommand = () => getRegistry().get('weibo/delete');

  it('returns deleted status when the API reports success', async () => {
    const page = makePage({ ok: true, id: '5197123456789012', mblogid: 'Px2yQfXYZ' });
    const result = await getCommand().func(page, { id: 'Px2yQfXYZ' });
    expect(result).toEqual([
      { status: 'deleted', id: '5197123456789012', mblogid: 'Px2yQfXYZ' },
    ]);
    expect(page.goto).toHaveBeenCalledWith('https://weibo.com');
  });

  it('throws ArgumentError when id is empty or whitespace', async () => {
    const page = makePage({ ok: true, id: '0' });
    await expect(getCommand().func(page, { id: '   ' })).rejects.toBeInstanceOf(ArgumentError);
    await expect(getCommand().func(page, { id: '' })).rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('maps 401 / 403 from the show endpoint to AuthRequiredError', async () => {
    const page = makePage({ error: 'auth', status: 401 });
    await expect(getCommand().func(page, { id: 'Px2yQfXYZ' })).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('throws EmptyResultError when the post cannot be resolved', async () => {
    const page = makePage({ error: 'not_found', input: 'Px2yQfXYZ' });
    await expect(getCommand().func(page, { id: 'Px2yQfXYZ' })).rejects.toBeInstanceOf(EmptyResultError);
  });

  it('throws CommandExecutionError on non-2xx show response', async () => {
    const page = makePage({ error: 'show_http', status: 500 });
    await expect(getCommand().func(page, { id: '5197123456789012' })).rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('throws CommandExecutionError on non-2xx destroy response', async () => {
    const page = makePage({ error: 'destroy_http', status: 502 });
    await expect(getCommand().func(page, { id: '5197123456789012' })).rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('surfaces API-level errors from destroy as CommandExecutionError with msg', async () => {
    const page = makePage({ error: 'api', msg: '无权限删除', id: '5197123456789012' });
    await expect(getCommand().func(page, { id: '5197123456789012' })).rejects.toThrowError(/无权限删除/);
  });

  it('unwraps the browser-bridge { session, data } envelope', async () => {
    const page = makePage({
      session: 'site:weibo:abc',
      data: { ok: true, id: '42', mblogid: 'M42' },
    });
    const result = await getCommand().func(page, { id: 'M42' });
    expect(result).toEqual([{ status: 'deleted', id: '42', mblogid: 'M42' }]);
  });
});
