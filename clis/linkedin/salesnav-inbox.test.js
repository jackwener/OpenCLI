import { describe, expect, it } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import './salesnav-inbox.js';

const {
  THREAD_DECORATION,
  encodeRestliDecoration,
  parseLimit,
  parseSalesnavThreads,
  salesnavThreadUrl,
  threadListUrl,
} = await import('./salesnav-inbox.js').then((m) => m.__test__);

describe('linkedin salesnav-inbox command', () => {
  it('percent-encodes Rest.li decoration parentheses for Sales Navigator messaging', () => {
    const encoded = encodeRestliDecoration('(id,messages*(body))');
    expect(encoded).toBe('%28id%2Cmessages*%28body%29%29');
    expect(encoded).not.toContain('(');
    expect(encoded).not.toContain(')');
  });

  it('builds the paginated salesApiMessagingThreads inbox URL', () => {
    const url = threadListUrl({ count: 20, pageStartsAt: '1779070755626' });
    expect(url).toContain('/sales-api/salesApiMessagingThreads?');
    expect(url).toContain('q=filter');
    expect(url).toContain('filter=INBOX');
    expect(url).toContain('count=20');
    expect(url).toContain('pageStartsAt=1779070755626');
    expect(url).toContain(encodeRestliDecoration(THREAD_DECORATION));
  });

  it('validates limits without silent clamping', () => {
    expect(parseLimit(undefined)).toBe(40);
    expect(parseLimit(12)).toBe(12);
    expect(() => parseLimit(0)).toThrow();
    expect(() => parseLimit(501)).toThrow();
    expect(() => parseLimit('abc')).toThrow();
  });

  it('parses Sales Navigator thread rows with other participant and unread state', () => {
    const rows = parseSalesnavThreads({ elements: [{
      id: '2-thread',
      unreadMessageCount: 1,
      archived: false,
      totalMessageCount: 2,
      nextPageStartsAt: 1778206803669,
      participants: [
        'urn:li:fs_salesProfile:(OTHER,NAME_SEARCH,T1)',
        'urn:li:fs_salesProfile:(SELF,NAME_SEARCH,T2)',
      ],
      participantsResolutionResults: {
        'urn:li:fs_salesProfile:(OTHER,NAME_SEARCH,T1)': {
          entityUrn: 'urn:li:fs_salesProfile:(OTHER,NAME_SEARCH,T1)',
          firstName: 'Rachael',
          lastName: 'Stolberg',
          fullName: 'Rachael Stolberg',
          degree: 2,
        },
        'urn:li:fs_salesProfile:(SELF,NAME_SEARCH,T2)': {
          entityUrn: 'urn:li:fs_salesProfile:(SELF,NAME_SEARCH,T2)',
          firstName: 'Hanzi',
          lastName: 'Li',
          fullName: 'Hanzi Li',
          degree: 0,
        },
      },
      messages: [{
        id: 'msg-1',
        author: 'urn:li:fs_salesProfile:(OTHER,NAME_SEARCH,T1)',
        body: 'Hi hanzi, happy to chat',
        deliveredAt: 1778206803669,
      }],
    }] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      thread_id: '2-thread',
      thread_url: salesnavThreadUrl('2-thread'),
      person_name: 'Rachael Stolberg',
      last_message_snippet: 'Hi hanzi, happy to chat',
      last_activity_time: '2026-05-08T02:20:03.669Z',
      unread: true,
      unread_count: 1,
      total_message_count: 2,
    });
  });

  it('does not hard-code a specific account name as the inbox owner', () => {
    const rows = parseSalesnavThreads({ elements: [{
      id: '2-thread',
      participants: [
        'urn:li:fs_salesProfile:(HANZI,NAME_SEARCH,T1)',
        'urn:li:fs_salesProfile:(ME,NAME_SEARCH,T2)',
      ],
      participantsResolutionResults: {
        'urn:li:fs_salesProfile:(HANZI,NAME_SEARCH,T1)': {
          fullName: 'Hanzi Li',
          degree: 2,
        },
        'urn:li:fs_salesProfile:(ME,NAME_SEARCH,T2)': {
          fullName: 'Current User',
          degree: 0,
        },
      },
      messages: [],
    }] });
    expect(rows[0].person_name).toBe('Hanzi Li');
  });

  it('fails typed on malformed thread payloads and missing thread identity', () => {
    expect(() => parseSalesnavThreads({})).toThrow(CommandExecutionError);
    expect(() => parseSalesnavThreads({ elements: [{}] })).toThrow(CommandExecutionError);
  });
});
