import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

import { __test__ } from './delete-note.js';

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
  const validId = '6a08ba0b000000000702a893';

  it('returns deleted status when delete + confirm + verify all succeed', async () => {
    const page = makePage([
      'https://creator.xiaohongshu.com/new/note-manager',  // currentUrl
      true,                                                 // 已发布 tab click
      { ok: true, clicked: true },                          // initResult: row found + delete clicked
      { ok: true },                                         // confirmResult
      false,                                                // verify probe: row gone
    ]);
    const result = await getCommand().func(page, { 'note-id': validId, execute: true });
    expect(result).toEqual([
      { status: 'deleted', note_id: validId, message: 'Delete confirmed and note row disappeared.' },
    ]);
    expect(page.goto).toHaveBeenCalledWith('https://creator.xiaohongshu.com/new/note-manager');
  });

  it('dry-runs by default after verifying the exact target and delete affordance', async () => {
    const page = makePage([
      'https://creator.xiaohongshu.com/new/note-manager',
      true,
      { ok: true, clicked: false },
    ]);
    const result = await getCommand().func(page, { 'note-id': validId });
    expect(result).toEqual([
      { status: 'dry-run', note_id: validId, message: 'Target note row and delete action verified. Re-run with --execute to delete.' },
    ]);
    expect(page.evaluate).toHaveBeenCalledTimes(3);
  });

  it('unwraps browser bridge envelopes at every evaluate boundary', async () => {
    const page = makePage([
      { session: 's', data: 'https://creator.xiaohongshu.com/new/note-manager' },
      { session: 's', data: true },
      { session: 's', data: { ok: true, clicked: true } },
      { session: 's', data: { ok: true } },
      { session: 's', data: false },
    ]);
    const result = await getCommand().func(page, { 'note-id': validId, execute: true });
    expect(result[0]).toMatchObject({ status: 'deleted', note_id: validId });
  });

  it('normalizes exact Xiaohongshu note IDs from supported URL forms', () => {
    expect(__test__.normalizeNoteId(validId.toUpperCase())).toBe(validId);
    expect(__test__.normalizeNoteId(`https://www.xiaohongshu.com/explore/${validId}?xsec_token=t`)).toBe(validId);
    expect(__test__.normalizeNoteId(`https://creator.xiaohongshu.com/statistics/note-detail?noteId=${validId}`)).toBe(validId);
  });

  it('throws ArgumentError for missing or ambiguous note identity before navigation', async () => {
    const page = makePage();
    await expect(getCommand().func(page, { 'note-id': '' })).rejects.toBeInstanceOf(ArgumentError);
    await expect(getCommand().func(page, { 'note-id': '   ' })).rejects.toBeInstanceOf(ArgumentError);
    await expect(getCommand().func(page, { 'note-id': 'x' })).rejects.toBeInstanceOf(ArgumentError);
    await expect(getCommand().func(page, { 'note-id': 'https://evil.com/explore/6a08ba0b000000000702a893' })).rejects.toBeInstanceOf(ArgumentError);
    await expect(getCommand().func(page, { 'note-id': 'https://xhslink.com/abc' })).rejects.toBeInstanceOf(ArgumentError);
    await expect(getCommand().func(page, { 'note-id': `https://www.xiaohongshu.com/anything?noteId=${validId}` })).rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('throws CommandExecutionError for malformed evaluate payloads instead of trusting truthy objects', async () => {
    await expect(getCommand().func(makePage([
      { session: 's', data: { href: 'https://creator.xiaohongshu.com/new/note-manager' } },
    ]), { 'note-id': validId })).rejects.toThrowError(/malformed current-url payload/);

    await expect(getCommand().func(makePage([
      'https://creator.xiaohongshu.com/new/note-manager',
      { session: 's', data: { ok: true } },
    ]), { 'note-id': validId })).rejects.toThrowError(/malformed published-tab payload/);

    await expect(getCommand().func(makePage([
      'https://creator.xiaohongshu.com/new/note-manager',
      true,
      { session: 's', data: { ok: 'yes', clicked: false } },
    ]), { 'note-id': validId })).rejects.toThrowError(/malformed locate-note payload/);
  });

  it('throws AuthRequiredError when redirected to login', async () => {
    const page = makePage([
      'https://creator.xiaohongshu.com/login?redirectReason=401',
    ]);
    await expect(getCommand().func(page, { 'note-id': validId })).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('throws CommandExecutionError when 已发布 tab cannot be clicked (UI drift)', async () => {
    const page = makePage([
      'https://creator.xiaohongshu.com/new/note-manager',
      false, // tab click returns false
    ]);
    await expect(getCommand().func(page, { 'note-id': validId })).rejects.toThrowError(/已发布 tab not found/);
  });

  it('throws EmptyResultError when the note row is not in the 已发布 tab', async () => {
    const page = makePage([
      'https://creator.xiaohongshu.com/new/note-manager',
      true,
      { ok: false, kind: 'not_found', visibleRows: 0 },
    ]);
    await expect(getCommand().func(page, { 'note-id': validId })).rejects.toBeInstanceOf(EmptyResultError);
  });

  it('throws CommandExecutionError when the row has no visible delete action', async () => {
    const page = makePage([
      'https://creator.xiaohongshu.com/new/note-manager',
      true,
      { ok: false, kind: 'no_delete_action', visibleRows: 1 },
    ]);
    await expect(getCommand().func(page, { 'note-id': validId })).rejects.toThrowError(/no delete action/i);
  });

  it('throws CommandExecutionError when the confirmation modal does not appear', async () => {
    const page = makePage([
      'https://creator.xiaohongshu.com/new/note-manager',
      true,
      { ok: true },
      { ok: false, kind: 'no_modal' },
    ]);
    await expect(getCommand().func(page, { 'note-id': validId, execute: true })).rejects.toThrowError(/no_modal/);
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
    await expect(getCommand().func(page, { 'note-id': validId, execute: true })).rejects.toThrowError(/still visible after confirm/i);
  });

  it('executes the generated row locator without substring-matching other impression fields', () => {
    const otherId = '6a08ba0b000000000702a894';
    const dom = new JSDOM(`
      <div class="note" data-impression='{"noteTarget":{"value":{"noteId":"${otherId}"}},"title":"${validId}"}'>
        <span class="control data-del">删除</span>
      </div>
      <div class="note" data-impression='{"noteTarget":{"value":{"noteId":"${validId}"}}}'>
        <span class="control data-del">删除</span>
      </div>
    `, { runScripts: 'outside-only' });
    Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get() {
        return this.ownerDocument.body;
      },
    });
    const result = dom.window.eval(__test__.buildLocateAndMaybeDeleteScript(validId, false));
    expect(result).toEqual({ ok: true, clicked: false });
  });
});
