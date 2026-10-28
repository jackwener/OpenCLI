import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { LINKEDIN_AUTH_WALL_JS, unwrapEvaluateResult } from './shared.js';
import { gotoResilient } from '@jackwener/opencli/browser/utils';

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

// Shared by BOTH in-page scripts below: how an expected name becomes tokens, and which controls
// belong to the profile owner. The dry-run probe and the send path used to resolve the owner
// separately, and on 2026-08-31 only the probe learned to find the 2026 action bar. From 2026-09-17
// the dry-run therefore reported profiles connectable via More while the send, still looking in the
// Follow button's bare parent, refused every one of them with owner_more_button_not_found. With one
// resolution the send acts on exactly the scope the dry-run verified.
//
// Page-side contract: clean() is defined before OWNER_NAME_JS; ariaLabel(), labelOf() and
// namesOwner() are defined before OWNER_SCOPE_JS.
const OWNER_NAME_JS = String.raw`
    const normalizeName = (s) => clean(s)
      .replace(/\s*[•·]\s*(?:1st|2nd|3rd\+?|degree connection).*$/i, '')
      .replace(/\s+LinkedIn.*$/i, '')
      .replace(/\b(p\.?eng\.?|cpa|mba|ph\.?d\.?)\b/ig, '')
      .replace(/[^\p{L}\p{N}\s.'-]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const tokens = (s) => normalizeName(s).replace(/[.'-]+/g, ' ').split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 2);
`;

const OWNER_SCOPE_JS = String.raw`
    // Find the profile's action bar WITHOUT depending on class names. The 2026 markup obfuscates
    // them (classes like _02c5e36f), so none of the selectors below match any more and the old
    // parentElement fallback landed on a wrapper holding only the primary button.
    // On a profile whose primary action is Follow, that put the Connect "More" menu outside the
    // scope entirely: seven of twenty-six real profiles came back connect_button_not_found on
    // 2026-08-31 while visibly showing the control. The action bar is instead the nearest ancestor
    // holding two or more distinct action controls — true whatever this month's class names are,
    // and far narrower than falling back to <main>, which drags in "People also viewed".
    const ACTION_LABEL = /^(connect|follow|message|more|pending)$/i;
    // A control that positively names SOMEONE ELSE. "People also viewed" and the sidebar render
    // "Invite <name> to connect" / "Follow <name>" for other members, so a scope containing one of
    // these is not this profile's action bar however plausible its shape.
    const namesAnotherMember = (el) => {
      const aria = ariaLabel(el);
      if (!aria) return false;
      if (!/invite .* to connect/i.test(aria) && !/^(follow|message)\s+\S/i.test(aria)) return false;
      return !namesOwner(el);
    };
    const controlsIn = (node) => (node && node.querySelectorAll
      ? Array.from(node.querySelectorAll('button, [role="button"], a')).filter((el) => el.offsetParent !== null)
      : []);
    const actionCountIn = (node) => {
      const labels = controlsIn(node).map((el) => labelOf(el)).filter((label) => ACTION_LABEL.test(label));
      return new Set(labels.map((label) => label.toLowerCase())).size;
    };
    // Bound the walk by IDENTITY rather than by depth. Depth is the thing LinkedIn changes: on the
    // 2026 markup the action bar renders OUTSIDE <main>, so a node !== main guard never fires and
    // the whole-main test alone is dead code, leaving a bare depth cap two levels short of the
    // first ancestor that holds another member's Connect button. Identity is the property that
    // actually matters, so refuse any candidate containing a control naming someone else and let
    // the old parentElement fallback stand — a quiet not_connectable beats inviting a stranger.
    const actionBarOf = (el) => {
      let node = el;
      for (let depth = 0; depth < 8 && node && node.parentElement; depth += 1) {
        node = node.parentElement;
        if (controlsIn(node).some(namesAnotherMember)) return null;
        if (actionCountIn(node) >= 2) return node;
      }
      return null;
    };
    // The owner's action scope. wholeMain says it cannot be trusted: it is the whole <main>, which
    // also holds the "People also viewed" controls, or it contains another member's control. Not
    // just scope === main: measured live, the 2026 action bar is not inside <main> at all, so that
    // test could never be true and the sidebar protection it gates was inert.
    const resolveOwnerScope = (controls, main) => {
      const heading = main?.querySelector('h1, .text-heading-xlarge, [class*="heading-xlarge"]');
      const topCard = main?.querySelector('.pv-top-card, [class*="top-card"]')
        || heading?.closest?.('section, .ph5, [class*="top-card"]')
        || main;
      const ownerAction = controls.find((el) => namesOwner(el) && /^(invite|connect|follow|message|more|pending)\b/i.test(ariaLabel(el)));
      const scope = ownerAction
        ? (ownerAction.closest('[class*="profile-actions"], [class*="pvs-profile-actions"], .pv-top-card, .ph5, section')
          || actionBarOf(ownerAction)
          || ownerAction.parentElement
          || topCard)
        : topCard;
      const wholeMain = scope === main || controlsIn(scope).some(namesAnotherMember);
      return { topCard, ownerAction, scope, wholeMain };
    };
`;

