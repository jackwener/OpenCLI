import { randomUUID } from 'node:crypto';
import { AuthRequiredError, CliError } from '../../errors.js';
import type { IPage } from '../../types.js';
import { bindCurrentTab } from '../../browser/daemon-client.js';
import {
  type NotebooklmAskRow,
  NOTEBOOKLM_DOMAIN,
  NOTEBOOKLM_HOME_URL,
  NOTEBOOKLM_SITE,
  type NotebooklmHistoryRow,
  type NotebooklmNotebookDetailRow,
  type NotebooklmNoteDetailRow,
  type NotebooklmNoteRow,
  type NotebooklmPageKind,
  type NotebooklmPageState,
  type NotebooklmRow,
  type NotebooklmSourceFulltextRow,
  type NotebooklmSourceGuideRow,
  type NotebooklmSourceRow,
  type NotebooklmSummaryRow,
} from './shared.js';
import {
  callNotebooklmRpc,
  buildNotebooklmRpcBody,
  extractNotebooklmRpcResult,
  fetchNotebooklmInPage,
  getNotebooklmPageAuth,
  parseNotebooklmChunkedResponse,
  stripNotebooklmAntiXssi,
} from './rpc.js';

export {
  buildNotebooklmRpcBody,
  extractNotebooklmRpcResult,
  fetchNotebooklmInPage,
  getNotebooklmPageAuth,
  parseNotebooklmChunkedResponse,
  stripNotebooklmAntiXssi,
} from './rpc.js';

const NOTEBOOKLM_LIST_RPC_ID = 'wXbhsf';
const NOTEBOOKLM_NOTEBOOK_DETAIL_RPC_ID = 'rLM1Ne';
const NOTEBOOKLM_HISTORY_THREADS_RPC_ID = 'hPTbtc';
const NOTEBOOKLM_HISTORY_DETAIL_RPC_ID = 'khqZz';
const NOTEBOOKLM_ASK_QUERY_URL =
  `https://${NOTEBOOKLM_DOMAIN}` +
  '/_/LabsTailwindUi/data/google.internal.labs.tailwind.orchestration.v1.LabsTailwindOrchestrationService/GenerateFreeFormStreamed';
const NOTEBOOKLM_ASK_BL =
  process.env.NOTEBOOKLM_BL ?? 'boq_labs-tailwind-frontend_20251221.14_p0';

function unwrapNotebooklmSingletonResult(result: unknown): unknown {
  let current = result;
  while (Array.isArray(current) && current.length === 1 && Array.isArray(current[0])) {
    current = current[0];
  }
  return current;
}

export function parseNotebooklmIdFromUrl(url: string): string {
  const match = url.match(/\/notebook\/([^/?#]+)/);
  return match?.[1] ?? '';
}

export function classifyNotebooklmPage(url: string): NotebooklmPageKind {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== NOTEBOOKLM_DOMAIN) return 'unknown';
    if (/\/notebook\/[^/?#]+/.test(parsed.pathname)) return 'notebook';
    return 'home';
  } catch {
    return 'unknown';
  }
}

export function normalizeNotebooklmTitle(value: unknown, fallback: string = ''): string {
  if (typeof value !== 'string') return fallback;
  let normalized = value.replace(/\s+/g, ' ').trim();
  if (/^Untitled\b/i.test(normalized) && /otebook$/i.test(normalized) && normalized !== 'Untitled notebook') {
    normalized = 'Untitled notebook';
  }
  return normalized || fallback;
}

function normalizeNotebooklmCreatedAt(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return trimmed;
  return new Date(parsed).toISOString();
}

function toNotebooklmIsoTimestamp(epochSeconds: unknown): string | null {
  if (typeof epochSeconds === 'number' && Number.isFinite(epochSeconds)) {
    try {
      return new Date(epochSeconds * 1000).toISOString();
    } catch {
      return null;
    }
  }

  if (Array.isArray(epochSeconds) && typeof epochSeconds[0] === 'number' && Number.isFinite(epochSeconds[0])) {
    const seconds = epochSeconds[0];
    const nanos = typeof epochSeconds[1] === 'number' && Number.isFinite(epochSeconds[1]) ? epochSeconds[1] : 0;
    try {
      return new Date(seconds * 1000 + Math.floor(nanos / 1_000_000)).toISOString();
    } catch {
      return null;
    }
  }

  return null;
}

function parseNotebooklmSourceTypeCode(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!Array.isArray(value) || typeof value[1] !== 'number' || !Number.isFinite(value[1])) return null;
  return value[1];
}

function parseNotebooklmSourceType(value: unknown): string | null {
  const code = parseNotebooklmSourceTypeCode(value);
  if (code === 8) return 'pasted-text';
  if (code === 9) return 'youtube';
  if (code === 2) return 'generated-text';
  if (code === 3) return 'pdf';
  if (code === 4) return 'audio';
  if (code === 5) return 'web';
  if (code === 6) return 'video';
  return code == null ? null : `type-${code}`;
}

function findFirstNotebooklmString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    const found = findFirstNotebooklmString(item);
    if (found) return found;
  }
  return null;
}

function isNotebooklmUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function collectNotebooklmStrings(value: unknown, results: string[]): string[] {
  if (typeof value === 'string') {
    const normalized = normalizeNotebooklmTitle(value);
    if (!normalized) return results;
    if (isNotebooklmUuid(normalized)) return results;
    if (/^[\d\s]+$/.test(normalized)) return results;
    if (/^(null|undefined)$/i.test(normalized)) return results;
    results.push(normalized);
    return results;
  }

  if (!Array.isArray(value)) return results;
  for (const item of value) collectNotebooklmStrings(item, results);
  return results;
}

function collectNotebooklmLeafStrings(value: unknown, results: string[]): string[] {
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (normalized) results.push(normalized);
    return results;
  }
  if (!Array.isArray(value)) return results;
  for (const item of value) collectNotebooklmLeafStrings(item, results);
  return results;
}

type NotebooklmRawNoteRow = {
  title?: string | null;
  text?: string | null;
};

type NotebooklmRawSummaryRow = {
  title?: string | null;
  summary?: string | null;
};

type NotebooklmRawVisibleNoteRow = {
  title?: string | null;
  content?: string | null;
};

function collectNotebooklmThreadIds(value: unknown, results: string[], seen: Set<string>): string[] {
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (isNotebooklmUuid(normalized) && !seen.has(normalized)) {
      seen.add(normalized);
      results.push(normalized);
    }
    return results;
  }

  if (!Array.isArray(value)) return results;
  for (const item of value) collectNotebooklmThreadIds(item, results, seen);
  return results;
}

export function parseNotebooklmHistoryThreadIdsResult(result: unknown): string[] {
  return collectNotebooklmThreadIds(result, [], new Set<string>());
}

export function extractNotebooklmHistoryPreview(result: unknown): string | null {
  const strings = collectNotebooklmStrings(result, []);
  return strings.length > 0 ? strings[0] : null;
}

export function buildNotebooklmAskBody(
  sourceIds: string[],
  prompt: string,
  csrfToken: string,
  conversationId: string,
): string {
  const params = [
    sourceIds.map((sourceId) => [[sourceId]]),
    prompt,
    null,
    [2, null, [1]],
    conversationId,
  ];
  const body = JSON.stringify([null, JSON.stringify(params)]);
  return `f.req=${encodeURIComponent(body)}&at=${encodeURIComponent(csrfToken)}&`;
}

function extractNotebooklmAskChunk(chunk: string): { text: string | null; isAnswer: boolean } {
  try {
    const parsed = JSON.parse(chunk);
    if (!Array.isArray(parsed)) return { text: null, isAnswer: false };

    for (const item of parsed) {
      if (!Array.isArray(item) || item[0] !== 'wrb.fr' || typeof item[2] !== 'string') continue;

      const inner = JSON.parse(item[2]);
      if (!Array.isArray(inner) || !Array.isArray(inner[0])) continue;

      const first = inner[0];
      const text = typeof first[0] === 'string' ? first[0].trim() : '';
      const isAnswer = Array.isArray(first[4]) && first[4].length > 0 && first[4][first[4].length - 1] === 1;
      if (text) return { text, isAnswer };
    }
  } catch {
    // Ignore malformed chunks and keep scanning.
  }

  return { text: null, isAnswer: false };
}

export function parseNotebooklmAskResponse(rawBody: string): string {
  const cleaned = stripNotebooklmAntiXssi(rawBody).trim();
  if (!cleaned) return '';

  const lines = cleaned.split('\n');
  let bestMarked = '';
  let bestUnmarked = '';

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim();
    if (!line) continue;

    const chunk = /^\d+$/.test(line) ? lines[i + 1]?.trim() ?? '' : line;
    if (/^\d+$/.test(line)) i += 1;
    if (!chunk) continue;

    const { text, isAnswer } = extractNotebooklmAskChunk(chunk);
    if (!text) continue;

    if (isAnswer) {
      if (text.length > bestMarked.length) bestMarked = text;
      continue;
    }

    if (text.length > bestUnmarked.length) bestUnmarked = text;
  }

  return bestMarked || bestUnmarked;
}

