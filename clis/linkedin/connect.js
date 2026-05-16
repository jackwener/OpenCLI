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
    const h1 = main?.querySelector('h1');
    const name = clean(h1?.innerText || h1?.textContent || document.querySelector('.text-heading-xlarge')?.textContent || '');
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).filter((el) => el.offsetParent !== null);
    const buttonLabels = buttons.map((button) => clean(button.innerText || button.textContent || button.getAttribute('aria-label'))).filter(Boolean);
    const lowerLabels = buttonLabels.map((label) => label.toLowerCase());
    const alreadyConnected = lowerLabels.some((label) => label === 'message' || label.includes('1st degree connection'));
    const pending = lowerLabels.some((label) => label === 'pending' || label.includes('pending'));
    const connectAvailable = lowerLabels.some((label) => label === 'connect' || label.startsWith('connect ') || label.includes(' invite '));
    return {
      url: location.href,
      title: document.title || '',
      name,
      authRequired,
      alreadyConnected,
      pending,
      connectAvailable,
      buttonLabels: buttonLabels.slice(0, 30),
      bodyText: text,
    };
  })()`;
}

function buildConnectionRequestScript(note) {
    return String.raw`(async () => {
    const note = ${JSON.stringify(note)};
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const jitter = async (min = 350, max = 950) => sleep(min + Math.floor(Math.random() * (max - min + 1)));
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
    const visible = (el) => el && el.offsetParent !== null && !el.closest('[aria-hidden="true"]');
    const label = (el) => clean(el?.innerText || el?.textContent || el?.getAttribute('aria-label'));
    const buttons = () => Array.from(document.querySelectorAll('button, [role="button"]')).filter(visible);
    const findButton = (patterns) => buttons().find((button) => patterns.some((pattern) => pattern.test(label(button))));

    let connect = findButton([/^connect$/i, /^connect\s+/i]);
    if (!connect) {
      const more = findButton([/^more$/i, /more actions/i]);
      if (more) {
        more.scrollIntoView({ block: 'center' });
        await jitter();
        more.click();
        await jitter(800, 1400);
        connect = findButton([/^connect$/i, /^connect\s+/i]);
      }
    }
    if (!connect) return { ok: false, status: 'blocked', reason: 'connect_button_not_found' };

    connect.scrollIntoView({ block: 'center' });
    await jitter();
    connect.click();
    await jitter(900, 1700);

    if (note) {
      const addNote = findButton([/add a note/i, /^add note$/i]);
      if (!addNote) return { ok: false, status: 'blocked', reason: 'add_note_button_not_found' };
      addNote.click();
      await jitter(700, 1300);
      const textarea = Array.from(document.querySelectorAll('textarea')).find(visible);
      if (!textarea) return { ok: false, status: 'blocked', reason: 'note_textarea_not_found' };
      textarea.focus();
      textarea.value = note;
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: note }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      await jitter(500, 1000);
    }

    const send = findButton([/^send$/i, /^send now$/i, /^done$/i]);
    if (!send) return { ok: false, status: 'blocked', reason: 'send_button_not_found' };
    if (send.disabled || send.getAttribute('aria-disabled') === 'true') return { ok: false, status: 'blocked', reason: 'send_button_disabled' };
    send.click();
    await jitter(1200, 2200);
    return { ok: true, status: 'sent', reason: 'connection_request_sent' };
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
        await page.wait(5);
        let probe = await probeProfile(page);
        for (let attempt = 0; attempt < 5 && !probe?.name; attempt += 1) {
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
        const result = unwrapEvaluateResult(await page.evaluate(buildConnectionRequestScript(note)));
        if (!result?.ok) throw new CommandExecutionError(`LinkedIn connect blocked: ${result?.reason || 'send_failed'}`);
        const after = await probeProfile(page);
        return [{
            status: result.status || 'sent',
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
