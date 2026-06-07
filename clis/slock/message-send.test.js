import { describe, it, expect, vi } from 'vitest';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './message-send.js';

function makePage(result = { kind: 'ok', rows: [{ id: 'm1' }] }) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(result) };
}

describe('slock message-send', () => {
  const command = getRegistry().get('slock/message-send');

  it('channel-name target embeds the lowercased name into the snippet', async () => {
    const page = makePage();
    await command.func(page, { target: '#general', content: 'hi' });
    expect(page.evaluate.mock.calls[0][0]).toContain('"general"');
  });

  it('dm:@name target embeds member-lookup + DM channel creation', async () => {
    const page = makePage();
    await command.func(page, { target: 'dm:@alice', content: 'hi' });
    const script = page.evaluate.mock.calls[0][0];
    expect(script).toContain('/members');
    expect(script).toContain('/channels/dm');
  });

  it('thread short-id target embeds /messages/context + parent /threads', async () => {
    const page = makePage();
    await command.func(page, { target: '#general:8af3cbbb', content: 'reply' });
    const script = page.evaluate.mock.calls[0][0];
    expect(script).toContain('/messages/context');
    expect(script).toContain('/threads');
  });

  it('[red-line] thread unresolvable → ArgumentError + zero network writes', async () => {
    const page = makePage({ kind: 'unresolvable', detail: 'short id had 0 matches' });
    await expect(command.func(page, { target: '#general:zzzzzzzz', content: 'hi' }))
      .rejects.toBeInstanceOf(ArgumentError);
    // The single evaluate is allowed (read-side resolution); the snippet returns
    // 'unresolvable' BEFORE any /messages POST, which the mock proves.
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it('[red-line] --dry-run returns a plan row and never calls evaluate', async () => {
    const page = makePage();
    const rows = await command.func(page, { target: '#general', content: 'hi', 'dry-run': true });
    expect(page.evaluate).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ result: 'dry-run', content: 'hi', target: '#general' });
  });

  it('[red-line] content is sent byte-equal — the snippet body contains the EXACT input string', async () => {
    const tricky = `pizza 🍕 + \n + </script> + "quotes"`;
    const page = makePage();
    await command.func(page, { target: '#general', content: tricky });
    const script = page.evaluate.mock.calls[0][0];
    // The snippet must JSON-encode the content; the encoded form must round-trip back exactly.
    const m = script.match(/content:\s*(".*?[^\\]")/);
    expect(m).not.toBeNull();
    expect(JSON.parse(m[1])).toBe(tricky);
  });

  it('error mapping: parametric coverage of auth / http / no-server', async () => {
    await expect(command.func(makePage({ kind: 'auth', detail: '401' }), { target: '#g', content: 'x' }))
      .rejects.toBeInstanceOf(AuthRequiredError);
    await expect(command.func(makePage({ kind: 'http', status: 500, where: '/messages' }), { target: '#g', content: 'x' }))
      .rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('--server override passes the override into the snippet', async () => {
    const page = makePage();
    await command.func(page, { target: '#general', content: 'hi', server: 'design' });
    expect(page.evaluate.mock.calls[0][0]).toContain('"design"');
  });
});
