import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

const LINKEDIN_DOMAIN = 'www.linkedin.com';

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanPersonName(value) {
  return normalizeWhitespace(value)
    .replace(/\s+(?:status is (?:online|reachable|away|offline)\b|active(?:\s+now|\s+\S+)?\b|view profile\b).*$/i, '')
    .trim();
}

function unwrapEvaluateResult(payload) {
  if (payload && typeof payload === 'object' && 'data' in payload && 'session' in payload) return payload.data;
  return payload;
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

function installThreadFetchCaptureScript() {
  return String.raw`(() => {
    window.__opencli_thread_pages = Array.isArray(window.__opencli_thread_pages) ? window.__opencli_thread_pages : [];
    if (window.__opencli_thread_fetch_patched) return { patched: false, count: window.__opencli_thread_pages.length };
    const originalFetch = window.fetch;
    window.__opencli_thread_fetch_patched = true;
    window.fetch = async function(...args) {
      const response = await originalFetch.apply(this, args);
      try {
        const request = args[0];
        const url = typeof request === 'string' ? request : (request && request.url) || '';
        if (/messengerMessages/i.test(String(url || response.url || ''))) {
          response.clone().text().then((text) => {
            if (text) window.__opencli_thread_pages.push(text);
          }).catch(() => {});
        }
      } catch {}
      return response;
    };
    return { patched: true, count: window.__opencli_thread_pages.length };
  })()`;
}

function scrollThreadMessagePaneScript() {
  return String.raw`(() => {
    const candidates = [
      '.msg-s-message-list-scrollable',
      '.msg-s-message-list',
      '.msg-thread',
      'main [role="main"]',
      'main'
    ];
    let scroller = null;
    for (const selector of candidates) {
      const el = document.querySelector(selector);
      if (el && (el.scrollHeight > el.clientHeight || selector === 'main')) { scroller = el; break; }
    }
    scroller = scroller || document.scrollingElement || document.documentElement;
    scroller.scrollTop = 0;
    window.scrollTo(0, 0);
    return { scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight || 0, clientHeight: scroller.clientHeight || 0 };
  })()`;
}

function getCapturedThreadPagesScript() {
  return String.raw`(() => Array.isArray(window.__opencli_thread_pages) ? window.__opencli_thread_pages.slice() : [])()`;
}

function parseThreadMessages(normalized) {
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized) || !Array.isArray(normalized.included)) return [];
  const clean = normalizeWhitespace;
  const byUrn = new Map();
  for (const entity of normalized.included) {
    if (entity && entity.entityUrn) byUrn.set(entity.entityUrn, entity);
  }
  const participantName = (participant) => {
    if (!participant) return '';
    const pt = participant.participantType || {};
    if (pt.member) return clean([pt.member.firstName?.text, pt.member.lastName?.text].filter(Boolean).join(' '));
    if (pt.organization?.name) return clean(pt.organization.name.text);
    if (pt.agent?.name) return clean(pt.agent.name.text);
    return clean(participant.name?.text || participant.name || '');
  };
  const resolveSpeaker = (message) => {
    const candidates = [message['*sender'], message['*from'], message.sender, message.from, message.actor, message.creator, message.backendAuthorUrn];
    for (const candidate of candidates) {
      const urn = typeof candidate === 'string' ? candidate : candidate?.entityUrn;
      if (!urn) continue;
      const entity = byUrn.get(urn);
      const name = participantName(entity);
      if (name) return name;
    }
    return '';
  };
  const createdMs = (message) => Number(message.createdAt || message.deliveredAt || message.timestamp || message.sentAt || 0);
  const rows = [];
  for (const message of normalized.included) {
    if (!message || !/\.Message$/i.test(String(message.$type || ''))) continue;
    const text = clean(message.body?.text || message.attributedBody?.text || message.text || '');
    if (!text) continue;
    rows.push({
      index: rows.length,
      urn: message.entityUrn || '',
      timestamp: createdMs(message) ? new Date(createdMs(message)).toISOString() : '',
      createdAt: createdMs(message),
      speaker: cleanPersonName(resolveSpeaker(message)),
      text,
    });
  }
  if (rows.some((row) => row.createdAt)) rows.sort((a, b) => a.createdAt - b.createdAt);
  return rows.map((row, index) => ({ ...row, index }));
}

