import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, TimeoutError } from '@jackwener/opencli/errors';
import { getRegistry, Strategy } from '@jackwener/opencli/registry';
import './auth.js';
import './search.js';
import './labels.js';
import './thread.js';
import './attachments.js';
import './draft.js';

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
    expect(getRegistry().get('gmail/draft')).toMatchObject({ access: 'write', strategy: Strategy.UI });
  });
});

describe('gmail draft', () => {
  const command = getRegistry().get('gmail/draft');
  let page;

  beforeEach(() => {
    page = {
      goto: vi.fn().mockResolvedValue(undefined),
      sleep: vi.fn().mockResolvedValue(undefined),
      nativeClick: vi.fn().mockResolvedValue(undefined),
      nativeType: vi.fn().mockResolvedValue(undefined),
      cdp: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockImplementation(async (source) => {
        const code = String(source);
        if (code.includes('compose button lookup')) return true;
        if (code.includes("item.getAttribute('gh')")) return { found: true, x: 10, y: 20 };
        if (code.includes('return !!dialog')) return true;
        if (code.includes('field.focus()')) return true;
        if (code.includes('recipientEmails')) return {
          subject: 'Subject',
          body: 'Body',
          recipientEmails: ['to@example.com', 'other@example.com'],
        };
        if (code.includes('save and close')) return { found: true, x: 30, y: 40 };
        if (code.includes("some((node) => node.getClientRects().length > 0)")) return false;
        return true;
      }),
    };
  });

  it('requires explicit execution before browser work', async () => {
    await expect(command.func(page, { to: 'to@example.com', subject: 'S', body: 'B' }))
      .rejects.toThrow(/--execute/);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('validates recipients and content before navigation', async () => {
    await expect(command.func(page, { execute: true, to: 'invalid', subject: 'S', body: 'B' }))
      .rejects.toThrow(ArgumentError);
    await expect(command.func(page, { execute: true, to: 'to@example.com', subject: ' ', body: 'B' }))
      .rejects.toThrow(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('uses the visible compose path and returns only after save confirmation', async () => {
    await expect(command.func(page, {
      execute: true,
      to: 'to@example.com, Other <other@example.com>',
      subject: 'Subject',
      body: 'Body',
      account: 1,
    })).resolves.toEqual([{
      to: 'to@example.com, Other <other@example.com>',
      subject: 'Subject',
      status: 'saved',
      message: 'Draft saved and compose window closed.',
    }]);
    expect(page.goto).toHaveBeenCalledWith('https://mail.google.com/mail/u/1/#inbox');
    expect(page.nativeType).toHaveBeenNthCalledWith(1, 'to@example.com');
    expect(page.nativeType).toHaveBeenNthCalledWith(2, 'Other <other@example.com>');
    expect(page.nativeType).toHaveBeenNthCalledWith(3, 'Subject');
    expect(page.nativeType).toHaveBeenNthCalledWith(4, 'Body');
  });

  it('surfaces post-compose uncertainty as retry-safe timeout guidance', async () => {
    page.evaluate.mockImplementation(async (source) => {
      const code = String(source);
      if (code.includes("item.getAttribute('gh')")) return { found: true, x: 10, y: 20 };
      if (code.includes('return !!dialog')) return true;
      if (code.includes('field.focus()')) return true;
      if (code.includes('recipientEmails')) return {
        subject: 'Subject',
        body: 'Body',
        recipientEmails: ['to@example.com'],
      };
      if (code.includes('save and close')) return { found: false };
      return true;
    });
    await expect(command.func(page, {
      execute: true,
      to: 'to@example.com',
      subject: 'Subject',
      body: 'Body',
    })).rejects.toThrow(TimeoutError);
  });
});