export function parseNotebooklmNoteListRawRows(
  rows: NotebooklmRawNoteRow[],
  notebookId: string,
  url: string,
): NotebooklmNoteRow[] {
  const parsed: Array<NotebooklmNoteRow | null> = rows.map((row) => {
      const title = normalizeNotebooklmTitle(row.title, '');
      const text = String(row.text ?? '')
        .replace(/\bsticky_note_2\b/g, ' ')
        .replace(/\bmore_vert\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!title) return null;
      const suffix = text.startsWith(title)
        ? text.slice(title.length).trim()
        : text.replace(title, '').trim();

      return {
        notebook_id: notebookId,
        title,
        created_at: suffix || null,
        url,
        source: 'studio-list' as const,
      };
    });

  return parsed.filter((row): row is NotebooklmNoteRow => row !== null);
}

function parseNotebooklmSummaryRawRow(
  row: NotebooklmRawSummaryRow | null | undefined,
  notebookId: string,
  url: string,
): NotebooklmSummaryRow | null {
  const title = normalizeNotebooklmTitle(row?.title, 'Untitled Notebook');
  const summary = String(row?.summary ?? '').trim();
  if (!summary) return null;

  return {
    notebook_id: notebookId,
    title,
    summary,
    url,
    source: 'summary-dom',
  };
}

function parseNotebooklmVisibleNoteRawRow(
  row: NotebooklmRawVisibleNoteRow | null | undefined,
  notebookId: string,
  url: string,
): NotebooklmNoteDetailRow | null {
  const title = normalizeNotebooklmTitle(row?.title, '');
  const content = String(row?.content ?? '').replace(/\r\n/g, '\n').trim();
  if (!title) return null;

  return {
    notebook_id: notebookId,
    id: null,
    title,
    content,
    url,
    source: 'studio-editor',
  };
}

export function parseNotebooklmListResult(result: unknown): NotebooklmRow[] {
  if (!Array.isArray(result) || result.length === 0) return [];
  const rawNotebooks = Array.isArray(result[0]) ? result[0] : result;
  if (!Array.isArray(rawNotebooks)) return [];

  return rawNotebooks
    .filter((item): item is unknown[] => Array.isArray(item))
    .map((item) => {
      const meta = Array.isArray(item[5]) ? item[5] : [];
      const timestamps = Array.isArray(meta[5]) ? meta[5] : [];
      const id = typeof item[2] === 'string' ? item[2] : '';
      const title = typeof item[0] === 'string'
        ? item[0].replace(/^thought\s*\n/, '')
        : '';

      return {
        id,
        title: normalizeNotebooklmTitle(title, 'Untitled Notebook'),
        url: `https://${NOTEBOOKLM_DOMAIN}/notebook/${id}`,
        source: 'rpc' as const,
        is_owner: meta.length > 1 ? meta[1] === false : true,
        created_at: timestamps.length > 0 ? toNotebooklmIsoTimestamp(timestamps[0]) : null,
      };
    })
    .filter((row) => row.id);
}

export function parseNotebooklmNotebookDetailResult(result: unknown): NotebooklmNotebookDetailRow | null {
  const detail = unwrapNotebooklmSingletonResult(result);
  if (!Array.isArray(detail) || detail.length < 3) return null;

  const id = typeof detail[2] === 'string' ? detail[2] : '';
  if (!id) return null;

  const title = normalizeNotebooklmTitle(detail[0], 'Untitled Notebook');
  const emoji = typeof detail[3] === 'string' ? detail[3] : null;
  const meta = Array.isArray(detail[5]) ? detail[5] : [];
  const sources = Array.isArray(detail[1]) ? detail[1] : [];

  return {
    id,
    title,
    url: `https://${NOTEBOOKLM_DOMAIN}/notebook/${id}`,
    source: 'rpc',
    is_owner: meta.length > 1 ? meta[1] === false : true,
    created_at: toNotebooklmIsoTimestamp(meta[8]),
    updated_at: toNotebooklmIsoTimestamp(meta[5]),
    emoji,
    source_count: sources.length,
  };
}

