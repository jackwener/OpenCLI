import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { createHash } from 'node:crypto';

const LINKEDIN_DOMAIN = 'www.linkedin.com';

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
}

function unwrapEvaluateResult(payload) {
  if (payload && typeof payload === 'object' && 'data' in payload && 'session' in payload) return payload.data;
  return payload;
}

function normalizeName(value) {
  return normalizeWhitespace(value)
    .replace(/\s*[•·]\s*(?:1st|2nd|3rd\+?|degree connection).*$/i, '')
    .replace(/\s+LinkedIn.*$/i, '')
    .toLowerCase();
}

function isLinkedInHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'linkedin.com' || host.endsWith('.linkedin.com');
}

function canonicalizeLinkedInThreadUrl(value) {
  const raw = normalizeWhitespace(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !isLinkedInHost(url.hostname)) return '';
    const match = url.pathname.match(/^\/messaging\/thread\/([^/]+)\/?$/i);
    if (!match || !match[1]) return '';
    url.hostname = 'www.linkedin.com';
    url.hash = '';
    url.search = '';
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url.toString();
  } catch {
    return '';
  }
}

function hashText(value) {
  return createHash('sha256').update(normalizeWhitespace(value)).digest('hex');
}

function textContainsNormalized(haystack, needle) {
  const h = normalizeWhitespace(haystack).toLowerCase();
  const n = normalizeWhitespace(needle).toLowerCase();
  return !n || h.includes(n);
}

function selectBestHeaderName(headerNames, expectedName) {
  const expected = normalizeName(expectedName);
  const names = (Array.isArray(headerNames) ? headerNames : [])
    .map(normalizeWhitespace)
    .filter(Boolean);
  return names.find((name) => normalizeName(name) === expected) || names[0] || '';
}

function assessThreadSafety(probe, expected) {
  const expectedName = normalizeWhitespace(expected.expectedName);
  const actualName = selectBestHeaderName(probe?.headerNames, expectedName);
  const expectedThreadUrl = canonicalizeLinkedInThreadUrl(expected.threadUrl);
  const actualThreadUrl = canonicalizeLinkedInThreadUrl(probe?.url || '');
  const bodyText = String(probe?.bodyText || '');

  if (probe?.authRequired) {
    return { ok: false, blockReason: 'auth_required', expectedValue: expectedName, actualValue: actualName, observedUrl: actualThreadUrl };
  }

  if (probe?.searchFailure || /we didn't find anything|no results found|no results for/i.test(bodyText)) {
    return { ok: false, blockReason: 'search_failure_visible', expectedValue: expectedName, actualValue: actualName, observedUrl: actualThreadUrl };
  }

  if (expectedThreadUrl && actualThreadUrl && expectedThreadUrl !== actualThreadUrl) {
    return { ok: false, blockReason: 'thread_url_mismatch', expectedValue: expectedThreadUrl, actualValue: actualThreadUrl, observedUrl: actualThreadUrl };
  }

  if (!actualName || normalizeName(actualName) !== normalizeName(expectedName)) {
    return { ok: false, blockReason: 'recipient_header_mismatch', expectedValue: expectedName, actualValue: actualName, observedUrl: actualThreadUrl };
  }

  if (!probe?.composerFound) {
    return { ok: false, blockReason: 'composer_not_found', expectedValue: expectedName, actualValue: actualName, observedUrl: actualThreadUrl };
  }

  const expectedLastHash = normalizeWhitespace(expected.expectedLastHash);
  if (expectedLastHash && expectedLastHash !== probe?.latestMessageHash) {
    return { ok: false, blockReason: 'latest_message_mismatch', expectedValue: expectedLastHash, actualValue: probe?.latestMessageHash || '', observedUrl: actualThreadUrl };
  }

  const expectedLastText = normalizeWhitespace(expected.expectedLastText);
  if (expectedLastText && !textContainsNormalized(bodyText, expectedLastText)) {
    return { ok: false, blockReason: 'latest_message_mismatch', expectedValue: expectedLastText, actualValue: '', observedUrl: actualThreadUrl };
  }

  return { ok: true, blockReason: 'verified', expectedValue: expectedName, actualValue: actualName, observedUrl: actualThreadUrl };
}

function requireStringArg(args, key, label = key) {
  const value = normalizeWhitespace(args[key]);
  if (!value) throw new ArgumentError(`${label} is required`);
  return value;
}

function requireLinkedInThreadUrl(value, label) {
  const url = canonicalizeLinkedInThreadUrl(value);
  if (!url) throw new ArgumentError(`${label} must be an exact https://www.linkedin.com/messaging/thread/<id>/ URL`);
  return url;
}

