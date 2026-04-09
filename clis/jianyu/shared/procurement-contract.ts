export type ProcurementContentType = 'notice' | 'result' | 'news' | 'navigation' | 'unknown';

export type ProcurementTaxonomy =
  | 'network_dns'
  | 'relay_unavailable'
  | 'selector_drift'
  | 'timeout'
  | 'empty_result'
  | 'extraction_drift';

export interface ProcurementSearchCandidateRaw {
  title: string;
  url: string;
  date?: string;
  contextText?: string;
}

interface ProcurementCoreRecord {
  title: string;
  url: string;
  date: string;
  publish_time: string;
  source_site: string;
  is_detail_page: boolean;
  content_type: ProcurementContentType;
  project_owner: string;
  project_code: string;
  budget_or_limit: string;
  deadline_or_open_time: string;
  snippet: string;
  summary: string;
  quality_flags: string[];
}

export interface ProcurementSearchRecord extends ProcurementCoreRecord {
  rank: number;
}

export interface ProcurementDetailRecord extends ProcurementCoreRecord {
  detail_text: string;
  evidence_blocks: string[];
}

const PROCUREMENT_HINTS = [
  '招标',
  '采购',
  '公告',
  '项目',
  '中标',
  '成交',
  '流标',
  '终止',
  '询价',
  '竞价',
  '比选',
  '投标',
  'tender',
  'procurement',
  'bidding',
  'bid',
  'notice',
];

const RESULT_HINTS = [
  '中标',
  '成交',
  '结果',
  '候选人',
  '中选',
  '定标',
  '评标',
  'award',
  'winner',
];

const NOTICE_HINTS = [
  '招标',
  '采购',
  '询价',
  '比选',
  '公告',
  '竞争性',
  '邀请',
  '投标',
  'tender',
  'procurement',
  'notice',
];

const NEWS_HINTS = [
  '新闻',
  '资讯',
  '动态',
  '政策',
  '简讯',
  'news',
  'article',
];

const NAVIGATION_HINTS = [
  '首页',
  '官网',
  '网站地图',
  '联系我们',
  '帮助中心',
  'english',
  'login',
  '注册',
  '导航',
  '法规',
  '政策文件',
  '服务平台',
  '信用中国',
];

const DETAIL_URL_HINTS = [
  '/detail',
  '/content',
  '/jybx/',
  '/notice',
  '/article',
  '/view',
  '/project',
  '/bid',
  'detail=',
  'id=',
];

const LIST_URL_HINTS = [
  '/search',
  '/list',
  '/index',
  '/home',
  '/portal',
  '/channel',
  'page=',
];

const OWNER_PATTERNS = [
  /(?:招标人|采购人|业主|建设单位|项目单位)\s*[：:]\s*([^\n，。；]{2,60})/i,
];

const CODE_PATTERNS = [
  /(?:项目编号|招标编号|采购编号|项目编码|项目代码|编号)\s*[：:]\s*([A-Za-z0-9\-_/]{4,60})/i,
];

const BUDGET_PATTERNS = [
  /(?:预算(?:金额)?|控制价|最高限价|限价|采购金额|合同估算价)\s*[：:]\s*([^\n，。；]{2,80})/i,
];

const DEADLINE_PATTERNS = [
  /(?:报名截止时间|投标截止时间|开标时间|响应文件递交截止时间|截止时间|开标日期)\s*[：:]\s*([^\n，。；]{2,80})/i,
];

const DATE_PATTERN = /(20\d{2})[.\-/年](\d{1,2})[.\-/月](\d{1,2})/;

export function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

export function normalizeDate(raw: string): string {
  const normalized = cleanText(raw);
  const match = normalized.match(DATE_PATTERN);
  if (!match) return '';
  const year = match[1];
  const month = match[2].padStart(2, '0');
  const day = match[3].padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function uniqueInOrder(values: string[]): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = cleanText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    ordered.push(text);
  }
  return ordered;
}

function containsAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle.toLowerCase()));
}

function extractByPatterns(text: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const matched = text.match(pattern);
    if (matched?.[1]) return cleanText(matched[1]);
  }
  return '';
}

function deriveSnippet(text: string): string {
  const normalized = cleanText(text);
  if (!normalized) return '';
  return normalized.slice(0, 220);
}

function splitEvidenceBlocks(text: string, query: string): string[] {
  const normalized = cleanText(text);
  if (!normalized) return [];
  const queryTokens = query
    .split(/\s+/)
    .map((item) => item.toLowerCase().trim())
    .filter(Boolean);
  const chunks = normalized
    .split(/[。！？；\n]/)
    .map((chunk) => cleanText(chunk))
    .filter(Boolean);

  const ranked = chunks
    .map((chunk) => {
      const lower = chunk.toLowerCase();
      const tokenScore = queryTokens.length === 0
        ? 0
        : queryTokens.reduce((score, token) => (lower.includes(token) ? score + 2 : score), 0);
      const procurementScore = containsAny(lower, PROCUREMENT_HINTS) ? 1 : 0;
      return {
        chunk,
        score: tokenScore + procurementScore,
      };
    })
    .sort((a, b) => b.score - a.score || b.chunk.length - a.chunk.length)
    .slice(0, 5)
    .map((item) => item.chunk);

  return uniqueInOrder(ranked);
}

function classifyContentType(title: string, url: string, contextText: string): ProcurementContentType {
  const haystack = `${title} ${contextText} ${url}`.toLowerCase();
  if (containsAny(haystack, RESULT_HINTS)) return 'result';
  if (containsAny(haystack, NOTICE_HINTS)) return 'notice';
  if (containsAny(haystack, NEWS_HINTS)) return 'news';
  if (containsAny(haystack, NAVIGATION_HINTS)) return 'navigation';
  return 'unknown';
}

