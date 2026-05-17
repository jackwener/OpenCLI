import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import './safe-send.js';

const {
  normalizeWhitespace,
  normalizeName,
  canonicalizeLinkedInThreadUrl,
  hashText,
  assessThreadSafety,
} = await import('./safe-send.js').then((m) => m.__test__);

function makeFakePage(probe) {
  let composerText = probe.composerText || '';
  return {
    goto: vi.fn(async () => undefined),
    wait: vi.fn(async () => undefined),
    evaluate: vi.fn(async (script) => {
      const text = String(script);
      if (text.includes('__OPENCLI_LINKEDIN_PROBE__')) return probe;
      if (text.includes('__OPENCLI_LINKEDIN_FOCUS_COMPOSER__')) return { ok: true, composerText: '' };
      if (text.includes('__OPENCLI_LINKEDIN_READ_COMPOSER__')) return { ok: true, composerText };
      if (text.includes('__OPENCLI_LINKEDIN_CLICK_SEND__')) return { ok: true, sent: true };
      return undefined;
    }),
    insertText: vi.fn(async (text) => {
      composerText = text;
    }),
    pressKey: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => 'base64-screenshot'),
  };
}

describe('linkedin safe-send helpers', () => {
  it('normalizes whitespace and LinkedIn names for exact-ish comparisons', () => {
    expect(normalizeWhitespace('  Lokesh\n\tRamesh  ')).toBe('Lokesh Ramesh');
    expect(normalizeName('Lokesh Ramesh • 1st')).toBe('lokesh ramesh');
  });

  it('canonicalizes thread URLs while dropping query and hash noise', () => {
    expect(canonicalizeLinkedInThreadUrl('https://www.linkedin.com/messaging/thread/abc/?foo=1#bar'))
      .toBe('https://www.linkedin.com/messaging/thread/abc/');
    expect(canonicalizeLinkedInThreadUrl('https://www.linkedin.com/messaging/thread/abc/extra')).toBe('');
    expect(canonicalizeLinkedInThreadUrl('https://evil-linkedin.com/messaging/thread/abc/')).toBe('');
    expect(canonicalizeLinkedInThreadUrl('http://www.linkedin.com/messaging/thread/abc/')).toBe('');
  });

  it('fails closed when LinkedIn search produced no results even if a composer is visible', () => {
    const result = assessThreadSafety({
      url: 'https://www.linkedin.com/messaging/thread/bora/',
      headerNames: ['Bora Nicholson'],
      bodyText: "We didn't find anything for Victoria Munoz\nBora Nicholson",
      searchFailure: true,
      composerFound: true,
      latestMessageHash: hashText('hello'),
    }, {
      expectedName: 'Victoria Munoz',
      threadUrl: 'https://www.linkedin.com/messaging/thread/victoria/',
      expectedLastText: 'hello',
    });

    expect(result.ok).toBe(false);
    expect(result.blockReason).toBe('search_failure_visible');
  });

  it('fails closed on recipient header mismatch', () => {
    const result = assessThreadSafety({
      url: 'https://www.linkedin.com/messaging/thread/bora/',
      headerNames: ['Bora Nicholson'],
      bodyText: 'Bora Nicholson\nhello',
      composerFound: true,
      latestMessageHash: hashText('hello'),
    }, {
      expectedName: 'Victoria Munoz',
      expectedLastText: 'hello',
    });

    expect(result.ok).toBe(false);
    expect(result.blockReason).toBe('recipient_header_mismatch');
    expect(result.actualValue).toBe('Bora Nicholson');
  });

  it('fails closed when the stored latest message is no longer visible', () => {
    const result = assessThreadSafety({
      url: 'https://www.linkedin.com/messaging/thread/lokesh/',
      headerNames: ['Lokesh Ramesh'],
      bodyText: 'Lokesh Ramesh\na newer inbound arrived',
      composerFound: true,
      latestMessageHash: hashText('a newer inbound arrived'),
    }, {
      expectedName: 'Lokesh Ramesh',
      expectedLastText: 'old inbound text',
    });

    expect(result.ok).toBe(false);
    expect(result.blockReason).toBe('latest_message_mismatch');
  });

  it('passes only when recipient, thread, latest text, and composer are all verified', () => {
    const result = assessThreadSafety({
      url: 'https://www.linkedin.com/messaging/thread/lokesh/?mini=true',
      headerNames: ['Lokesh Ramesh'],
      bodyText: 'Lokesh Ramesh\nI think outside help would fit best for provider doc follow ups',
      composerFound: true,
      latestMessageHash: hashText('I think outside help would fit best for provider doc follow ups'),
    }, {
      expectedName: 'Lokesh Ramesh',
      threadUrl: 'https://www.linkedin.com/messaging/thread/lokesh/',
      expectedLastText: 'provider doc follow ups',
    });

    expect(result.ok).toBe(true);
    expect(result.blockReason).toBe('verified');
  });
});

