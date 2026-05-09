import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './thread-snapshot.js';

function makeFakePage(snapshot) {
  return {
    goto: vi.fn(async () => undefined),
    wait: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => snapshot),
  };
}

describe('linkedin thread-snapshot command', () => {
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
});