// Shared by BOTH in-page scripts: binds an invitation link's ?vanityName= to THIS profile (see the
// probe's connectAnchor). The top card's anchor and the More menu's link are the same route.
const OWNER_HREF_JS = String.raw`
    const ownVanity = String((location.pathname.match(/\/in\/([^/]+)/) || [])[1] || '').toLowerCase();
    const hrefTargetsOwner = (href) => {
      const raw = String(href || '');
      const match = raw.match(/[?&]vanityName=([^&]+)/i);
      if (!match) return true;                       // no recipient encoded: nothing to contradict
      if (!ownVanity) return false;                  // cannot prove it is ours: refuse
      return decodeURIComponent(match[1]).toLowerCase() === ownVanity;
    };
`;

function buildProfileProbeScript(expectedName = '') {
    return String.raw`(() => {
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
    const expectedName = ${JSON.stringify(expectedName)};
    ${OWNER_NAME_JS}
    const text = document.body ? (document.body.innerText || '') : '';
    ${LINKEDIN_AUTH_WALL_JS}
    const authRequired = linkedInAuthWall();
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
    ${OWNER_SCOPE_JS}
    const { topCard, scope: ownerScope, wholeMain: scopeIsWholeMain } = resolveOwnerScope(buttons, main);
    const scopedButtons = Array.from(ownerScope?.querySelectorAll?.('button, [role="button"], a') || []).filter((el) => el.offsetParent !== null);
    const ownerButtons = Array.from(new Set([...buttons.filter(namesOwner), ...scopedButtons]));
    const lowerOwnerLabels = ownerButtons.map((button) => labelOf(button).toLowerCase()).filter(Boolean);
    const pending = lowerOwnerLabels.some((label) => label === 'pending' || label.includes('pending'));
    const connectAvailable = ownerButtons.some((el) => {
      const label = labelOf(el).toLowerCase();
      const aria = ariaLabel(el).toLowerCase();
      const generic = label === 'connect' || label.startsWith('connect ');
      return (generic && (!scopeIsWholeMain || namesOwner(el)))
        || (/invite .* to connect/i.test(aria) && namesOwner(el));
    });
    // When "Follow" is the primary action, Connect is tucked inside the "More" actions
    // menu rather than shown as a top-level button. Note the menu's presence so the safety
    // check can treat the profile as connectable; the send step opens the menu and confirms.
    const moreAvailable = !scopeIsWholeMain
      && lowerOwnerLabels.some((label) => label === 'more' || label.startsWith('more '));
    // A visible "Message" button is NOT proof of an existing connection: LinkedIn shows
    // Message on many 2nd/3rd-degree profiles (open profiles, Premium, recruiter) right
    // next to a real "Connect" button. The reliable signal for a 1st-degree connection is
    // the degree badge ("1st degree connection") in the top card. Scope to the top card so
    // the "People also viewed" sidebar (which lists other members' degrees) cannot bleed in,
    // and never call it connected when a Connect affordance is present.
    const topCardRaw = clean(topCard?.textContent || '');
    // 2026 profile markup shows the degree as a "· 1st" badge right after the
    // owner's name instead of "1st degree connection" text. Read only the few
    // characters that follow the name so sidebar degrees cannot bleed in.
    const mainRaw = clean(main?.innerText || '');
    const nameAt = name ? mainRaw.indexOf(name) : -1;
    const afterName = nameAt >= 0 ? mainRaw.slice(nameAt + name.length, nameAt + name.length + 24) : '';
    const firstDegreeBadge = /\b1st degree connection\b/i.test(topCardRaw) || /^\s*[·•]\s*1st\b/.test(afterName);
    const alreadyConnected = !connectAvailable && firstDegreeBadge;
    // The Connect control is an <a> linking to LinkedIn's invitation route
    // (/preload/custom-invite/?vanityName=...). Capture it so the sender can
    // navigate straight to the invite dialog.
    // Owner identity required on BOTH branches. The generic one used to accept any <a> labelled
    // "Connect" anywhere in the scope, while connectAvailable above already demanded the owner —
    // and the invite href carries ?vanityName=, which canonicalizeLinkedInInviteUrl preserves and
    // the send path never re-checks. A stranger's anchor therefore meant a real invitation to the
    // wrong member, reported under the intended member's name.
    // The href itself carries the recipient: /preload/custom-invite/?vanityName=<slug>. That is the
    // only identity a bare <a>Connect</a> has - a sidebar anchor need not carry an aria-label at
    // all, so the name checks above cannot see it. Bind it to THIS profile's own slug, because the
    // canonicaliser preserves the query string and the send path never re-checks who it is inviting.
    ${OWNER_HREF_JS}
    const connectAnchor = ownerButtons.find((el) => el.tagName === 'A'
      && hrefTargetsOwner(el.getAttribute('href'))
      && ((/^connect$/i.test(labelOf(el)) && (!scopeIsWholeMain || namesOwner(el)))
        || (/invite .* to connect/i.test(ariaLabel(el)) && namesOwner(el))));
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
    ${LINKEDIN_AUTH_WALL_JS}
    if (linkedInAuthWall()) return { authRequired: true, found: false, matchedName: '', matchedUrl: '', visibleNames: [] };
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
    const inviteDialog = () => {
      const roots = [document, ...Array.from(document.querySelectorAll('*')).filter((e) => e.shadowRoot).map((e) => e.shadowRoot)];
      for (const r of roots) {
        for (const d of r.querySelectorAll('[role="dialog"], [aria-modal="true"]')) {
          const t = clean(d.innerText || d.textContent || '');
          if (/invitation|add a note|send without a note|send now|connect with/i.test(t)) return d;
        }
      }
      return null;
    };
    const dialog = inviteDialog;
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
    ${OWNER_NAME_JS}
    const ariaLabel = (el) => clean(el?.getAttribute('aria-label') || '');
    const textLabel = (el) => clean(el?.innerText || el?.textContent || '');
    const labelOf = (el) => clean(textLabel(el) || ariaLabel(el));
    const expTokens = tokens(expectedName);
    // Require every expected-name token to appear in the control's aria-label, so a
    // sidebar card's "Invite <OtherName> to connect" can never satisfy this.
    const namesOwner = (el) => { const al = ariaLabel(el).toLowerCase(); return expTokens.length >= 1 && expTokens.every((t) => al.includes(t)); };
    ${OWNER_SCOPE_JS}
    ${OWNER_HREF_JS}
    const isConnectText = (el) => /^connect$/i.test(textLabel(el));
    const isOwnerConnect = (el) => /invite .* to connect/i.test(ariaLabel(el)) && namesOwner(el);
    const isMore = (el) => { const l = (ariaLabel(el) || textLabel(el)).toLowerCase(); return l === 'more' || l.startsWith('more '); };
    const inviteDialog = () => {
      const roots = [document, ...Array.from(document.querySelectorAll('*')).filter((e) => e.shadowRoot).map((e) => e.shadowRoot)];
      for (const r of roots) {
        for (const d of r.querySelectorAll('[role="dialog"], [aria-modal="true"]')) {
          const t = clean(d.innerText || d.textContent || '');
          if (/invitation|add a note|send without a note|send now|connect with/i.test(t)) return d;
        }
      }
      return null;
    };
    if (inviteDialog()) return { ok: true, opened: 'already_open' };
    const all = Array.from(document.querySelectorAll('button, [role="button"], a')).filter(visible);
    // 1) A Connect control whose aria-label names the profile owner, wherever it renders.
    let btn = all.find(isOwnerConnect);
    if (!btn) {
      // 2) The owner's action bar, resolved exactly as the dry-run probe resolved it. The probe never
      //    passes a profile whose scope is untrusted (wholeMain), so the send refuses the same scope
      //    rather than guessing inside it.
      const main = document.querySelector('main') || document.body;
      const { scope: bar, wholeMain } = resolveOwnerScope(all, main);
      if (!bar || wholeMain) return { ok: false, reason: 'owner_action_bar_not_found' };
      // 3) Connect under the owner's "More" menu. Open it, then pick Connect from THAT opened menu
      //    only (the dropdown is portaled to the body). A bare "Connect" button in the scope is
      //    never clicked: nothing on it says whose it is, and the one click this path makes is a
      //    real invitation. A profile whose primary Connect names nobody fails closed below.
      const moreBtn = controlsIn(bar).find(isMore);
      if (!moreBtn) return { ok: false, reason: 'owner_more_button_not_found' };
      await jitter();
      moreBtn.click();
      await jitter(700, 1300);
      const menu = Array.from(document.querySelectorAll('[role="menu"], .artdeco-dropdown__content')).filter(visible).pop();
      // The owner's menu is definitive: "Remove connection" means 1st degree, no matter
      // what the top card looked like. Never fall through to a sidebar Connect.
      if (menu && /remove connection/i.test(textLabel(menu))) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return { ok: false, reason: 'already_connected' };
      }
      if (!menu) return { ok: false, reason: 'owner_menu_not_open' };
      // Only real controls, innermost first. The 2026 menu wraps each item in plain <div>s around an
      // <a role="menuitem">, and the old '..., div' selector took the text-only wrapper first. A click
      // bubbles up to its ancestors, never down, so it never reached the link: on 2026-09-19 all seven
      // via-More sends clicked a wrapper, nothing happened, and each came back send_unverified.
      const connects = Array.from(menu.querySelectorAll('[role="menuitem"], [role="button"], button, a')).filter(visible)
        .filter((el) => isOwnerConnect(el) || isConnectText(el) || Array.from(el.querySelectorAll('[aria-label]')).some(isOwnerConnect));
      btn = connects.find((el) => !connects.some((other) => other !== el && el.contains(other)));
      // That link goes to the invitation route, the same one as the top card's Connect anchor. Hand it
      // back so the caller navigates there and drives the same dialog; clicking it here would
      // navigate this page out from under the script.
      const href = btn?.tagName === 'A' ? (btn.getAttribute('href') || '') : '';
      if (/\/preload\/custom-invite\//i.test(href)) {
        if (!hrefTargetsOwner(href)) return { ok: false, reason: 'connect_link_not_owner' };
        return { ok: true, opened: 'invite_link', inviteHref: href };
      }
    }
    if (!btn) return { ok: false, reason: 'connect_control_not_found' };
    await jitter();
    btn.click();
    await jitter(1200, 2000);
    if (inviteDialog()) return { ok: true, opened: 'dialog' };
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

        await gotoResilient(page, profileUrl);
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
        let inviteHref = probe?.connectHref || '';
        if (!inviteHref) {
            // Button-based Connect: no /preload/custom-invite/ anchor in the top card, so open the
            // invite dialog in-page by clicking the Connect control (directly or via More). When the
            // More menu's Connect is itself an invitation link, the script returns the link unclicked.
            const opened = unwrapEvaluateResult(await page.evaluate(buildOpenConnectDialogScript(expectedName)));
            if (!opened?.ok && opened?.reason === 'already_connected') {
                return [{ status: 'not_connectable', recipient: safety.actualValue, reason: 'already_connected', profile_url: safety.observedUrl, note_chars: note.length, connectable: false, delivery_verified: false }];
            }
            if (!opened?.ok) {
                throw new CommandExecutionError(`LinkedIn connect blocked: ${opened?.reason || 'connect_control_not_found'}`);
            }
            if (opened.opened === 'invite_link') {
                // The no-dialog fallback below reads an empty inviteHref as "a control was clicked",
                // so a link result must never leave it empty.
                inviteHref = String(opened.inviteHref || '');
                if (!inviteHref) throw new CommandExecutionError('LinkedIn connect blocked: invalid_connect_link');
            }
            else {
                await page.wait(3);
            }
        }
        if (inviteHref) {
            // Anchor-based Connect: navigate straight to the invitation route, where the
            // "Add a note?" dialog renders already open.
            const inviteUrl = canonicalizeLinkedInInviteUrl(inviteHref);
            if (!inviteUrl) {
                throw new CommandExecutionError('LinkedIn connect blocked: invalid_connect_link');
            }
            await gotoResilient(page, inviteUrl);
            await page.wait(6);
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
            await gotoResilient(page, 'https://www.linkedin.com/mynetwork/invitation-manager/sent/');
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
    clampNote,
    assessProfileSafety,
    buildProfileProbeScript,
    buildOpenConnectDialogScript,
    buildSentInvitationsProbeScript,
};
