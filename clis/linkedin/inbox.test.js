import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import './inbox.js';

const { parseConversations, threadUrl } = await import('./inbox.js').then((m) => m.__test__);

const SELF = 'urn:li:fsd_profile:SELF';

// Minimal normalized messaging payload mirroring LinkedIn's real response shape:
// a flat `included` entity array where conversations reference participants and
// messages by URN.
function fixture() {
  return {
    included: [
      {
        $type: 'com.linkedin.messenger.MessagingParticipant',
        entityUrn: 'urn:li:msg_messagingParticipant:SELF',
        hostIdentityUrn: SELF,
        participantType: { member: { firstName: { text: 'Hanzi' }, lastName: { text: 'Li' } } },
      },
      {
        $type: 'com.linkedin.messenger.MessagingParticipant',
        entityUrn: 'urn:li:msg_messagingParticipant:P1',
        hostIdentityUrn: 'urn:li:fsd_profile:P1',
        participantType: { member: { firstName: { text: 'Olga' }, lastName: { text: 'Magere' } } },
      },
      {
        $type: 'com.linkedin.messenger.MessagingParticipant',
        entityUrn: 'urn:li:msg_messagingParticipant:ORG',
        hostIdentityUrn: 'urn:li:fsd_company:99',
        participantType: { organization: { name: { text: 'American Express' } } },
      },
      { $type: 'com.linkedin.messenger.Message', entityUrn: 'urn:li:msg_message:M1', body: { text: 'hey, are you around   this week?' } },
      { $type: 'com.linkedin.messenger.Message', entityUrn: 'urn:li:msg_message:M2', body: { text: 'Sponsored offer' } },
      {
        $type: 'com.linkedin.messenger.Conversation',
        entityUrn: 'urn:li:msg_conversation:C1',
        backendUrn: 'urn:li:messagingThread:2-aaa==',
        unreadCount: 2,
        read: false,
        categories: ['INBOX', 'PRIMARY_INBOX'],
        lastActivityAt: 2000,
        '*conversationParticipants': ['urn:li:msg_messagingParticipant:P1', 'urn:li:msg_messagingParticipant:SELF'],
        messages: { '*elements': ['urn:li:msg_message:M1'] },
        title: null,
      },
      {
        $type: 'com.linkedin.messenger.Conversation',
        entityUrn: 'urn:li:msg_conversation:C2',
        backendUrn: 'urn:li:messagingThread:2-bbb==',
        unreadCount: 0,
        read: true,
        categories: ['INBOX', 'PRIMARY_INBOX', 'INMAIL'],
        lastActivityAt: 3000,
        '*conversationParticipants': ['urn:li:msg_messagingParticipant:ORG', 'urn:li:msg_messagingParticipant:SELF'],
        messages: { '*elements': ['urn:li:msg_message:M2'] },
        title: null,
      },
      {
        $type: 'com.linkedin.messenger.Conversation',
        entityUrn: 'urn:li:msg_conversation:C3',
        backendUrn: 'urn:li:messagingThread:2-ccc==',
        unreadCount: 0,
        read: true,
        categories: ['INBOX', 'PRIMARY_INBOX'],
        lastActivityAt: 1000,
        '*conversationParticipants': ['urn:li:msg_messagingParticipant:P1', 'urn:li:msg_messagingParticipant:SELF'],
        messages: { '*elements': [] },
        title: 'Cohort 2 group',
      },
    ],
  };
}

describe('linkedin inbox adapter', () => {
  const command = getRegistry().get('linkedin/inbox');

  it('registers the command with the expected shape', () => {
    expect(command).toBeDefined();
    expect(command.site).toBe('linkedin');
    expect(command.name).toBe('inbox');
    expect(command.domain).toBe('www.linkedin.com');
    expect(command.strategy).toBe('cookie');
    expect(command.browser).toBe(true);
    expect(typeof command.func).toBe('function');
  });

  it('exposes channel-safe structured columns', () => {
    expect(command.columns).toEqual(
      expect.arrayContaining([
        'thread_url',
        'thread_id',
        'person_name',
        'last_message_preview',
        'unread',
        'counterparty_type',
        'category',
        'timestamp',
      ]),
    );
  });

  it('builds a thread URL from a thread id', () => {
    expect(threadUrl('2-aaa==')).toBe('https://www.linkedin.com/messaging/thread/2-aaa==/');
    expect(threadUrl('')).toBe('');
  });

  it('parses conversations and sorts them by most recent activity', () => {
    const rows = parseConversations(fixture(), SELF);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.thread_id)).toEqual(['2-bbb==', '2-aaa==', '2-ccc==']);
  });

  it('resolves the member counterparty, excludes the inbox owner, and reports unread state', () => {
    const c1 = parseConversations(fixture(), SELF).find((r) => r.thread_id === '2-aaa==');
    expect(c1.person_name).toBe('Olga Magere');
    expect(c1.counterparty_type).toBe('member');
    expect(c1.unread).toBe(true);
    expect(c1.last_message_preview).toBe('hey, are you around this week?');
  });

  it('flags organization counterparties and read conversations', () => {
    const c2 = parseConversations(fixture(), SELF).find((r) => r.thread_id === '2-bbb==');
    expect(c2.person_name).toBe('American Express');
    expect(c2.counterparty_type).toBe('organization');
    expect(c2.unread).toBe(false);
    expect(c2.category).toBe('INBOX,PRIMARY_INBOX,INMAIL');
  });

  it('uses the group title as the conversation name', () => {
    const c3 = parseConversations(fixture(), SELF).find((r) => r.thread_id === '2-ccc==');
    expect(c3.person_name).toBe('Cohort 2 group');
  });

  it('returns an empty array when a valid payload has no conversations', () => {
    expect(parseConversations({ included: [] }, SELF)).toEqual([]);
  });

  it('fails typed when the normalized payload shape is malformed', () => {
    expect(() => parseConversations({}, SELF)).toThrow(CommandExecutionError);
    expect(() => parseConversations(null, SELF)).toThrow(CommandExecutionError);
    const malformed = fixture();
    malformed.included.push({
      $type: 'com.linkedin.messenger.Conversation',
      entityUrn: 'urn:li:msg_conversation:MALFORMED',
      '*conversationParticipants': [],
      messages: { '*elements': [] },
    });
    expect(() => parseConversations(malformed, SELF)).toThrow(CommandExecutionError);
  });
});
