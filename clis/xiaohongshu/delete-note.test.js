import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

import './delete-note.js';

function makePage(evaluateResults = []) {
  const evaluate = vi.fn();
  for (const r of evaluateResults) evaluate.mockResolvedValueOnce(r);
  evaluate.mockResolvedValue(undefined);
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    evaluate,
  };
}

describe('xiaohongshu delete-note command', () => {
  const getCommand = () => getRegistry().get('xiaohongshu/delete-note');

  it('returns deleted status when delete + confirm + verify all succeed', async () => {
    const page = makePage([
      'https://creator.xiaohongshu.com/new/note-manager',  // currentUrl
      true,                                                 // 已发布 tab click
      { ok: true },                                         // initResult: row found + delete clicked
      { ok: true },                                         // confirmResult
      false,                                                // verify probe: row gone
    ]);
    const result = await getCommand().func(page, { 'note-id': '6a08ba0b000000000702a893' });
    expect(result).toEqual([
      { status: 'deleted', note_id: '6a08ba0b000000000702a893' },
    ]);
    expect(page.goto).toHaveBeenCalledWith('https://creator.xiaohongshu.com/new/note-manager');
  });

  it('throws ArgumentError when note-id is empty or whitespace', async () => {
    const page = makePage();
    await expect(getCommand().func(page, { 'note-id': '' })).rejects.toBeInstanceOf(ArgumentError);
    await expect(getCommand().func(page, { 'note-id': '   ' })).rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('throws AuthRequiredError when redirected to login', async () => {
    const page = makePage([
      'https://creator.xiaohongshu.com/login?redirectReason=401',
    ]);
    await expect(getCommand().func(page, { 'note-id': 'x' })).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('throws CommandExecutionError when 已发布 tab cannot be clicked (UI drift)', async () => {
    const page = makePage([
      'https://creator.xiaohongshu.com/new/note-manager',
      false, // tab click returns false
    ]);
    await expect(getCommand().func(page, { 'note-id': 'x' })).rejects.toThrowError(/已发布 tab not found/);
  });

  it('throws EmptyResultError when the note row is not in the 已发布 tab', async () => {
    const page = makePage([
      'https://creator.xiaohongshu.com/new/note-manager',
      true,
      { ok: false, kind: 'not_found', visibleRows: 0 },
    ]);
    await expect(getCommand().func(page, { 'note-id': 'missing-id' })).rejects.toBeInstanceOf(EmptyResultError);
  });

  it('throws CommandExecutionError when the row has no visible delete action', async () => {
    const page = makePage([
      'https://creator.xiaohongshu.com/new/note-manager',
      true,
      { ok: false, kind: 'no_delete_action', visibleRows: 1 },
    ]);
    await expect(getCommand().func(page, { 'note-id': 'x' })).rejects.toThrowError(/no delete action/i);
  });

  it('throws CommandExecutionError when the confirmation modal does not appear', async () => {
    const page = makePage([
      'https://creator.xiaohongshu.com/new/note-manager',
      true,
      { ok: true },
      { ok: false, kind: 'no_modal' },
    ]);
    await expect(getCommand().func(page, { 'note-id': 'x' })).rejects.toThrowError(/no_modal/);
  });

  it('throws CommandExecutionError when row stays visible after confirm (delete did not commit)', async () => {
    // verify probes return true (note still present) for the entire poll window.
    const probes = Array(15).fill(true);
    const page = makePage([
      'https://creator.xiaohongshu.com/new/note-manager',
      true,
      { ok: true },
      { ok: true },
      ...probes,
    ]);
    await expect(getCommand().func(page, { 'note-id': 'x' })).rejects.toThrowError(/still visible after confirm/i);
  });
});