export function parseNotebooklmSourceListResult(result: unknown): NotebooklmSourceRow[] {
  const detail = unwrapNotebooklmSingletonResult(result);
  const notebook = parseNotebooklmNotebookDetailResult(detail);
  if (!notebook || !Array.isArray(detail)) return [];

  const rawSources = Array.isArray(detail[1]) ? detail[1] : [];
  return rawSources
    .filter((entry): entry is unknown[] => Array.isArray(entry))
    .map((entry) => {
      const id = findFirstNotebooklmString(entry[0]) ?? '';
      const title = normalizeNotebooklmTitle(entry[1], 'Untitled source');
      const meta = Array.isArray(entry[2]) ? entry[2] : [];
      const typeInfo = typeof meta[4] === 'number' ? meta[4] : entry[3];

      return {
        id,
        notebook_id: notebook.id,
        title,
        url: notebook.url,
        source: 'rpc' as const,
        type: parseNotebooklmSourceType(typeInfo),
        type_code: parseNotebooklmSourceTypeCode(typeInfo),
        size: typeof meta[1] === 'number' && Number.isFinite(meta[1]) ? meta[1] : null,
        created_at: toNotebooklmIsoTimestamp(meta[2]),
        updated_at: toNotebooklmIsoTimestamp(meta[14]),
      };
    })
    .filter((row) => row.id);
}

export function parseNotebooklmSourceGuideResult(
  result: unknown,
  source: Pick<NotebooklmSourceRow, 'id' | 'notebook_id' | 'title' | 'type'>,
): NotebooklmSourceGuideRow | null {
  if (!Array.isArray(result) || result.length === 0 || !Array.isArray(result[0])) return null;

  const outer = result[0];
  const guide = Array.isArray(outer) && outer.length > 0 && Array.isArray(outer[0])
    ? outer[0]
    : outer;
  if (!Array.isArray(guide)) return null;

  const summary = Array.isArray(guide[1]) && typeof guide[1][0] === 'string'
    ? guide[1][0].trim()
    : '';
  const keywords = Array.isArray(guide[2]) && Array.isArray(guide[2][0])
    ? guide[2][0].filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];

  if (!summary) return null;

  return {
    source_id: source.id,
    notebook_id: source.notebook_id,
    title: source.title,
    type: source.type ?? null,
    summary,
    keywords,
    source: 'rpc',
  };
}

export function parseNotebooklmSourceFulltextResult(
  result: unknown,
  notebookId: string,
  fallbackUrl: string,
): NotebooklmSourceFulltextRow | null {
  if (!Array.isArray(result) || result.length === 0 || !Array.isArray(result[0])) return null;

  const source = result[0];
  const sourceId = findFirstNotebooklmString(source[0]) ?? '';
  const title = normalizeNotebooklmTitle(source[1], 'Untitled source');
  const meta = Array.isArray(source[2]) ? source[2] : [];
  const url = Array.isArray(meta[7]) && typeof meta[7][0] === 'string' ? meta[7][0] : fallbackUrl;
  const kind = parseNotebooklmSourceType([null, meta[4]]);

  const contentRoot = Array.isArray(result[3]) && result[3].length > 0 ? result[3][0] : [];
  const content = collectNotebooklmLeafStrings(contentRoot, []).join('\n').trim();

  if (!sourceId || !content) return null;

  return {
    source_id: sourceId,
    notebook_id: notebookId,
    title,
    kind,
    content,
    char_count: content.length,
    url,
    source: 'rpc',
  };
}

export function findNotebooklmSourceRow(
  rows: NotebooklmSourceRow[],
  query: string,
): NotebooklmSourceRow | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;

  const exactId = rows.find((row) => row.id.trim().toLowerCase() === needle);
  if (exactId) return exactId;

  const exactTitle = rows.find((row) => row.title.trim().toLowerCase() === needle);
  if (exactTitle) return exactTitle;

  const partialMatches = rows.filter((row) => row.title.trim().toLowerCase().includes(needle));
  if (partialMatches.length === 1) return partialMatches[0];

  return null;
}

export function findNotebooklmNoteRow(
  rows: NotebooklmNoteRow[],
  query: string,
): NotebooklmNoteRow | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;

  const exactTitle = rows.find((row) => row.title.trim().toLowerCase() === needle);
  if (exactTitle) return exactTitle;

  const partialMatches = rows.filter((row) => row.title.trim().toLowerCase().includes(needle));
  if (partialMatches.length === 1) return partialMatches[0];

  return null;
}

