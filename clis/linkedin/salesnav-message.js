import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

const LINKEDIN_DOMAIN = 'www.linkedin.com';
const SALES_HOME = 'https://www.linkedin.com/sales/';
const PROFILE_DECO = '(entityUrn,objectUrn,firstName,lastName,fullName,headline,degree,inmailRestriction,memberBadges,defaultPosition)';
const CREDITS_URL = 'https://www.linkedin.com/sales-api/salesApiCredits?q=findCreditGrant&creditGrantType=LSS_INMAIL';
const MESSAGE_ACTION_URL = 'https://www.linkedin.com/sales-api/salesApiMessageActions?action=createMessage';

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
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

function isLinkedInHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'linkedin.com' || host.endsWith('.linkedin.com');
}

function parseSalesProfileUrn(value) {
  const raw = normalizeWhitespace(value);
  const match = raw.match(/^urn:li:fs_salesProfile:\(([^,()]+),([^,()]+),([^,()]+)\)$/);
  if (!match) return null;
  if (!isResolvedSalesProfileParts(match[1], match[2], match[3])) return null;
  return { profileId: match[1], authType: match[2], authToken: match[3], entityUrn: raw };
}

function isResolvedSalesProfileParts(profileId, authType, authToken) {
  return [profileId, authType, authToken].every((part) => {
    const clean = normalizeWhitespace(part).toLowerCase();
    return clean && clean !== 'undefined' && clean !== 'null' && clean !== 'not_available';
  });
}

function salesLeadUrlFromParts({ profileId, authType, authToken }) {
  return `https://www.linkedin.com/sales/lead/${encodeURIComponent(profileId)},${encodeURIComponent(authType)},${encodeURIComponent(authToken)}`;
}

function parseRecipient(value) {
  const raw = normalizeWhitespace(value);
  const urn = parseSalesProfileUrn(raw);
  if (urn) return urn;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !isLinkedInHost(url.hostname)) return null;
    const salesMatch = url.pathname.match(/^\/sales\/lead\/([^,/]+),([^,/]+),([^/]+)\/?$/i);
    if (salesMatch) {
      const profileId = decodeURIComponent(salesMatch[1]);
      const authType = decodeURIComponent(salesMatch[2]);
      const authToken = decodeURIComponent(salesMatch[3]);
      if (!isResolvedSalesProfileParts(profileId, authType, authToken)) return null;
      return { profileId, authType, authToken, entityUrn: `urn:li:fs_salesProfile:(${profileId},${authType},${authToken})` };
    }
    const profileMatch = url.pathname.match(/^\/in\/([^/]+)\/?$/i);
    if (profileMatch) {
      return { profileId: decodeURIComponent(profileMatch[1]), authType: '', authToken: '', entityUrn: '' };
    }
  } catch {
    return null;
  }
  return null;
}

function encodeRestliDecoration(value) {
  return encodeURIComponent(value).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

function profileApiUrl(recipient) {
  if (!recipient?.profileId || !recipient?.authType || !recipient?.authToken) return '';
  const key = `(profileId:${recipient.profileId},authType:${recipient.authType},authToken:${recipient.authToken})`;
  return `https://www.linkedin.com/sales-api/salesApiProfiles/${key}?decoration=${encodeRestliDecoration(PROFILE_DECO)}`;
}

function randomTrackingId() {
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function buildCreateMessagePayload({ recipientUrn, subject, body, trackingId = randomTrackingId(), copyToCrm = false }) {
  const cleanRecipient = normalizeWhitespace(recipientUrn);
  if (!parseSalesProfileUrn(cleanRecipient)) throw new ArgumentError('--recipient must resolve to a Sales Navigator lead urn');
  const cleanSubject = normalizeWhitespace(subject);
  const cleanBody = String(body ?? '').trim();
  if (!cleanSubject) throw new ArgumentError('--subject is required');
  if (!cleanBody) throw new ArgumentError('--body is required');
  if (cleanSubject.length > 200) throw new ArgumentError('--subject must be 200 characters or fewer');
  if (cleanBody.length > 1900) throw new ArgumentError('--body must be 1900 characters or fewer');
  return {
    createMessageRequest: {
      recipients: [cleanRecipient],
      subject: cleanSubject,
      body: cleanBody,
      copyToCrm: Boolean(copyToCrm),
      trackingId,
    },
  };
}

function extractRemainingCredits(json) {
  const elements = Array.isArray(json?.elements) ? json.elements : [];
  const inmailGrant = elements.find((el) => el?.type === 'LSS_INMAIL' && Number.isInteger(el.value));
  if (inmailGrant) return inmailGrant.value;
  const candidates = [];
  const visit = (value) => {
    if (value === null || value === undefined) return;
    if (typeof value === 'number' && Number.isFinite(value)) candidates.push(value);
    if (Array.isArray(value)) value.forEach(visit);
    else if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (/remaining|available|balance|value/i.test(key) && typeof child === 'number') candidates.unshift(child);
        else if (!/^count$|^start$|^id$/i.test(key)) visit(child);
      }
    }
  };
  visit(json);
  return candidates.find((n) => Number.isInteger(n) && n >= 0) ?? null;
}

