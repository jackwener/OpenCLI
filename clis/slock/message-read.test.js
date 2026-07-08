import { describe, it, expect, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './message-read.js';

function makePage(result) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(result) };
}

describe('slock message-read', () => {
  const command = getRegistry().get('slock/message-read');

  it('happy: returns mapped rows for a channel-uuid target', async () => {
    const page = makePage({ kind: 'ok', rows: [
      { id: 'm1', seq: 100, sender: { name: 'A' }, content: 'hi', createdAt: 't' },
    ], meta: { threadsAvailable: true, threadsMap: {} }});
    const rows = await command.func(page, { channel: '11111111-1111-1111-1111-111111111111' });
    expect(rows[0]).toMatchObject({
      id: 'm1', seq: 100, senderName: 'A', content: 'hi',
      threadChannelId: null, replyCount: 0,
    });
  });

  it('thread target "#name:short" passes the resolution shape into the snippet', async () => {
    const page = makePage({ kind: 'ok', rows: [], meta: { threadsAvailable: true, threadsMap: {} } });
    await command.func(page, { channel: '#general:8af3cbbb' });
    const script = page.evaluate.mock.calls[0][0];
    expect(script).toContain('"general"');
    expect(script).toContain('"8af3cbbb"');
    expect(script).toContain('/messages/context/');
  });

  it('thread target with NO_THREAD result returns a single hint row', async () => {
    const page = makePage({ kind: 'no-thread', parent: '#general:abc12345' });
    const rows = await command.func(page, { channel: '#general:abc12345' });
    expect(rows.length).toBe(1);
    expect(rows[0].content).toMatch(/no thread yet/);
    expect(rows[0].seq).toBeNull();
  });

  it('--after with a UUID value embeds the resolution path into the snippet', async () => {
    const page = makePage({ kind: 'ok', rows: [], meta: { threadsAvailable: true, threadsMap: {} } });
    await command.func(page, {
      channel: '11111111-1111-1111-1111-111111111111',
      after: '22222222-2222-2222-2222-222222222222',
    });
    const script = page.evaluate.mock.calls[0][0];
    expect(script).toContain('"22222222-2222-2222-2222-222222222222"');
    expect(script).toContain('/messages/context/');
  });

  it('rejects invalid --limit and --before before navigation', async () => {
    const page = makePage({ kind: 'ok', rows: [] });
    await expect(command.func(page, { channel: '#general', limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
    await expect(command.func(page, { channel: '#general', before: 'abc' })).rejects.toBeInstanceOf(ArgumentError);
    await expect(command.func(page, { channel: '#general', before: '0' })).rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('--no-threads omits the threads enrichment fetch from the snippet', async () => {
    const page = makePage({ kind: 'ok', rows: [], meta: { threadsAvailable: false, threadsMap: {} } });
    await command.func(page, {
      channel: '11111111-1111-1111-1111-111111111111',
      'no-threads': true,
    });
    const script = page.evaluate.mock.calls[0][0];
    expect(script).not.toContain('/threads');
  });

  it('threads enrichment failure → replyCount=null and a warning row is prepended', async () => {
    const page = makePage({ kind: 'ok', rows: [
      { id: 'm1', seq: 100, sender: { name: 'A' }, content: 'hi', createdAt: 't' },
    ], meta: { threadsAvailable: false, threadsMap: null, threadsDegraded: true } });
    const rows = await command.func(page, { channel: '11111111-1111-1111-1111-111111111111' });
    expect(rows[0].content).toMatch(/threads-enrichment unavailable/);
    expect(rows[1].replyCount).toBeNull();
  });

  it('[anti-drift] non-array rows throws instead of silently returning empty', async () => {
    const page = makePage({ kind: 'ok', rows: { wrong: 'shape' } });
    await expect(command.func(page, { channel: '11111111-1111-1111-1111-111111111111' })).rejects.toThrow(/expected array/);
  });
});