export async function listNotebooklmViaRpc(page: IPage): Promise<NotebooklmRow[]> {
  const rpc = await callNotebooklmRpc(page, NOTEBOOKLM_LIST_RPC_ID, [null, 1, null, [2]]);
  return parseNotebooklmListResult(rpc.result);
}

export async function getNotebooklmDetailViaRpc(page: IPage): Promise<NotebooklmNotebookDetailRow | null> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId) return null;

  const rpc = await callNotebooklmRpc(
    page,
    NOTEBOOKLM_NOTEBOOK_DETAIL_RPC_ID,
    [state.notebookId, null, [2], null, 0],
  );
  return parseNotebooklmNotebookDetailResult(rpc.result);
}

export async function listNotebooklmSourcesViaRpc(page: IPage): Promise<NotebooklmSourceRow[]> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId) return [];

  const rpc = await callNotebooklmRpc(
    page,
    NOTEBOOKLM_NOTEBOOK_DETAIL_RPC_ID,
    [state.notebookId, null, [2], null, 0],
  );
  return parseNotebooklmSourceListResult(rpc.result);
}

export async function listNotebooklmHistoryViaRpc(page: IPage): Promise<NotebooklmHistoryRow[]> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId) return [];

  const threadsRpc = await callNotebooklmRpc(
    page,
    NOTEBOOKLM_HISTORY_THREADS_RPC_ID,
    [[], null, state.notebookId, 20],
  );
  const threadIds = parseNotebooklmHistoryThreadIdsResult(threadsRpc.result);
  if (threadIds.length === 0) return [];

  const rows: NotebooklmHistoryRow[] = [];
  for (const threadId of threadIds) {
    const detailRpc = await callNotebooklmRpc(
      page,
      NOTEBOOKLM_HISTORY_DETAIL_RPC_ID,
      [[], null, null, threadId, 20],
    );

    rows.push({
      notebook_id: state.notebookId,
      thread_id: threadId,
      item_count: Array.isArray(detailRpc.result) ? detailRpc.result.length : 0,
      preview: extractNotebooklmHistoryPreview(detailRpc.result),
      url: state.url || `https://${NOTEBOOKLM_DOMAIN}/notebook/${state.notebookId}`,
      source: 'rpc',
    });
  }

  return rows;
}

export async function listNotebooklmNotesFromPage(page: IPage): Promise<NotebooklmNoteRow[]> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId) return [];

  const raw = await page.evaluate(`(() => {
    return Array.from(document.querySelectorAll('artifact-library-note')).map((node) => {
      const titleNode = node.querySelector('.artifact-title');
      return {
        title: (titleNode?.textContent || '').trim(),
        text: (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim(),
      };
    });
  })()`) as NotebooklmRawNoteRow[] | null;

  if (!Array.isArray(raw) || raw.length === 0) return [];
  return parseNotebooklmNoteListRawRows(
    raw,
    state.notebookId,
    state.url || `https://${NOTEBOOKLM_DOMAIN}/notebook/${state.notebookId}`,
  );
}

export async function readNotebooklmSummaryFromPage(page: IPage): Promise<NotebooklmSummaryRow | null> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId) return null;

  const raw = await page.evaluate(`(() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    const title = normalize(document.querySelector('.notebook-title, h1, [data-testid="notebook-title"]')?.textContent || document.title || '');
    const summaryNode = document.querySelector('.notebook-summary, .summary-content, [class*="summary"]');
    const summary = normalize(summaryNode?.textContent || '');
    return { title, summary };
  })()`) as NotebooklmRawSummaryRow | null;

  return parseNotebooklmSummaryRawRow(
    raw,
    state.notebookId,
    state.url || `https://${NOTEBOOKLM_DOMAIN}/notebook/${state.notebookId}`,
  );
}

export async function getNotebooklmSummaryViaRpc(page: IPage): Promise<NotebooklmSummaryRow | null> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId) return null;

  const rpc = await callNotebooklmRpc(
    page,
    NOTEBOOKLM_NOTEBOOK_DETAIL_RPC_ID,
    [state.notebookId, null, [2], null, 0],
  );
  const detail = unwrapNotebooklmSingletonResult(rpc.result);
  if (!Array.isArray(detail)) return null;

  const title = normalizeNotebooklmTitle(detail[0], 'Untitled Notebook');
  const summary = detail
    .filter((value, index) => index !== 0 && index !== 2 && index !== 3)
    .find((value) => typeof value === 'string' && value.trim().length >= 80);

  if (typeof summary !== 'string') return null;

  return {
    notebook_id: state.notebookId,
    title,
    summary: summary.trim(),
    url: state.url || `https://${NOTEBOOKLM_DOMAIN}/notebook/${state.notebookId}`,
    source: 'rpc',
  };
}