function mergeThreadMessages(apiMessages, domMessages) {
  const seen = new Set();
  const merged = [];
  const add = (message) => {
    const text = normalizeWhitespace(message?.text || '');
    if (!text) return;
    const speakerTextKey = `${normalizeWhitespace(message?.speaker || '')}\n${text}`;
    const key = normalizeWhitespace(message?.urn || '') || `${speakerTextKey}\n${normalizeWhitespace(message?.timestamp || '')}`;
    if (seen.has(key) || seen.has(speakerTextKey)) return;
    seen.add(key);
    seen.add(speakerTextKey);
    merged.push({ ...message, text });
  };
  for (const message of apiMessages || []) add(message);
  for (const message of domMessages || []) add(message);
  if (merged.some((message) => Number(message.createdAt || 0))) {
    merged.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
  }
  return merged.map((message, index) => ({ ...message, index }));
}

function buildThreadSnapshotScript(maxScrolls) {
  const scrolls = maxScrolls;
  return String.raw`(async () => {
    const marker = '__OPENCLI_LINKEDIN_THREAD_SNAPSHOT__';
    void marker;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
    const cleanPersonName = (s) => clean(s).replace(/\s+(?:status is (?:online|reachable|away|offline)\b|active(?:\s+now|\s+\S+)?\b|view profile\b).*$/i, '').trim();
    const text = document.body ? (document.body.innerText || '') : '';
    const authRequired = /\b(sign in|log in|join linkedin)\b/i.test(text)
      || /linkedin\.com\/(login|checkpoint|authwall)/i.test(location.href)
      || /captcha|verification required/i.test(text);

    const selectors = [
      '.msg-s-message-list',
      '.msg-s-message-list-scrollable',
      '.msg-thread',
      'main [role="main"]',
      'main'
    ];
    let scroller = null;
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && (el.scrollHeight > el.clientHeight || selector === 'main')) { scroller = el; break; }
    }
    scroller = scroller || document.scrollingElement || document.documentElement;
    let previousHeight = -1;
    let stable = 0;
    for (let i = 0; i < ${scrolls}; i += 1) {
      scroller.scrollTop = 0;
      window.scrollTo(0, 0);
      await sleep(750);
      const height = scroller.scrollHeight || document.body.scrollHeight || 0;
      if (height === previousHeight) stable += 1; else stable = 0;
      previousHeight = height;
      if (stable >= 3) break;
    }
    await sleep(1000);

    const headerCandidates = [];
    const headerSelectors = [
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
    for (const selector of headerSelectors) {
      for (const el of Array.from(document.querySelectorAll(selector)).slice(0, 8)) {
        const value = cleanPersonName(el.innerText || el.textContent || el.getAttribute('aria-label'));
        if (value && value.length <= 120 && !/^(message|messaging|send|profile|view profile)$/i.test(value)) {
          headerCandidates.push(value);
        }
      }
    }

    const seen = new Set();
    const messages = [];
    let currentSpeaker = '';
    const nodes = Array.from(document.querySelectorAll('.msg-s-event-listitem'));
    for (const [nodeIndex, el] of nodes.entries()) {
      const speakerEl = el.querySelector('.msg-s-message-group__name');
      const speaker = cleanPersonName(speakerEl?.innerText || speakerEl?.textContent || '');
      if (speaker) currentSpeaker = speaker;
      const bodyEl = el.querySelector('.msg-s-event-listitem__body');
      const body = clean(bodyEl?.innerText || bodyEl?.textContent || '');
      if (!body) continue;
      const key = currentSpeaker + '\n' + body;
      if (seen.has(key)) continue;
      seen.add(key);
      messages.push({ index: messages.length, nodeIndex, speaker: currentSpeaker, text: body });
    }
    if (messages.length === 0) {
      const fallbackNodes = Array.from(document.querySelectorAll('.msg-s-message-list__event, [data-event-urn]'));
      for (const [nodeIndex, el] of fallbackNodes.entries()) {
        const raw = clean(el.innerText || el.textContent);
        if (!raw) continue;
        const key = '\n' + raw;
        if (seen.has(key)) continue;
        seen.add(key);
        messages.push({ index: messages.length, nodeIndex, speaker: '', text: raw });
      }
    }

    const refreshedText = document.body ? (document.body.innerText || '') : '';
    const fallbackLines = refreshedText.split(/\n+/).map(clean).filter(Boolean);
    const latestMessageText = messages.length
      ? messages[messages.length - 1].text
      : ([...fallbackLines].reverse().find((line) => !/^(send|reply|write a message|press enter to send)$/i.test(line)) || '');

    return {
      url: location.href,
      title: document.title || '',
      headerNames: Array.from(new Set(headerCandidates)).slice(0, 10),
      bodyText: refreshedText,
      latestMessageText,
      messages,
      messageCount: messages.length,
      authRequired,
      extractedAt: new Date().toISOString(),
      maxScrolls: ${scrolls}
    };
  })()`;
}