function fetchJsonScript(url, csrf, options = {}) {
  return String.raw`(async () => {
    const headers = {
      'csrf-token': ${JSON.stringify(csrf)},
      'x-restli-protocol-version': '2.0.0',
      accept: ${JSON.stringify(options.accept || 'application/json')},
      ...((${JSON.stringify(Boolean(options.body))}) ? { 'content-type': 'application/json' } : {}),
    };
    try {
      const res = await fetch(${JSON.stringify(url)}, {
        credentials: 'include',
        method: ${JSON.stringify(options.method || 'GET')},
        headers,
        body: ${options.body ? JSON.stringify(JSON.stringify(options.body)) : 'undefined'},
      });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
      if (res.status === 401 || res.status === 403) return ['auth', res.status, json, text];
      if (!res.ok) return ['error', res.status, json, text, 'HTTP ' + res.status];
      return ['ok', res.status, json, text];
    } catch (e) {
      return ['error', 0, null, '', 'fetch failed: ' + ((e && e.message) || String(e))];
    }
  })()`;
}

function requireFetchResult(result, label, { requireJson = true } = {}) {
  if (Array.isArray(result)) {
    const [kind, status, json, text, error] = result;
    result = {
      authRequired: kind === 'auth',
      error: kind === 'error' ? error || `HTTP ${status}` : '',
      status,
      json,
      text,
    };
  }
  if (result?.authRequired) throw new AuthRequiredError(LINKEDIN_DOMAIN, `${label} auth failed.`);
  if (result?.error) throw new CommandExecutionError(`${label} failed`, result.error);
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new CommandExecutionError(`${label} returned malformed response`);
  }
  if (requireJson && (!result.json || typeof result.json !== 'object' || Array.isArray(result.json))) {
    throw new CommandExecutionError(`${label} returned malformed response`, 'missing_json');
  }
  return result;
}

function salesPageShowsSentMessage(text, recipientName) {
  const normalizedText = normalizeWhitespace(text);
  const firstName = normalizeWhitespace(recipientName).split(' ')[0];
  return normalizedText.includes('You sent a Sales Navigator message')
    && (!firstName || normalizedText.includes(firstName));
}