export async function getNotebooklmSourceFulltextViaRpc(
  page: IPage,
  sourceId: string,
): Promise<NotebooklmSourceFulltextRow | null> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId || !sourceId) return null;

  const rpc = await callNotebooklmRpc(
    page,
    'hizoJc',
    [[sourceId], [2], [2]],
  );
  return parseNotebooklmSourceFulltextResult(
    rpc.result,
    state.notebookId,
    state.url || `https://${NOTEBOOKLM_DOMAIN}/notebook/${state.notebookId}`,
  );
}

export async function getNotebooklmSourceGuideViaRpc(
  page: IPage,
  source: Pick<NotebooklmSourceRow, 'id' | 'notebook_id' | 'title' | 'type'>,
): Promise<NotebooklmSourceGuideRow | null> {
  if (!source.id) return null;

  const rpc = await callNotebooklmRpc(
    page,
    'tr032e',
    [[[[source.id]]]],
  );

  return parseNotebooklmSourceGuideResult(rpc.result, source);
}

export async function askNotebooklmQuestionViaQuery(
  page: IPage,
  prompt: string,
): Promise<NotebooklmAskRow | null> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId) return null;

  const sources = await listNotebooklmSourcesViaRpc(page);
  const sourceIds = sources
    .map((row) => row.id)
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  if (sourceIds.length === 0) {
    throw new CliError(
      'NOTEBOOKLM_QUERY',
      'NotebookLM ask could not resolve source ids for the current notebook',
      'Retry after the notebook sources finish loading, then rerun the ask command.',
    );
  }

  const auth = await getNotebooklmPageAuth(page);
  const body = buildNotebooklmAskBody(sourceIds, prompt, auth.csrfToken, randomUUID());
  const urlParams = new URLSearchParams({
    bl: NOTEBOOKLM_ASK_BL,
    hl: 'en',
    _reqid: String(Date.now()),
    rt: 'c',
  });
  if (auth.sessionId) urlParams.set('f.sid', auth.sessionId);

  const response = await fetchNotebooklmInPage(page, `${NOTEBOOKLM_ASK_QUERY_URL}?${urlParams.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body,
  });

  if (response.status === 401 || response.status === 403) {
    throw new AuthRequiredError(
      NOTEBOOKLM_DOMAIN,
      `NotebookLM ask returned auth error (${response.status})`,
    );
  }

  if (!response.ok) {
    throw new CliError(
      'NOTEBOOKLM_QUERY',
      `NotebookLM ask request failed with HTTP ${response.status}`,
      'Retry from an already logged-in NotebookLM notebook tab.',
    );
  }

  const answer = parseNotebooklmAskResponse(response.body).trim();
  if (!answer) return null;

  return {
    notebook_id: state.notebookId,
    prompt,
    answer,
    url: state.url || `https://${NOTEBOOKLM_DOMAIN}/notebook/${state.notebookId}`,
    source: 'query-endpoint',
  };
}

export async function readNotebooklmVisibleNoteFromPage(page: IPage): Promise<NotebooklmNoteDetailRow | null> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId) return null;

  const raw = await page.evaluate(`(() => {
    const normalizeText = (value) => (value || '').replace(/\\u00a0/g, ' ').replace(/\\r\\n/g, '\\n').trim();
    const titleNode = document.querySelector('.note-header__editable-title');
    const title = titleNode instanceof HTMLInputElement || titleNode instanceof HTMLTextAreaElement
      ? titleNode.value
      : (titleNode?.textContent || '');
    const editor = document.querySelector('.note-editor .ql-editor, .note-editor [contenteditable="true"], .note-editor textarea');
    let content = '';
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      content = editor.value || '';
    } else if (editor) {
      content = editor.innerText || editor.textContent || '';
    }
    return {
      title: normalizeText(title),
      content: normalizeText(content),
    };
  })()`) as NotebooklmRawVisibleNoteRow | null;

  return parseNotebooklmVisibleNoteRawRow(
    raw,
    state.notebookId,
    state.url || `https://${NOTEBOOKLM_DOMAIN}/notebook/${state.notebookId}`,
  );
}

