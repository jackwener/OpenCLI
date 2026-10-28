import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { gotoResilient } from '@jackwener/opencli/browser/utils';
import { normalizeWhitespace, unwrapEvaluateResult } from './shared.js';
import { __profile__ } from './connect.js';

// First LinkedIn message to a 1st-degree connection, from their profile URL.
//
// PROBLEM (2026-10-06): nothing could message a person who
// accepted our invite. `safe-send` replies inside an existing thread URL, and a first message has
// no thread yet. This adapter opens the profile, proves it is the expected person and a 1st-degree
// connection (the probe and owner resolution `connect` uses), opens the owner's Message control,
// proves the open conversation is addressed to that person, types the text, proves the composer
// holds exactly it, clicks Send, and reads the conversation back.
//
// Every refusal BEFORE the click is a result row (dry_run, name_mismatch, not_connected, refused),
// so the caller can record "nothing went out". After the click only sent_verified or
// sent_unverified is returned; a throw after the click means the caller must treat it as sent.

const { OWNER_NAME_JS, OWNER_SCOPE_JS, buildProfileProbeScript, assessProfileSafety, requireLinkedInProfileUrl, normalizeName } = __profile__;
const LINKEDIN_DOMAIN = 'www.linkedin.com';
// LinkedIn allows 8,000; the send gate allows 1,900 (outreach_gate.LINKEDIN_MESSAGE_MAX).
const TEXT_MAX = 1900;

// Page-side: the conversation the Message click opened. Since 2026 LinkedIn renders the messaging
// overlay inside a shadow root (host div.theme--light, measured 2026-10-06), so every query here
// searches the document and each open shadow root. The newest visible overlay bubble is the one
// the click opened; a full /messaging/ page is the fallback layout.
const CONVERSATION_JS = String.raw`
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
    const visible = (el) => el && el.offsetParent !== null;
    const roots = [document, ...Array.from(document.querySelectorAll('*')).filter((e) => e.shadowRoot).map((e) => e.shadowRoot)];
    const queryAll = (selector) => roots.flatMap((r) => Array.from(r.querySelectorAll(selector)));
    const bubbles = queryAll('.msg-overlay-conversation-bubble').filter(visible);
    const onThread = /^\/messaging\//.test(location.pathname);
    const root = bubbles.length ? bubbles[bubbles.length - 1] : (onThread ? (document.querySelector('main') || document.body) : null);
    const composerIn = (r) => r && Array.from(r.querySelectorAll('[contenteditable="true"][role="textbox"], div.msg-form__contenteditable[contenteditable="true"]')).find(visible);
`;

function buildOpenMessageScript(expectedName) {
  return String.raw`(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const clean = (s) => String(s || '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
    const visible = (el) => el && el.offsetParent !== null;
    const expectedName = ${JSON.stringify(expectedName)};
    ${OWNER_NAME_JS}
    const ariaLabel = (el) => clean(el?.getAttribute('aria-label') || '');
    const textLabel = (el) => clean(el?.innerText || el?.textContent || '');
    const labelOf = (el) => clean(textLabel(el) || ariaLabel(el));
    const expTokens = tokens(expectedName);
    const namesOwner = (el) => { const al = ariaLabel(el).toLowerCase(); return expTokens.length >= 1 && expTokens.every((t) => al.includes(t)); };
    ${OWNER_SCOPE_JS}
    const all = Array.from(document.querySelectorAll('button, [role="button"], a')).filter(visible);
    // 1) A Message control whose aria-label names the owner ("Message Jane Doe").
    let btn = all.find((el) => /^message\b/i.test(ariaLabel(el)) && namesOwner(el));
    if (!btn) {
      // 2) The plain "Message" control inside the owner's action bar, resolved as the probe did,
      //    or, when that scope is the whole page, the action bar around any control that names the
      //    owner ("Manage notifications about Jane Doe" sits in it, 2026-10-06 markup). actionBarOf
      //    refuses a bar that holds another member's control.
      const main = document.querySelector('main') || document.body;
      const { scope, wholeMain } = resolveOwnerScope(all, main);
      let bar = scope && !wholeMain ? scope : null;
      if (!bar) {
        const anchor = all.find((el) => namesOwner(el) && !/^view\b/i.test(ariaLabel(el)));
        bar = anchor ? actionBarOf(anchor) : null;
      }
      if (!bar) return { ok: false, reason: 'owner_action_bar_not_found' };
      const messages = controlsIn(bar).filter((el) => /^message$/i.test(labelOf(el)));
      if (messages.length > 1 && new Set(messages.map((el) => el.getAttribute('href') || '')).size > 1) {
        return { ok: false, reason: 'message_button_ambiguous' };
      }
      btn = messages[0];
    }
    if (!btn) return { ok: false, reason: 'message_button_not_found' };
    await sleep(450 + Math.floor(Math.random() * 700));
    btn.click();
    return { ok: true };
  })()`;
}

