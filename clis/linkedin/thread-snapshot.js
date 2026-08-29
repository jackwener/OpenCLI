import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
  canonicalizeLinkedInThreadUrl,
  normalizeWhitespace,
  requireLinkedInCookie,
  unwrapEvaluateResult,
} from './shared.js';

const LINKEDIN_DOMAIN = 'www.linkedin.com';

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

function parseMaxScrolls(value) {
  if (value === undefined || value === null || value === '') return 30;
  const scrolls = Number(value);
  if (!Number.isInteger(scrolls) || scrolls < 0 || scrolls > 80) {
    throw new ArgumentError('--max-scrolls must be an integer between 0 and 80');
  }
  return scrolls;
}

function buildThreadApiDiscoveryScript(maxScrolls) {
  return String.raw`(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const pageText = document.body ? (document.body.innerText || '') : '';
    const authRequired = /\b(sign in|log in|join linkedin)\b/i.test(pageText)
      || /linkedin\.com\/(login|checkpoint|authwall|uas)/i.test(location.href)
      || /captcha|verification required/i.test(pageText);

    const selectors = [
      '.msg-s-message-list',
      '.msg-s-message-list-scrollable',
      '.msg-thread',
      'main [role="main"]',
      'main'
    ];
    let scroller = null;
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && (element.scrollHeight > element.clientHeight || selector === 'main')) {
        scroller = element;
        break;
      }
    }
    scroller = scroller || document.scrollingElement || document.documentElement;

    let previousHeight = -1;
    let stable = 0;
    let attempts = 0;
    for (let index = 0; index < ${maxScrolls}; index += 1) {
      attempts += 1;
      scroller.scrollTop = 0;
      window.scrollTo(0, 0);
      await sleep(750);
      const height = scroller.scrollHeight || document.body.scrollHeight || 0;
      if (height === previousHeight) stable += 1;
      else stable = 0;
      previousHeight = height;
      if (stable >= 3) break;
    }
    await sleep(1000);

    const threadId = (location.pathname.match(/^\/messaging\/thread\/([^/]+)\/?$/i) || [])[1] || '';
    const apiUrls = [];
    const seen = new Set();
    for (const entry of performance.getEntriesByType('resource')) {
      const url = String(entry && entry.name || '');
      if (!/\/voyager\/api\/voyagerMessagingGraphQL\/graphql/i.test(url)) continue;
      if (!/[?&]queryId=messengerMessages\.[a-f0-9]+/i.test(url)) continue;
      let decoded = url;
      try { decoded = decodeURIComponent(url); } catch {}
      if (!threadId || !decoded.includes(threadId) || seen.has(url)) continue;
      seen.add(url);
      apiUrls.push(url);
    }

    return {
      url: location.href,
      title: document.title || '',
      authRequired,
      apiUrls,
      scrollAttempts: attempts,
      scrollStable: ${maxScrolls} === 0 ? null : stable >= 3,
    };
  })()`;
}

function buildFetchThreadPagesScript(apiUrls, csrf) {
  return String.raw`(async () => {
    const urls = ${JSON.stringify(apiUrls)};
    const pages = [];
    for (const url of urls) {
      let response;
      try {
        response = await fetch(url, {
          credentials: 'include',
          headers: {
            'csrf-token': ${JSON.stringify(csrf)},
            accept: 'application/vnd.linkedin.normalized+json+2.1',
            'x-restli-protocol-version': '2.0.0',
          },
        });
      } catch (error) {
        return { error: 'fetch failed: ' + ((error && error.message) || String(error)) };
      }
      if (response.status === 401 || response.status === 403) {
        return { authRequired: true, error: 'HTTP ' + response.status };
      }
      if (!response.ok) return { error: 'HTTP ' + response.status };
      const contentType = response.headers.get('content-type') || '';
      if (!/json|linkedin\.normalized/i.test(contentType)) {
        return { error: 'unexpected content-type: ' + contentType };
      }
      let json;
      try {
        json = await response.json();
      } catch (error) {
        return { error: 'invalid JSON: ' + ((error && error.message) || String(error)) };
      }
      pages.push({ url, json });
    }
    return { pages };
  })()`;
}

function participantName(participant) {
  const type = participant?.participantType || {};
  const member = type.member;
  if (member) {
    return normalizeWhitespace([
      member.firstName?.text,
      member.lastName?.text,
    ].filter(Boolean).join(' '));
  }
  if (type.organization) return normalizeWhitespace(type.organization.name?.text || type.organization.name);
  if (type.agent) return normalizeWhitespace(type.agent.name?.text || type.agent.name);
  if (type.custom) return normalizeWhitespace(type.custom.name?.text || type.custom.name);
  return '';
}

function messageText(message) {
  return normalizeWhitespace(
    message?.body?.text
    || message?.renderContentFallbackText?.text
    || message?.renderContentFallbackText
    || message?.subject?.text
    || message?.subject
    || '',
  );
}