export async function ensureNotebooklmHome(page: IPage): Promise<void> {
  const currentUrl = page.getCurrentUrl
    ? await page.getCurrentUrl().catch(() => null)
    : null;
  const currentKind = currentUrl ? classifyNotebooklmPage(currentUrl) : 'unknown';
  if (currentKind === 'home') return;
  await page.goto(NOTEBOOKLM_HOME_URL);
  await page.wait(2);
}

export async function ensureNotebooklmNotebookBinding(page: IPage): Promise<boolean> {
  if (!page.getCurrentUrl) return false;
  if (process.env.OPENCLI_CDP_ENDPOINT) return false;

  const currentUrl = await page.getCurrentUrl().catch(() => null);
  if (currentUrl && classifyNotebooklmPage(currentUrl) === 'notebook') return false;

  try {
    await bindCurrentTab(`site:${NOTEBOOKLM_SITE}`, {
      matchDomain: NOTEBOOKLM_DOMAIN,
      matchPathPrefix: '/notebook/',
    });
    return true;
  } catch {
    return false;
  }
}

export async function getNotebooklmPageState(page: IPage): Promise<NotebooklmPageState> {
  const raw = await page.evaluate(`(() => {
    const url = window.location.href;
    const title = document.title || '';
    const hostname = window.location.hostname || '';
    const notebookMatch = url.match(/\\/notebook\\/([^/?#]+)/);
    const notebookId = notebookMatch ? notebookMatch[1] : '';
    const path = window.location.pathname || '/';
    const kind = notebookId
      ? 'notebook'
      : (hostname === 'notebooklm.google.com' ? 'home' : 'unknown');

    const textNodes = Array.from(document.querySelectorAll('a, button, [role="button"], h1, h2'))
      .map(node => (node.textContent || '').trim().toLowerCase())
      .filter(Boolean);
    const loginRequired = textNodes.some(text =>
      text.includes('sign in') ||
      text.includes('log in') ||
      text.includes('登录') ||
      text.includes('登入')
    );

    const notebookCount = Array.from(document.querySelectorAll('a[href*="/notebook/"]'))
      .map(node => node instanceof HTMLAnchorElement ? node.href : '')
      .filter(Boolean)
      .reduce((count, href, index, list) => list.indexOf(href) === index ? count + 1 : count, 0);

    return { url, title, hostname, kind, notebookId, loginRequired, notebookCount, path };
  })()`) as Partial<NotebooklmPageState> | null;

  const state: NotebooklmPageState = {
    url: String(raw?.url ?? ''),
    title: normalizeNotebooklmTitle(raw?.title, 'NotebookLM'),
    hostname: String(raw?.hostname ?? ''),
    kind: raw?.kind === 'notebook' || raw?.kind === 'home' ? raw.kind : 'unknown',
    notebookId: String(raw?.notebookId ?? ''),
    loginRequired: Boolean(raw?.loginRequired),
    notebookCount: Number(raw?.notebookCount ?? 0),
  };

  // Notebook pages can still contain "sign in" or login-related text fragments
  // even when the active Google session is valid. Prefer the real page tokens
  // as the stronger auth signal before declaring the session unauthenticated.
  if (state.hostname === NOTEBOOKLM_DOMAIN && state.loginRequired) {
    try {
      await getNotebooklmPageAuth(page);
      state.loginRequired = false;
    } catch {
      // Keep the heuristic result when page auth tokens are genuinely unavailable.
    }
  }

  return state;
}

export async function readCurrentNotebooklm(page: IPage): Promise<NotebooklmRow | null> {
  const raw = await page.evaluate(`(() => {
    const url = window.location.href;
    const match = url.match(/\\/notebook\\/([^/?#]+)/);
    if (!match) return null;

    const titleNode = document.querySelector('h1, [data-testid="notebook-title"], [role="heading"]');
    const title = (titleNode?.textContent || document.title || '').trim();
    return {
      id: match[1],
      title,
      url,
      source: 'current-page',
    };
  })()`) as NotebooklmRow | null;

  if (!raw) return null;
  return {
    id: String(raw.id ?? ''),
    title: normalizeNotebooklmTitle(raw.title, 'Untitled Notebook'),
    url: String(raw.url ?? ''),
    source: 'current-page',
    is_owner: true,
    created_at: null,
  };
}

