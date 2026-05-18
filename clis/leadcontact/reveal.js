import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

const LEADCONTACT_DOMAIN = 'app.leadcontact.ai';
const FINDER_URL = 'https://app.leadcontact.ai/finder';

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
}

function unwrapEvaluateResult(payload) {
  if (payload && typeof payload === 'object' && 'data' in payload && 'session' in payload) return payload.data;
  return payload;
}

function isLinkedInHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'linkedin.com' || host.endsWith('.linkedin.com');
}

function normalizeLinkedInUrl(value) {
  const raw = normalizeWhitespace(value);
  if (!raw) return '';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new ArgumentError('--linkedin must be a valid LinkedIn URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new ArgumentError('--linkedin must be an http(s) URL');
  if (url.username || url.password || url.port || !isLinkedInHost(url.hostname)) {
    throw new ArgumentError('--linkedin must be a linkedin.com URL');
  }
  url.protocol = 'https:';
  if (url.hostname.endsWith('.linkedin.com') || url.hostname === 'linkedin.com') url.hostname = 'www.linkedin.com';
  url.hash = '';
  url.search = '';
  return url.toString();
}

function buildLeadIdentity(args = {}) {
  const linkedinUrl = normalizeLinkedInUrl(args.linkedin || args['linkedin-url'] || args.profile || '');
  const name = normalizeWhitespace(args.name);
  const company = normalizeWhitespace(args.company);
  if (linkedinUrl) return { mode: 'linkedin', linkedin_url: linkedinUrl, name, company };
  if (name && company) return { mode: 'name_company', name, company, linkedin_url: '' };
  throw new ArgumentError('Provide either --linkedin or both --name and --company');
}

function extractEmails(text) {
  const emails = String(text || '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  return Array.from(new Set(emails.map((email) => email.trim()).filter(Boolean)));
}

function extractPhones(text) {
  const patterns = [
    /\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*(?:x|ext|extension)\s*\d{1,6})?/gi,
    /\+\d{1,3}\s?\d{2,4}\*{2,}\d{2,4}/gi,
    /\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\*{3,}[\s.-]?\d{4}/gi,
    /\+?1?[\s.-]?\d{3}\*{3,}\d{4}/gi,
  ];
  const raw = String(text || '');
  const matches = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of raw.matchAll(pattern)) {
      const phone = normalizeWhitespace(match[0]);
      const digitCount = (phone.match(/\d/g) || []).length;
      if (digitCount >= 7) matches.push({ phone, index: match.index ?? raw.indexOf(match[0]) });
    }
  }
  matches.sort((a, b) => a.index - b.index);
  const found = [];
  for (const { phone } of matches) if (!found.includes(phone)) found.push(phone);
  return found;
}

function classifyPhoneType(phoneText) {
  const p = normalizeWhitespace(phoneText);
  if (!p) return '';
  if (/[*∗✱•●＊﹡⋆✶✷]/.test(p)) return 'masked';
  const digits = p.replace(/\D/g, '');
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (/^(800|833|844|855|866|877|888)/.test(national)) return 'company line';
  if (p.includes(';') || p.includes('/')) return 'company line';
  return 'unknown';
}

function statusFromContacts(emails, phones) {
  if (emails.length && phones.length) return 'email_phone_found';
  if (emails.length) return 'email_found';
  if (phones.length) return 'phone_found';
  return 'no_contact_found';
}

function parseCredits(text) {
  return Array.from(new Set(String(text || '').match(/\d+\/\d+/g) || []));
}

function parseRevealText(text, identity = {}, clickedReveal = false) {
  const emails = extractEmails(text);
  const phones = extractPhones(text);
  const firstName = normalizeWhitespace(identity.name).split(' ')[0].toLowerCase();
  const body = String(text || '').toLowerCase();
  const foundByIdentity = Boolean(firstName && body.includes(firstName))
    || Boolean(identity.company && body.includes(normalizeWhitespace(identity.company).toLowerCase()))
    || Boolean(identity.linkedin_url && body.includes(identity.linkedin_url.toLowerCase()));
  return {
    name: normalizeWhitespace(identity.name),
    company: normalizeWhitespace(identity.company),
    linkedin_url: normalizeWhitespace(identity.linkedin_url),
    leadcontact_found: Boolean(emails.length || phones.length || foundByIdentity),
    clicked_reveal: Boolean(clickedReveal),
    emails: emails.join(';'),
    phones: phones.join(';'),
    phone_type: classifyPhoneType(phones.join(';')),
    credits_text: parseCredits(text).join(';'),
    status: statusFromContacts(emails, phones),
  };
}