function ownerUrnFromApiUrls(apiUrls) {
  for (const url of apiUrls) {
    let decoded = url;
    try { decoded = decodeURIComponent(url); } catch {}
    const match = decoded.match(/conversationUrn:urn:li:msg_conversation:\((urn:li:fsd_profile:[^,)]+)/i);
    if (match) return match[1];
  }
  return '';
}

function validateThreadApiUrls(apiUrls, threadUrl) {
  const threadId = new URL(threadUrl).pathname.match(/^\/messaging\/thread\/([^/]+)\/?$/i)?.[1] || '';
  if (!Array.isArray(apiUrls) || apiUrls.length === 0) {
    throw new CommandExecutionError('LinkedIn did not issue a messengerMessages API request for this thread.');
  }
  for (const value of apiUrls) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new CommandExecutionError('LinkedIn messengerMessages discovery returned an invalid URL.');
    }
    let decoded = value;
    try { decoded = decodeURIComponent(value); } catch {}
    if (url.protocol !== 'https:'
      || url.hostname !== LINKEDIN_DOMAIN
      || url.pathname !== '/voyager/api/voyagerMessagingGraphQL/graphql'
      || !/^messengerMessages\.[a-f0-9]+$/i.test(url.searchParams.get('queryId') || '')
      || !threadId
      || !decoded.includes(threadId)) {
      throw new CommandExecutionError('LinkedIn messengerMessages discovery returned an unsafe or mismatched URL.');
    }
  }
  return apiUrls;
}

function parseThreadPages(pages) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new CommandExecutionError('LinkedIn messengerMessages API returned no pages.');
  }

  const entities = new Map();
  const apiUrls = [];
  for (const page of pages) {
    if (!page || typeof page !== 'object' || Array.isArray(page) || typeof page.url !== 'string') {
      throw new CommandExecutionError('LinkedIn messengerMessages API returned a malformed page wrapper.');
    }
    const normalized = page.json;
    if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
      throw new CommandExecutionError('LinkedIn messengerMessages API returned a malformed normalized payload.');
    }
    if (Array.isArray(normalized.errors) && normalized.errors.length > 0) {
      throw new CommandExecutionError('LinkedIn messengerMessages GraphQL returned errors.');
    }
    if (!Array.isArray(normalized.included)) {
      throw new CommandExecutionError('LinkedIn messengerMessages payload is missing the included entity array.');
    }
    const data = normalized.data?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new CommandExecutionError('LinkedIn messengerMessages payload is missing normalized data.');
    }
    const container = Object.entries(data).find(([key, value]) => (
      /^messengerMessages/i.test(key)
      && value
      && typeof value === 'object'
      && !Array.isArray(value)
      && (Array.isArray(value['*elements']) || Array.isArray(value.elements))
    ));
    if (!container) {
      throw new CommandExecutionError('LinkedIn messengerMessages payload is missing a message collection.');
    }
    for (const entity of normalized.included) {
      if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
        throw new CommandExecutionError('LinkedIn messengerMessages payload contains a malformed included entity.');
      }
      if (entity.entityUrn) {
        const existing = entities.get(entity.entityUrn);
        if (!existing || Object.keys(entity).length > Object.keys(existing).length) {
          entities.set(entity.entityUrn, entity);
        }
      }
    }
    apiUrls.push(page.url);
  }

  const ownerUrn = ownerUrnFromApiUrls(apiUrls);
  if (!ownerUrn) {
    throw new CommandExecutionError('LinkedIn messengerMessages URL is missing the conversation owner identity.');
  }

  const participants = Array.from(entities.values()).filter(
    (entity) => entity.$type === 'com.linkedin.messenger.MessagingParticipant',
  );
  const recipientNames = Array.from(new Set(participants
    .filter((participant) => participant.hostIdentityUrn !== ownerUrn)
    .map(participantName)
    .filter(Boolean)));
  if (recipientNames.length === 0) {
    throw new CommandExecutionError('LinkedIn messengerMessages payload is missing the counterparty participant.');
  }

  const byMessageId = new Map();
  for (const entity of entities.values()) {
    if (entity.$type !== 'com.linkedin.messenger.Message') continue;
    const messageId = normalizeWhitespace(entity.entityUrn || entity.backendUrn || entity.originToken);
    if (!messageId) {
      throw new CommandExecutionError('LinkedIn messengerMessages payload contains a message without an id.');
    }
    const deliveredAt = Number(entity.deliveredAt);
    if (!Number.isFinite(deliveredAt) || deliveredAt <= 0) {
      throw new CommandExecutionError('LinkedIn messengerMessages payload contains a message without a valid timestamp.');
    }
    const senderUrn = normalizeWhitespace(entity['*sender'] || entity['*actor']);
    const sender = senderUrn ? entities.get(senderUrn) : null;
    const speaker = participantName(sender);
    if (!speaker) {
      throw new CommandExecutionError('LinkedIn messengerMessages payload contains a message with an unresolved sender.');
    }
    byMessageId.set(messageId, {
      messageUrn: messageId,
      speaker,
      text: messageText(entity),
      deliveredAt,
    });
  }

  const messages = Array.from(byMessageId.values())
    .sort((left, right) => left.deliveredAt - right.deliveredAt || left.messageUrn.localeCompare(right.messageUrn))
    .map((message, index) => ({ index, ...message }));
  if (messages.length === 0) {
    throw new EmptyResultError('linkedin thread-snapshot', 'No messages were found in the LinkedIn thread.');
  }
  return { recipientNames, messages };
}