cli({
  site: 'linkedin',
  name: 'thread-snapshot',
  access: 'read',
  description: 'Load a LinkedIn messaging thread, scroll for available history, and return a full context snapshot',
  domain: LINKEDIN_DOMAIN,
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'thread-url', required: true, help: 'Exact LinkedIn messaging thread URL to open and snapshot' },
    { name: 'max-scrolls', type: 'number', default: 30, help: 'Maximum upward scroll attempts to load older messages' },
    { name: 'json', type: 'bool', default: false, help: 'Return only JSON snapshot string in the snapshot_json field' },
  ],
  columns: ['thread_url', 'recipient', 'message_count', 'latest_text', 'snapshot_json'],
  func: async (page, args) => {
    if (!page) throw new CommandExecutionError('Browser session required for linkedin thread-snapshot');
    const threadUrl = requireLinkedInThreadUrl(requireStringArg(args, 'thread-url', '--thread-url'), '--thread-url');
    const maxScrolls = parseMaxScrolls(args['max-scrolls']);

    await page.goto('https://www.linkedin.com/messaging/');
    await page.wait(4);
    await page.goto(threadUrl);
    await page.wait(10);
    await page.evaluate(installThreadFetchCaptureScript());
    for (let i = 0; i < maxScrolls; i += 1) {
      await page.evaluate(scrollThreadMessagePaneScript());
      await page.wait(1);
    }
    const capturedBodies = unwrapEvaluateResult(await page.evaluate(getCapturedThreadPagesScript()));

    const snapshot = unwrapEvaluateResult(await page.evaluate(buildThreadSnapshotScript(0)));
    if (snapshot?.authRequired) {
      throw new AuthRequiredError(LINKEDIN_DOMAIN, 'LinkedIn thread-snapshot requires an active signed-in LinkedIn browser session.');
    }
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || !Array.isArray(snapshot.headerNames) || !Array.isArray(snapshot.messages)) {
      throw new CommandExecutionError('LinkedIn thread-snapshot returned malformed snapshot payload');
    }

    const actualUrl = canonicalizeLinkedInThreadUrl(snapshot?.url || '');
    if (threadUrl && actualUrl && threadUrl !== actualUrl) {
      throw new CommandExecutionError('LinkedIn thread-snapshot blocked: thread_url_mismatch', `Expected ${threadUrl}; actual ${actualUrl}`);
    }

    const apiMessages = [];
    for (const body of Array.isArray(capturedBodies) ? capturedBodies : []) {
      try {
        apiMessages.push(...parseThreadMessages(JSON.parse(body)));
      } catch {
        // Ignore non-JSON or malformed captured bodies.
      }
    }
    const mergedMessages = mergeThreadMessages(apiMessages, snapshot.messages);

    const recipient = cleanPersonName(snapshot.headerNames[0] || '');
    const messageCount = mergedMessages.length;
    const normalized = {
      ...snapshot,
      url: actualUrl || threadUrl,
      headerNames: snapshot.headerNames,
      latestMessageText: normalizeWhitespace(mergedMessages[mergedMessages.length - 1]?.text || snapshot?.latestMessageText || ''),
      messages: mergedMessages,
      capturedApiPageCount: Array.isArray(capturedBodies) ? capturedBodies.length : 0,
    };

    return [{
      thread_url: normalized.url,
      recipient,
      message_count: messageCount,
      latest_text: normalized.latestMessageText,
      snapshot_json: JSON.stringify(normalized),
    }];
  },
});

export const __test__ = {
  normalizeWhitespace,
  cleanPersonName,
  canonicalizeLinkedInThreadUrl,
  parseMaxScrolls,
  unwrapEvaluateResult,
  buildThreadSnapshotScript,
  parseThreadMessages,
  mergeThreadMessages,
};
