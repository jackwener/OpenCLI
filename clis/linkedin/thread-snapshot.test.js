import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import './thread-snapshot.js';

const {
  parseMaxScrolls,
  parseThreadPages,
  validateThreadApiUrls,
} = await import('./thread-snapshot.js').then((module) => module.__test__);

const THREAD_URL = 'https://www.linkedin.com/messaging/thread/2-abc/';
const API_URL = 'https://www.linkedin.com/voyager/api/voyagerMessagingGraphQL/graphql?queryId=messengerMessages.abc123&variables=(conversationUrn:urn%3Ali%3Amsg_conversation%3A%28urn%3Ali%3Afsd_profile%3Aowner%2C2-abc%29)';
const OWNER_URN = 'urn:li:fsd_profile:owner';
const OWNER_PARTICIPANT = `urn:li:msg_messagingParticipant:${OWNER_URN}`;
const OTHER_PARTICIPANT = 'urn:li:msg_messagingParticipant:urn:li:fsd_profile:other';

function participant(entityUrn, hostIdentityUrn, firstName, lastName) {
  return {
    entityUrn,
    hostIdentityUrn,
    participantType: {
      member: {
        firstName: { text: firstName },
        lastName: { text: lastName },
      },
    },
    $type: 'com.linkedin.messenger.MessagingParticipant',
  };
}

function message(entityUrn, senderUrn, deliveredAt, text) {
  return {
    entityUrn,
    '*sender': senderUrn,
    deliveredAt,
    body: { text },
    $type: 'com.linkedin.messenger.Message',
  };
}

function normalizedPage(included, refs = included.filter((entity) => entity.$type === 'com.linkedin.messenger.Message').map((entity) => entity.entityUrn)) {
  return {
    data: {
      data: {
        messengerMessagesBySyncToken: {
          metadata: { shouldClearCache: true },
          '*elements': refs,
        },
      },
    },
    included,
  };
}

function liveFixturePages() {
  return [{
    url: API_URL,
    json: normalizedPage([
      participant(OWNER_PARTICIPANT, OWNER_URN, 'Jie', 'Wen'),
      participant(OTHER_PARTICIPANT, 'urn:li:fsd_profile:other', 'Neha', 'Rudraraju'),
      message('urn:li:msg_message:2', OWNER_PARTICIPANT, 200, 'safe-send test from hermes. pls ignore :)'),
      message('urn:li:msg_message:1', OTHER_PARTICIPANT, 100, 'damn i just saw ur msg sry sry'),
    ]),
  }];
}

function makeFakePage({ discovery, fetched } = {}) {
  return {
    goto: vi.fn(async () => undefined),
    wait: vi.fn(async () => undefined),
    getCookies: vi.fn(async () => [{ name: 'JSESSIONID', value: '"ajax:123"' }]),
    evaluate: vi.fn()
      .mockResolvedValueOnce(discovery || {
        url: THREAD_URL,
        title: 'Messaging | LinkedIn',
        authRequired: false,
        apiUrls: [API_URL],
        scrollAttempts: 4,
        scrollStable: true,
      })
      .mockResolvedValueOnce(fetched || { pages: liveFixturePages() }),
  };
}