function buildThreadProbeScript() {
  return String.raw`(() => {
    const marker = '__OPENCLI_LINKEDIN_PROBE__';
    void marker;
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
    const text = document.body ? (document.body.innerText || '') : '';
    const lower = text.toLowerCase();
    const authRequired = /\b(sign in|log in|join linkedin)\b/i.test(text)
      || /linkedin\.com\/(login|checkpoint|authwall)/i.test(location.href)
      || /captcha|verification required/i.test(text);
    const searchFailure = /we didn't find anything|no results found|no results for/i.test(text);

    const headerCandidates = [];
    const selectors = [
      '.msg-thread__link-to-profile',
      '.msg-thread__link-to-profile span[aria-hidden="true"]',
      '.msg-entity-lockup__entity-title',
      '.msg-conversation-card__participant-names',
      'main h1',
      'main h2',
      '[data-anonymize="person-name"]',
      'a[href*="/in/"] span[aria-hidden="true"]',
      'a[href*="/in/"]'
    ];
    for (const selector of selectors) {
      for (const el of Array.from(document.querySelectorAll(selector)).slice(0, 8)) {
        const value = clean(el.innerText || el.textContent || el.getAttribute('aria-label'));
        if (value && value.length <= 120 && !/^(message|messaging|send|profile|view profile)$/i.test(value)) {
          headerCandidates.push(value);
        }
      }
    }

    const composer = Array.from(document.querySelectorAll('[contenteditable="true"][role="textbox"], div.msg-form__contenteditable[contenteditable="true"], [aria-label*="Write a message" i]'))
      .find((el) => !el.closest('[aria-hidden="true"]') && el.offsetParent !== null);

    const messageText = Array.from(document.querySelectorAll('.msg-s-message-list__event, .msg-s-event-listitem, [data-event-urn], .msg-s-message-group__meta, .msg-s-message-list-content'))
      .map((el) => clean(el.innerText || el.textContent))
      .filter(Boolean)
      .join('\n');
    const sourceText = messageText || text;
    const sourceLines = sourceText.split(/\n+/).map(clean).filter(Boolean);
    const lastMeaningfulLine = [...sourceLines].reverse().find((line) => !/^(send|reply|write a message|press enter to send)$/i.test(line)) || '';

    return {
      url: location.href,
      title: document.title || '',
      headerNames: Array.from(new Set(headerCandidates)).slice(0, 10),
      bodyText: text,
      composerFound: Boolean(composer),
      composerText: composer ? clean(composer.innerText || composer.textContent) : '',
      authRequired,
      searchFailure,
      latestMessageText: lastMeaningfulLine,
      latestMessageHash: '',
    };
  })()`;
}

function buildFocusComposerScript() {
  return String.raw`(() => {
    const marker = '__OPENCLI_LINKEDIN_FOCUS_COMPOSER__';
    void marker;
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
    const composer = Array.from(document.querySelectorAll('[contenteditable="true"][role="textbox"], div.msg-form__contenteditable[contenteditable="true"], [aria-label*="Write a message" i]'))
      .find((el) => !el.closest('[aria-hidden="true"]') && el.offsetParent !== null);
    if (!composer) return { ok: false, error: 'composer_not_found', composerText: '' };
    composer.focus();
    composer.innerHTML = '';
    composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
    return { ok: true, composerText: clean(composer.innerText || composer.textContent) };
  })()`;
}

function buildReadComposerScript() {
  return String.raw`(() => {
    const marker = '__OPENCLI_LINKEDIN_READ_COMPOSER__';
    void marker;
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
    const composer = Array.from(document.querySelectorAll('[contenteditable="true"][role="textbox"], div.msg-form__contenteditable[contenteditable="true"], [aria-label*="Write a message" i]'))
      .find((el) => !el.closest('[aria-hidden="true"]') && el.offsetParent !== null);
    return { ok: Boolean(composer), composerText: composer ? clean(composer.innerText || composer.textContent) : '' };
  })()`;
}

function buildClickSendScript() {
  return String.raw`(() => {
    const marker = '__OPENCLI_LINKEDIN_CLICK_SEND__';
    void marker;
    const buttons = Array.from(document.querySelectorAll('button'));
    const send = buttons.find((button) => {
      const text = (button.innerText || button.textContent || button.getAttribute('aria-label') || '').trim().toLowerCase();
      return text === 'send' || text === 'send message';
    });
    if (!send) return { ok: false, error: 'send_button_not_found', sent: false };
    if (send.disabled || send.getAttribute('aria-disabled') === 'true') return { ok: false, error: 'send_button_disabled', sent: false };
    send.click();
    return { ok: true, sent: true };
  })()`;
}

async function probeThread(page) {
  const result = unwrapEvaluateResult(await page.evaluate(buildThreadProbeScript()));
  const latestText = normalizeWhitespace(result?.latestMessageText || '');
  return {
    ...(result || {}),
    latestMessageText: latestText,
    latestMessageHash: latestText ? hashText(latestText) : '',
  };
}