export async function listNotebooklmLinks(page: IPage): Promise<NotebooklmRow[]> {
  const raw = await page.evaluate(`(() => {
    const rows = [];
    const seen = new Set();

    for (const node of Array.from(document.querySelectorAll('a[href*="/notebook/"]'))) {
      if (!(node instanceof HTMLAnchorElement)) continue;
      const href = node.href || '';
      const match = href.match(/\\/notebook\\/([^/?#]+)/);
      if (!match) continue;
      const id = match[1];
      if (seen.has(id)) continue;
      seen.add(id);

      const parentCard = node.closest('mat-card, [role="listitem"], article, div');
      const titleNode = parentCard?.querySelector('.project-button-title, [id$="-title"]');
      const subtitleTitleNode = parentCard?.querySelector('.project-button-subtitle-part[title]');
      const subtitleTextNode = parentCard?.querySelector('.project-button-subtitle-part, .project-button-subtitle');
      const parentText = (parentCard?.textContent || '').trim();
      const parentLines = parentText
        .split(/\\n+/)
        .map((value) => value.trim())
        .filter(Boolean);

      const title = (
        titleNode?.textContent ||
        node.getAttribute('aria-label') ||
        node.getAttribute('title') ||
        parentLines.find((line) => !line.includes('个来源') && !line.includes('sources') && !line.includes('more_vert')) ||
        node.textContent ||
        ''
      ).trim();
      const createdAtHint = (
        subtitleTitleNode?.getAttribute?.('title') ||
        subtitleTextNode?.textContent ||
        ''
      ).trim();

      rows.push({
        id,
        title,
        url: href,
        source: 'home-links',
        is_owner: true,
        created_at: createdAtHint || null,
      });
    }

    return rows;
  })()`) as NotebooklmRow[] | null;

  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => ({
      id: String(row.id ?? ''),
      title: normalizeNotebooklmTitle(row.title, 'Untitled Notebook'),
      url: String(row.url ?? ''),
      source: 'home-links' as const,
      is_owner: row.is_owner === false ? false : true,
      created_at: normalizeNotebooklmCreatedAt(row.created_at),
    }))
    .filter((row) => row.id && row.url);
}

export async function listNotebooklmSourcesFromPage(page: IPage): Promise<NotebooklmSourceRow[]> {
  const raw = await page.evaluate(`(() => {
    const notebookMatch = window.location.href.match(/\\/notebook\\/([^/?#]+)/);
    const notebookId = notebookMatch ? notebookMatch[1] : '';
    if (!notebookId) return [];

    const skip = new Set([
      '选择所有来源',
      '添加来源',
      '收起来源面板',
      '更多',
      'Web',
      'Fast Research',
      '提交',
      '创建笔记本',
      '分享笔记本',
      '设置',
      '对话选项',
      '配置笔记本',
      '音频概览',
      '演示文稿',
      '视频概览',
      '思维导图',
      '报告',
      '闪卡',
      '测验',
      '信息图',
      '数据表格',
      '添加笔记',
      '保存到笔记',
      '复制摘要',
      '摘要很棒',
      '摘要欠佳',
    ]);

    const rows = [];
    const seen = new Set();
    for (const node of Array.from(document.querySelectorAll('button, [role="button"], input[type="checkbox"]'))) {
      const text = (node.getAttribute?.('aria-label') || node.textContent || '').trim();
      if (!text || skip.has(text) || seen.has(text)) continue;
      if (text.includes('个来源') || text.includes('来源') && text.length < 5) continue;
      seen.add(text);
      rows.push({
        id: text,
        notebook_id: notebookId,
        title: text,
        url: window.location.href,
        source: 'current-page',
      });
    }
    return rows;
  })()`) as NotebooklmSourceRow[] | null;

  if (!Array.isArray(raw)) return [];
  return raw.filter((row) => row.id && row.title);
}

export async function requireNotebooklmSession(page: IPage): Promise<NotebooklmPageState> {
  const state = await getNotebooklmPageState(page);
  if (state.hostname !== NOTEBOOKLM_DOMAIN) {
    throw new CliError(
      'NOTEBOOKLM_UNAVAILABLE',
      'NotebookLM page is not available in the current browser session',
      `Open Chrome and navigate to ${NOTEBOOKLM_HOME_URL}`,
    );
  }
  if (state.loginRequired) {
    throw new AuthRequiredError(NOTEBOOKLM_DOMAIN, 'NotebookLM requires a logged-in Google session');
  }
  return state;
}
