import { describe, expect, it } from 'vitest';
import { getRegistry, Strategy } from '@jackwener/opencli/registry';
import './auth.js';
import './search.js';
import './labels.js';
import './thread.js';
import './attachments.js';

describe('gmail command registry', () => {
  it('registers the rich read surface with explicit strategies', () => {
    for (const name of [
      'search', 'inbox', 'unread', 'starred', 'sent', 'drafts', 'trash', 'spam',
      'snoozed', 'important', 'labels', 'thread', 'attachments',
    ]) {
      expect(getRegistry().get(`gmail/${name}`)).toMatchObject({
        access: 'read',
        strategy: Strategy.INTERCEPT,
        domain: 'mail.google.com',
      });
    }
    expect(getRegistry().get('gmail/whoami')).toMatchObject({ access: 'read', strategy: Strategy.COOKIE });
    expect(getRegistry().get('gmail/login')).toMatchObject({ access: 'write', strategy: Strategy.COOKIE });
    expect(getRegistry().has('gmail/draft')).toBe(false);
    expect(getRegistry().has('gmail/send')).toBe(false);
    expect(getRegistry().has('gmail/delete')).toBe(false);
  });
});