cli({
  site: 'linkedin',
  name: 'safe-send',
  access: 'write',
  description: 'Fail-closed LinkedIn message sender that verifies exact thread, recipient, and latest message before filling/sending',
  domain: LINKEDIN_DOMAIN,
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'thread-url', required: true, help: 'Exact LinkedIn messaging thread URL to open and verify' },
    { name: 'expected-name', required: true, help: 'Expected visible recipient name in the active thread header' },
    { name: 'message', required: true, help: 'Message body to send or dry-run' },
    { name: 'expected-last-text', help: 'Substring expected in the currently visible latest conversation context' },
    { name: 'expected-last-hash', help: 'SHA-256 hash of expected latest visible message text' },
    { name: 'send', type: 'bool', default: false, help: 'Actually click Send. Default is dry-run verification only.' },
    { name: 'screenshot', type: 'bool', default: false, help: 'Capture a screenshot during verification' },
  ],
  columns: ['status', 'recipient', 'reason', 'thread_url', 'message_chars', 'screenshot'],
  func: async (page, args) => {
    if (!page) throw new CommandExecutionError('Browser session required for linkedin safe-send');

    const threadUrl = requireLinkedInThreadUrl(requireStringArg(args, 'thread-url', '--thread-url'), '--thread-url');
    const expectedName = requireStringArg(args, 'expected-name', '--expected-name');
    const message = requireStringArg(args, 'message', '--message');

    await page.goto('https://www.linkedin.com/messaging/');
    await page.wait(4);
    await page.goto(threadUrl);
    // LinkedIn messaging often renders the shell first and hydrates the active
    // thread header/messages a few seconds later. Wait long enough for the
    // recipient header to appear so we fail closed on a real mismatch, not on
    // a premature blank DOM snapshot.
    await page.wait(12);

    let beforeProbe = await probeThread(page);
    const expectedLastText = normalizeWhitespace(args['expected-last-text']);
    for (let attempt = 0; expectedLastText && attempt < 6 && !textContainsNormalized(beforeProbe.bodyText, expectedLastText); attempt += 1) {
      await page.wait(2);
      beforeProbe = await probeThread(page);
    }

    const safety = assessThreadSafety(beforeProbe, {
      expectedName,
      threadUrl,
      expectedLastText: args['expected-last-text'],
      expectedLastHash: args['expected-last-hash'],
    });

    if (safety.blockReason === 'auth_required') {
      throw new AuthRequiredError(LINKEDIN_DOMAIN, 'LinkedIn safe-send requires an active signed-in LinkedIn browser session.');
    }

    if (!safety.ok) {
      const observed = [
        `Expected ${safety.expectedValue}; actual ${safety.actualValue || 'not_visible'} at ${safety.observedUrl || 'url_not_available'}`,
        `Observed headers: ${(beforeProbe.headerNames || []).join(' | ') || 'no_visible_headers'}`,
        `Title: ${beforeProbe.title || 'title_not_available'}`,
        `Body: ${normalizeWhitespace(beforeProbe.bodyText || '').slice(0, 500)}`,
      ].join('\n');
      throw new CommandExecutionError(
        `LinkedIn safe-send blocked: ${safety.blockReason}`,
        observed,
      );
    }

    let screenshot = '';
    if (args.screenshot && typeof page.screenshot === 'function') {
      screenshot = await page.screenshot({ fullPage: false });
    }

    if (!args.send) {
      return [{
        status: 'verified_dry_run',
        recipient: safety.actualValue,
        reason: safety.blockReason,
        thread_url: safety.observedUrl,
        message_chars: message.length,
        screenshot: screenshot ? 'captured' : '',
      }];
    }

    const focus = unwrapEvaluateResult(await page.evaluate(buildFocusComposerScript()));
    if (!focus?.ok) throw new CommandExecutionError(`LinkedIn safe-send blocked: ${focus?.error || 'composer_focus_failed'}`);

    await page.insertText(message);
    await page.wait(0.6 + Math.random() * 0.8);

    const composer = unwrapEvaluateResult(await page.evaluate(buildReadComposerScript()));
    if (!composer?.ok || normalizeWhitespace(composer.composerText) !== normalizeWhitespace(message)) {
      throw new CommandExecutionError(
        'LinkedIn safe-send blocked: composer_text_mismatch',
        `Composer text did not exactly match intended message for ${expectedName}.`,
      );
    }

    const afterFillProbe = await probeThread(page);
    const afterFillSafety = assessThreadSafety(afterFillProbe, {
      expectedName,
      threadUrl,
      expectedLastText: args['expected-last-text'],
      expectedLastHash: args['expected-last-hash'],
    });
    if (!afterFillSafety.ok) {
      throw new CommandExecutionError(`LinkedIn safe-send blocked after fill: ${afterFillSafety.blockReason}`);
    }

    const sent = unwrapEvaluateResult(await page.evaluate(buildClickSendScript()));
    if (!sent?.ok || !sent.sent) {
      throw new CommandExecutionError(`LinkedIn safe-send blocked: ${sent?.error || 'send_click_failed'}`);
    }

    await page.wait(0.8 + Math.random() * 1.2);
    return [{
      status: 'sent',
      recipient: safety.actualValue,
      reason: safety.blockReason,
      thread_url: safety.observedUrl,
      message_chars: message.length,
      screenshot: screenshot ? 'captured' : '',
    }];
  },
});

export const __test__ = {
  normalizeWhitespace,
  unwrapEvaluateResult,
  normalizeName,
  canonicalizeLinkedInThreadUrl,
  hashText,
  assessThreadSafety,
};
