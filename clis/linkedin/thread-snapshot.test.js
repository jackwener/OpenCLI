import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import './thread-snapshot.js';

const { buildOlderThreadPageUrl, buildThreadSnapshotScript, canonicalizeLinkedInThreadUrl, cleanPersonName, collectThreadMessageUrlsScript, fetchThreadPagesScript, mergeThreadMessages, oldestDeliveredAt, parseMaxScrolls, parseThreadMessages } = await import('./thread-snapshot.js').then((m) => m.__test__);

function makeFakePage(snapshot, { urls = [], pageFor = () => null } = {}) {
  return {
    goto: vi.fn(async () => undefined),
    wait: vi.fn(async () => undefined),
    getCookies: vi.fn(async () => [{ name: 'JSESSIONID', value: 'ajax:123' }]),
    evaluate: vi.fn(async (script) => {
      const source = String(script || '');
      if (source.includes('setResourceTimingBufferSize')) return undefined;
      if (source.includes('messengerMessages') && source.includes('getEntriesByType')) return urls;
      if (source.includes('fetch(url')) {
        const match = source.match(/const urls = (\[[\s\S]*?\]);/);
        const requested = match ? JSON.parse(match[1]) : [];
        return requested.map((url) => ({ url, json: pageFor(url) })).filter((entry) => entry.json);
      }
      if (source.includes('__OPENCLI_LINKEDIN_THREAD_SNAPSHOT__')) return snapshot;
      return undefined;
    }),
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




  it('builds Performance API collection and in-page refetch scripts for messengerMessages pages', () => {
    expect(collectThreadMessageUrlsScript()).toContain("performance.getEntriesByType('resource')");
    expect(collectThreadMessageUrlsScript()).toContain('messengerMessages');
    const fetchScript = fetchThreadPagesScript(['https://www.linkedin.com/voyager/api/messaging/messengerMessages?q=x'], 'ajax:123');
    expect(fetchScript).toContain('\'csrf-token\': "ajax:123"');
    expect(fetchScript).toContain("accept: 'application/vnd.linkedin.normalized+json+2.1'");
  });

  it('parses and merges captured messengerMessages pages oldest first', () => {
    const normalized = {
      included: [
        {
          $type: 'com.linkedin.messenger.MessagingParticipant',
          entityUrn: 'urn:li:msg_messagingParticipant:P1',
          participantType: { member: { firstName: { text: 'Neha' }, lastName: { text: 'Rudraraju' } } },
        },
        { $type: 'com.linkedin.messenger.Message', entityUrn: 'urn:li:msg_message:M2', createdAt: 2000, '*sender': 'urn:li:msg_messagingParticipant:P1', body: { text: 'second message' } },
        { $type: 'com.linkedin.messenger.Message', entityUrn: 'urn:li:msg_message:M1', createdAt: 1000, '*sender': 'urn:li:msg_messagingParticipant:P1', body: { text: 'first message' } },
      ],
    };
    const apiMessages = parseThreadMessages(normalized);
    expect(apiMessages.map((message) => message.text)).toEqual(['first message', 'second message']);
    expect(apiMessages[0].speaker).toBe('Neha Rudraraju');
    const merged = mergeThreadMessages(apiMessages, [{ index: 0, speaker: 'Neha Rudraraju', text: 'second message' }]);
    expect(merged.map((message) => message.text)).toEqual(['first message', 'second message']);
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

  it('builds deliveredAt-anchored older-page URLs and finds the oldest timestamp', () => {
    const recentUrl = 'https://www.linkedin.com/voyager/api/voyagerMessagingGraphQL/graphql?queryId=messengerMessages.5846eeb7&variables=(conversationUrn:urn%3Ali%3Amsg_conversation%3A%28ABC%29)';
    const older = buildOlderThreadPageUrl(recentUrl, 1776742893955);
    expect(older).toContain('deliveredAt:1776742893955');
    expect(older).toContain('conversationUrn:urn%3Ali%3Amsg_conversation%3A%28ABC%29');
    expect(older).toContain('countBefore:20,countAfter:0');
    expect(buildOlderThreadPageUrl('https://example.com/no-conversation-urn', 123)).toBe('');
    expect(buildOlderThreadPageUrl(recentUrl, 0)).toBe('');
    expect(oldestDeliveredAt([{ createdAt: 500 }, { createdAt: 300 }, { createdAt: 0 }])).toBe(300);
    expect(oldestDeliveredAt([])).toBe(0);
  });

  it('opens messaging first, then pages through full thread history', async () => {
    const command = getRegistry().get('linkedin/thread-snapshot');
    const recentUrl = 'https://www.linkedin.com/voyager/api/voyagerMessagingGraphQL/graphql?queryId=messengerMessages.5846eeb7&variables=(conversationUrn:urn%3Ali%3Amsg_conversation%3A%28ABC%29)';
    const participant = { $type: 'com.linkedin.messenger.MessagingParticipant', entityUrn: 'urn:li:msg_messagingParticipant:P1', participantType: { member: { firstName: { text: 'Neha' }, lastName: { text: 'Rudraraju' } } } };
    const recentPage = { included: [participant, { $type: 'com.linkedin.messenger.Message', entityUrn: 'urn:li:msg_message:M1', deliveredAt: 500, '*senderParticipant': 'urn:li:msg_messagingParticipant:P1', body: { text: 'recent reply' } }] };
    const olderPage = { included: [participant, { $type: 'com.linkedin.messenger.Message', entityUrn: 'urn:li:msg_message:M0', deliveredAt: 300, '*senderParticipant': 'urn:li:msg_messagingParticipant:P1', body: { text: 'real conversation opener' } }] };
    const page = makeFakePage({
      url: 'https://www.linkedin.com/messaging/thread/abc/',
      headerNames: ['Neha Rudraraju'],
      latestMessageText: 'safe-send test from hermes. pls ignore :)',
      messages: [
        { index: 0, speaker: 'Neha Rudraraju', text: 'damn i just saw ur msg sry sry' },
        { index: 1, speaker: 'Me', text: 'safe-send test from hermes. pls ignore :)' },
      ],
    }, {
      urls: [recentUrl],
      pageFor: (url) => {
        if (/deliveredAt:500,/.test(url)) return olderPage;
        if (/deliveredAt:300,/.test(url)) return null;
        if (url === recentUrl) return recentPage;
        return null;
      },
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
      message_count: 4,
      latest_text: 'safe-send test from hermes. pls ignore :)',
    });
    expect(rows[0].snapshot_json).toContain('real conversation opener');
    expect(JSON.parse(rows[0].snapshot_json).capturedApiPageCount).toBe(2);
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
