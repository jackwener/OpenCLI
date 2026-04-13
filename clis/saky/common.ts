import { CliError, ConfigError, getErrorMessage } from '@jackwener/opencli/errors';

export const SAKY_SITE = 'saky';
export const SAKY_DOMAIN = 'dataapi.weimeizi.com';
export const SAKY_DEFAULT_BASE_URL = `https://${SAKY_DOMAIN}/warehouse`;
export const SAKY_DOC_TITLE = '产品标签信息导出 API 文档 V1.0.0';
export const SAKY_DOC_SAMPLE_PT = '20260409';

export type SakyDatasetKey = 'tool' | 'electronics' | 'formula';

export interface SakyDatasetConfig {
  command: SakyDatasetKey;
  title: string;
  description: string;
  endpoint: string;
  columns: string[];
  keyFields: string[];
}

export const SAKY_DATASETS: Record<SakyDatasetKey, SakyDatasetConfig> = {
  tool: {
    command: 'tool',
    title: '工具类标签查询',
    description: '查询工具类产品标签信息（如牙刷、牙线）',
    endpoint: '/warehouse_ai/product_label_info_tool',
    columns: ['id', 'cpmc', 'cpmcdh', 'cptm', 'cppl', 'sqrq', 'bbh', 'pt'],
    keyFields: ['id', 'cpmc', 'cptm', 'cppl', 'pt'],
  },
  electronics: {
    command: 'electronics',
    title: '电子类标签查询',
    description: '查询电子类产品标签信息（如电动牙刷、冲牙器）',
    endpoint: '/warehouse_ai/product_label_info_electronics',
    columns: ['id', 'cpmc', 'cpmczj', 'cptm', 'cppl', 'xh', 'ys', 'pt'],
    keyFields: ['id', 'cpmc', 'cptm', 'cppl', 'pt'],
  },
  formula: {
    command: 'formula',
    title: '配方类标签查询',
    description: '查询配方类产品标签和成分信息（如牙膏、漱口水）',
    endpoint: '/warehouse_ai/product_label_info_formula',
    columns: ['id', 'cpmc', 'cpmc1', 'cptxm', 'fl', 'cppl', 'jhl', 'pt'],
    keyFields: ['id', 'cpmc', 'cptxm', 'cppl', 'pt'],
  },
};

interface SakyListResponse<T = Record<string, unknown>> {
  errCode?: number;
  errMsg?: string;
  requestId?: string;
  data?: {
    totalNum?: number;
    pageSize?: number;
    pageNum?: number;
    rows?: T[];
  };
}

function trimOrEmpty(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const text = trimOrEmpty(value);
    if (text) return text;
  }
  return '';
}

function formatShanghaiDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  return `${year}${month}${day}`;
}

function defaultPt(): string {
  return formatShanghaiDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
}

function parsePositiveInt(value: unknown, name: string, fallback: number, max: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new CliError('ARGUMENT', `${name} must be a positive integer.`, `Pass --${name} <number>.`);
  }
  return Math.min(numeric, max);
}

function parseBoolean(value: unknown, name: string, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = trimOrEmpty(value).toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  throw new CliError('ARGUMENT', `${name} must be true or false.`, `Pass --${name} true or --${name} false.`);
}

function resolveAppCode(kwargs: Record<string, unknown>): string {
  const appCode = firstNonEmpty(
    kwargs['app-code'],
    kwargs.appCode,
    process.env.SAKY_APPCODE,
    process.env.SAKY_APP_CODE,
  );
  if (!appCode) {
    throw new ConfigError(
      'Missing SAKY APPCODE.',
      'Pass --app-code <code> or set SAKY_APPCODE / SAKY_APP_CODE before running this command.',
    );
  }
  return appCode;
}

function resolveBaseUrl(kwargs: Record<string, unknown>): string {
  const baseUrl = firstNonEmpty(kwargs['base-url'], kwargs.baseUrl, process.env.SAKY_BASE_URL, SAKY_DEFAULT_BASE_URL)
    .replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new ConfigError(
      'SAKY base URL must start with http:// or https://.',
      `Current value: ${baseUrl}`,
    );
  }
  return baseUrl;
}