async function getCsrf(page) {
  const cookies = await page.getCookies({ url: 'https://www.linkedin.com' });
  const jsession = cookies.find((c) => c.name === 'JSESSIONID')?.value;
  if (!jsession) throw new AuthRequiredError(LINKEDIN_DOMAIN, 'LinkedIn JSESSIONID cookie not found. Please sign in to LinkedIn.');
  return jsession.replace(/^\"|\"$/g, '');
}

async function resolveRecipient(page, parsed, csrf) {
  if (!parsed) throw new ArgumentError('--recipient must be a Sales Navigator lead URL, Sales Navigator profile URL, LinkedIn /in/ URL, or urn:li:fs_salesProfile:(...)');
  if (parsed.entityUrn && parsed.authType && parsed.authToken) return parsed;

  await page.goto(`https://www.linkedin.com/sales/lead/${encodeURIComponent(parsed.profileId)}`);
  await page.wait(6);
  const probe = unwrapEvaluateResult(await page.evaluate(String.raw`(() => {
    const href = location.href;
    const text = document.body ? document.body.innerText : '';
    const resourceUrns = Array.from(performance.getEntriesByType('resource'))
      .map((entry) => entry.name)
      .filter((name) => name.includes('/sales-api/salesApiProfiles/'))
      .slice(-20);
    return { href, text: text.slice(0, 1000), resourceUrns };
  })()`));
    const urlMatch = String(probe?.href || '').match(/\/sales\/lead\/([^,/]+),([^,/]+),([^/?#]+)/i);
  if (urlMatch && isResolvedSalesProfileParts(urlMatch[1], urlMatch[2], urlMatch[3])) {
    return {
      profileId: decodeURIComponent(urlMatch[1]),
      authType: decodeURIComponent(urlMatch[2]),
      authToken: decodeURIComponent(urlMatch[3]),
      entityUrn: `urn:li:fs_salesProfile:(${decodeURIComponent(urlMatch[1])},${decodeURIComponent(urlMatch[2])},${decodeURIComponent(urlMatch[3])})`,
    };
  }
  for (const resource of probe?.resourceUrns || []) {
    const resourceMatch = String(resource).match(/profileId:([^,)]+),authType:([^,)]+),authToken:([^,)]+)\)/);
    if (resourceMatch && resourceMatch[1] === parsed.profileId) {
      return {
        profileId: resourceMatch[1],
        authType: resourceMatch[2],
        authToken: resourceMatch[3],
        entityUrn: `urn:li:fs_salesProfile:(${resourceMatch[1]},${resourceMatch[2]},${resourceMatch[3]})`,
      };
    }
  }
  void csrf;
  throw new CommandExecutionError('Could not resolve Sales Navigator auth token for recipient', `Observed URL: ${probe?.href || 'url_not_available'}\nBody: ${normalizeWhitespace(probe?.text || '').slice(0, 500)}`);
}

function profileSummary(json) {
  const data = json?.data || json || {};
  const pos = data.defaultPosition || (Array.isArray(data.positions) ? data.positions.find((p) => p.current) || data.positions[0] : {}) || {};
  return {
    recipient: normalizeWhitespace(data.fullName || [data.firstName, data.lastName].filter(Boolean).join(' ')),
    title: normalizeWhitespace(pos.title || data.headline || ''),
    company: normalizeWhitespace(pos.companyName || pos.company?.name || ''),
    degree: normalizeWhitespace(data.degree || ''),
    inmail_restriction: normalizeWhitespace(data.inmailRestriction || ''),
    open_link: Boolean(data.memberBadges?.openLink),
  };
}

function requireProfileSummary(json) {
  const summary = profileSummary(json);
  if (!summary.recipient) {
    throw new CommandExecutionError('Sales Navigator profile lookup returned malformed profile data', 'missing_recipient_name');
  }
  return summary;
}

