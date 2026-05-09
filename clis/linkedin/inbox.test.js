import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './inbox.js';

function makeFakePage(snapshot) {
  return {
    goto: vi.fn(async () => undefined),
    wait: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => snapshot),
  };
}

describe('linkedin inbox command', () => {
  it('registers as a read command with unread and thread columns', () => {
    const command = getRegistry().get('linkedin/inbox');
    expect(command).toBeDefined();
    expect(command.access).toBe('read');
    expect(command.columns).toEqual(expect.arrayContaining(['name', 'unread', 'thread_url', 'inbox_json']));
  });

  it('opens LinkedIn messaging and returns visible inbox rows', async () => {
    const command = getRegistry().get('linkedin/inbox');
    const page = makeFakePage({
      url: 'https://www.linkedin.com/messaging/',
      title: 'Messaging | LinkedIn',
      rows: [
        {
          name: 'Charlett Braxton, BBM, PESC',
          threadUrl: 'https://www.linkedin.com/messaging/thread/abc?x=1',
          profileUrl: 'https://www.linkedin.com/in/charlett/',
          timestamp: 'Thu',
          preview: 'To internal but it depends on the know outside source have',
          unread: true,
          unreadCount: 1,
          rowText: 'Charlett Braxton, BBM, PESC Thu To internal but it depends on the know outside source have 1',
        },
      ],
    });

    const rows = await command.func(page, { limit: 10, json: false });

    expect(page.goto).toHaveBeenCalledWith('https://www.linkedin.com/messaging/');
    expect(rows[0]).toMatchObject({
      name: 'Charlett Braxton, BBM, PESC',
      unread: true,
      unread_count: 1,
      thread_url: 'https://www.linkedin.com/messaging/thread/abc/',
    });
  });

  it('uses current thread URL for the active conversation row when LinkedIn omits a row link', async () => {
    const command = getRegistry().get('linkedin/inbox');
    const page = makeFakePage({
      url: 'https://www.linkedin.com/messaging/thread/current/',
      rows: [
        {
          name: 'Vishnu Singh, PESC',
          threadUrl: 'https://www.linkedin.com/messaging/thread/current/',
          timestamp: 'May 8',
          preview: 'You: thanks for connecting Vishnu',
          unread: false,
          unreadCount: 0,
          rowText: 'Vishnu Singh, PESC May 8 You: thanks for connecting Vishnu . Active conversation',
        },
      ],
    });

    const rows = await command.func(page, { limit: 10, json: false });
    expect(rows[0].thread_url).toBe('https://www.linkedin.com/messaging/thread/current/');
  });

  it('can return one compact JSON row for downstream reconciliation', async () => {
    const command = getRegistry().get('linkedin/inbox');
    const page = makeFakePage({ rows: [{ name: 'Lempila Alphonsa', threadUrl: 'https://www.linkedin.com/messaging/thread/xyz/', unread: true, unreadCount: 1 }] });
    const rows = await command.func(page, { limit: 10, json: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].unread).toBe(true);
    expect(rows[0].unread_count).toBe(1);
    expect(rows[0].inbox_json).toContain('Lempila Alphonsa');
  });
});
