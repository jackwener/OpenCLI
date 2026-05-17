import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import './thread-snapshot.js';

const { buildThreadSnapshotScript, canonicalizeLinkedInThreadUrl, cleanPersonName, parseMaxScrolls } = await import('./thread-snapshot.js').then((m) => m.__test__);

function makeFakePage(snapshot) {
  return {
    goto: vi.fn(async () => undefined),
    wait: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => snapshot),
  };
}

describe('linkedin thread-snapshot command', () => {
  it('strips LinkedIn presence and profile cruft from person names', () => {
    expect(cleanPersonName('Eugene Huo Status is online Active now')).toBe('Eugene Huo');
    expect(cleanPersonName('Eugene Huo active 2h')).toBe('Eugene Huo');
    expect(cleanPersonName('Eugene Huo View profile')).toBe('Eugene Huo');
    expect(cleanPersonName('  Eugene\u00a0Huo  ')).toBe('Eugene Huo');
  });

  it('extracts non-overlapping event-listitem message bodies with carried speakers', async () => {
    const dom = new JSDOM(`<!doctype html><body>
      <main>
        <h1>Eugene Huo Status is online Active now</h1>
        <div class="msg-s-message-list">
          <div class="msg-s-event-listitem" data-event-urn="1">
            <div class="msg-s-message-group__name">Hanzi Li</div>
            <div class="msg-s-event-listitem__body">hey eugene</div>
          </div>
          <div class="msg-s-event-listitem" data-event-urn="2">
            <div class="msg-s-event-listitem__body">following up with a clean body</div>
          </div>
          <div class="msg-s-event-listitem" data-event-urn="3">
            <div class="msg-s-message-group__name">Eugene Huo</div>
            <div class="msg-s-event-listitem__body">sounds good</div>
          </div>
          <div class="msg-s-message-list__event"><div class="msg-s-event-listitem__body">duplicate selector should not be read</div></div>
        </div>
      </main>
    </body>`, { url: 'https://www.linkedin.com/messaging/thread/abc/' });
    Object.defineProperty(dom.window.document, 'title', { value: 'Messaging | LinkedIn' });
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const previousLocation = globalThis.location;
    try {
      globalThis.window = dom.window;
      globalThis.document = dom.window.document;
      globalThis.location = dom.window.location;
      const runSnapshotScript = Function(`return ${buildThreadSnapshotScript(0)}`);
      const snapshot = await runSnapshotScript();
      expect(snapshot.headerNames[0]).toBe('Eugene Huo');
      expect(snapshot.latestMessageText).toBe('sounds good');
      expect(snapshot.messages).toEqual([
        { index: 0, nodeIndex: 0, speaker: 'Hanzi Li', text: 'hey eugene' },
        { index: 1, nodeIndex: 1, speaker: 'Hanzi Li', text: 'following up with a clean body' },
        { index: 2, nodeIndex: 2, speaker: 'Eugene Huo', text: 'sounds good' },
      ]);
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
      globalThis.location = previousLocation;
    }
  });

  it('accepts only exact LinkedIn messaging thread URLs', () => {
    expect(canonicalizeLinkedInThreadUrl('https://www.linkedin.com/messaging/thread/2-abc==/?mini=true#x'))
      .toBe('https://www.linkedin.com/messaging/thread/2-abc==/');
    expect(canonicalizeLinkedInThreadUrl('https://www.linkedin.com/messaging/thread/2-abc==/extra')).toBe('');
    expect(canonicalizeLinkedInThreadUrl('https://evil-linkedin.com/messaging/thread/2-abc==/')).toBe('');
    expect(canonicalizeLinkedInThreadUrl('http://www.linkedin.com/messaging/thread/2-abc==/')).toBe('');
  });

  it('validates max-scrolls without silent clamping', () => {
    expect(parseMaxScrolls(undefined)).toBe(30);
    expect(parseMaxScrolls(0)).toBe(0);
    expect(parseMaxScrolls(80)).toBe(80);
    expect(() => parseMaxScrolls(81)).toThrow('--max-scrolls must be an integer between 0 and 80');
    expect(() => parseMaxScrolls(1.5)).toThrow('--max-scrolls must be an integer between 0 and 80');
  });

  it('registers as a read command for loading full thread context', () => {
    const command = getRegistry().get('linkedin/thread-snapshot');
    expect(command).toBeDefined();
    expect(command.access).toBe('read');
    expect(command.columns).toEqual(expect.arrayContaining(['thread_url', 'recipient', 'message_count', 'latest_text']));
  });

  it('opens messaging first, then exact thread, and returns extracted messages', async () => {
    const command = getRegistry().get('linkedin/thread-snapshot');
    const page = makeFakePage({
      url: 'https://www.linkedin.com/messaging/thread/abc/',
      headerNames: ['Neha Rudraraju'],
      latestMessageText: 'safe-send test from hermes. pls ignore :)',
      messages: [
        { index: 0, speaker: 'Neha Rudraraju', text: 'damn i just saw ur msg sry sry' },
        { index: 1, speaker: 'Me', text: 'safe-send test from hermes. pls ignore :)' },
      ],
    });

    const rows = await command.func(page, {
      'thread-url': 'https://www.linkedin.com/messaging/thread/abc/',
      'max-scrolls': 8,
      json: false,
    });

    expect(page.goto).toHaveBeenNthCalledWith(1, 'https://www.linkedin.com/messaging/');
    expect(page.goto).toHaveBeenNthCalledWith(2, 'https://www.linkedin.com/messaging/thread/abc/');
    expect(rows[0]).toMatchObject({
      thread_url: 'https://www.linkedin.com/messaging/thread/abc/',
      recipient: 'Neha Rudraraju',
      message_count: 2,
      latest_text: 'safe-send test from hermes. pls ignore :)',
    });
    expect(rows[0].snapshot_json).toContain('damn i just saw ur msg sry sry');
  });

  it('rejects invalid thread URL before navigation', async () => {
    const command = getRegistry().get('linkedin/thread-snapshot');
    const page = makeFakePage({});

    await expect(command.func(page, {
      'thread-url': 'https://www.linkedin.com/feed/',
      'max-scrolls': 8,
    })).rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('fails typed on malformed snapshot payloads', async () => {
    const command = getRegistry().get('linkedin/thread-snapshot');
    const page = makeFakePage({ url: 'https://www.linkedin.com/messaging/thread/abc/', headerNames: ['Neha Rudraraju'] });

    await expect(command.func(page, {
      'thread-url': 'https://www.linkedin.com/messaging/thread/abc/',
      'max-scrolls': 8,
    })).rejects.toBeInstanceOf(CommandExecutionError);
  });
});
