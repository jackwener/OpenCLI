/**
 * Bilibili creator-only manuscript analytics.
 *
 * Contract note: these are undocumented creator-center endpoints. The registry
 * uses Strategy.COOKIE to acquire a logged-in browser session; requests use the
 * supported page.fetchJson() primitive and preserve metric paths plus Bilibili's
 * raw platform scale so downstream consumers do not mistake basis points or
 * internal scores for percentages.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
} from '@jackwener/opencli/errors';

const MEMBER_ORIGIN = 'https://member.bilibili.com';
const API_ORIGIN = 'https://api.bilibili.com';

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseBvid(value) {
  const raw = String(value ?? '').trim();
  if (!/^BV[0-9A-Za-z]{10}$/i.test(raw)) {
    throw new ArgumentError('bvid must be a 12-character BV ID, for example BV1xx411c7mD');
  }
  return `BV${raw.slice(2)}`;
}

function isAuthLike(code, message) {
  return code === -101
    || code === -111
    || code === -403
    || /登录|账号|权限|forbidden|permission|login|auth/i.test(String(message ?? ''));
}

function requirePayload(payload, label) {
  if (!isRecord(payload) || !Object.hasOwn(payload, 'code')) {
    throw new CommandExecutionError(`Bilibili ${label} API returned a malformed envelope`);
  }
  const message = String(payload.message ?? payload.msg ?? 'unknown error');
  if (payload.code !== 0) {
    if (isAuthLike(payload.code, message)) {
      throw new AuthRequiredError(
        'member.bilibili.com',
        `Bilibili ${label} requires a logged-in creator account with access: ${message} (${payload.code})`,
      );
    }
    if (payload.code === -404) {
      throw new EmptyResultError(`bilibili creator-stats ${label}`, message);
    }
    throw new CommandExecutionError(`Bilibili ${label} API failed: ${message} (${payload.code})`);
  }
  return payload.data;
}

async function fetchPayload(page, url, label) {
  try {
    const payload = await page.fetchJson(url);
    return requirePayload(payload, label);
  } catch (error) {
    if (
      error instanceof ArgumentError
      || error instanceof AuthRequiredError
      || error instanceof EmptyResultError
      || error instanceof CommandExecutionError
    ) {
      throw error;
    }
    throw new CommandExecutionError(
      `Bilibili ${label} request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function normalizePlatformValue(value) {
  if (typeof value === 'string' && (value.trim() === '' || value.trim() === '-')) return null;
  return value;
}

function addScalars(rows, source, value, prefix = '') {
  if (value === undefined) return;
  if (value === null) {
    if (prefix) rows.push({ source, metric: prefix, value: null, unit: 'platform_raw' });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => addScalars(rows, source, item, `${prefix}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    Object.entries(value).forEach(([key, item]) => {
      addScalars(rows, source, item, prefix ? `${prefix}.${key}` : key);
    });
    return;
  }
  if (!prefix) {
    throw new CommandExecutionError(`Bilibili ${source} returned a scalar root instead of an object`);
  }
  rows.push({ source, metric: prefix, value: normalizePlatformValue(value), unit: 'platform_raw' });
}

cli({
  site: 'bilibili',
  name: 'creator-stats',
  description: '读取本人稿件的创作诊断、转粉和留存原始指标（需登录创作中心）',
  access: 'read',
  example: 'opencli bilibili creator-stats <owned-bvid> -f json',
  domain: 'member.bilibili.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: `${MEMBER_ORIGIN}/platform/home`,
  args: [
    {
      name: 'bvid',
      type: 'string',
      required: true,
      positional: true,
      help: '本人稿件 BV ID',
    },
  ],
  columns: ['source', 'metric', 'value', 'unit'],
  func: async (page, args) => {
    const bvid = parseBvid(args.bvid);

    const publicData = await fetchPayload(
      page,
      `${API_ORIGIN}/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
      'video view',
    );
    if (!isRecord(publicData)) {
      throw new CommandExecutionError('Bilibili video view API returned malformed data');
    }
    const cid = publicData.pages?.[0]?.cid;
    if (!Number.isSafeInteger(cid) || cid <= 0) {
      throw new CommandExecutionError(`Bilibili video view API did not return a valid cid for ${bvid}`);
    }

    const compare = await fetchPayload(
      page,
      `${MEMBER_ORIGIN}/x/web/data/archive_diagnose/compare?bvid=${encodeURIComponent(bvid)}&size=100&tmid=`,
      'creator comparison',
    );
    if (!isRecord(compare) || !Array.isArray(compare.list)) {
      throw new CommandExecutionError('Bilibili creator comparison API returned malformed list data');
    }
    const target = compare.list.find(
      (item) => String(item?.bvid ?? '').toUpperCase() === bvid.toUpperCase(),
    );
    if (!target) {
      throw new AuthRequiredError(
        'member.bilibili.com',
        `The logged-in Bilibili creator account does not own or cannot access ${bvid}`,
      );
    }
    if (!isRecord(target.stat)) {
      throw new CommandExecutionError(`Bilibili creator comparison returned malformed stat data for ${bvid}`);
    }
    if (target.hour_stat != null && !isRecord(target.hour_stat)) {
      throw new CommandExecutionError(`Bilibili creator comparison returned malformed hour_stat data for ${bvid}`);
    }

    const play = await fetchPayload(
      page,
      `${MEMBER_ORIGIN}/x/web/data/archive_diagnose/play_analyze?bvid=${encodeURIComponent(bvid)}&tmid=`,
      'play analysis',
    );
    if (!isRecord(play)) {
      throw new CommandExecutionError('Bilibili play analysis API returned malformed data');
    }

    const graph = await fetchPayload(
      page,
      `${MEMBER_ORIGIN}/x/web/data/v2/archive/analyze/graph?cid=${encodeURIComponent(cid)}&tmid=`,
      'retention graph',
    );
    if (!isRecord(graph)) {
      throw new CommandExecutionError('Bilibili retention graph API returned malformed data');
    }

    const rows = [];
    addScalars(rows, 'compare.stat', target.stat);
    if (target.hour_stat) addScalars(rows, 'compare.hour_stat', target.hour_stat);
    addScalars(rows, 'play_analyze', play);
    addScalars(rows, 'retention_graph', graph);
    if (rows.length === 0) {
      throw new EmptyResultError(
        `bilibili creator-stats ${bvid}`,
        'Creator analytics are not available yet for this manuscript',
      );
    }
    return rows;
  },
});