cli({
  site: 'linkedin',
  name: 'thread-snapshot',
  access: 'read',
  description: 'Load a LinkedIn messaging thread and return a structured conversation snapshot',
  domain: LINKEDIN_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'thread-url', required: true, help: 'Exact LinkedIn messaging thread URL to open and snapshot' },
    { name: 'max-scrolls', type: 'number', default: 30, help: 'Maximum upward scroll attempts used to request older message pages' },
    { name: 'json', type: 'bool', default: false, help: 'Return only JSON snapshot string in the snapshot_json field' },
  ],
  columns: ['thread_url', 'recipient', 'message_count', 'latest_text', 'snapshot_json'],
  func: async (page, args) => {
    if (!page) throw new CommandExecutionError('Browser session required for linkedin thread-snapshot');
    const threadUrl = requireLinkedInThreadUrl(requireStringArg(args, 'thread-url', '--thread-url'), '--thread-url');
    const maxScrolls = parseMaxScrolls(args['max-scrolls']);

    await page.goto(threadUrl);
    await page.wait(10);

    let discovery = unwrapEvaluateResult(await page.evaluate(buildThreadApiDiscoveryScript(maxScrolls)));
    if (discovery && Array.isArray(discovery.apiUrls) && discovery.apiUrls.length === 0) {
      const firstDiscovery = discovery;
      await page.wait(4);
      const retried = unwrapEvaluateResult(await page.evaluate(buildThreadApiDiscoveryScript(0)));
      if (retried && typeof retried === 'object' && !Array.isArray(retried)) {
        discovery = {
          ...retried,
          scrollAttempts: firstDiscovery.scrollAttempts,
          scrollStable: firstDiscovery.scrollStable,
        };
      } else {
        discovery = retried;
      }
    }
    if (discovery?.authRequired) {
      throw new AuthRequiredError(LINKEDIN_DOMAIN, 'LinkedIn thread-snapshot requires an active signed-in LinkedIn browser session.');
    }
    if (!discovery || typeof discovery !== 'object' || Array.isArray(discovery) || !Array.isArray(discovery.apiUrls)) {
      throw new CommandExecutionError('LinkedIn thread-snapshot returned a malformed API discovery payload.');
    }

    const actualUrl = canonicalizeLinkedInThreadUrl(discovery.url || '');
    if (threadUrl && actualUrl && threadUrl !== actualUrl) {
      throw new CommandExecutionError('LinkedIn thread-snapshot blocked: thread_url_mismatch', `Expected ${threadUrl}; actual ${actualUrl}`);
    }
    if (maxScrolls >= 4 && discovery.scrollAttempts >= maxScrolls && discovery.scrollStable === false) {
      throw new CommandExecutionError('LinkedIn thread history did not stabilize before --max-scrolls; refusing to return a partial snapshot.');
    }

    const apiUrls = validateThreadApiUrls(discovery.apiUrls, threadUrl);
    const csrf = await requireLinkedInCookie(page, 'LinkedIn thread-snapshot');
    const fetched = unwrapEvaluateResult(
      await page.evaluate(buildFetchThreadPagesScript(apiUrls, csrf)),
    );
    if (fetched?.authRequired) {
      throw new AuthRequiredError(LINKEDIN_DOMAIN, `LinkedIn messengerMessages API authentication failed: ${fetched.error}`);
    }
    if (!fetched || fetched.error || !Array.isArray(fetched.pages)) {
      throw new CommandExecutionError(`LinkedIn messengerMessages API returned an unexpected response: ${fetched?.error || 'no data'}`);
    }

    const parsed = parseThreadPages(fetched.pages);
    const recipient = parsed.recipientNames.join(', ');
    const latestMessageText = parsed.messages[parsed.messages.length - 1]?.text || '';
    const normalized = {
      url: actualUrl || threadUrl,
      title: normalizeWhitespace(discovery.title),
      headerNames: parsed.recipientNames,
      latestMessageText,
      messages: parsed.messages,
      messageCount: parsed.messages.length,
      authRequired: false,
      extractedAt: new Date().toISOString(),
      maxScrolls,
      source: 'linkedin-messengerMessages',
    };

    return [{
      thread_url: normalized.url,
      recipient,
      message_count: normalized.messageCount,
      latest_text: latestMessageText,
      snapshot_json: JSON.stringify(normalized),
    }];
  },
});

export const __test__ = {
  parseMaxScrolls,
  buildThreadApiDiscoveryScript,
  buildFetchThreadPagesScript,
  validateThreadApiUrls,
  parseThreadPages,
};