function buildConversationProbeScript() {
  return String.raw`(() => {
    ${CONVERSATION_JS}
    // A new-message draft names its recipients as pills ("Remove Jane Doe"); an existing
    // conversation names the other person in its header.
    const recipients = root
      ? Array.from(root.querySelectorAll('.artdeco-pill, [aria-label^="Remove "]'))
        .map((el) => clean((el.getAttribute('aria-label') || '').replace(/^Remove\s+/i, '') || el.innerText || el.textContent))
        .filter(Boolean)
      : [];
    const headerNames = [];
    if (root) {
      const selectors = ['.msg-overlay-bubble-header__title', '.msg-entity-lockup__entity-title', '.msg-thread__link-to-profile',
        '.msg-overlay-bubble-header h2', 'a[href*="/in/"] span[aria-hidden="true"]'];
      for (const selector of selectors) {
        for (const el of Array.from(root.querySelectorAll(selector)).slice(0, 6)) {
          const value = clean(el.innerText || el.textContent || el.getAttribute('aria-label'));
          if (value && value.length <= 120) headerNames.push(value);
        }
      }
    }
    const composer = composerIn(root);
    const messages = root
      ? Array.from(root.querySelectorAll('.msg-s-event-listitem__body, .msg-s-event__content, .msg-s-message-group__msg'))
        .map((el) => clean(el.innerText || el.textContent)).filter(Boolean)
      : [];
    return {
      url: location.href,
      found: Boolean(root),
      bubbles: bubbles.length,
      onThread,
      recipients: Array.from(new Set(recipients)),
      headerNames: Array.from(new Set(headerNames)).slice(0, 10),
      composerFound: Boolean(composer),
      composerText: composer ? clean(composer.innerText || composer.textContent) : '',
      lastMessages: messages.slice(-3),
    };
  })()`;
}

function buildCloseDraftScript() {
  return String.raw`(() => {
    ${CONVERSATION_JS}
    if (!root || onThread) return { ok: false };
    const close = Array.from(root.querySelectorAll('button')).find((b) => /^close your (draft )?conversation/i.test(clean(b.innerText || b.textContent || b.getAttribute('aria-label'))));
    if (!close) return { ok: false };
    close.click();
    return { ok: true };
  })()`;
}

function buildFocusComposerScript() {
  return String.raw`(() => {
    ${CONVERSATION_JS}
    const composer = composerIn(root);
    if (!composer) return { ok: false, error: 'composer_not_found' };
    composer.focus();
    composer.innerHTML = '';
    composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
    return { ok: true };
  })()`;
}

function buildClickSendScript() {
  return String.raw`(() => {
    ${CONVERSATION_JS}
    if (!root) return { ok: false, error: 'conversation_not_found' };
    const buttons = Array.from(root.querySelectorAll('button')).filter(visible);
    const send = buttons.find((b) => b.classList.contains('msg-form__send-button'))
      || buttons.find((b) => /^send( message)?$/i.test(clean(b.innerText || b.textContent || b.getAttribute('aria-label'))));
    if (!send) return { ok: false, error: 'send_button_not_found' };
    if (send.disabled || send.getAttribute('aria-disabled') === 'true') return { ok: false, error: 'send_button_disabled' };
    send.click();
    return { ok: true };
  })()`;
}

/** The open conversation is addressed to the expected person and nobody else: a draft's
 * recipient pills are exactly that one person; without pills, a header name is theirs. */
function conversationIsFor(convo, expectedName) {
  const expected = normalizeName(expectedName);
  const pills = Array.isArray(convo?.recipients) ? convo.recipients : [];
  if (pills.length) return pills.length === 1 && normalizeName(pills[0]) === expected;
  return (Array.isArray(convo?.headerNames) ? convo.headerNames : []).some((name) => normalizeName(name) === expected);
}

/** The read-back: our text is the conversation's last message. */
function readBackMatches(lastMessages, text) {
  const last = (Array.isArray(lastMessages) ? lastMessages : []).slice(-1)[0];
  return Boolean(last) && normalizeWhitespace(last) === normalizeWhitespace(text);
}

function requireText(value) {
  const text = String(value ?? '').trim();
  if (!text) throw new ArgumentError('--text is required');
  // CONSTRAINT: LinkedIn can be set to send on Enter, so a line break could send half a message.
  if (/[\r\n]/.test(text)) throw new ArgumentError('--text must be one paragraph: no line breaks');
  if (text.length > TEXT_MAX) throw new ArgumentError(`--text is ${text.length} characters; the limit is ${TEXT_MAX}`);
  return text;
}

async function probeConversation(page) {
  return unwrapEvaluateResult(await page.evaluate(buildConversationProbeScript())) || {};
}

