import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { simulateHumanBehavior, waitRandomDuration } from './shared.js';
import {
  DEFAULT_BROWSE_STEPS,
  DEFAULT_DURATION_MIN,
  DEFAULT_INSPECT_LIMIT,
  DEFAULT_SEARCH_TERMS,
  buildBrowseInspectScript,
  buildSeedSearchUrls,
  clampInt,
  normalizeBrowseInspectPayload,
  normalizeDwellRange,
  normalizeShopeeBrowseUrl,
  parseSearchTerms,
  pickBrowseCandidate,
} from './browse-shared.js';

const SHOPEE_BROWSE_TIMEOUT_SECONDS = 15 * 60;
const BROWSE_NEXT_ATTR = 'data-opencli-browse-next';

function isActionLogEnabled(args) {
  if (args?.['action-log'] === true) return true;
  const raw = String(process.env.OPENCLI_ACTION_LOG ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function emitBrowseActionLog(enabled, action, fields = {}) {
  if (!enabled) return;
  const parts = [`action:${action}`];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue;
    const normalized = String(value).replace(/\s+/g, ' ').trim();
    if (!normalized) continue;
    parts.push(`${key}:${normalized}`);
  }
  process.stderr.write(`${parts.join(' ')}\n`);
}

async function inspectCurrentPage(page, currentUrl, inspectLimit) {
  const payload = await page.evaluate(buildBrowseInspectScript(inspectLimit));
  return normalizeBrowseInspectPayload(payload, currentUrl, inspectLimit);
}

function buildBrowseClickCandidateScript(targetHref) {
  return `
    (() => {
      const marker = '__OPENCLI_SHOPEE_BROWSE_CLICK__';
      const targetHref = ${JSON.stringify(targetHref)};
      const attr = ${JSON.stringify(BROWSE_NEXT_ATTR)};
      const absolutize = (href) => {
        try {
          const url = new URL(String(href || ''), window.location.href);
          url.hash = '';
          return url.toString();
        } catch {
          return '';
        }
      };
      const isVisible = (node) => {
        if (!(node instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      document.querySelectorAll('[' + attr + ']').forEach((node) => node.removeAttribute(attr));
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      const exactMatches = anchors.filter((anchor) => absolutize(anchor.getAttribute('href')) === targetHref);
      const selected = exactMatches.find(isVisible) || exactMatches[0] || null;
      if (!selected) {
        return { marker, ok: false, reason: 'anchor_not_found', href: targetHref };
      }
      selected.setAttribute(attr, '1');
      return { marker, ok: true, selector: '[' + attr + '="1"]', href: targetHref };
    })()
  `;
}

async function readCurrentPageUrl(page, fallbackUrl) {
  if (typeof page.getCurrentUrl === 'function') {
    try {
      const value = await page.getCurrentUrl();
      if (typeof value === 'string' && value.trim()) return value;
    } catch {}
  }
  try {
    const value = await page.evaluate('window.location.href');
    if (typeof value === 'string' && value.trim()) return value;
  } catch {}
  return fallbackUrl;
}

function normalizeHopUrlForComparison(value) {
  try {
    const url = new URL(String(value || ''));
    if (
      (url.protocol === 'https:' && url.port === '443')
      || (url.protocol === 'http:' && url.port === '80')
    ) {
      url.port = '';
    }
    url.hash = '';
    return url.toString();
  } catch {
    return String(value || '').trim();
  }
}

function isExpectedHopUrl(currentUrl, targetUrl) {
  const current = normalizeHopUrlForComparison(currentUrl);
  const target = normalizeHopUrlForComparison(targetUrl);
  return !!current && !!target && current === target;
}

async function waitForHopUrl(page, targetUrl, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let lastUrl = await readCurrentPageUrl(page, '');
  while (Date.now() < deadline) {
    if (isExpectedHopUrl(lastUrl, targetUrl)) {
      return { ok: true, currentUrl: lastUrl };
    }
    await page.wait({ time: 0.2 });
    lastUrl = await readCurrentPageUrl(page, lastUrl || targetUrl);
  }
  return { ok: isExpectedHopUrl(lastUrl, targetUrl), currentUrl: lastUrl };
}

async function performBrowseHop(page, target, actionLog, step, hopTimeoutMs = 5000) {
  const targetUrl = target?.href || '';
  const mode = target?.navigate_via === 'click' ? 'click' : 'goto';
  emitBrowseActionLog(actionLog, 'navigate_start', { step, url: targetUrl, mode });

  if (mode === 'click' && typeof page.click === 'function') {
    const tagged = await page.evaluate(buildBrowseClickCandidateScript(targetUrl)).catch(() => null);
    if (tagged?.ok && tagged.selector) {
      emitBrowseActionLog(actionLog, 'click_nav_start', { step, url: targetUrl });
      await page.click(tagged.selector, { firstOnMulti: true });
      const hop = await waitForHopUrl(page, targetUrl, hopTimeoutMs);
      if (hop.ok) {
        await page.wait({ time: 1 });
        emitBrowseActionLog(actionLog, 'click_nav_done', {
          step,
          url: targetUrl,
          current_url: hop.currentUrl,
        });
        emitBrowseActionLog(actionLog, 'navigate_done', { step, url: targetUrl, mode: 'click' });
        return;
      }
      emitBrowseActionLog(actionLog, 'click_nav_fallback', {
        step,
        url: targetUrl,
        reason: 'url_not_changed',
        current_url: hop.currentUrl,
      });
    } else {
      emitBrowseActionLog(actionLog, 'click_nav_fallback', {
        step,
        url: targetUrl,
        reason: tagged?.reason || 'click_prepare_failed',
      });
    }
  }

  await page.goto(targetUrl, { waitUntil: 'load' });
  emitBrowseActionLog(actionLog, 'navigate_done', { step, url: targetUrl, mode: 'goto' });
}

function chooseNextTarget(payload, visitedUrls, seedQueue, allowSeedFallback = false) {
  const chosen = pickBrowseCandidate(payload, visitedUrls);
  if (chosen) return { ...chosen, navigate_via: 'click', selection_source: 'candidate' };
  if (!allowSeedFallback || !['browse', 'search'].includes(payload?.pageType || '')) return null;
  while (seedQueue.length > 0) {
    const seed = seedQueue.shift();
    if (seed?.href && !visitedUrls.has(seed.href)) {
      return { ...seed, navigate_via: 'goto', selection_source: 'seed' };
    }
  }
  return null;
}

export async function runBrowseSession(page, args, options = {}) {
  const nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now();
  const hopTimeoutMs = Number.isFinite(options.hopTimeoutMs) ? Math.max(0, Number(options.hopTimeoutMs)) : 5000;
  const mock = !!args.mock;
  const actionLog = isActionLogEnabled(args);
  const startUrl = normalizeShopeeBrowseUrl(args.url, { allowMock: mock });
  const steps = clampInt(args.steps, DEFAULT_BROWSE_STEPS, 1, 200);
  const durationMin = clampInt(args['duration-min'], DEFAULT_DURATION_MIN, 0, 180);
  const inspectLimit = clampInt(args['inspect-limit'], DEFAULT_INSPECT_LIMIT, 1, 50);
  const dwellRange = normalizeDwellRange(args['dwell-min-ms'], args['dwell-max-ms']);
  const searchTerms = parseSearchTerms(args['search-terms']);
  const seedQueue = buildSeedSearchUrls(startUrl, searchTerms);
  const allowSeedFallback = durationMin > 0;
  const visitedUrls = new Set();
  const rows = [];
  let currentHop = {
    href: startUrl,
    navigate_via: 'goto',
    selection_source: 'start',
  };
  const deadlineAt = durationMin > 0 ? nowFn() + durationMin * 60 * 1000 : null;
  emitBrowseActionLog(actionLog, 'session_start', {
    url: startUrl,
    steps,
    duration_min: durationMin,
    inspect_limit: inspectLimit,
  });

  for (let step = 1; step <= steps; step += 1) {
    if (deadlineAt !== null && nowFn() >= deadlineAt) {
      emitBrowseActionLog(actionLog, 'session_stop', { reason: 'deadline_reached', step });
      break;
    }
    emitBrowseActionLog(actionLog, 'step_start', { step, url: currentHop.href });
    await performBrowseHop(page, currentHop, actionLog, step, hopTimeoutMs);
    if (typeof page.autoScroll === 'function') {
      emitBrowseActionLog(actionLog, 'autoscroll_start', { step });
      await page.autoScroll({ times: 1, delayMs: 700 }).catch(() => undefined);
      emitBrowseActionLog(actionLog, 'autoscroll_done', { step });
    }
    emitBrowseActionLog(actionLog, 'humanize_start', { step });
    await simulateHumanBehavior(page, {
      preWaitRangeMs: [160, 420],
      postWaitRangeMs: [120, 320],
      scrollRangePx: [120, 280],
    });
    emitBrowseActionLog(actionLog, 'humanize_done', { step });

    emitBrowseActionLog(actionLog, 'inspect_start', { step, limit: inspectLimit });
    const currentUrl = await readCurrentPageUrl(page, currentHop.href);
    const payload = await inspectCurrentPage(page, currentUrl, inspectLimit);
    if (payload.issue) {
      const issueCode = payload.issue.code || 'page_issue';
      emitBrowseActionLog(actionLog, 'status', {
        value: issueCode === 'unlogin' ? 'unlogin' : 'not_ok',
        reason: issueCode,
      });
      if (issueCode === 'unlogin') {
        rows.push({
          step,
          status: 'unlogin',
          page_type: payload.pageType,
          title: payload.title || payload.issue.title,
          visited_url: payload.url,
          candidate_count: payload.candidateCount,
          selected_kind: '',
          selected_url: '',
          dwell_seconds: 0,
        });
        emitBrowseActionLog(actionLog, 'session_stop', { reason: 'unlogin', step });
        break;
      }
      emitBrowseActionLog(actionLog, 'inspect_error', {
        step,
        code: issueCode,
        title: payload.issue.title,
      });
      const title = payload.issue.title || 'Shopee page reported a read error';
      const message = payload.issue.message || 'The current Shopee page returned a read error screen.';
      throw new CommandExecutionError(title, message);
    }
    emitBrowseActionLog(actionLog, 'inspect_done', {
      step,
      page_type: payload.pageType,
      candidates: payload.candidateCount,
    });
    emitBrowseActionLog(actionLog, 'status', { value: 'ok' });
    visitedUrls.add(payload.url);
    const chosen = chooseNextTarget(payload, visitedUrls, seedQueue, allowSeedFallback);
    emitBrowseActionLog(actionLog, 'select_done', {
      step,
      page_type: payload.pageType,
      selected_kind: chosen?.kind || 'none',
      selected_url: chosen?.href || '',
    });
    let dwellSeconds = 0;
    if (chosen) {
      emitBrowseActionLog(actionLog, 'dwell_start', { step });
      dwellSeconds = await waitRandomDuration(page, dwellRange);
      emitBrowseActionLog(actionLog, 'dwell_done', { step, seconds: dwellSeconds });
    }

    rows.push({
      step,
      status: 'ok',
      page_type: payload.pageType,
      title: payload.title,
      visited_url: payload.url,
      candidate_count: payload.candidateCount,
      selected_kind: chosen?.kind || '',
      selected_url: chosen?.href || '',
      dwell_seconds: dwellSeconds,
    });

    if (!chosen) {
      emitBrowseActionLog(actionLog, 'session_stop', { reason: 'no_candidate', step });
      break;
    }
    if (deadlineAt !== null && nowFn() >= deadlineAt) {
      emitBrowseActionLog(actionLog, 'session_stop', { reason: 'deadline_reached', step });
      break;
    }
    currentHop = chosen;
  }

  emitBrowseActionLog(actionLog, 'session_done', { rows: rows.length });
  return rows;
}

cli({
  site: 'shopee',
  name: 'browse',
  access: 'read',
  workspace: 'browser:shopee-browse-{pid}',
  description: 'Read-only Shopee browse rehearsal across search, product, and shop pages',
  domain: 'shopee.sg',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  timeoutSeconds: SHOPEE_BROWSE_TIMEOUT_SECONDS,
  args: [
    {
      name: 'url',
      positional: true,
      required: true,
      help: 'Starting Shopee page URL (search, product, or shop)',
    },
    {
      name: 'steps',
      type: 'int',
      default: DEFAULT_BROWSE_STEPS,
      help: 'Maximum navigation steps (default 3, max 200)',
    },
    {
      name: 'duration-min',
      type: 'int',
      default: DEFAULT_DURATION_MIN,
      help: 'Optional time budget in minutes for read-only browsing (default 0 = disabled)',
    },
    {
      name: 'inspect-limit',
      type: 'int',
      default: DEFAULT_INSPECT_LIMIT,
      help: 'Maximum candidate links to inspect per page (default 20, max 50)',
    },
    {
      name: 'dwell-min-ms',
      type: 'int',
      default: 3500,
      help: 'Minimum dwell time before the next hop in milliseconds (default 3500)',
    },
    {
      name: 'dwell-max-ms',
      type: 'int',
      default: 6500,
      help: 'Maximum dwell time before the next hop in milliseconds (default 6500)',
    },
    {
      name: 'search-terms',
      default: DEFAULT_SEARCH_TERMS.join(','),
      help: 'Comma-separated public search keywords used as fallback seeds, e.g. shoes,shirt',
    },
    {
      name: 'mock',
      type: 'bool',
      default: false,
      help: 'Allow localhost or .test hosts for local mock-site verification',
    },
    {
      name: 'action-log',
      type: 'bool',
      default: false,
      help: 'Emit one action log line per browse step to stderr',
    },
  ],
  columns: ['step', 'status', 'page_type', 'title', 'visited_url', 'candidate_count', 'selected_kind', 'selected_url', 'dwell_seconds'],
  func: runBrowseSession,
});

export const __test__ = {
  chooseNextTarget,
  inspectCurrentPage,
  runBrowseSession,
};