function leadContactAutomationScript(identity, options = {}) {
  return String.raw`(async () => {
    const identity = ${JSON.stringify(identity)};
    const options = ${JSON.stringify(options)};
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visible = (el) => {
      if (!el || !el.getBoundingClientRect) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const textOf = (el) => ((el && el.innerText) || '').trim();
    const bodyText = () => (document.body ? document.body.innerText : '');
    const findButton = (predicate) => [...document.querySelectorAll('button')].find((b) => visible(b) && predicate(textOf(b), b));
    const clickButton = (predicate) => {
      const b = findButton(predicate);
      if (!b) return false;
      b.click();
      return true;
    };
    const openFilter = async (label) => {
      const b = [...document.querySelectorAll('button.collapse-trigger,button')]
        .find((el) => visible(el) && textOf(el).split(String.fromCharCode(10))[0] === label);
      if (!b) return false;
      b.click();
      await wait(350);
      return true;
    };
    const fillInput = async (placeholderPart, value) => {
      const wanted = String(placeholderPart).toLowerCase();
      let inp = null;
      for (let attempt = 0; attempt < 12 && !inp; attempt += 1) {
        const inputs = [...document.querySelectorAll('input')]
          .filter((el) => visible(el) && (el.getAttribute('type') || '').toLowerCase() !== 'hidden');
        inp = inputs.find((el) => {
          const meta = [el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.name, el.id]
            .filter(Boolean).join(' ').toLowerCase();
          return meta.includes(wanted);
        }) || (inputs.length === 1 ? inputs[0] : null);
        if (!inp) await wait(250);
      }
      if (!inp) return false;
      inp.focus();
      inp.value = '';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.value = value;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };

    if (location.hostname !== 'app.leadcontact.ai') location.href = ${JSON.stringify(FINDER_URL)};
    else if (!location.pathname.includes('/finder')) location.href = ${JSON.stringify(FINDER_URL)};
    await wait(options.initialWaitMs || 4000);
    if (location.hostname !== 'app.leadcontact.ai') {
      return { authRequired: true, href: location.href, text: 'LeadContact navigation did not land on app.leadcontact.ai' };
    }

    const initialText = bodyText();
    if (/sign\s*in|log\s*in|login/i.test(initialText) && !/Search Contacts|Contacts LinkedIn URL|Reveal/i.test(initialText)) {
      return { authRequired: true, href: location.href, text: initialText.slice(0, 2000) };
    }

    clickButton((txt) => txt === 'Clear All' || txt === 'Clear all');
    await wait(700);

    const actions = [];
    if (identity.mode === 'linkedin') {
      actions.push(['open_linkedin', await openFilter('Contacts LinkedIn URL')]);
      let linkedInFilled = await fillInput('LinkedIn', identity.linkedin_url);
      if (!linkedInFilled) {
        await openFilter('Contacts LinkedIn URL');
        linkedInFilled = await fillInput('LinkedIn', identity.linkedin_url);
      }
      actions.push(['fill_linkedin', linkedInFilled]);
    } else {
      actions.push(['open_name', await openFilter('Name')]);
      actions.push(['open_company', await openFilter('Company')]);
      actions.push(['fill_name', await fillInput('full name', identity.name)]);
      actions.push(['fill_company', await fillInput('name or domain', identity.company)]);
    }
    await wait(500);
    const failedAction = actions.find(([, ok]) => !ok);
    if (failedAction) {
      return { error: 'LeadContact filter action failed: ' + failedAction[0], href: location.href, actions, text: bodyText().slice(0, 4000) };
    }
    const searched = clickButton((txt) => txt === 'Search Contacts');
    if (!searched) return { error: 'Search Contacts button not found', href: location.href, actions, text: bodyText().slice(0, 4000) };
    await wait(options.searchWaitMs || 10000);

    const beforeText = bodyText();
    const fullName = String(identity.name || '').toLowerCase();
    const company = String(identity.company || '').toLowerCase();
    const linkedinUrl = String(identity.linkedin_url || '').toLowerCase();
    const linkedinPath = linkedinUrl ? (() => { try { return new URL(linkedinUrl).pathname.toLowerCase().replace(/\/$/, ''); } catch (_) { return ''; } })() : '';
    const matchesIdentity = (text) => {
      const haystack = String(text || '').toLowerCase();
      if (linkedinUrl && (haystack.includes(linkedinUrl) || (linkedinPath && haystack.includes(linkedinPath)))) return true;
      if (fullName && company) return haystack.includes(fullName) && haystack.includes(company);
      if (fullName) return haystack.includes(fullName);
      return Boolean(company && haystack.includes(company));
    };
    const candidateContainer = (button) => {
      let node = button.parentElement;
      for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
        const text = textOf(node);
        if (text && text.length < 12000 && matchesIdentity(text)) return node;
      }
      return null;
    };
    const revealButtons = [...document.querySelectorAll('button')]
      .filter((b) => visible(b) && /\breveal\b/i.test(textOf(b)));
    const matchedContainers = revealButtons
      .map((button) => ({ button, match: candidateContainer(button) }))
      .filter((entry) => entry.match);
    const uniqueScopes = [...new Set(matchedContainers.map((entry) => entry.match))];
    if (uniqueScopes.length > 1) {
      return { error: 'Multiple matching LeadContact result containers found; refusing to reveal ambiguously', href: location.href, actions, text: beforeText.slice(0, 4000), revealCount: revealButtons.length };
    }
    let scope = uniqueScopes[0] || null;
    if (!scope && revealButtons.length === 1) scope = revealButtons[0].parentElement;
    if (!scope && revealButtons.length > 1) {
      return { error: 'Multiple Reveal buttons found but no result matched the requested identity', href: location.href, actions, text: beforeText.slice(0, 4000), revealCount: revealButtons.length };
    }
    let clickedReveal = false;
    const scopedRevealButtons = scope
      ? [...scope.querySelectorAll('button')].filter((b) => visible(b) && /\breveal\b/i.test(textOf(b)))
      : revealButtons;
    const maxRevealClicks = Math.max(1, Math.min(3, Number(options.maxRevealClicks || 3)));
    if (scopedRevealButtons.length) {
      for (const button of scopedRevealButtons.slice(0, maxRevealClicks)) {
        try { button.click(); clickedReveal = true; await wait(900); } catch (_) {}
      }
      await wait(options.revealWaitMs || 14000);
    }
    const scopedText = scope ? textOf(scope) : '';
    if (scope && !scopedText) {
      return { error: 'Matched LeadContact result container became unreadable after reveal', href: location.href, actions, text: beforeText.slice(0, 4000), revealCount: scopedRevealButtons.length };
    }
    const finalText = scope ? scopedText : bodyText();
    return {
      href: location.href,
      actions,
      searched,
      revealCount: scopedRevealButtons.length || revealButtons.length,
      clickedReveal,
      beforeText: beforeText.slice(0, 12000),
      text: finalText.slice(0, 30000),
      credits: bodyText().match(/\d+\/\d+/g) || [],
    };
  })()`;
}

