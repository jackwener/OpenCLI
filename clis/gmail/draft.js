import { ArgumentError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { GMAIL_ORIGIN, parseAccount, unwrapBrowserResult } from './utils.js';

function requiredText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new ArgumentError(`gmail draft ${label} cannot be empty`);
  return text;
}

function parseRecipients(value) {
  const recipients = requiredText(value, 'recipients')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (recipients.some((item) => !/^(?:[^<>]+<)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(item))) {
    throw new ArgumentError('gmail draft recipients must be comma-separated email addresses');
  }
  return recipients.join(', ');
}

cli({
  site: 'gmail',
  name: 'draft',
  access: 'write',
  description: 'Create and save a Gmail draft without sending it',
  domain: 'mail.google.com',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  args: [
    { name: 'to', type: 'string', positional: true, required: true, help: 'Comma-separated recipient email addresses' },
    { name: 'subject', type: 'string', required: true, help: 'Draft subject' },
    { name: 'body', type: 'string', required: true, help: 'Plain-text draft body' },
    { name: 'account', type: 'int', default: 0, help: 'Gmail account index from the /mail/u/<index>/ URL' },
    { name: 'execute', type: 'boolean', default: false, help: 'Actually create the remote draft' },
  ],
  columns: ['to', 'subject', 'status', 'message'],
  func: async (page, kwargs) => {
    if (kwargs.execute !== true) {
      throw new ArgumentError('Refusing to create a Gmail draft: pass --execute');
    }
    const to = parseRecipients(kwargs.to);
    const recipientAddresses = to.split(', ')
      .map((recipient) => recipient.match(/[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/)?.[0]?.toLowerCase())
      .filter(Boolean);
    const subject = requiredText(kwargs.subject, 'subject');
    const body = requiredText(kwargs.body, 'body');
    const account = parseAccount(kwargs.account);
    if (!page) throw new CommandExecutionError('Browser session required for gmail draft');
    if (typeof page.nativeClick !== 'function' || typeof page.nativeType !== 'function') {
      throw new CommandExecutionError('Gmail draft requires native browser input support');
    }

    await page.goto(`${GMAIL_ORIGIN}/mail/u/${account}/#inbox`);
    await page.sleep(1);
    const compose = unwrapBrowserResult(await page.evaluate(`() => {
      const visible = (node) => {
        if (!node) return false;
        const style = getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length > 0;
      };
      const node = Array.from(document.querySelectorAll('[gh="cm"], button, [role="button"]'))
        .find((item) => visible(item) && (
          item.getAttribute('gh') === 'cm'
          || /^(compose|撰写|写邮件)$/i.test(String(item.innerText || item.textContent || '').trim())
        ));
      if (!node) return { found: false };
      const rect = node.getBoundingClientRect();
      return { found: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }`), 'compose button lookup');
    if (!compose?.found) {
      throw new CommandExecutionError('Could not find Gmail Compose button. Are you logged in?');
    }

    await page.nativeClick(compose.x, compose.y);
    const uncertain = async (message) => {
      throw new TimeoutError(
        'gmail draft confirmation',
        5,
        `${message} Check Gmail Drafts before retrying; a complete or partial draft may already exist.`,
      );
    };

    try {
      let ready = false;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        ready = unwrapBrowserResult(await page.evaluate(`() => {
          const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((node) => node.getClientRects().length > 0);
          return !!dialog
            && !!dialog.querySelector('input[name="to"], input[peoplekit-id]')
            && !!dialog.querySelector('input[name="subjectbox"]')
            && !!dialog.querySelector('[aria-label="Message Body"][contenteditable="true"], [role="textbox"][contenteditable="true"]');
        }`), 'compose readiness');
        if (ready === true) break;
        await page.sleep(0.1);
      }
      if (!ready) return uncertain('Compose window or fields did not appear.');

      const rawEnter = async () => {
        if (typeof page.cdp === 'function') {
          const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
          await page.cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
          await page.cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
        } else if (typeof page.nativeKeyPress === 'function') {
          await page.nativeKeyPress('Enter');
        } else {
          return uncertain('Native Enter is unavailable while entering recipients.');
        }
      };

      for (const recipient of to.split(', ')) {
        const focused = unwrapBrowserResult(await page.evaluate(`() => {
          const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((node) => node.getClientRects().length > 0);
          const field = dialog?.querySelector('input[name="to"], input[peoplekit-id]');
          if (!field) return false;
          field.focus();
          field.select();
          return true;
        }`), 'recipient field focus');
        if (!focused) return uncertain('Recipient field disappeared.');
        await page.nativeType(recipient);
        await rawEnter();
        await page.sleep(0.1);
      }

      const subjectFocused = unwrapBrowserResult(await page.evaluate(`() => {
        const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((node) => node.getClientRects().length > 0);
        const field = dialog?.querySelector('input[name="subjectbox"]');
        if (!field) return false;
        field.focus();
        field.select();
        return true;
      }`), 'subject field focus');
      if (!subjectFocused) return uncertain('Subject field disappeared.');
      await page.nativeType(subject);

      const bodyFocused = unwrapBrowserResult(await page.evaluate(`() => {
        const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((node) => node.getClientRects().length > 0);
        const field = dialog?.querySelector('[aria-label="Message Body"][contenteditable="true"], [role="textbox"][contenteditable="true"]');
        if (!field) return false;
        field.focus();
        return true;
      }`), 'body field focus');
      if (!bodyFocused) return uncertain('Message body field disappeared.');
      await page.nativeType(body);
      await page.sleep(1.5);

      const entered = unwrapBrowserResult(await page.evaluate(`() => {
        const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((node) => node.getClientRects().length > 0);
        const subject = dialog?.querySelector('input[name="subjectbox"]');
        const body = dialog?.querySelector('[aria-label="Message Body"][contenteditable="true"], [role="textbox"][contenteditable="true"]');
        return {
          subject: String(subject?.value || ''),
          body: String(body?.innerText || body?.textContent || ''),
          recipientEmails: Array.from(dialog?.querySelectorAll('[email]') || [])
            .map((node) => String(node.getAttribute('email') || '').trim().toLowerCase())
            .filter(Boolean),
        };
      }`), 'draft field verification');
      const normalizeBody = (value) => String(value || '').replace(/\r\n/g, '\n').replace(/\n$/, '');
      if (
        entered?.subject !== subject
        || normalizeBody(entered?.body) !== normalizeBody(body)
        || recipientAddresses.some((address) => !entered?.recipientEmails?.includes(address))
      ) {
        return uncertain('Gmail did not retain every draft field exactly.');
      }

      const close = unwrapBrowserResult(await page.evaluate(`() => {
        const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((node) => node.getClientRects().length > 0);
        const node = Array.from(dialog?.querySelectorAll('[data-tooltip], [aria-label], [role="button"]') || [])
          .find((item) => /(save\\s*&\\s*close|save and close|保存并关闭|儲存並關閉)/i.test(
            String(item.getAttribute('data-tooltip') || item.getAttribute('aria-label') || item.textContent || '').trim(),
          ));
        if (!node) return { found: false };
        const rect = node.getBoundingClientRect();
        return { found: rect.width > 0 && rect.height > 0, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }`), 'save-and-close lookup');
      if (!close?.found) return uncertain('Draft fields were entered but Save & close was not found.');
      await page.nativeClick(close.x, close.y);

      for (let attempt = 0; attempt < 30; attempt += 1) {
        const open = unwrapBrowserResult(await page.evaluate(`() => Array.from(document.querySelectorAll('[role="dialog"]')).some((node) => node.getClientRects().length > 0)`), 'draft close confirmation');
        if (open === false) {
          return [{ to, subject, status: 'saved', message: 'Draft saved and compose window closed.' }];
        }
        await page.sleep(0.1);
      }
      return uncertain('Draft save could not be confirmed.');
    } catch (error) {
      if (error instanceof TimeoutError) throw error;
      return uncertain(`Draft state is unknown: ${String(error?.message || error)}.`);
    }
  },
});