function isDetailPage(url: string): boolean {
  const lower = cleanText(url).toLowerCase();
  if (!lower) return false;
  const hasDetailToken = DETAIL_URL_HINTS.some((hint) => lower.includes(hint));
  if (!hasDetailToken) return false;
  const hasListToken = LIST_URL_HINTS.some((hint) => lower.includes(hint));
  return !hasListToken;
}

function buildQualityFlags(core: ProcurementCoreRecord): string[] {
  const flags: string[] = [];
  if (!core.project_owner) flags.push('missing_project_owner');
  if (!core.project_code) flags.push('missing_project_code');
  if (!core.budget_or_limit) flags.push('missing_budget');
  if (!core.deadline_or_open_time) flags.push('missing_deadline');
  if (core.content_type === 'navigation') flags.push('navigation_risk');
  if (!core.is_detail_page) flags.push('list_page_url');
  return flags;
}

function queryMatched(text: string, query: string): boolean {
  const tokenParts = query
    .split(/\s+/)
    .map((part) => part.toLowerCase().trim())
    .filter(Boolean);
  if (tokenParts.length === 0) return true;
  const lower = text.toLowerCase();
  return tokenParts.some((part) => lower.includes(part));
}

function normalizeCoreRecord(
  row: ProcurementSearchCandidateRaw,
  {
    sourceSite,
  }: {
    sourceSite: string;
  },
): ProcurementCoreRecord {
  const title = cleanText(row.title);
  const url = cleanText(row.url);
  const contextText = cleanText(row.contextText);
  const date = normalizeDate(cleanText(row.date || contextText));
  const publishTime = date;
  const contentType = classifyContentType(title, url, contextText);
  const projectOwner = extractByPatterns(contextText, OWNER_PATTERNS);
  const projectCode = extractByPatterns(contextText, CODE_PATTERNS);
  const budget = extractByPatterns(contextText, BUDGET_PATTERNS);
  const deadline = extractByPatterns(contextText, DEADLINE_PATTERNS);
  const snippet = deriveSnippet(contextText || title);

  const core: ProcurementCoreRecord = {
    title,
    url,
    date,
    publish_time: publishTime,
    source_site: sourceSite,
    is_detail_page: isDetailPage(url),
    content_type: contentType,
    project_owner: projectOwner,
    project_code: projectCode,
    budget_or_limit: budget,
    deadline_or_open_time: deadline,
    snippet,
    summary: snippet,
    quality_flags: [],
  };
  core.quality_flags = buildQualityFlags(core);
  return core;
}

function qualityRejectReason(core: ProcurementCoreRecord, query: string): string | null {
  if (!core.title || !core.url) return 'missing_identity';
  if (core.content_type === 'navigation') return 'navigation_only';

  const searchable = `${core.title} ${core.snippet} ${core.url}`.toLowerCase();
  const hasQuery = queryMatched(searchable, query);
  if (!hasQuery) return 'query_mismatch';
  return null;
}

function dedupeByTitleUrl<T extends { title: string; url: string }>(items: T[]): T[] {
  const deduped: T[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = `${item.title}\t${item.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

export function formatTaxonomyError(
  taxonomy: ProcurementTaxonomy,
  {
    site,
    command,
    detail,
  }: {
    site: string;
    command: 'search' | 'detail';
    detail: string;
  },
): string {
  return `[taxonomy=${taxonomy}] site=${site} command=${command} ${cleanText(detail)}`;
}

export function taxonomyError(
  taxonomy: ProcurementTaxonomy,
  context: {
    site: string;
    command: 'search' | 'detail';
    detail: string;
  },
): Error {
  return new Error(formatTaxonomyError(taxonomy, context));
}

export function toProcurementSearchRecords(
  rows: ProcurementSearchCandidateRaw[],
  {
    site,
    query,
    limit,
  }: {
    site: string;
    query: string;
    limit: number;
  },
): ProcurementSearchRecord[] {
  const normalizedRows = dedupeByTitleUrl(rows.map((row) => normalizeCoreRecord(row, { sourceSite: site })));
  const accepted: ProcurementCoreRecord[] = [];
  for (const row of normalizedRows) {
    const rejectReason = qualityRejectReason(row, query);
    if (rejectReason) continue;
    accepted.push(row);
  }

  if (normalizedRows.length > 0 && accepted.length === 0) {
    throw taxonomyError('extraction_drift', {
      site,
      command: 'search',
      detail: `all rows rejected by quality gate (raw=${normalizedRows.length})`,
    });
  }

  return accepted
    .slice(0, Math.max(1, limit))
    .map((row, index) => ({
      rank: index + 1,
      ...row,
    }));
}

export function toProcurementDetailRecord(
  {
    title,
    url,
    contextText,
    publishTime,
  }: {
    title: string;
    url: string;
    contextText: string;
    publishTime?: string;
  },
  {
    site,
    query = '',
  }: {
    site: string;
    query?: string;
  },
): ProcurementDetailRecord {
  const core = normalizeCoreRecord(
    {
      title,
      url,
      date: publishTime,
      contextText,
    },
    { sourceSite: site },
  );
  const detailText = cleanText(contextText).slice(0, 6000);
  const evidenceBlocks = splitEvidenceBlocks(detailText, query);
  return {
    ...core,
    detail_text: detailText,
    evidence_blocks: evidenceBlocks,
  };
}

export const __test__ = {
  classifyContentType,
  isDetailPage,
  splitEvidenceBlocks,
  qualityRejectReason,
};