describe('linkedin safe-send command', () => {
  it('registers as a write command with safe output columns', () => {
    const command = getRegistry().get('linkedin/safe-send');
    expect(command).toBeDefined();
    expect(command.access).toBe('write');
    expect(command.columns).toEqual(expect.arrayContaining(['status', 'recipient', 'reason']));
  });

  it('does not type or send when verification fails', async () => {
    const command = getRegistry().get('linkedin/safe-send');
    const page = makeFakePage({
      url: 'https://www.linkedin.com/messaging/thread/bora/',
      headerNames: ['Bora Nicholson'],
      bodyText: 'Bora Nicholson',
      composerFound: true,
      searchFailure: false,
    });

    await expect(command.func(page, {
      'thread-url': 'https://www.linkedin.com/messaging/thread/victoria/',
      'expected-name': 'Victoria Munoz',
      message: 'hello victoria',
      send: true,
    })).rejects.toBeInstanceOf(CommandExecutionError);

    expect(page.insertText).not.toHaveBeenCalled();
    expect(page.pressKey).not.toHaveBeenCalled();
  });

  it('rejects non-thread URLs before navigating or typing', async () => {
    const command = getRegistry().get('linkedin/safe-send');
    const page = makeFakePage({});

    await expect(command.func(page, {
      'thread-url': 'https://www.linkedin.com/feed/',
      'expected-name': 'Victoria Munoz',
      message: 'hello victoria',
      send: true,
    })).rejects.toBeInstanceOf(ArgumentError);

    expect(page.goto).not.toHaveBeenCalled();
    expect(page.insertText).not.toHaveBeenCalled();
  });

  it('dry-runs by default after verification without filling or sending', async () => {
    const command = getRegistry().get('linkedin/safe-send');
    const page = makeFakePage({
      url: 'https://www.linkedin.com/messaging/thread/lokesh/',
      headerNames: ['Lokesh Ramesh'],
      bodyText: 'Lokesh Ramesh\nprovider doc follow ups',
      composerFound: true,
      searchFailure: false,
    });

    const rows = await command.func(page, {
      'thread-url': 'https://www.linkedin.com/messaging/thread/lokesh/',
      'expected-name': 'Lokesh Ramesh',
      message: 'both, but starting hands on',
    });

    expect(rows[0]).toMatchObject({ status: 'verified_dry_run', recipient: 'Lokesh Ramesh', reason: 'verified' });
    expect(page.insertText).not.toHaveBeenCalled();
    expect(page.pressKey).not.toHaveBeenCalled();
  });

  it('fills and sends only when --send is explicitly true and post-fill verification matches exactly', async () => {
    const command = getRegistry().get('linkedin/safe-send');
    const page = makeFakePage({
      url: 'https://www.linkedin.com/messaging/thread/lokesh/',
      headerNames: ['Lokesh Ramesh'],
      bodyText: 'Lokesh Ramesh\nprovider doc follow ups',
      composerFound: true,
      searchFailure: false,
    });

    const rows = await command.func(page, {
      'thread-url': 'https://www.linkedin.com/messaging/thread/lokesh/',
      'expected-name': 'Lokesh Ramesh',
      message: 'both, but starting hands on',
      send: true,
    });

    expect(rows[0]).toMatchObject({ status: 'sent', recipient: 'Lokesh Ramesh', reason: 'verified' });
    expect(page.insertText).toHaveBeenCalledWith('both, but starting hands on');
    expect(page.pressKey).not.toHaveBeenCalled();
  });
});
