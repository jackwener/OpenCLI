import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@jackwener/opencli/registry';
import './inbox.js';

const {
  extractInboxConversationsFromDocument,
  extractThreadId,
  mergeConversations,
} = await import('./inbox.js').then((m) => m.__test__);

describe('linkedin inbox adapter', () => {
  const command = getRegistry().get('linkedin/inbox');

  it('registers the command with correct shape', () => {
    expect(command).toBeDefined();
    expect(command.site).toBe('linkedin');
    expect(command.name).toBe('inbox');
    expect(command.domain).toBe('www.linkedin.com');
    expect(command.strategy).toBe('cookie');
    expect(command.browser).toBe(true);
    expect(typeof command.func).toBe('function');
  });

  it('includes channel-safe structured columns', () => {
    expect(command.columns).toEqual(expect.arrayContaining([
      'thread_url',
      'thread_id',
      'person_name',
      'last_message_preview',
      'unread',
      'timestamp',
    ]));
  });
});

describe('extractThreadId', () => {
  it('extracts encoded LinkedIn thread IDs', () => {
    expect(extractThreadId('https://www.linkedin.com/messaging/thread/2-YzEyMzQ=/')).toBe('2-YzEyMzQ=');
  });
});

describe('extractInboxConversationsFromDocument', () => {
  it('extracts visible read and unread conversations from an HTML fixture', () => {
    const html = `<!doctype html>
      <main>
        <ul class="msg-conversations-container__conversations-list">
          <li class="msg-conversation-listitem msg-conversation-listitem--unread">
            <a href="/messaging/thread/2-abc123/">
              <span class="msg-conversation-card__participant-names">Jane Champion</span>
              <time>2h</time>
              <p class="msg-conversation-card__message-snippet">Could you send the compliance checklist?</p>
            </a>
          </li>
          <li class="msg-conversation-listitem">
            <a href="https://www.linkedin.com/messaging/thread/2-def456/?lipi=tracking">
              <span class="msg-conversation-card__participant-names">Bob Buyer</span>
              <time>May 14</time>
              <p class="msg-conversation-card__message-snippet">You: thanks, happy to show the workflow</p>
            </a>
          </li>
        </ul>
      </main>`;
    const dom = new JSDOM(html, { url: 'https://www.linkedin.com/messaging/' });
    const result = extractInboxConversationsFromDocument(dom.window.document, dom.window.location.href);
    expect(result.loginRequired).toBe(false);
    expect(result.conversations).toHaveLength(2);
    expect(result.conversations[0]).toMatchObject({
      thread_url: 'https://www.linkedin.com/messaging/thread/2-abc123/',
      thread_id: '2-abc123',
      person_name: 'Jane Champion',
      last_message_preview: 'Could you send the compliance checklist?',
      unread: true,
      timestamp: '2h',
    });
    expect(result.conversations[1]).toMatchObject({
      thread_url: 'https://www.linkedin.com/messaging/thread/2-def456/',
      thread_id: '2-def456',
      person_name: 'Bob Buyer',
      unread: false,
      timestamp: 'May 14',
    });
  });

  it('uses current thread URL for active conversation rows with no row-level link', () => {
    const html = `<!doctype html>
      <main>
        <div role="listitem" aria-label="Active conversation Unread">
          <span class="msg-conversation-card__participant-names">Active Router</span>
          <p class="msg-conversation-card__message-snippet">Can you ask our QA manager?</p>
          <time>now</time>
        </div>
      </main>`;
    const currentUrl = 'https://www.linkedin.com/messaging/thread/2-active789/';
    const dom = new JSDOM(html, { url: currentUrl });
    const result = extractInboxConversationsFromDocument(dom.window.document, currentUrl);
    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0]).toMatchObject({
      thread_url: currentUrl,
      thread_id: '2-active789',
      person_name: 'Active Router',
      unread: true,
    });
  });

  it('detects login/checkpoint pages', () => {
    const dom = new JSDOM('<form class="login__form"><input name="session_key" /></form>', {
      url: 'https://www.linkedin.com/login',
    });
    const result = extractInboxConversationsFromDocument(dom.window.document, dom.window.location.href);
    expect(result.loginRequired).toBe(true);
  });
});

describe('mergeConversations', () => {
  it('deduplicates by thread url and preserves unread truthiness', () => {
    const result = mergeConversations([
      { thread_url: 'https://www.linkedin.com/messaging/thread/2-a/', person_name: 'A', last_message_preview: 'old', unread: true, timestamp: '1h' },
    ], [
      { thread_url: 'https://www.linkedin.com/messaging/thread/2-a/', person_name: 'A', last_message_preview: 'new', unread: false, timestamp: '2h' },
      { thread_url: 'https://www.linkedin.com/messaging/thread/2-b/', person_name: 'B', last_message_preview: 'hi', unread: false, timestamp: '3h' },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ unread: true, last_message_preview: 'new' });
  });
});
