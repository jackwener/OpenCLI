import { describe, it, expect, vi } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './message-search.js';

function makePage(result) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(result) };
}

describe('slock message-search', () => {
  const command = getRegistry().get('slock/message-search');

  it('happy: returns mapped rows for a query', async () => {
    const page = makePage({ kind: 'ok', rows: [
      { id: 'm1', content: 'hello', channelId: 'c1', sender: { name: 'A' }, createdAt: 't' },
    ]});
    const rows = await command.func(page, { query: 'hello' });
    expect(rows[0]).toMatchObject({ id: 'm1', content: 'hello', channelId: 'c1' });
  });

  it('--channel filter: snippet contains channelId param', async () => {
    const page = makePage({ kind: 'ok', rows: [] });
    await command.func(page, { query: 'x', channel: '#general' });
    expect(page.evaluate.mock.calls[0][0]).toContain('channelId=');
  });

  it('rejects non-positive --limit before navigation', async () => {
    const page = makePage({ kind: 'ok', rows: [] });
    await expect(command.func(page, { query: 'hello', limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  // F2-b — qatester live dump: real shape is { results, hasMore }. If a future
  // refactor strips data.results out of the in-page unwrap chain, the command
  // silently returns [] even when matches exist. Pin the unwrap order so the
  // drift is caught pre-network.
  it('[F2-b drift] in-page snippet unwraps data.results FIRST in the fallback chain', async () => {
    const page = makePage({ kind: 'ok', rows: [] });
    await command.func(page, { query: 'x' });
    const snippet = page.evaluate.mock.calls[0][0];
    // results before messages before data — order matters because legacy
    // shapes used data.messages and data.data, but the live server now
    // returns data.results and only data.results.
    expect(snippet).toMatch(/data\.results\s*\|\|\s*data\.messages\s*\|\|\s*data\.data/);
  });

  it('[anti-drift] non-array search rows throw typed instead of TypeError', async () => {
    const page = makePage({ kind: 'ok', rows: { wrong: 'shape' } });
    await expect(command.func(page, { query: 'hello' })).rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('[red-line] a --channel name with a quote cannot break out of the snippet string', async () => {
    const page = makePage({ kind: 'unresolvable', detail: 'x' });
    await command.func(page, { query: 'x', channel: "#ev'il" }).catch(() => {});
    const script = page.evaluate.mock.calls[0][0];
    // Vulnerable form would embed the name raw as `matches #ev'il`, letting the
    // quote close the string literal. The name must only appear JSON-encoded.
    expect(script).not.toContain("no channel matches #ev'il");
    expect(script).toContain('"#ev\'il"');
  });
});
