import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

const LINKEDIN_DOMAIN = 'www.linkedin.com';

function normalizeWhitespace(value) {
    return String(value ?? '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeName(value) {
    return normalizeWhitespace(value)
        .replace(/\s*[•·]\s*(?:1st|2nd|3rd\+?|degree connection).*$/i, '')
        .replace(/\s+LinkedIn.*$/i, '')
        .toLowerCase();
}

function canonicalizeLinkedInProfileUrl(value) {
    const raw = normalizeWhitespace(value);
    if (!raw) return '';
    try {
        const url = new URL(raw);
        if (!/linkedin\.com$/i.test(url.hostname) && !/\.linkedin\.com$/i.test(url.hostname)) return raw;
        // LinkedIn redirects country subdomains (ca./uk./...) to www.; normalize the
        // host so an expected `ca.linkedin.com/in/x` matches the landed `www.linkedin.com/in/x`.
        url.protocol = 'https:';
        url.hostname = 'www.linkedin.com';
        url.hash = '';
        url.search = '';
        if (!url.pathname.endsWith('/')) url.pathname += '/';
        return url.toString();
    }
    catch {
        return raw;
    }
}

function requireStringArg(args, key, label = key) {
    const value = normalizeWhitespace(args[key]);
    if (!value) throw new ArgumentError(`${label} is required`);
    return value;
}

function unwrapEvaluateResult(payload) {
    if (payload && typeof payload === 'object' && 'data' in payload && 'session' in payload) return payload.data;
    return payload;
}

function clampNote(note) {
    const value = normalizeWhitespace(note);
    if (value.length > 300) throw new ArgumentError('--note must be 300 characters or fewer for LinkedIn connection requests');
    return value;
}

function assessProfileSafety(probe, expectedName, expectedProfileUrl) {
    const expected = normalizeWhitespace(expectedName);
    const actual = normalizeWhitespace(probe?.name || '');
    const expectedUrl = canonicalizeLinkedInProfileUrl(expectedProfileUrl);
    const actualUrl = canonicalizeLinkedInProfileUrl(probe?.url || '');
    if (probe?.authRequired) return { ok: false, reason: 'auth_required', expected, actual, url: actualUrl };
    if (!actual) return { ok: false, reason: 'profile_name_not_found', expected, actual, url: actualUrl };
    if (expected && normalizeName(actual) !== normalizeName(expected)) {
        return { ok: false, reason: 'profile_name_mismatch', expected, actual, url: actualUrl };
    }
    if (expectedUrl && actualUrl && expectedUrl !== actualUrl) {
        return { ok: false, reason: 'profile_url_mismatch', expected: expectedUrl, actual: actualUrl, url: actualUrl };
    }
    if (probe?.alreadyConnected) return { ok: false, reason: 'already_connected', expected, actual, url: actualUrl };
    if (probe?.pending) return { ok: false, reason: 'connection_pending', expected, actual, url: actualUrl };
    if (!probe?.connectAvailable) return { ok: false, reason: 'connect_button_not_found', expected, actual, url: actualUrl };
    return { ok: true, reason: 'verified', expected, actual, url: actualUrl };
}

function buildProfileProbeScript() {
    return String.raw`(() => {
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
    const text = document.body ? (document.body.innerText || '') : '';
    const authRequired = /\b(sign in|log in|join linkedin)\b/i.test(text)
      || /linkedin\.com\/(login|checkpoint|authwall)/i.test(location.href)
      || /captcha|verification required/i.test(text);
    const main = document.querySelector('main') || document.body;
    // LinkedIn profile pages no longer expose the name in an <h1>; the heading
    // markup churns, but document.title is a stable "Name | LinkedIn" pattern.
    const heading = main?.querySelector('h1, .text-heading-xlarge, [class*="heading-xlarge"]');
    const titleName = clean((document.title || '')
      .replace(/^\(\d+\+?\)\s*/, '')
      .replace(/\s*[|｜]\s*LinkedIn\s*$/i, ''));
    const name = clean(heading?.innerText || heading?.textContent || '') || titleName;
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], a')).filter((el) => el.offsetParent !== null);
    const buttonLabels = buttons.map((button) => clean(button.innerText || button.textContent || button.getAttribute('aria-label'))).filter(Boolean);
    const lowerLabels = buttonLabels.map((label) => label.toLowerCase());
    const alreadyConnected = lowerLabels.some((label) => label === 'message' || label.includes('1st degree connection'));
    const pending = lowerLabels.some((label) => label === 'pending' || label.includes('pending'));
    const connectAvailable = lowerLabels.some((label) => label === 'connect' || label.startsWith('connect ') || label.includes(' invite '));
    // The Connect control is an <a> linking to LinkedIn's invitation route
    // (/preload/custom-invite/?vanityName=...). Capture it so the sender can
    // navigate straight to the invite dialog.
    const connectAnchor = buttons.find((el) => el.tagName === 'A'
      && /^connect$/i.test(clean(el.innerText || el.textContent || el.getAttribute('aria-label'))));
    const connectHref = connectAnchor ? (connectAnchor.getAttribute('href') || '') : '';
    return {
      url: location.href,
      title: document.title || '',
      name,
      authRequired,
      alreadyConnected,
      pending,
      connectAvailable,
      connectHref,
      buttonLabels: buttonLabels.slice(0, 30),
      bodyText: text,
    };
  })()`;
}

// Runs in-page on LinkedIn's invitation route (/preload/custom-invite/...),
// where the "Add a note to your invitation?" dialog is already open.
function buildInviteScript(note) {
    return String.raw`(async () => {
    const note = ${JSON.stringify(note)};
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const jitter = async (min = 450, max = 1150) => sleep(min + Math.floor(Math.random() * (max - min + 1)));
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
    const visible = (el) => el && el.offsetParent !== null;
    const label = (el) => clean(el?.innerText || el?.textContent || el?.getAttribute('aria-label'));
    const dialog = () => document.querySelector('[role="dialog"]');
    const dialogButton = (pattern) => {
      const dlg = dialog();
      if (!dlg) return null;
      return Array.from(dlg.querySelectorAll('button, [role="button"]')).filter(visible)
        .find((button) => pattern.test(label(button)));
    };

    if (!dialog()) return { ok: false, status: 'blocked', reason: 'invite_dialog_not_found' };

    if (!note) {
      const sendDirect = dialogButton(/^send without a note$/i) || dialogButton(/^send$/i);
      if (!sendDirect) return { ok: false, status: 'blocked', reason: 'send_button_not_found' };
      await jitter();
      sendDirect.click();
      await jitter(1400, 2400);
      return { ok: true, status: 'sent', reason: 'invitation_sent_without_note' };
    }

    const addNote = dialogButton(/^add a note$/i);
    if (!addNote) return { ok: false, status: 'blocked', reason: 'add_note_button_not_found' };
    await jitter();
    addNote.click();
    await jitter(800, 1400);

    const textarea = document.querySelector('#custom-message')
      || Array.from(document.querySelectorAll('textarea')).find(visible);
    if (!textarea) return { ok: false, status: 'blocked', reason: 'note_textarea_not_found' };
    textarea.focus();
    // React tracks textarea values through the native setter; assigning .value
    // directly would leave component state (and the Send button) unchanged.
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    nativeSetter.call(textarea, note);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    await jitter(700, 1300);

    const send = dialogButton(/^send$/i);
    if (!send) return { ok: false, status: 'blocked', reason: 'send_button_not_found' };
    if (send.disabled || send.getAttribute('aria-disabled') === 'true') {
      return { ok: false, status: 'blocked', reason: 'send_button_disabled' };
    }
    send.click();
    await jitter(1400, 2400);
    return { ok: true, status: 'sent', reason: 'invitation_sent_with_note' };
  })()`;
}

async function probeProfile(page) {
    return unwrapEvaluateResult(await page.evaluate(buildProfileProbeScript()));
}

cli({
    site: 'linkedin',
    name: 'connect',
    access: 'write',
    description: 'Fail-closed LinkedIn connection request sender that verifies the exact profile before optionally sending a note',
    domain: LINKEDIN_DOMAIN,
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'profile-url', type: 'string', required: true, positional: true, help: 'Exact LinkedIn profile URL to open and verify' },
        { name: 'expected-name', type: 'string', required: true, help: 'Expected visible profile name' },
        { name: 'note', type: 'string', required: false, default: '', help: 'Optional connection note, max 300 chars' },
        { name: 'send', type: 'bool', required: false, default: false, help: 'Actually click Send. Default is dry-run verification only.' },
    ],
    columns: ['status', 'recipient', 'reason', 'profile_url', 'note_chars', 'expected', 'actual', 'url'],
    func: async (page, args) => {
        if (!page) throw new CommandExecutionError('Browser session required for linkedin connect');
        const profileUrl = canonicalizeLinkedInProfileUrl(requireStringArg(args, 'profile-url', '--profile-url'));
        const expectedName = requireStringArg(args, 'expected-name', '--expected-name');
        const note = clampNote(args.note || '');

        await page.goto(profileUrl);
        await page.wait(6);
        let probe = await probeProfile(page);
        // The name resolves early (from document.title), but the profile action
        // buttons (Connect / Message / Pending) render later. Keep probing until
        // the action state has resolved, not merely until the name is visible.
        for (let attempt = 0; attempt < 8; attempt += 1) {
            const resolved = probe?.name
                && (probe.connectAvailable || probe.alreadyConnected || probe.pending);
            if (resolved) break;
            await page.wait(2);
            probe = await probeProfile(page);
        }
        const safety = assessProfileSafety(probe, expectedName, profileUrl);
        if (safety.reason === 'auth_required') {
            throw new AuthRequiredError(LINKEDIN_DOMAIN, 'LinkedIn connect requires an active signed-in LinkedIn browser session.');
        }
        if (!safety.ok) {
            throw new CommandExecutionError(
                `LinkedIn connect blocked: ${safety.reason}`,
                `Expected ${safety.expected}; actual ${safety.actual || 'not_visible'} at ${safety.url || 'url_not_available'}\nButtons: ${(probe?.buttonLabels || []).join(' | ')}`,
            );
        }
        if (!args.send) {
            return [{ status: 'verified_dry_run', recipient: safety.actual, reason: safety.reason, profile_url: safety.url, note_chars: note.length }];
        }
        const inviteHref = probe?.connectHref || '';
        if (!inviteHref) {
            throw new CommandExecutionError('LinkedIn connect blocked: connect_link_not_found');
        }
        const inviteUrl = new URL(inviteHref, 'https://www.linkedin.com').toString();
        await page.goto(inviteUrl);
        await page.wait(6);
        let result = unwrapEvaluateResult(await page.evaluate(buildInviteScript(note)));
        if (result?.reason === 'invite_dialog_not_found') {
            await page.wait(5);
            result = unwrapEvaluateResult(await page.evaluate(buildInviteScript(note)));
        }
        if (!result?.ok) throw new CommandExecutionError(`LinkedIn connect blocked: ${result?.reason || 'send_failed'}`);
        await page.goto(profileUrl);
        await page.wait(5);
        const after = await probeProfile(page);
        return [{
            status: after?.pending ? 'sent' : (result.status || 'sent'),
            recipient: safety.actual,
            reason: result.reason || 'connection_request_sent',
            profile_url: canonicalizeLinkedInProfileUrl(after?.url || safety.url),
            note_chars: note.length,
        }];
    },
});

export const __test__ = {
    normalizeWhitespace,
    normalizeName,
    canonicalizeLinkedInProfileUrl,
    unwrapEvaluateResult,
    clampNote,
    assessProfileSafety,
};