cli({
  site: 'linkedin',
  name: 'salesnav-message',
  access: 'write',
  description: 'Send or dry-run a LinkedIn Sales Navigator InMail to a lead using the Sales Navigator messaging API',
  domain: LINKEDIN_DOMAIN,
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'recipient', type: 'string', required: true, positional: true, help: 'Sales Navigator lead URL, LinkedIn /in/ URL from salesnav-search, or urn:li:fs_salesProfile:(...)' },
    { name: 'subject', type: 'string', required: true, help: 'InMail subject' },
    { name: 'body', type: 'string', required: true, help: 'InMail body' },
    { name: 'send', type: 'bool', default: false, help: 'Actually send the InMail. Default is dry-run validation only.' },
    { name: 'copy-to-crm', type: 'bool', default: false, help: 'Set Sales Navigator copyToCrm on the message request' },
  ],
  columns: ['status', 'recipient', 'title', 'company', 'credits_remaining', 'credits_before', 'credits_after', 'sent_in_salesnav', 'message_chars', 'subject_chars', 'recipient_urn', 'degree', 'inmail_restriction', 'open_link'],
  func: async (page, args) => {
    if (!page) throw new CommandExecutionError('Browser session required for linkedin salesnav-message');
    const recipientArg = requireStringArg(args, 'recipient', '--recipient');
    const subject = requireStringArg(args, 'subject', '--subject');
    const body = String(args.body ?? '').trim();
    if (!body) throw new ArgumentError('--body is required');

    await page.goto(SALES_HOME);
    await page.wait(4);
    const csrf = await getCsrf(page);
    const recipient = await resolveRecipient(page, parseRecipient(recipientArg), csrf);

    let summary = { recipient: '', title: '', company: '', degree: '', inmail_restriction: '', open_link: false };
    const profileUrl = profileApiUrl(recipient);
    if (profileUrl) {
      const profileResult = requireFetchResult(unwrapEvaluateResult(await page.evaluate(fetchJsonScript(profileUrl, csrf))), 'LinkedIn Sales Navigator profile API');
      summary = requireProfileSummary(profileResult.json);
    }
    if (summary.inmail_restriction && summary.inmail_restriction !== 'NO_RESTRICTION') {
      throw new CommandExecutionError('Sales Navigator InMail blocked by recipient restriction', summary.inmail_restriction);
    }

    const creditsResult = requireFetchResult(unwrapEvaluateResult(await page.evaluate(fetchJsonScript(CREDITS_URL, csrf))), 'LinkedIn Sales Navigator credits API');
    const creditsRemaining = extractRemainingCredits(creditsResult?.json);

    const payload = buildCreateMessagePayload({ recipientUrn: recipient.entityUrn, subject, body, copyToCrm: args['copy-to-crm'] });
    if (!args.send) {
      return [{
        status: 'validated_dry_run',
        recipient: summary.recipient,
        title: summary.title,
        company: summary.company,
        credits_remaining: creditsRemaining,
        credits_before: creditsRemaining,
        credits_after: '',
        sent_in_salesnav: false,
        message_chars: body.length,
        subject_chars: subject.length,
        recipient_urn: recipient.entityUrn,
        degree: summary.degree,
        inmail_restriction: summary.inmail_restriction,
        open_link: summary.open_link,
      }];
    }

    const sendResult = requireFetchResult(unwrapEvaluateResult(await page.evaluate(fetchJsonScript(MESSAGE_ACTION_URL, csrf, {
      method: 'POST',
      accept: 'application/vnd.linkedin.normalized+json+2.1',
      body: payload,
    }))), 'LinkedIn Sales Navigator message API', { requireJson: false });
    void sendResult;
    await page.wait(3);
    const creditsAfterResult = requireFetchResult(unwrapEvaluateResult(await page.evaluate(fetchJsonScript(CREDITS_URL, csrf))), 'LinkedIn Sales Navigator credits API after send');
    const creditsAfter = extractRemainingCredits(creditsAfterResult?.json);
    await page.goto(salesLeadUrlFromParts(recipient));
    await page.wait(6);
    const salesPageText = unwrapEvaluateResult(await page.evaluate('document.body ? document.body.innerText : ""'));
    const sentInSalesNav = salesPageShowsSentMessage(salesPageText, summary.recipient);
    if (!sentInSalesNav) throw new CommandExecutionError('Sales Navigator post-send verification failed', 'Sent activity was not found on the Sales Navigator lead page.');
    return [{
      status: 'sent',
      recipient: summary.recipient,
      title: summary.title,
      company: summary.company,
      credits_remaining: creditsAfter,
      credits_before: creditsRemaining,
      credits_after: creditsAfter,
      sent_in_salesnav: sentInSalesNav,
      message_chars: body.length,
      subject_chars: subject.length,
      recipient_urn: recipient.entityUrn,
      degree: summary.degree,
      inmail_restriction: summary.inmail_restriction,
      open_link: summary.open_link,
    }];
  },
});

export const __test__ = {
  normalizeWhitespace,
  parseSalesProfileUrn,
  isResolvedSalesProfileParts,
  parseRecipient,
  salesLeadUrlFromParts,
  profileApiUrl,
  buildCreateMessagePayload,
  extractRemainingCredits,
  profileSummary,
  requireProfileSummary,
  salesPageShowsSentMessage,
};
