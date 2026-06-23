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
        .replace(/\b(p\.?eng\.?|cpa|mba|ph\.?d\.?)\b/ig, '')
        .replace(/[^\p{L}\p{N}\s.'-]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function nameTokens(value) {
    return normalizeName(value)
        .replace(/[.'-]+/g, ' ')
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2);
}

function matchInvitationName(candidate, expected) {
    const candidateName = normalizeName(candidate);
    const expectedName = normalizeName(expected);
    if (!candidateName || !expectedName) return false;
    if (candidateName === expectedName) return true;
    if (candidateName.includes(expectedName) || expectedName.includes(candidateName)) return true;
    const candidateTokens = new Set(nameTokens(candidateName));
    const expectedTokens = nameTokens(expectedName);
    if (expectedTokens.length < 2 || candidateTokens.size < 2) return false;
    const matched = expectedTokens.filter((token) => candidateTokens.has(token)).length;
    return matched >= 2 && matched / expectedTokens.length >= 0.8;
}

function isLinkedInHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'linkedin.com' || host.endsWith('.linkedin.com');
}

function canonicalizeLinkedInProfileUrl(value) {
    const raw = normalizeWhitespace(value);
    if (!raw) return '';
    try {
        const url = new URL(raw);
        if (url.protocol !== 'https:' || url.username || url.password || url.port || !isLinkedInHost(url.hostname)) return '';
        const match = url.pathname.match(/^\/in\/([^/]+)\/?$/i);
        if (!match || !match[1]) return '';
        // LinkedIn redirects country subdomains (ca./uk./...) to www.; normalize the
        // host so an expected `ca.linkedin.com/in/x` matches the landed `www.linkedin.com/in/x`.
        url.hostname = 'www.linkedin.com';
        url.hash = '';
        url.search = '';
        if (!url.pathname.endsWith('/')) url.pathname += '/';
        return url.toString();
    }
    catch {
        return '';
    }
}

function requireStringArg(args, key, label = key) {
    const value = normalizeWhitespace(args[key]);
    if (!value) throw new ArgumentError(`${label} is required`);
    return value;
}

function requireLinkedInProfileUrl(value, label) {
    const url = canonicalizeLinkedInProfileUrl(value);
    if (!url) throw new ArgumentError(`${label} must be an exact https://www.linkedin.com/in/<profile>/ URL`);
    return url;
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

function canonicalizeLinkedInInviteUrl(value) {
    try {
        const url = new URL(normalizeWhitespace(value), 'https://www.linkedin.com');
        if (url.protocol !== 'https:' || url.username || url.password || url.port || !isLinkedInHost(url.hostname)) return '';
        if (!/^\/preload\/custom-invite\/?$/i.test(url.pathname)) return '';
        url.hostname = 'www.linkedin.com';
        url.hash = '';
        if (!url.pathname.endsWith('/')) url.pathname += '/';
        return url.toString();
    }
    catch {
        return '';
    }
}

function assessProfileSafety(probe, expectedName, expectedProfileUrl) {
    const expected = normalizeWhitespace(expectedName);
    const actual = normalizeWhitespace(probe?.name || '');
    const expectedUrl = canonicalizeLinkedInProfileUrl(expectedProfileUrl);
    const actualUrl = canonicalizeLinkedInProfileUrl(probe?.url || '');
    if (probe?.authRequired) return { ok: false, safety: 'unsafe_block', connectable: null, blockReason: 'auth_required', expectedValue: expected, actualValue: actual, observedUrl: actualUrl };
    if (!actual) return { ok: false, safety: 'unsafe_block', connectable: null, blockReason: 'profile_name_not_found', expectedValue: expected, actualValue: actual, observedUrl: actualUrl };
    if (expected && normalizeName(actual) !== normalizeName(expected)) {
        return { ok: false, safety: 'unsafe_block', connectable: null, blockReason: 'profile_name_mismatch', expectedValue: expected, actualValue: actual, observedUrl: actualUrl };
    }
    if (expectedUrl && actualUrl && expectedUrl !== actualUrl) {
        return { ok: false, safety: 'unsafe_block', connectable: null, blockReason: 'profile_url_mismatch', expectedValue: expectedUrl, actualValue: actualUrl, observedUrl: actualUrl };
    }
    if (probe?.alreadyConnected) return { ok: false, safety: 'routine_non_connectable', connectable: false, blockReason: 'already_connected', expectedValue: expected, actualValue: actual, observedUrl: actualUrl };
    if (probe?.pending) return { ok: false, safety: 'routine_non_connectable', connectable: false, blockReason: 'connection_pending', expectedValue: expected, actualValue: actual, observedUrl: actualUrl };
    if (probe?.connectAvailable) return { ok: true, safety: 'connectable', connectable: true, blockReason: 'verified', expectedValue: expected, actualValue: actual, observedUrl: actualUrl };
    // No top-level Connect, but a "More" actions menu is present and the profile is neither
    // already-connected nor pending: Connect is almost certainly inside that menu. Treat as
    // connectable; the send step opens "More" and fails cleanly if Connect truly isn't there.
    if (probe?.moreAvailable) return { ok: true, safety: 'connectable', connectable: true, blockReason: 'verified_via_more', expectedValue: expected, actualValue: actual, observedUrl: actualUrl };
    return { ok: false, safety: 'routine_non_connectable', connectable: false, blockReason: 'connect_button_not_found', expectedValue: expected, actualValue: actual, observedUrl: actualUrl };
}

function buildProfileProbeScript(expectedName = '') {
    return String.raw`(() => {
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
    const expectedName = ${JSON.stringify(expectedName)};
    const normalizeName = (s) => clean(s)
      .replace(/\s*[•·]\s*(?:1st|2nd|3rd\+?|degree connection).*$/i, '')
      .replace(/\s+LinkedIn.*$/i, '')
      .replace(/\b(p\.?eng\.?|cpa|mba|ph\.?d\.?)\b/ig, '')
      .replace(/[^\p{L}\p{N}\s.'-]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const tokens = (s) => normalizeName(s).replace(/[.'-]+/g, ' ').split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 2);
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
    const expectedTokens = tokens(expectedName || name);
    const ariaLabel = (el) => clean(el?.getAttribute('aria-label') || '');
    const textLabel = (el) => clean(el?.innerText || el?.textContent || '');
    const labelOf = (el) => clean(textLabel(el) || ariaLabel(el));
    const namesOwner = (el) => {
      const label = ariaLabel(el).toLowerCase();
      return expectedTokens.length >= 1 && expectedTokens.every((token) => label.includes(token));
    };
    const topCard = main?.querySelector('.pv-top-card, [class*="top-card"]')
      || heading?.closest?.('section, .ph5, [class*="top-card"]')
      || main;
    const ownerAction = buttons.find((el) => namesOwner(el) && /^(invite|connect|follow|message|more|pending)\b/i.test(ariaLabel(el)));
    const ownerScope = ownerAction
      ? (ownerAction.closest('[class*="profile-actions"], [class*="pvs-profile-actions"], .pv-top-card, .ph5, section') || ownerAction.parentElement || topCard)
      : topCard;
    const scopedButtons = Array.from(ownerScope?.querySelectorAll?.('button, [role="button"], a') || []).filter((el) => el.offsetParent !== null);
    const ownerButtons = Array.from(new Set([...buttons.filter(namesOwner), ...scopedButtons]));
    const lowerOwnerLabels = ownerButtons.map((button) => labelOf(button).toLowerCase()).filter(Boolean);
    const pending = lowerOwnerLabels.some((label) => label === 'pending' || label.includes('pending'));
    const connectAvailable = ownerButtons.some((el) => {
      const label = labelOf(el).toLowerCase();
      const aria = ariaLabel(el).toLowerCase();
      return label === 'connect'
        || label.startsWith('connect ')
        || (/invite .* to connect/i.test(aria) && namesOwner(el));
    });
    // When "Follow" is the primary action, Connect is tucked inside the "More" actions
    // menu rather than shown as a top-level button. Note the menu's presence so the safety
    // check can treat the profile as connectable; the send step opens the menu and confirms.
    const moreAvailable = lowerOwnerLabels.some((label) => label === 'more' || label.startsWith('more '));
    // A visible "Message" button is NOT proof of an existing connection: LinkedIn shows
    // Message on many 2nd/3rd-degree profiles (open profiles, Premium, recruiter) right
    // next to a real "Connect" button. The reliable signal for a 1st-degree connection is
    // the degree badge ("1st degree connection") in the top card. Scope to the top card so
    // the "People also viewed" sidebar (which lists other members' degrees) cannot bleed in,
    // and never call it connected when a Connect affordance is present.
    const topCardRaw = clean(topCard?.textContent || '');
    const firstDegreeBadge = /\b1st degree connection\b/i.test(topCardRaw);
    const alreadyConnected = !connectAvailable && firstDegreeBadge;
    // The Connect control is an <a> linking to LinkedIn's invitation route
    // (/preload/custom-invite/?vanityName=...). Capture it so the sender can
    // navigate straight to the invite dialog.
    const connectAnchor = ownerButtons.find((el) => el.tagName === 'A'
      && (/^connect$/i.test(labelOf(el)) || (/invite .* to connect/i.test(ariaLabel(el)) && namesOwner(el))));
    const connectHref = connectAnchor ? (connectAnchor.getAttribute('href') || '') : '';
    return {
      url: location.href,
      title: document.title || '',
      name,
      authRequired,
      alreadyConnected,
      pending,
      connectAvailable,
      moreAvailable,
      connectHref,
      buttonLabels: buttonLabels.slice(0, 30),
      bodyText: text,
    };
  })()`;
}

// Runs in-page on LinkedIn's invitation route (/preload/custom-invite/...),
// where the "Add a note to your invitation?" dialog is already open.

function buildSentInvitationsProbeScript(expectedName, expectedProfileUrl) {
    return String.raw`(() => {
    const expectedName = ${JSON.stringify(expectedName)};
    const expectedUrl = ${JSON.stringify(canonicalizeLinkedInProfileUrl(expectedProfileUrl))};
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
    const normName = (s) => clean(s)
      .replace(/\s*[•·]\s*(?:1st|2nd|3rd\+?|degree connection).*$/i, '')
      .replace(/\s+LinkedIn.*$/i, '')
      .replace(/\b(p\.?eng\.?|cpa|mba|ph\.?d\.?)\b/ig, '')
      .replace(/[^\p{L}\p{N}\s.'-]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const tokens = (s) => normName(s).replace(/[.'-]+/g, ' ').split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 2);
    const nameMatchesReasonably = (candidate, expected) => {
      const c = normName(candidate);
      const e = normName(expected);
      if (!c || !e) return false;
      if (c === e || c.includes(e) || e.includes(c)) return true;
      const candidateTokens = new Set(tokens(c));
      const expectedTokens = tokens(e);
      if (expectedTokens.length < 2 || candidateTokens.size < 2) return false;
      const matched = expectedTokens.filter((token) => candidateTokens.has(token)).length;
      return matched >= 2 && matched / expectedTokens.length >= 0.8;
    };
    const canon = (value) => {
      try {
        const url = new URL(value, 'https://www.linkedin.com');
        if (!/^\/in\/[^/]+\/?$/i.test(url.pathname)) return '';
        url.protocol = 'https:';
        url.hostname = 'www.linkedin.com';
        url.hash = '';
        url.search = '';
        if (!url.pathname.endsWith('/')) url.pathname += '/';
        return url.toString();
      } catch { return ''; }
    };
    const text = document.body ? (document.body.innerText || '') : '';
    const authRequired = /\b(sign in|log in|join linkedin)\b/i.test(text)
      || /linkedin\.com\/(login|checkpoint|authwall)/i.test(location.href)
      || /captcha|verification required/i.test(text);
    if (authRequired) return { authRequired: true, found: false, matchedName: '', matchedUrl: '', visibleNames: [] };
    const structuralRows = Array.from(document.querySelectorAll('li, article, [data-view-name], .mn-invitation-card'));
    const linkRows = Array.from(document.querySelectorAll('a[href*="/in/"]'))
      .map((a) => a.closest('li') || a.closest('[data-view-name]') || a.closest('[class*="invitation"]') || a.closest('div'))
      .filter(Boolean);
    const rows = Array.from(new Set([...structuralRows, ...linkRows]));
    const visibleNames = [];
    for (const row of rows.slice(0, 25)) {
      const rowText = clean(row.innerText || row.textContent || '');
      if (!rowText) continue;
      const link = Array.from(row.querySelectorAll('a[href*="/in/"]'))
        .map((a) => ({ href: canon(a.href || a.getAttribute('href') || ''), text: clean(a.innerText || a.textContent || '') }))
        .find((a) => a.href || a.text);
      const candidateName = clean(link?.text || row.querySelector('span[aria-hidden="true"], h3, h2')?.textContent || rowText.split('\n')[0]);
      if (candidateName) visibleNames.push(candidateName);
      const candidateUrl = link?.href || '';
      const nameMatches = expectedName && candidateName && nameMatchesReasonably(candidateName, expectedName);
      const urlMatches = expectedUrl && candidateUrl && candidateUrl === expectedUrl;
      if (urlMatches || nameMatches) return { authRequired: false, found: true, matchedName: candidateName, matchedUrl: candidateUrl, visibleNames: visibleNames.slice(0, 20) };
    }
    return { authRequired: false, found: false, matchedName: '', matchedUrl: '', visibleNames: visibleNames.slice(0, 20) };
  })()`;
}

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

// Opens the connection-invite dialog in-page for profiles where "Connect" is a
// <button> (not an <a> to /preload/custom-invite/). Connect may be a primary button
// or hidden inside the "More" actions menu. CRITICAL: a profile page also renders
// "Connect" buttons for OTHER people (the "People also viewed" / "More profiles for
// you" sidebar). We must never click those. Every click here is scoped to the profile
// OWNER, identified by LinkedIn's name-bearing aria-labels ("Invite <Name> to connect",
// "Message <Name>", "Follow <Name>"). If the owner's control can't be positively
// identified, fail closed rather than guess.
function buildOpenConnectDialogScript(expectedName) {
    return String.raw`(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const jitter = async (min = 450, max = 1150) => sleep(min + Math.floor(Math.random() * (max - min + 1)));
    const clean = (s) => String(s || '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
    const visible = (el) => el && el.offsetParent !== null;
    const expectedName = ${JSON.stringify(expectedName)};
    const ariaLabel = (el) => clean(el?.getAttribute('aria-label') || '');
    const textLabel = (el) => clean(el?.innerText || el?.textContent || '');
    const tokens = (s) => clean(s).toLowerCase().replace(/[.'-]+/g, ' ').split(/\s+/).filter((t) => t.length >= 2);
    const expTokens = tokens(expectedName);
    // Require every expected-name token to appear in the control's aria-label, so a
    // sidebar card's "Invite <OtherName> to connect" can never satisfy this.
    const namesOwner = (el) => { const al = ariaLabel(el).toLowerCase(); return expTokens.length >= 1 && expTokens.every((t) => al.includes(t)); };
    const isConnectText = (el) => /^connect$/i.test(textLabel(el));
    const isOwnerConnect = (el) => /invite .* to connect/i.test(ariaLabel(el)) && namesOwner(el);
    if (document.querySelector('[role="dialog"]')) return { ok: true, opened: 'already_open' };
    const all = Array.from(document.querySelectorAll('button, [role="button"], a')).filter(visible);
    // 1) Primary Connect button whose aria-label names the profile owner.
    let btn = all.find(isOwnerConnect);
    // 2) Connect under the owner's "More" menu: find the owner's action bar via a named
    //    Follow/Message/More/Pending control, open the menu, then pick Connect from THAT
    //    opened menu only (the dropdown is portaled to the body).
    if (!btn) {
      const ownerAction = all.find((el) => namesOwner(el) && /^(follow|message|more|pending|invite)\b/i.test(ariaLabel(el)));
      const bar = ownerAction
        ? (ownerAction.closest('[class*="profile-actions"], [class*="pvs-profile-actions"], .pv-top-card, .ph5, section') || ownerAction.parentElement)
        : null;
      if (!bar) return { ok: false, reason: 'owner_action_bar_not_found' };
      const moreBtn = Array.from(bar.querySelectorAll('button, [role="button"]')).filter(visible)
        .find((el) => { const l = (ariaLabel(el) || textLabel(el)).toLowerCase(); return l === 'more' || l.startsWith('more '); });
      if (!moreBtn) return { ok: false, reason: 'owner_more_button_not_found' };
      await jitter();
      moreBtn.click();
      await jitter(700, 1300);
      const menu = Array.from(document.querySelectorAll('[role="menu"], .artdeco-dropdown__content')).filter(visible).pop();
      const scope = menu || bar;
      btn = Array.from(scope.querySelectorAll('[role="menuitem"], button, a, div')).filter(visible).find((el) => isOwnerConnect(el) || isConnectText(el));
    }
    if (!btn) return { ok: false, reason: 'connect_control_not_found' };
    await jitter();
    btn.click();
    await jitter(1200, 2000);
    if (document.querySelector('[role="dialog"]')) return { ok: true, opened: 'dialog' };
    // Some flows fire the invite immediately without a confirmation dialog.
    return { ok: true, opened: 'no_dialog' };
  })()`;
}

async function probeProfile(page, expectedName = '') {
    return unwrapEvaluateResult(await page.evaluate(buildProfileProbeScript(expectedName)));
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
    columns: ['status', 'recipient', 'reason', 'profile_url', 'note_chars', 'connectable', 'delivery_verified', 'matched_invitation_name', 'matched_invitation_url', 'actualValue', 'blockReason', 'expectedValue', 'observedUrl', 'safety'],
    func: async (page, args) => {
        if (!page) throw new CommandExecutionError('Browser session required for linkedin connect');
        const profileUrl = requireLinkedInProfileUrl(requireStringArg(args, 'profile-url', '--profile-url'), '--profile-url');
        const expectedName = requireStringArg(args, 'expected-name', '--expected-name');
        const note = clampNote(args.note || '');

        await page.goto(profileUrl);
        await page.wait(6);
        let probe = await probeProfile(page, expectedName);
        // The name resolves early (from document.title), but the profile action
        // buttons (Connect / Message / Pending) render later. Keep probing until
        // the action state has resolved, not merely until the name is visible.
        for (let attempt = 0; attempt < 8; attempt += 1) {
            const resolved = probe?.name
                && (probe.connectAvailable || probe.alreadyConnected || probe.pending || probe.moreAvailable);
            if (resolved) break;
            await page.wait(2);
            probe = await probeProfile(page, expectedName);
        }
        const safety = assessProfileSafety(probe, expectedName, profileUrl);
        if (safety.blockReason === 'auth_required') {
            throw new AuthRequiredError(LINKEDIN_DOMAIN, 'LinkedIn connect requires an active signed-in LinkedIn browser session.');
        }
        if (!safety.ok && safety.safety === 'routine_non_connectable') {
            return [{ status: 'not_connectable', recipient: safety.actualValue, reason: safety.blockReason, profile_url: safety.observedUrl, note_chars: note.length, connectable: false }];
        }
        if (!safety.ok) {
            throw new CommandExecutionError(
                `LinkedIn connect blocked: ${safety.blockReason}`,
                `Expected ${safety.expectedValue}; actual ${safety.actualValue || 'not_visible'} at ${safety.observedUrl || 'url_not_available'}\nButtons: ${(probe?.buttonLabels || []).join(' | ')}`,
            );
        }
        if (!args.send) {
            return [{ status: 'connectable_dry_run', recipient: safety.actualValue, reason: safety.blockReason, profile_url: safety.observedUrl, note_chars: note.length, connectable: true }];
        }
        const inviteHref = probe?.connectHref || '';
        if (inviteHref) {
            // Anchor-based Connect: navigate straight to the invitation route, where the
            // "Add a note?" dialog renders already open.
            const inviteUrl = canonicalizeLinkedInInviteUrl(inviteHref);
            if (!inviteUrl) {
                throw new CommandExecutionError('LinkedIn connect blocked: invalid_connect_link');
            }
            await page.goto(inviteUrl);
            await page.wait(6);
        }
        else {
            // Button-based Connect: no /preload/custom-invite/ anchor exists, so open the
            // invite dialog in-page by clicking the Connect control (directly or via More).
            const opened = unwrapEvaluateResult(await page.evaluate(buildOpenConnectDialogScript(expectedName)));
            if (!opened?.ok) {
                throw new CommandExecutionError(`LinkedIn connect blocked: ${opened?.reason || 'connect_control_not_found'}`);
            }
            await page.wait(3);
        }
        let result = unwrapEvaluateResult(await page.evaluate(buildInviteScript(note)));
        if (result?.reason === 'invite_dialog_not_found') {
            await page.wait(5);
            result = unwrapEvaluateResult(await page.evaluate(buildInviteScript(note)));
        }
        // A button-based Connect that fired the invite without a confirmation dialog leaves
        // no dialog to drive; treat it as sent and let the sent-invitations probe verify.
        if (!result?.ok && result?.reason === 'invite_dialog_not_found' && !inviteHref) {
            result = { ok: true, status: 'sent', reason: 'invitation_sent_no_dialog' };
        }
        if (!result?.ok) throw new CommandExecutionError(`LinkedIn connect blocked: ${result?.reason || 'send_failed'}`);
        // LinkedIn can take a few seconds after the Send click to materialize the
        // new invite in /mynetwork/invitation-manager/sent/. Wait before the
        // first check, then retry page loads for propagation lag.
        await page.wait(8);
        let sentProbe = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            await page.goto('https://www.linkedin.com/mynetwork/invitation-manager/sent/');
            await page.wait(attempt === 0 ? 6 : 4);
            sentProbe = unwrapEvaluateResult(await page.evaluate(buildSentInvitationsProbeScript(expectedName, profileUrl)));
            if (sentProbe?.found || sentProbe?.authRequired) break;
            if (attempt < 2) await page.wait(5);
        }
        if (sentProbe?.authRequired) {
            throw new AuthRequiredError(LINKEDIN_DOMAIN, 'LinkedIn sent-invitations verification requires an active signed-in LinkedIn browser session.');
        }
        const verified = Boolean(sentProbe?.found);
        return [{
            status: verified ? 'sent_verified' : 'send_unverified',
            recipient: safety.actualValue,
            reason: verified ? 'sent_invitation_verified' : 'sent_invitation_not_found_after_retries',
            profile_url: safety.observedUrl,
            note_chars: note.length,
            connectable: true,
            delivery_verified: verified,
            matched_invitation_name: sentProbe?.matchedName || '',
            matched_invitation_url: sentProbe?.matchedUrl || '',
        }];
    },
});

export const __test__ = {
    normalizeWhitespace,
    normalizeName,
    matchInvitationName,
    canonicalizeLinkedInProfileUrl,
    canonicalizeLinkedInInviteUrl,
    unwrapEvaluateResult,
    clampNote,
    assessProfileSafety,
    buildProfileProbeScript,
    buildSentInvitationsProbeScript,
};
