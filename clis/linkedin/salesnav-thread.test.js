import { describe, expect, it } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import './salesnav-thread.js';

const {
  parseThreadInput,
  threadApiUrl,
  parseSalesnavThreadMessages,
  threadMatchesInput,
  salesnavThreadUrl,
} = await import('./salesnav-thread.js').then((m) => m.__test__);

describe('linkedin salesnav-thread command', () => {
  it('accepts Sales Navigator inbox URLs, raw thread ids, lead URLs, urns, and names', () => {
    expect(parseThreadInput('https://www.linkedin.com/sales/inbox/2-abc%3D%3D')).toEqual(['thread_id', '2-abc==']);
    expect(parseThreadInput('2-abc==')).toEqual(['thread_id', '2-abc==']);
    expect(parseThreadInput('https://www.linkedin.com/sales/lead/P1,NAME_SEARCH,T1')).toEqual(['recipient_urn', 'urn:li:fs_salesProfile:(P1,NAME_SEARCH,T1)']);
    expect(parseThreadInput('urn:li:fs_salesProfile:(P1,NAME_SEARCH,T1)')).toEqual(['recipient_urn', 'urn:li:fs_salesProfile:(P1,NAME_SEARCH,T1)']);
    expect(parseThreadInput('Rachael Stolberg')).toEqual(['name', 'rachael stolberg']);
    expect(() => parseThreadInput('urn:li:fs_salesProfile:(P1,undefined,T1)')).toThrow(ArgumentError);
    expect(() => parseThreadInput('https://www.linkedin.com/sales/lead/P1,undefined,T1')).toThrow(ArgumentError);
  });

  it('builds the decorated thread API URL with encoded parentheses and message pagination size', () => {
    const url = threadApiUrl('2-thread==', 40);
    expect(url).toContain('/sales-api/salesApiMessagingThreads/2-thread%3D%3D?');
    expect(url).toContain('messageCount=40');
    expect(url).toContain('count=1');
    expect(url).toContain('decoration=%28');
    expect(url).not.toContain('decoration=(');
  });

  it('parses thread messages in chronological order with sender names and timestamps', () => {
    const rows = parseSalesnavThreadMessages({
      id: '2-thread',
      participants: [
        'urn:li:fs_salesProfile:(OTHER,NAME_SEARCH,T1)',
        'urn:li:fs_salesProfile:(SELF,NAME_SEARCH,T2)',
      ],
      participantsResolutionResults: {
        'urn:li:fs_salesProfile:(OTHER,NAME_SEARCH,T1)': { fullName: 'Rachael Stolberg', entityUrn: 'urn:li:fs_salesProfile:(OTHER,NAME_SEARCH,T1)' },
        'urn:li:fs_salesProfile:(SELF,NAME_SEARCH,T2)': { fullName: 'Hanzi Li', entityUrn: 'urn:li:fs_salesProfile:(SELF,NAME_SEARCH,T2)' },
      },
      messages: [
        { id: 'm2', author: 'urn:li:fs_salesProfile:(OTHER,NAME_SEARCH,T1)', body: 'Happy to chat', deliveredAt: 1778206803669, type: 'MEMBER_TO_MEMBER' },
        { id: 'm1', author: 'urn:li:fs_salesProfile:(SELF,NAME_SEARCH,T2)', subject: 'Quick question', body: 'Hi Rachael', deliveredAt: 1777188013523, type: 'INMAIL' },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      index: 0,
      message_id: 'm1',
      thread_id: '2-thread',
      sender: 'Hanzi Li',
      subject: 'Quick question',
      text: 'Hi Rachael',
      timestamp: '2026-04-26T07:20:13.523Z',
    });
    expect(rows[1]).toMatchObject({ index: 1, message_id: 'm2', sender: 'Rachael Stolberg', text: 'Happy to chat' });
  });

  it('fails typed on malformed thread message payloads', () => {
    expect(() => parseSalesnavThreadMessages({ messages: [] })).toThrow(CommandExecutionError);
    expect(() => parseSalesnavThreadMessages({ id: '2-thread' })).toThrow(CommandExecutionError);
    expect(() => parseSalesnavThreadMessages({ id: '2-thread', messages: [null] })).toThrow(CommandExecutionError);
  });

  it('matches recipient identifiers against inbox rows', () => {
    const row = {
      thread_id: '2-thread',
      person_name: 'Rachael Stolberg',
      participants: [{ name: 'Rachael Stolberg', entity_urn: 'urn:li:fs_salesProfile:(P1,NAME_SEARCH,T1)' }],
    };
    expect(threadMatchesInput(row, ['thread_id', '2-thread'])).toBe(true);
    expect(threadMatchesInput(row, ['recipient_urn', 'urn:li:fs_salesProfile:(P1,NAME_SEARCH,T1)'])).toBe(true);
    expect(threadMatchesInput(row, ['name', 'rachael stolberg'])).toBe(true);
    expect(salesnavThreadUrl('2-thread')).toBe('https://www.linkedin.com/sales/inbox/2-thread');
  });
});