cli({
  site: 'linkedin',
  name: 'message',
  access: 'write',
  description: 'Fail-closed first LinkedIn message to a 1st-degree connection, from their profile URL. Dry-run unless --send.',
  domain: LINKEDIN_DOMAIN,
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'profile-url', type: 'string', required: true, positional: true, help: 'Exact LinkedIn profile URL of the recipient' },
    { name: 'expected-name', type: 'string', required: true, help: 'Expected visible profile name (fail-closed check)' },
    { name: 'text', type: 'string', required: true, help: `Message text, at most ${TEXT_MAX} characters` },
    { name: 'send', type: 'bool', default: false, help: 'Actually click Send. Default is dry-run: verify the profile and open the message box, type nothing.' },
  ],
  columns: ['status', 'recipient', 'reason', 'profile_url', 'text_chars', 'thread_url'],
  func: async (page, args) => {
    if (!page) throw new CommandExecutionError('Browser session required for linkedin message');
    const profileUrl = requireLinkedInProfileUrl(String(args['profile-url'] || ''), '--profile-url');
    const expectedName = normalizeWhitespace(args['expected-name']);
    if (!expectedName) throw new ArgumentError('--expected-name is required');
    const text = requireText(args.text);
    const row = (status, reason, extra = {}) => [{ status, recipient: extra.recipient || '', reason, profile_url: profileUrl,
      text_chars: text.length, thread_url: extra.thread_url || '' }];

    await gotoResilient(page, profileUrl);
    await page.wait(6);
    let probe = unwrapEvaluateResult(await page.evaluate(buildProfileProbeScript(expectedName)));
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (probe?.name && (probe.connectAvailable || probe.alreadyConnected || probe.pending || probe.moreAvailable)) break;
      await page.wait(2);
      probe = unwrapEvaluateResult(await page.evaluate(buildProfileProbeScript(expectedName)));
    }
    const safety = assessProfileSafety(probe, expectedName, profileUrl);
    if (safety.blockReason === 'auth_required') {
      throw new AuthRequiredError(LINKEDIN_DOMAIN, 'LinkedIn message requires an active signed-in LinkedIn browser session.');
    }
    if (['profile_name_not_found', 'profile_name_mismatch', 'profile_url_mismatch'].includes(safety.blockReason)) {
      return row('name_mismatch', safety.blockReason, { recipient: safety.actualValue });
    }
    // assessProfileSafety reports a 1st-degree profile as "already_connected": for a message
    // that is the one state that may proceed.
    if (safety.blockReason !== 'already_connected') {
      return row('not_connected', safety.blockReason, { recipient: safety.actualValue });
    }

    const opened = unwrapEvaluateResult(await page.evaluate(buildOpenMessageScript(expectedName)));
    if (!opened?.ok) return row('refused', opened?.reason || 'message_open_failed', { recipient: safety.actualValue });
    let convo = {};
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await page.wait(2);
      convo = await probeConversation(page);
      if (convo.composerFound) break;
    }
    const closeDraft = async () => { try { await page.evaluate(buildCloseDraftScript()); } catch { /* best effort */ } };
    if (!conversationIsFor(convo, expectedName)) {
      await closeDraft();
      return row('refused', 'recipient_mismatch', { recipient: [...(convo.recipients || []), ...(convo.headerNames || [])].join(' | ').slice(0, 120) });
    }
    if (!convo.composerFound) {
      await closeDraft();
      return row('refused', 'composer_not_found', { recipient: safety.actualValue });
    }
    if (!args.send) {
      await closeDraft();
      return row('dry_run', 'verified', { recipient: safety.actualValue });
    }

    const focus = unwrapEvaluateResult(await page.evaluate(buildFocusComposerScript()));
    if (!focus?.ok) return row('refused', focus?.error || 'composer_focus_failed', { recipient: safety.actualValue });
    await page.insertText(text);
    await page.wait(0.6 + Math.random() * 0.8);
    const filled = await probeConversation(page);
    if (normalizeWhitespace(filled.composerText) !== normalizeWhitespace(text)) {
      return row('refused', 'composer_text_mismatch', { recipient: safety.actualValue });
    }
    if (!conversationIsFor(filled, expectedName)) {
      return row('refused', 'recipient_mismatch_after_fill', { recipient: safety.actualValue });
    }
    const clicked = unwrapEvaluateResult(await page.evaluate(buildClickSendScript()));
    if (!clicked?.ok) return row('refused', clicked?.error || 'send_click_failed', { recipient: safety.actualValue });

    // After this line the message may have gone out: only sent_verified or sent_unverified.
    let after = {};
    try {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await page.wait(1.5 + Math.random());
        after = await probeConversation(page);
        if (readBackMatches(after.lastMessages, text)) break;
      }
    } catch {
      after = {};
    }
    const verified = readBackMatches(after.lastMessages, text);
    return row(verified ? 'sent_verified' : 'sent_unverified', verified ? 'read_back' : 'read_back_failed', {
      recipient: safety.actualValue, thread_url: after.onThread ? after.url : '',
    });
  },
});

export const __test__ = {
  conversationIsFor,
  readBackMatches,
  requireText,
  TEXT_MAX,
};