export function buildSakyFooter(kwargs: Record<string, unknown>): string {
  const pt = firstNonEmpty(kwargs.pt, process.env.SAKY_PT, defaultPt());
  const pageNum = parsePositiveInt(kwargs['page-num'] ?? kwargs.pageNum, 'page-num', 1, 100000);
  const pageSize = parsePositiveInt(kwargs['page-size'] ?? kwargs.pageSize, 'page-size', 10, 1000);
  return `pt=${pt} · page=${pageNum} · size=${pageSize}`;
}

export function sakyDocsRows(): Record<string, string>[] {
  return Object.values(SAKY_DATASETS).map((dataset) => ({
    command: `${SAKY_SITE}/${dataset.command}`,
    endpoint: dataset.endpoint,
    description: dataset.description,
    sample_pt: SAKY_DOC_SAMPLE_PT,
    key_fields: dataset.keyFields.join(', '),
  }));
}

export async function querySakyDataset(
  datasetKey: SakyDatasetKey,
  kwargs: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const dataset = SAKY_DATASETS[datasetKey];
  const pageNum = parsePositiveInt(kwargs['page-num'] ?? kwargs.pageNum, 'page-num', 1, 100000);
  const pageSize = parsePositiveInt(kwargs['page-size'] ?? kwargs.pageSize, 'page-size', 10, 1000);
  const pt = firstNonEmpty(kwargs.pt, process.env.SAKY_PT, defaultPt());
  if (!/^\d{8}$/.test(pt)) {
    throw new CliError('ARGUMENT', 'pt must use YYYYMMDD format.', 'Pass --pt 20260409');
  }
  const returnTotalNum = parseBoolean(
    kwargs['return-total-num'] ?? kwargs.returnTotalNum,
    'return-total-num',
    true,
  );
  const appCode = resolveAppCode(kwargs);
  const baseUrl = resolveBaseUrl(kwargs);

  const params = new URLSearchParams({
    pageNum: String(pageNum),
    pageSize: String(pageSize),
    pt,
    returnTotalNum: String(returnTotalNum),
  });
  const url = `${baseUrl}${dataset.endpoint}?${params.toString()}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `APPCODE ${appCode}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (error: unknown) {
    throw new CliError(
      'FETCH_ERROR',
      `Unable to reach SAKY API: ${getErrorMessage(error)}`,
      'Check your network connection, VPN, or SAKY_BASE_URL and try again.',
    );
  }

  const rawText = await response.text();
  let payload: SakyListResponse | string = rawText;
  if (rawText) {
    try {
      payload = JSON.parse(rawText) as SakyListResponse;
    } catch {
      payload = rawText;
    }
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object'
        ? trimOrEmpty(payload.errMsg) || `HTTP ${response.status}`
        : trimOrEmpty(payload) || `HTTP ${response.status}`;
    throw new CliError(
      'API_ERROR',
      `SAKY API request failed: ${message}`,
      'Check the APPCODE, base URL, and whether the requested partition exists.',
    );
  }

  if (!payload || typeof payload !== 'object') {
    throw new CliError(
      'API_ERROR',
      'SAKY API returned a non-JSON response.',
      'Check the upstream gateway or try again later.',
    );
  }

  if (payload.errCode !== 0) {
    const hint = payload.errCode === 1108110565
      ? `数仓查询异常，优先检查 --pt 是否正确。文档样例日期是 ${SAKY_DOC_SAMPLE_PT}。`
      : 'Check the APPCODE, requested partition, and upstream API status.';
    throw new CliError(
      'API_ERROR',
      `SAKY API error ${String(payload.errCode ?? 'unknown')}: ${trimOrEmpty(payload.errMsg) || 'unknown error'}`,
      hint,
    );
  }

  const rows = Array.isArray(payload.data?.rows) ? payload.data?.rows ?? [] : [];
  return rows.map((row) => ({
    ...(row as Record<string, unknown>),
    _requestId: payload.requestId ?? '',
    _pageNum: payload.data?.pageNum ?? pageNum,
    _pageSize: payload.data?.pageSize ?? pageSize,
    _totalNum: payload.data?.totalNum ?? '',
  }));
}