describe('linkedin thread-snapshot command', () => {
  it('validates max-scrolls without silent clamping', () => {
    expect(parseMaxScrolls(undefined)).toBe(30);
    expect(parseMaxScrolls(0)).toBe(0);
    expect(parseMaxScrolls(80)).toBe(80);
    expect(() => parseMaxScrolls(81)).toThrow('--max-scrolls must be an integer between 0 and 80');
    expect(() => parseMaxScrolls(1.5)).toThrow('--max-scrolls must be an integer between 0 and 80');
  });

  it('registers as a read command for structured thread context', () => {
    const command = getRegistry().get('linkedin/thread-snapshot');
    expect(command).toBeDefined();
    expect(command.access).toBe('read');
    expect(command.columns).toEqual(expect.arrayContaining(['thread_url', 'recipient', 'message_count', 'latest_text']));
  });

  it('opens the exact thread, discovers the live API, and returns deduped chronological messages', async () => {
    const command = getRegistry().get('linkedin/thread-snapshot');
    const page = makeFakePage();

    const rows = await command.func(page, {
      'thread-url': THREAD_URL,
      'max-scrolls': 8,
      json: false,
    });

    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(page.goto).toHaveBeenCalledWith(THREAD_URL);
    expect(page.getCookies).toHaveBeenCalledWith({ url: 'https://www.linkedin.com' });
    expect(rows[0]).toMatchObject({
      thread_url: THREAD_URL,
      recipient: 'Neha Rudraraju',
      message_count: 2,
      latest_text: 'safe-send test from hermes. pls ignore :)',
    });
    const snapshot = JSON.parse(rows[0].snapshot_json);
    expect(snapshot.source).toBe('linkedin-messengerMessages');
    expect(snapshot.messages.map((entry) => entry.text)).toEqual([
      'damn i just saw ur msg sry sry',
      'safe-send test from hermes. pls ignore :)',
    ]);
  });

  it('dedupes the same normalized message entity across API pages', () => {
    const pages = liveFixturePages();
    pages.push({
      url: API_URL.replace('abc123', 'def456').replace('variables=(', 'variables=(deliveredAt:100,countBefore:20,countAfter:0,'),
      json: {
        data: { data: { messengerMessagesByAnchorTimestamp: { metadata: { prevCursor: null }, elements: [] } } },
        included: [{ entityUrn: 'urn:li:msg_message:1', $type: 'com.linkedin.messenger.Message' }],
      },
    });
    const parsed = parseThreadPages(pages);
    expect(parsed.messages).toHaveLength(2);
  });

  it('retries slow API discovery without repeating the configured scroll budget', async () => {
    const command = getRegistry().get('linkedin/thread-snapshot');
    const page = makeFakePage();
    page.evaluate = vi.fn()
      .mockResolvedValueOnce({
        url: THREAD_URL,
        title: 'Messaging | LinkedIn',
        authRequired: false,
        apiUrls: [],
        scrollAttempts: 8,
        scrollStable: true,
      })
      .mockResolvedValueOnce({
        url: THREAD_URL,
        title: 'Messaging | LinkedIn',
        authRequired: false,
        apiUrls: [API_URL],
        scrollAttempts: 0,
        scrollStable: null,
      })
      .mockResolvedValueOnce({ pages: liveFixturePages() });

    const rows = await command.func(page, {
      'thread-url': THREAD_URL,
      'max-scrolls': 8,
    });

    expect(rows[0].message_count).toBe(2);
    expect(page.evaluate).toHaveBeenCalledTimes(3);
    expect(page.evaluate.mock.calls[1][0]).toContain('index < 0');
    expect(page.wait).toHaveBeenNthCalledWith(2, 4);
  });

  it('rejects invalid thread URL before navigation', async () => {
    const command = getRegistry().get('linkedin/thread-snapshot');
    const page = makeFakePage();

    await expect(command.func(page, {
      'thread-url': 'https://www.linkedin.com/feed/',
      'max-scrolls': 8,
    })).rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('rejects unsafe or mismatched discovered API URLs', () => {
    expect(() => validateThreadApiUrls([
      'https://evil.example/voyager/api/voyagerMessagingGraphQL/graphql?queryId=messengerMessages.abc123&variables=(conversationUrn:2-abc)',
    ], THREAD_URL)).toThrow('unsafe or mismatched');
  });

  it('fails typed on malformed normalized payloads', async () => {
    const command = getRegistry().get('linkedin/thread-snapshot');
    const page = makeFakePage({ fetched: { pages: [{ url: API_URL, json: {} }] } });

    await expect(command.func(page, {
      'thread-url': THREAD_URL,
      'max-scrolls': 8,
    })).rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('refuses a partial snapshot when history never stabilizes at the scroll cap', async () => {
    const command = getRegistry().get('linkedin/thread-snapshot');
    const page = makeFakePage({
      discovery: {
        url: THREAD_URL,
        title: 'Messaging | LinkedIn',
        authRequired: false,
        apiUrls: [API_URL],
        scrollAttempts: 8,
        scrollStable: false,
      },
    });

    await expect(command.func(page, {
      'thread-url': THREAD_URL,
      'max-scrolls': 8,
    })).rejects.toThrow('refusing to return a partial snapshot');
    expect(page.getCookies).not.toHaveBeenCalled();
  });
});