cli({
  site: 'leadcontact',
  name: 'reveal',
  access: 'write',
  description: 'Reveal email and phone contact data from app.leadcontact.ai by LinkedIn URL or name plus company',
  domain: LEADCONTACT_DOMAIN,
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'linkedin', type: 'string', required: false, help: 'LinkedIn profile URL to search in LeadContact' },
    { name: 'name', type: 'string', required: false, help: 'Lead full name. Required with --company when --linkedin is omitted' },
    { name: 'company', type: 'string', required: false, help: 'Lead company. Required with --name when --linkedin is omitted' },
  ],
  columns: ['status', 'name', 'company', 'linkedin_url', 'emails', 'phones', 'phone_type', 'leadcontact_found', 'clicked_reveal', 'reveal_count', 'credits_text', 'href', 'actions', 'error'],
  navigateBefore: FINDER_URL,
  func: async (page, args) => {
    if (!page) throw new CommandExecutionError('Browser session required for leadcontact reveal');
    const identity = buildLeadIdentity(args);
    await page.goto(FINDER_URL);
    await page.wait(4);
    const result = unwrapEvaluateResult(await page.evaluate(leadContactAutomationScript(identity, {
      initialWaitMs: 2000,
      searchWaitMs: 10000,
      revealWaitMs: 14000,
      maxRevealClicks: 3,
    })));
    if (result?.authRequired) {
      throw new AuthRequiredError(LEADCONTACT_DOMAIN, 'LeadContact login required. Open app.leadcontact.ai/finder in the automation Chrome and sign in.');
    }
    if (result?.error) throw new CommandExecutionError('LeadContact reveal failed', result.error + (result.text ? `\n${result.text}` : ''));
    const parsed = parseRevealText(result?.text || '', identity, Boolean(result?.clickedReveal));
    return [{
      ...parsed,
      reveal_count: Number(result?.revealCount || 0),
      credits_text: (Array.isArray(result?.credits) ? Array.from(new Set(result.credits)) : parseCredits(result?.text)).join(';') || parsed.credits_text,
      href: normalizeWhitespace(result?.href || ''),
      actions: Array.isArray(result?.actions) ? JSON.stringify(result.actions) : '',
      error: '',
    }];
  },
});

export const __test__ = {
  normalizeWhitespace,
  normalizeLinkedInUrl,
  buildLeadIdentity,
  extractEmails,
  extractPhones,
  classifyPhoneType,
  statusFromContacts,
  parseRevealText,
  leadContactAutomationScript,
};
