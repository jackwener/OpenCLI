import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve as resolvePath } from 'node:path';
import { AuthRequiredError, CliError } from '../../errors.js';
import { formatCookieHeader, httpDownload } from '../../download/index.js';
import { fetchWithNodeNetwork } from '../../node-network.js';
import { browserSession, getBrowserFactory } from '../../runtime.js';
import type { IPage } from '../../types.js';
import { bindCurrentTab } from '../../browser/daemon-client.js';
import {
  type NotebooklmAskRow,
  type NotebooklmAudioDownloadRow,
  type NotebooklmDownloadListRow,
  type NotebooklmGenerateRow,
  type NotebooklmGenerationErrorType,
  type NotebooklmVideoDownloadRow,
  NOTEBOOKLM_DOMAIN,
  NOTEBOOKLM_HOME_URL,
  NOTEBOOKLM_SITE,
  type NotebooklmHistoryRow,
  type NotebooklmLanguageRow,
  type NotebooklmLanguageStatusRow,
  type NotebooklmNotebookDescriptionRow,
  type NotebooklmNotebookDetailRow,
  type NotebooklmNoteDeleteRow,
  type NotebooklmNoteDetailRow,
  type NotebooklmNoteRow,
  type NotebooklmPageKind,
  type NotebooklmPageState,
  type NotebooklmReportDownloadRow,
  type NotebooklmRow,
  type NotebooklmSlideDeckDownloadFormat,
  type NotebooklmSlideDeckDownloadRow,
  type NotebooklmShareStatusRow,
  type NotebooklmShareUserRow,
  type NotebooklmSourceFulltextRow,
  type NotebooklmSourceDeleteRow,
  type NotebooklmSourceFreshnessRow,
  type NotebooklmSourceGuideRow,
  type NotebooklmSourceRefreshRow,
  type NotebooklmSourceRow,
  type NotebooklmSummaryRow,
} from './shared.js';
import { NOTEBOOKLM_SUPPORTED_LANGUAGES } from './languages.js';
import {
  callNotebooklmRpc,
  buildNotebooklmRpcBody,
  extractNotebooklmRpcUserDisplayableError,
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
const NOTEBOOKLM_CREATE_NOTEBOOK_RPC_ID = 'CCqFvf';
const NOTEBOOKLM_HISTORY_THREADS_RPC_ID = 'hPTbtc';
const NOTEBOOKLM_HISTORY_DETAIL_RPC_ID = 'khqZz';
const NOTEBOOKLM_LIST_ARTIFACTS_RPC_ID = 'gArtLc';
const NOTEBOOKLM_CREATE_ARTIFACT_RPC_ID = 'R7cb6c';
const NOTEBOOKLM_ADD_FILE_RPC_ID = 'o4cbdc';
const NOTEBOOKLM_ASK_QUERY_URL =
  `https://${NOTEBOOKLM_DOMAIN}` +
  '/_/LabsTailwindUi/data/google.internal.labs.tailwind.orchestration.v1.LabsTailwindOrchestrationService/GenerateFreeFormStreamed';
const NOTEBOOKLM_UPLOAD_URL = `https://${NOTEBOOKLM_DOMAIN}/upload/_/`;
const NOTEBOOKLM_ASK_BL =
  process.env.NOTEBOOKLM_BL ?? 'boq_labs-tailwind-frontend_20251221.14_p0';
const NOTEBOOKLM_ARTIFACT_STATUS_COMPLETED = 3;
const NOTEBOOKLM_ARTIFACT_TYPE_AUDIO = 1;
const NOTEBOOKLM_ARTIFACT_TYPE_REPORT = 2;
const NOTEBOOKLM_ARTIFACT_TYPE_VIDEO = 3;
const NOTEBOOKLM_ARTIFACT_TYPE_SLIDE_DECK = 8;
const NOTEBOOKLM_SOURCE_STATUS_PROCESSING = 1;
const NOTEBOOKLM_SOURCE_STATUS_READY = 2;
const NOTEBOOKLM_SOURCE_STATUS_ERROR = 3;
const NOTEBOOKLM_SOURCE_STATUS_PREPARING = 5;
const NOTEBOOKLM_DOWNLOADABLE_ARTIFACT_TYPES = new Map<number, NotebooklmDownloadListRow['artifact_type']>([
  [NOTEBOOKLM_ARTIFACT_TYPE_REPORT, 'report'],
  [NOTEBOOKLM_ARTIFACT_TYPE_AUDIO, 'audio'],
  [NOTEBOOKLM_ARTIFACT_TYPE_VIDEO, 'video'],
  [NOTEBOOKLM_ARTIFACT_TYPE_SLIDE_DECK, 'slide_deck'],
]);

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

function parseNotebooklmSharePermission(value: unknown): NotebooklmShareUserRow['permission'] {
  if (value === 1) return 'owner';
  if (value === 2) return 'editor';
  if (value === 3) return 'viewer';
  return 'unknown';
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

export function extractNotebooklmStableIdFromHints(hints: unknown[]): string | null {
  for (const hint of hints) {
    if (typeof hint !== 'string') continue;
    const trimmed = hint.trim();
    if (!trimmed) continue;

    const labelledIdMatch = trimmed.match(/(?:note|artifact)-labels-([A-Za-z0-9_-]{6,})/i);
    if (labelledIdMatch?.[1]) return labelledIdMatch[1];

    const uuidMatch = trimmed.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuidMatch?.[0]) return uuidMatch[0];
  }

  return null;
}

export function resolveNotebooklmVisibleNoteId(
  visible: Pick<NotebooklmNoteDetailRow, 'id' | 'title' | 'content'>,
  rows: NotebooklmNoteDetailRow[],
): NotebooklmVisibleNoteIdResolution {
  const visibleId = typeof visible.id === 'string' ? visible.id.trim() : '';
  if (visibleId) {
    return { id: visibleId, reason: 'visible-id' };
  }

  const normalizedTitle = visible.title.trim().toLowerCase();
  const normalizedContent = visible.content.replace(/\r\n/g, '\n').trim();
  const titleMatches = rows.filter((row) => row.title.trim().toLowerCase() === normalizedTitle);
  if (titleMatches.length === 0) return { id: null, reason: 'missing' };

  const contentMatches = titleMatches.filter(
    (row) => row.content.replace(/\r\n/g, '\n').trim() === normalizedContent,
  );
  if (contentMatches.length === 1) {
    return { id: contentMatches[0]?.id ?? null, reason: 'title-content' };
  }
  if (contentMatches.length > 1) {
    return { id: null, reason: 'ambiguous' };
  }

  if (titleMatches.length === 1) {
    return { id: titleMatches[0]?.id ?? null, reason: 'title' };
  }

  return { id: null, reason: 'ambiguous' };
}

type NotebooklmRawNoteRow = {
  id?: string | null;
  title?: string | null;
  text?: string | null;
};

type NotebooklmRawSummaryRow = {
  title?: string | null;
  summary?: string | null;
};

type NotebooklmRawVisibleNoteRow = {
  id?: string | null;
  title?: string | null;
  content?: string | null;
};

type NotebooklmVisibleNoteIdResolution = {
  id: string | null;
  reason: 'visible-id' | 'title-content' | 'title' | 'missing' | 'ambiguous';
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

export function buildNotebooklmAddTextParams(
  title: string,
  content: string,
  notebookId: string,
): unknown[] {
  return [
    [[null, [title, content], null, null, null, null, null, null]],
    notebookId,
    [2],
    null,
    null,
  ];
}

export function buildNotebooklmAddFileParams(
  filename: string,
  notebookId: string,
): unknown[] {
  return [
    [[filename]],
    notebookId,
    [2],
    [1, null, null, null, null, null, null, null, null, null, [1]],
  ];
}

export function buildNotebooklmCreateNotebookParams(title: string): unknown[] {
  return [
    title,
    null,
    null,
    [2],
    [1, null, null, null, null, null, null, null, null, null, [1]],
  ];
}

export function buildNotebooklmRenameNotebookParams(
  notebookId: string,
  title: string,
): unknown[] {
  return [
    notebookId,
    [[null, null, null, [null, title]]],
  ];
}

export function buildNotebooklmDeleteNotebookParams(notebookId: string): unknown[] {
  return [
    [notebookId],
    [2],
  ];
}

export function buildNotebooklmRemoveFromRecentParams(notebookId: string): unknown[] {
  return [notebookId];
}

export function buildNotebooklmAddUrlParams(
  url: string,
  notebookId: string,
): unknown[] {
  return [
    [[null, null, [url], null, null, null, null, null]],
    notebookId,
    [2],
    null,
    null,
  ];
}

export function buildNotebooklmAddYoutubeParams(
  url: string,
  notebookId: string,
): unknown[] {
  return [
    [[null, null, null, null, null, null, null, [url], null, null, 1]],
    notebookId,
    [2],
    [1, null, null, null, null, null, null, null, null, null, [1]],
  ];
}

export function buildNotebooklmRenameSourceParams(
  sourceId: string,
  title: string,
): unknown[] {
  return [null, [sourceId], [[[title]]]];
}

export function buildNotebooklmUpdateNoteParams(
  notebookId: string,
  noteId: string,
  title: string,
  content: string,
): unknown[] {
  return [
    notebookId,
    noteId,
    [[[content, title, [], 0]]],
  ];
}

export function buildNotebooklmCreateNoteParams(notebookId: string): unknown[] {
  return [notebookId, '', [1], null, 'New Note'];
}

export function buildNotebooklmDeleteNoteParams(notebookId: string, noteId: string): unknown[] {
  return [notebookId, null, [noteId]];
}

export function buildNotebooklmGetLanguageParams(): unknown[] {
  return [null, [1, null, null, null, null, null, null, null, null, null, [1]]];
}

export function buildNotebooklmSetLanguageParams(language: string): unknown[] {
  return [[[null, [[null, null, null, null, [language]]]]]];
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

function isNotebooklmYoutubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === 'youtu.be') return parsed.pathname.length > 1;
    if (!host.endsWith('youtube.com')) return false;
    if (parsed.pathname === '/watch') return parsed.searchParams.has('v');
    return /^\/(shorts|embed|live)\//.test(parsed.pathname);
  } catch {
    return false;
  }
}

function extractNotebooklmNestedString(value: unknown, path: number[]): string | null {
  let current = value;
  for (const index of path) {
    if (!Array.isArray(current) || current.length <= index) return null;
    current = current[index];
  }
  return typeof current === 'string' && current.trim() ? current : null;
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

export function parseNotebooklmArtifactListResult(result: unknown): unknown[][] {
  const rows = Array.isArray(result) && Array.isArray(result[0])
    ? result[0]
    : Array.isArray(result)
      ? result
      : [];

  return rows.filter((row): row is unknown[] => Array.isArray(row));
}

function getNotebooklmArtifactCreatedAt(row: unknown[]): number {
  const createdAt = row[15];
  if (Array.isArray(createdAt) && typeof createdAt[0] === 'number' && Number.isFinite(createdAt[0])) {
    return createdAt[0];
  }
  return 0;
}

function parseNotebooklmArtifactStatus(statusCode: unknown): string {
  const value = Number(statusCode ?? NaN);
  if (!Number.isFinite(value)) return 'unknown';
  return value === NOTEBOOKLM_ARTIFACT_STATUS_COMPLETED ? 'completed' : `status_${value}`;
}

function parseNotebooklmGenerationStatus(statusCode: unknown): NotebooklmGenerateRow['status'] {
  const value = Number(statusCode ?? NaN);
  if (!Number.isFinite(value)) return 'failed';
  if (value === 1) return 'in_progress';
  if (value === 2) return 'pending';
  if (value === 3) return 'completed';
  if (value === 4) return 'failed';
  return 'unknown';
}

function buildNotebooklmGenerateSourceTriples(sourceIds: string[]): string[][][] {
  return sourceIds.map((sourceId) => [[sourceId]]);
}

function buildNotebooklmGenerateSourceDoubles(sourceIds: string[]): string[][] {
  return sourceIds.map((sourceId) => [sourceId]);
}

export function buildNotebooklmGenerateReportParams(
  notebookId: string,
  sourceIds: string[],
): unknown[] {
  const sourceTriples = buildNotebooklmGenerateSourceTriples(sourceIds);
  const sourceDoubles = buildNotebooklmGenerateSourceDoubles(sourceIds);

  return [
    [2],
    notebookId,
    [
      null,
      null,
      NOTEBOOKLM_ARTIFACT_TYPE_REPORT,
      sourceTriples,
      null,
      null,
      null,
      [
        null,
        [
          'Briefing Doc',
          'Key insights and important quotes',
          null,
          sourceDoubles,
          'en',
          'Create a comprehensive briefing document that includes an Executive Summary, detailed analysis of key themes, important quotes with context, and actionable insights.',
          null,
          true,
        ],
      ],
    ],
  ];
}

export function buildNotebooklmGenerateAudioParams(
  notebookId: string,
  sourceIds: string[],
): unknown[] {
  const sourceTriples = buildNotebooklmGenerateSourceTriples(sourceIds);
  const sourceDoubles = buildNotebooklmGenerateSourceDoubles(sourceIds);

  return [
    [2],
    notebookId,
    [
      null,
      null,
      NOTEBOOKLM_ARTIFACT_TYPE_AUDIO,
      sourceTriples,
      null,
      null,
      [
        null,
        [
          null,
          null,
          null,
          sourceDoubles,
          'en',
          null,
          null,
        ],
      ],
    ],
  ];
}

export function buildNotebooklmGenerateSlideDeckParams(
  notebookId: string,
  sourceIds: string[],
): unknown[] {
  const sourceTriples = buildNotebooklmGenerateSourceTriples(sourceIds);

  return [
    [2],
    notebookId,
    [
      null,
      null,
      NOTEBOOKLM_ARTIFACT_TYPE_SLIDE_DECK,
      sourceTriples,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      [[null, 'en', null, null]],
    ],
  ];
}

export function parseNotebooklmGenerationResult(
  result: unknown,
): Pick<NotebooklmGenerateRow, 'artifact_id' | 'status'> {
  const firstRow = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : null;
  const artifactId = typeof firstRow?.[0] === 'string' && firstRow[0].trim()
    ? firstRow[0].trim()
    : null;
  const statusCode = firstRow?.[4];

  return {
    artifact_id: artifactId,
    status: artifactId ? parseNotebooklmGenerationStatus(statusCode) : 'failed',
  };
}

export function classifyNotebooklmGenerationFailureMessage(
  message: string | null | undefined,
): NotebooklmGenerationErrorType {
  const normalized = typeof message === 'string' ? message.trim().toLowerCase() : '';
  if (!normalized) return 'generation_failed_unknown';

  if (
    /daily .*limit|limit reached|quota|try again tomorrow|每日|上限|额度|改日再来|数量上限/.test(normalized)
  ) {
    return 'daily_limit_reached';
  }

  if (
    /not enough content|insufficient content|insufficient information|need more content|need more sources|more material|内容不足|材料不足|信息不足|更多来源/.test(normalized)
  ) {
    return 'content_insufficient';
  }

  if (
    /not eligible|eligible|upgrade|premium|plus|pro plan|进行升级|升级|资格/.test(normalized)
  ) {
    return 'feature_not_eligible';
  }

  return 'generation_failed_unknown';
}

export function parseNotebooklmGenerationFailureFromRpcBody(
  rawBody: string,
): Pick<NotebooklmGenerateRow, 'error_type' | 'message'> | null {
  const displayable = extractNotebooklmRpcUserDisplayableError(rawBody, NOTEBOOKLM_CREATE_ARTIFACT_RPC_ID);
  if (!displayable) return null;

  const message = typeof displayable.message === 'string' && displayable.message.trim()
    ? displayable.message.trim()
    : null;

  return {
    error_type: classifyNotebooklmGenerationFailureMessage(message),
    message,
  };
}

function mapNotebooklmStreamingVariantCodeToLabel(code: unknown): string | null {
  const value = Number(code ?? NaN);
  if (!Number.isFinite(value)) return null;
  if (value === 2) return 'hls';
  if (value === 3) return 'dash';
  return null;
}

function extractNotebooklmVariantLabels(mediaList: unknown): string[] {
  if (!Array.isArray(mediaList)) return [];

  const labels: string[] = [];
  for (const item of mediaList) {
    if (!Array.isArray(item) || typeof item[0] !== 'string' || !item[0].trim()) continue;

    const mimeType = typeof item[2] === 'string' && item[2].trim() ? item[2].trim() : null;
    const label = mimeType ?? mapNotebooklmStreamingVariantCodeToLabel(item[1]);
    if (label && !labels.includes(label)) labels.push(label);
  }

  return labels;
}

export function selectNotebooklmCompletedArtifact(
  rows: unknown[][],
  typeCode: number,
  artifactId?: string | null,
): unknown[] | null {
  const candidates = rows.filter((row) =>
    Number(row[2] ?? 0) === typeCode &&
    Number(row[4] ?? 0) === NOTEBOOKLM_ARTIFACT_STATUS_COMPLETED);

  if (artifactId) {
    return candidates.find((row) => String(row[0] ?? '') === artifactId) ?? null;
  }

  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => getNotebooklmArtifactCreatedAt(b) - getNotebooklmArtifactCreatedAt(a))[0];
}

export function extractNotebooklmReportMarkdown(row: unknown[] | null): string | null {
  if (!Array.isArray(row) || row.length <= 7) return null;
  const content = row[7];
  if (typeof content === 'string') return content;
  if (Array.isArray(content) && typeof content[0] === 'string') return content[0];
  return null;
}

export function extractNotebooklmAudioDownloadVariant(
  row: unknown[] | null,
): { url: string; mime_type: string | null } | null {
  if (!Array.isArray(row) || row.length <= 6) return null;
  const metadata = row[6];
  if (!Array.isArray(metadata) || metadata.length <= 5 || !Array.isArray(metadata[5])) return null;

  const mediaList = metadata[5];
  for (const item of mediaList) {
    if (!Array.isArray(item) || typeof item[0] !== 'string' || !item[0].trim()) continue;
    if (item.length > 2 && item[2] === 'audio/mp4') {
      return {
        url: item[0].trim(),
        mime_type: 'audio/mp4',
      };
    }
  }

  const fallback = mediaList[0];
  if (Array.isArray(fallback) && typeof fallback[0] === 'string' && fallback[0].trim()) {
    return {
      url: fallback[0].trim(),
      mime_type: typeof fallback[2] === 'string' ? fallback[2] : null,
    };
  }

  return null;
}

export function extractNotebooklmVideoDownloadVariant(
  row: unknown[] | null,
): { url: string; mime_type: string | null } | null {
  if (!Array.isArray(row) || row.length <= 8) return null;
  const metadata = row[8];
  if (!Array.isArray(metadata) || metadata.length <= 4 || !Array.isArray(metadata[4])) return null;

  const mediaList = metadata[4];
  for (const item of mediaList) {
    if (!Array.isArray(item) || typeof item[0] !== 'string' || !item[0].trim()) continue;
    if (item.length > 2 && item[2] === 'video/mp4') {
      return {
        url: item[0].trim(),
        mime_type: 'video/mp4',
      };
    }
  }

  const fallback = mediaList[0];
  if (Array.isArray(fallback) && typeof fallback[0] === 'string' && fallback[0].trim()) {
    return {
      url: fallback[0].trim(),
      mime_type: typeof fallback[2] === 'string' ? fallback[2] : null,
    };
  }

  return null;
}

export function extractNotebooklmSlideDeckDownloadUrl(
  row: unknown[] | null,
  outputFormat: NotebooklmSlideDeckDownloadFormat = 'pdf',
): string | null {
  if (!Array.isArray(row) || row.length <= 16) return null;
  const payload = row[16];
  if (!Array.isArray(payload)) return null;

  const slotIndex = outputFormat === 'pptx' ? 4 : 3;
  const candidate = payload[slotIndex];
  return typeof candidate === 'string' && candidate.trim()
    ? candidate.trim()
    : null;
}

export function parseNotebooklmDownloadListRows(
  rows: unknown[][],
  notebookId: string,
  url: string,
): NotebooklmDownloadListRow[] {
  const parsed: Array<NotebooklmDownloadListRow | null> = rows
    .filter((row) => NOTEBOOKLM_DOWNLOADABLE_ARTIFACT_TYPES.has(Number(row[2] ?? 0)))
    .map((row) => {
      const typeCode = Number(row[2] ?? 0);
      const artifactType = NOTEBOOKLM_DOWNLOADABLE_ARTIFACT_TYPES.get(typeCode);
      if (!artifactType) return null;

      let downloadVariants: string[] = [];
      if (artifactType === 'report') {
        downloadVariants = extractNotebooklmReportMarkdown(row) ? ['markdown'] : [];
      } else if (artifactType === 'audio') {
        downloadVariants = extractNotebooklmVariantLabels(Array.isArray(row[6]) ? row[6][5] : null);
      } else if (artifactType === 'video') {
        downloadVariants = extractNotebooklmVariantLabels(Array.isArray(row[8]) ? row[8][4] : null);
      } else if (artifactType === 'slide_deck') {
        const variants: string[] = [];
        if (extractNotebooklmSlideDeckDownloadUrl(row, 'pdf')) variants.push('pdf');
        if (extractNotebooklmSlideDeckDownloadUrl(row, 'pptx')) variants.push('pptx');
        downloadVariants = variants;
      }

      return {
        notebook_id: notebookId,
        artifact_id: String(row[0] ?? ''),
        artifact_type: artifactType,
        status: parseNotebooklmArtifactStatus(row[4]),
        title: normalizeNotebooklmTitle(row[1], `Untitled ${artifactType}`),
        created_at: toNotebooklmIsoTimestamp(row[15]),
        download_variants: downloadVariants,
        source: 'rpc+artifact-list' as const,
      };
    })
    .filter((row): row is NotebooklmDownloadListRow => row !== null && Boolean(row.artifact_id));

  const filtered = parsed.filter((row) => row !== null && Boolean(row.artifact_id)) as NotebooklmDownloadListRow[];

  return filtered.sort((a, b) => {
    const left = Date.parse(b.created_at ?? '') || 0;
    const right = Date.parse(a.created_at ?? '') || 0;
    return left - right;
  });
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
        id: extractNotebooklmStableIdFromHints([row.id]),
        title,
        created_at: suffix || null,
        url,
        source: 'studio-list' as const,
      };
    });

  return parsed.filter((row): row is NotebooklmNoteRow => row !== null);
}

export function parseNotebooklmNotesRpcResult(
  result: unknown,
  notebookId: string,
  url: string,
): NotebooklmNoteDetailRow[] {
  if (!Array.isArray(result) || !Array.isArray(result[0])) return [];

  return result[0]
    .filter((item): item is unknown[] => Array.isArray(item) && typeof item[0] === 'string')
    .filter((item) => !(item[1] == null && item[2] === 2))
    .map((item) => {
      let title = '';
      let content = '';

      if (typeof item[1] === 'string') {
        content = item[1];
      } else if (Array.isArray(item[1])) {
        const inner = item[1];
        content = typeof inner[1] === 'string' ? inner[1] : '';
        title = typeof inner[4] === 'string' ? inner[4] : '';
      }

      return {
        notebook_id: notebookId,
        id: String(item[0]),
        title: normalizeNotebooklmTitle(title, ''),
        content: String(content),
        url,
        source: 'rpc' as const,
      };
    })
    .filter((row) => row.id && row.title);
}

export function parseNotebooklmShareStatusResult(
  result: unknown,
  notebookId: string,
): NotebooklmShareStatusRow | null {
  if (!Array.isArray(result)) return null;

  const sharedUsers = Array.isArray(result[0])
    ? result[0]
        .filter((item): item is unknown[] => Array.isArray(item) && typeof item[0] === 'string')
        .map((item) => ({
          email: String(item[0]),
          permission: parseNotebooklmSharePermission(item[1]),
          display_name: Array.isArray(item[3]) && typeof item[3][0] === 'string' ? item[3][0] : null,
          avatar_url: Array.isArray(item[3]) && typeof item[3][1] === 'string' ? item[3][1] : null,
        }))
    : [];

  const isPublic = Array.isArray(result[1]) && result[1][0] === 1;

  return {
    notebook_id: notebookId,
    is_public: isPublic,
    access: isPublic ? 'anyone_with_link' : 'restricted',
    view_level: 'full',
    share_url: isPublic ? `https://${NOTEBOOKLM_DOMAIN}/notebook/${notebookId}` : null,
    shared_user_count: sharedUsers.length,
    shared_users: sharedUsers,
    source: 'rpc',
  };
}

export function parseNotebooklmLanguageGetResult(result: unknown): string | null {
  return extractNotebooklmNestedString(result, [0, 2, 4, 0]);
}

export function parseNotebooklmLanguageSetResult(result: unknown): string | null {
  return extractNotebooklmNestedString(result, [2, 4, 0]);
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
    id: extractNotebooklmStableIdFromHints([row?.id]),
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
  return parseNotebooklmSourceListRows(result, false);
}

export function parseNotebooklmSourceListResultWithStatus(result: unknown): NotebooklmSourceRow[] {
  return parseNotebooklmSourceListRows(result, true);
}

function parseNotebooklmSourceListRows(
  result: unknown,
  withStatus: boolean,
): NotebooklmSourceRow[] {
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
      const statusCode = Array.isArray(entry[3]) && typeof entry[3][1] === 'number'
        ? entry[3][1]
        : null;
      const row: NotebooklmSourceRow = {
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

      if (withStatus) {
        row.status_code = statusCode;
        row.status = parseNotebooklmSourceStatus(statusCode);
      }

      return row;
    })
    .filter((row) => row.id);
}

export function parseNotebooklmCreatedSourceResult(
  result: unknown,
  notebookId: string,
  fallbackUrl: string,
): NotebooklmSourceRow | null {
  const raw = unwrapNotebooklmSingletonResult(result);
  if (!Array.isArray(raw)) return null;

  const entry = (
    raw.length >= 2 &&
    (typeof raw[1] === 'string' || Array.isArray(raw[2]))
  )
    ? raw
    : Array.isArray(raw[0])
      ? raw[0]
      : raw;
  if (!Array.isArray(entry)) return null;

  const id = findFirstNotebooklmString(entry[0]) ?? '';
  if (!id) return null;

  const title = normalizeNotebooklmTitle(entry[1], 'Untitled source');
  const meta = Array.isArray(entry[2]) ? entry[2] : [];
  const typeInfo = typeof meta[4] === 'number' ? meta[4] : entry[3];

  return {
    id,
    notebook_id: notebookId,
    title,
    url: fallbackUrl,
    source: 'rpc',
    type: parseNotebooklmSourceType(typeInfo),
    type_code: parseNotebooklmSourceTypeCode(typeInfo),
    size: typeof meta[1] === 'number' && Number.isFinite(meta[1]) ? meta[1] : null,
    created_at: toNotebooklmIsoTimestamp(meta[2]),
    updated_at: toNotebooklmIsoTimestamp(meta[14]),
  };
}

export function parseNotebooklmSourceFreshnessResult(result: unknown): boolean {
  if (result === true) return true;
  if (result === false) return false;
  if (!Array.isArray(result)) return false;
  if (result.length === 0) return true;

  const first = result[0];
  if (Array.isArray(first) && first.length > 1 && first[1] === true) {
    return true;
  }

  return false;
}

export function parseNotebooklmNotebookDescriptionResult(
  result: unknown,
  notebookId: string,
  url: string,
): NotebooklmNotebookDescriptionRow | null {
  if (!Array.isArray(result)) return null;

  const summary = Array.isArray(result[0]) && typeof result[0][0] === 'string'
    ? result[0][0].trim()
    : '';
  const suggestedTopics = Array.isArray(result[1]) && Array.isArray(result[1][0])
    ? result[1][0]
        .filter((topic): topic is unknown[] => Array.isArray(topic))
        .map((topic) => ({
          question: typeof topic[0] === 'string' ? topic[0].trim() : '',
          prompt: typeof topic[1] === 'string' ? topic[1].trim() : '',
        }))
        .filter((topic) => topic.question || topic.prompt)
    : [];

  if (!summary && suggestedTopics.length === 0) return null;

  return {
    notebook_id: notebookId,
    summary,
    suggested_topics: suggestedTopics,
    suggested_topic_count: suggestedTopics.length,
    url,
    source: 'rpc',
  };
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

export async function createNotebooklmNotebookViaRpc(
  page: IPage,
  title: string,
): Promise<NotebooklmNotebookDetailRow | null> {
  const rpc = await callNotebooklmRpc(
    page,
    NOTEBOOKLM_CREATE_NOTEBOOK_RPC_ID,
    buildNotebooklmCreateNotebookParams(title),
    { sourcePath: '/' },
  );
  return parseNotebooklmNotebookDetailResult(rpc.result);
}

export async function getNotebooklmDetailViaRpc(page: IPage): Promise<NotebooklmNotebookDetailRow | null> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId) return null;

  return getNotebooklmDetailByIdViaRpc(page, state.notebookId);
}

export async function getNotebooklmDetailByIdViaRpc(
  page: IPage,
  notebookId: string,
): Promise<NotebooklmNotebookDetailRow | null> {
  const rpc = await callNotebooklmRpc(
    page,
    NOTEBOOKLM_NOTEBOOK_DETAIL_RPC_ID,
    [notebookId, null, [2], null, 0],
    { sourcePath: `/notebook/${notebookId}` },
  );
  return parseNotebooklmNotebookDetailResult(rpc.result);
}

export async function renameNotebooklmNotebookViaRpc(
  page: IPage,
  notebookId: string,
  title: string,
): Promise<NotebooklmNotebookDetailRow | null> {
  await callNotebooklmRpc(
    page,
    's0tc2d',
    buildNotebooklmRenameNotebookParams(notebookId, title),
    { sourcePath: '/' },
  );

  return getNotebooklmDetailByIdViaRpc(page, notebookId);
}

export async function deleteNotebooklmNotebookViaRpc(
  page: IPage,
  notebookId: string,
): Promise<{ notebook_id: string; deleted: true; source: 'rpc' }> {
  await callNotebooklmRpc(
    page,
    'WWINqb',
    buildNotebooklmDeleteNotebookParams(notebookId),
    { sourcePath: '/' },
  );

  return {
    notebook_id: notebookId,
    deleted: true,
    source: 'rpc',
  };
}

export async function removeNotebooklmFromRecentViaRpc(
  page: IPage,
  notebookId: string,
): Promise<{ notebook_id: string; removed_from_recent: true; source: 'rpc' }> {
  await callNotebooklmRpc(
    page,
    'fejl7e',
    buildNotebooklmRemoveFromRecentParams(notebookId),
    { sourcePath: '/' },
  );

  return {
    notebook_id: notebookId,
    removed_from_recent: true,
    source: 'rpc',
  };
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

export async function listNotebooklmSourcesViaRpcWithStatus(page: IPage): Promise<NotebooklmSourceRow[]> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId) return [];

  const rpc = await callNotebooklmRpc(
    page,
    NOTEBOOKLM_NOTEBOOK_DETAIL_RPC_ID,
    [state.notebookId, null, [2], null, 0],
  );
  return parseNotebooklmSourceListResultWithStatus(rpc.result);
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
      const labelledNode = node.querySelector('[aria-labelledby^="note-labels-"], [aria-labelledby^="artifact-labels-"], [id^="note-labels-"], [id^="artifact-labels-"]');
      return {
        id: node.getAttribute('aria-labelledby') || labelledNode?.getAttribute?.('aria-labelledby') || labelledNode?.id || '',
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

export async function describeNotebooklmNotebookViaRpc(
  page: IPage,
  notebookId: string,
): Promise<NotebooklmNotebookDescriptionRow | null> {
  const url = `https://${NOTEBOOKLM_DOMAIN}/notebook/${notebookId}`;
  if (typeof page.goto === 'function') {
    await page.goto(url);
    if (typeof page.wait === 'function') {
      await page.wait(2);
    }
  }

  const rpc = await callNotebooklmRpc(
    page,
    'VfAZjd',
    [notebookId, [2]],
    { sourcePath: `/notebook/${notebookId}` },
  );
  const parsed = parseNotebooklmNotebookDescriptionResult(
    rpc.result,
    notebookId,
    url,
  );
  if (parsed) return parsed;

  const domSummary = await readNotebooklmSummaryFromPage(page);
  if (domSummary) {
    return {
      notebook_id: notebookId,
      summary: domSummary.summary,
      suggested_topics: [],
      suggested_topic_count: 0,
      url,
      source: domSummary.source,
    };
  }

  const rpcSummary = await getNotebooklmSummaryViaRpc(page).catch(() => null);
  if (!rpcSummary) return null;

  return {
    notebook_id: notebookId,
    summary: rpcSummary.summary,
    suggested_topics: [],
    suggested_topic_count: 0,
    url,
    source: rpcSummary.source,
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

export async function addNotebooklmTextSourceViaRpc(
  page: IPage,
  title: string,
  content: string,
): Promise<NotebooklmSourceRow | null> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId) return null;

  const rpc = await callNotebooklmRpc(
    page,
    'izAoDd',
    buildNotebooklmAddTextParams(title, content, state.notebookId),
  );

  return parseNotebooklmCreatedSourceResult(
    rpc.result,
    state.notebookId,
    state.url || `https://${NOTEBOOKLM_DOMAIN}/notebook/${state.notebookId}`,
  );
}

export async function addNotebooklmUrlSourceViaRpc(
  page: IPage,
  url: string,
): Promise<NotebooklmSourceRow | null> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId) return null;

  const rpc = await callNotebooklmRpc(
    page,
    'izAoDd',
    isNotebooklmYoutubeUrl(url)
      ? buildNotebooklmAddYoutubeParams(url, state.notebookId)
      : buildNotebooklmAddUrlParams(url, state.notebookId),
  );

  return parseNotebooklmCreatedSourceResult(
    rpc.result,
    state.notebookId,
    state.url || `https://${NOTEBOOKLM_DOMAIN}/notebook/${state.notebookId}`,
  );
}

function parseNotebooklmSourceStatus(statusCode: unknown): NotebooklmSourceRow['status'] {
  const value = Number(statusCode ?? NaN);
  if (!Number.isFinite(value)) return 'unknown';

  switch (value) {
    case NOTEBOOKLM_SOURCE_STATUS_PROCESSING:
      return 'processing';
    case NOTEBOOKLM_SOURCE_STATUS_READY:
      return 'ready';
    case NOTEBOOKLM_SOURCE_STATUS_ERROR:
      return 'error';
    case NOTEBOOKLM_SOURCE_STATUS_PREPARING:
      return 'preparing';
    default:
      return 'unknown';
  }
}

function getNotebooklmAuthuser(): string {
  const raw = String(process.env.NOTEBOOKLM_AUTHUSER ?? '0').trim();
  return /^\d+$/.test(raw) ? raw : '0';
}

function extractFirstNotebooklmNestedString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (!Array.isArray(value)) return null;

  for (const item of value) {
    const nested = extractFirstNotebooklmNestedString(item);
    if (nested) return nested;
  }

  return null;
}

export async function addNotebooklmFileSourceViaUpload(
  page: IPage,
  filePath: string,
): Promise<NotebooklmSourceRow | null> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId) return null;

  const resolvedPath = resolvePath(filePath);
  const fileInfo = await stat(resolvedPath).catch(() => null);
  if (!fileInfo) {
    throw new CliError(
      'NOTEBOOKLM_SOURCE_FILE_NOT_FOUND',
      `NotebookLM source file was not found: ${resolvedPath}`,
      'Provide a readable local file path and retry.',
    );
  }
  if (!fileInfo.isFile()) {
    throw new CliError(
      'NOTEBOOKLM_SOURCE_FILE_INVALID',
      `NotebookLM source path is not a regular file: ${resolvedPath}`,
      'Provide a regular local file path and retry.',
    );
  }

  const filename = basename(resolvedPath);
  const registerRpc = await callNotebooklmRpc(
    page,
    NOTEBOOKLM_ADD_FILE_RPC_ID,
    buildNotebooklmAddFileParams(filename, state.notebookId),
    { sourcePath: `/notebook/${state.notebookId}` },
  );
  const sourceId = extractFirstNotebooklmNestedString(registerRpc.result);
  if (!sourceId) {
    throw new CliError(
      'NOTEBOOKLM_SOURCE_ADD_FILE_REGISTER',
      `NotebookLM did not return a source id for file "${filename}"`,
      'Retry from the target notebook page. If it persists, the NotebookLM file-upload RPC may have changed.',
    );
  }

  const cookieHeader = formatCookieHeader(await page.getCookies({ url: NOTEBOOKLM_HOME_URL }));
  const authuser = getNotebooklmAuthuser();
  const startUploadResponse = await fetchWithNodeNetwork(
    `${NOTEBOOKLM_UPLOAD_URL}?authuser=${encodeURIComponent(authuser)}`,
    {
      method: 'POST',
      headers: {
        Accept: '*/*',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        Origin: `https://${NOTEBOOKLM_DOMAIN}`,
        Referer: NOTEBOOKLM_HOME_URL,
        'x-goog-authuser': authuser,
        'x-goog-upload-command': 'start',
        'x-goog-upload-header-content-length': String(fileInfo.size),
        'x-goog-upload-protocol': 'resumable',
      },
      body: JSON.stringify({
        PROJECT_ID: state.notebookId,
        SOURCE_NAME: filename,
        SOURCE_ID: sourceId,
      }),
    },
  );
  if (!startUploadResponse.ok) {
    throw new CliError(
      'NOTEBOOKLM_SOURCE_ADD_FILE_UPLOAD_START',
      `NotebookLM upload session start failed with HTTP ${startUploadResponse.status}`,
      'Refresh the NotebookLM notebook page and retry the file upload.',
    );
  }

  const uploadUrl = startUploadResponse.headers.get('x-goog-upload-url');
  if (!uploadUrl) {
    throw new CliError(
      'NOTEBOOKLM_SOURCE_ADD_FILE_UPLOAD_URL',
      `NotebookLM did not return an upload URL for file "${filename}"`,
      'Retry the file upload from the target notebook page.',
    );
  }

  const uploadInit = {
    method: 'POST',
    headers: {
      Accept: '*/*',
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      Origin: `https://${NOTEBOOKLM_DOMAIN}`,
      Referer: NOTEBOOKLM_HOME_URL,
      'x-goog-authuser': authuser,
      'x-goog-upload-command': 'upload, finalize',
      'x-goog-upload-offset': '0',
    },
    body: createReadStream(resolvedPath) as unknown as BodyInit,
    duplex: 'half' as const,
  } as RequestInit & { duplex: 'half' };

  const uploadResponse = await fetchWithNodeNetwork(uploadUrl, uploadInit);
  if (!uploadResponse.ok) {
    throw new CliError(
      'NOTEBOOKLM_SOURCE_ADD_FILE_UPLOAD',
      `NotebookLM file upload failed with HTTP ${uploadResponse.status}`,
      'Retry the file upload. If it persists, the NotebookLM resumable-upload flow may have changed.',
    );
  }

  return {
    id: sourceId,
    notebook_id: state.notebookId,
    title: filename,
    url: state.url || `https://${NOTEBOOKLM_DOMAIN}/notebook/${state.notebookId}`,
    source: 'rpc',
    type: null,
    type_code: null,
    size: fileInfo.size,
    created_at: null,
    updated_at: null,
    status: 'preparing',
    status_code: NOTEBOOKLM_SOURCE_STATUS_PREPARING,
  };
}

export async function renameNotebooklmSourceViaRpc(
  page: IPage,
  sourceId: string,
  title: string,
): Promise<NotebooklmSourceRow | null> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId || !sourceId) return null;

  const rpc = await callNotebooklmRpc(
    page,
    'b7Wfje',
    buildNotebooklmRenameSourceParams(sourceId, title),
    { sourcePath: `/notebook/${state.notebookId}` },
  );

  return parseNotebooklmCreatedSourceResult(
    rpc.result,
    state.notebookId,
    state.url || `https://${NOTEBOOKLM_DOMAIN}/notebook/${state.notebookId}`,
  ) ?? {
    id: sourceId,
    notebook_id: state.notebookId,
    title,
    url: state.url || `https://${NOTEBOOKLM_DOMAIN}/notebook/${state.notebookId}`,
    source: 'rpc',
    type: null,
    type_code: null,
    size: null,
    created_at: null,
    updated_at: null,
  };
}

export async function deleteNotebooklmSourceViaRpc(
  page: IPage,
  sourceId: string,
): Promise<NotebooklmSourceDeleteRow | null> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId || !sourceId) return null;

  await callNotebooklmRpc(
    page,
    'tGMBJ',
    [[[sourceId]]],
    { sourcePath: `/notebook/${state.notebookId}` },
  );

  return {
    notebook_id: state.notebookId,
    source_id: sourceId,
    deleted: true,
    source: 'rpc',
  };
}

export async function refreshNotebooklmSourceViaRpc(
  page: IPage,
  sourceId: string,
): Promise<NotebooklmSourceRefreshRow | null> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId || !sourceId) return null;

  await callNotebooklmRpc(
    page,
    'FLmJqe',
    [null, [sourceId], [2]],
    { sourcePath: `/notebook/${state.notebookId}` },
  );

  return {
    notebook_id: state.notebookId,
    source_id: sourceId,
    refreshed: true,
    source: 'rpc',
  };
}

export async function checkNotebooklmSourceFreshnessViaRpc(
  page: IPage,
  sourceId: string,
): Promise<NotebooklmSourceFreshnessRow | null> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId || !sourceId) return null;

  const rpc = await callNotebooklmRpc(
    page,
    'yR9Yof',
    [null, [sourceId], [2]],
    { sourcePath: `/notebook/${state.notebookId}` },
  );

  const isFresh = parseNotebooklmSourceFreshnessResult(rpc.result);
  return {
    notebook_id: state.notebookId,
    source_id: sourceId,
    is_fresh: isFresh,
    is_stale: !isFresh,
    source: 'rpc',
  };
}

export async function waitForNotebooklmSourcesReadyViaRpc(
  page: IPage,
  sourceIds: string[],
  options: {
    timeout?: number;
    initialInterval?: number;
    maxInterval?: number;
    backoffFactor?: number;
  } = {},
): Promise<NotebooklmSourceRow[]> {
  const ids = sourceIds.map((value) => value.trim()).filter(Boolean);
  if (ids.length === 0) return [];

  const timeout = Number.isFinite(options.timeout) ? Number(options.timeout) : 120;
  const initialInterval = Number.isFinite(options.initialInterval) ? Number(options.initialInterval) : 1;
  const maxInterval = Number.isFinite(options.maxInterval) ? Number(options.maxInterval) : 10;
  const backoffFactor = Number.isFinite(options.backoffFactor) ? Number(options.backoffFactor) : 1.5;

  const startedAt = Date.now();
  let intervalSeconds = initialInterval;

  while (true) {
    const rows = await listNotebooklmSourcesViaRpcWithStatus(page);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const matched = ids.map((id) => byId.get(id) ?? null);
    const failed = matched.find((row) => row?.status_code === NOTEBOOKLM_SOURCE_STATUS_ERROR) ?? null;
    if (failed) {
      throw new CliError(
        'NOTEBOOKLM_SOURCE_PROCESSING_FAILED',
        `NotebookLM source "${failed.id}" failed while processing`,
        'Open the notebook in Chrome and inspect the source error state, then retry the ingest if needed.',
      );
    }

    if (matched.every((row) => row?.status_code === NOTEBOOKLM_SOURCE_STATUS_READY)) {
      return matched.filter((row): row is NotebooklmSourceRow => Boolean(row));
    }

    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    if (elapsedSeconds >= timeout) {
      const pendingIds = matched
        .map((row, index) => (row?.status_code === NOTEBOOKLM_SOURCE_STATUS_READY ? null : ids[index]))
        .filter((value): value is string => Boolean(value));
      throw new CliError(
        'NOTEBOOKLM_SOURCE_WAIT_TIMEOUT',
        `NotebookLM source wait timed out after ${timeout} seconds for: ${pendingIds.join(', ')}`,
        'Retry notebooklm source wait after the notebook finishes processing its sources.',
      );
    }

    const remainingSeconds = Math.max(0, timeout - elapsedSeconds);
    const sleepSeconds = Math.min(intervalSeconds, remainingSeconds);
    if (sleepSeconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, sleepSeconds * 1000));
    }
    intervalSeconds = Math.min(intervalSeconds * backoffFactor, maxInterval);
  }
}

export async function waitForNotebooklmSourceReadyViaRpc(
  page: IPage,
  sourceId: string,
  options: {
    timeout?: number;
    initialInterval?: number;
    maxInterval?: number;
    backoffFactor?: number;
  } = {},
): Promise<NotebooklmSourceRow | null> {
  const rows = await waitForNotebooklmSourcesReadyViaRpc(page, [sourceId], options);
  return rows[0] ?? null;
}

export async function listNotebooklmArtifactsViaRpc(page: IPage): Promise<unknown[][]> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId) return [];

  const rpc = await callNotebooklmRpc(
    page,
    NOTEBOOKLM_LIST_ARTIFACTS_RPC_ID,
    [[2], state.notebookId, 'NOT artifact.status = "ARTIFACT_STATUS_SUGGESTED"'],
  );

  return parseNotebooklmArtifactListResult(rpc.result);
}

function selectNotebooklmGeneratedArtifact(
  rows: unknown[][],
  typeCode: number,
  baselineIds: Set<string>,
  artifactId?: string | null,
): unknown[] | null {
  const candidates = rows.filter((row) => Number(row[2] ?? 0) === typeCode);
  if (artifactId) {
    return candidates.find((row) => String(row[0] ?? '') === artifactId) ?? null;
  }

  const newCandidates = candidates.filter((row) => !baselineIds.has(String(row[0] ?? '')));
  if (newCandidates.length === 0) return null;
  return [...newCandidates].sort((a, b) => getNotebooklmArtifactCreatedAt(b) - getNotebooklmArtifactCreatedAt(a))[0];
}

async function waitForNotebooklmGeneratedArtifactViaRpc(
  page: IPage,
  options: {
    artifactType: NotebooklmGenerateRow['artifact_type'];
    typeCode: number;
    baselineIds: Set<string>;
    artifactId?: string | null;
    timeout?: number;
    initialInterval?: number;
    maxInterval?: number;
    backoffFactor?: number;
    isReady?: (row: unknown[]) => boolean;
  },
): Promise<unknown[] | null> {
  const timeout = Number.isFinite(options.timeout) ? Number(options.timeout) : 180;
  const initialInterval = Number.isFinite(options.initialInterval) ? Number(options.initialInterval) : 2;
  const maxInterval = Number.isFinite(options.maxInterval) ? Number(options.maxInterval) : 10;
  const backoffFactor = Number.isFinite(options.backoffFactor) ? Number(options.backoffFactor) : 1.5;

  const startedAt = Date.now();
  let intervalSeconds = initialInterval;

  while (true) {
    const rows = await listNotebooklmArtifactsViaRpc(page);
    const artifact = selectNotebooklmGeneratedArtifact(
      rows,
      options.typeCode,
      options.baselineIds,
      options.artifactId,
    );

    if (artifact) {
      const status = parseNotebooklmGenerationStatus(artifact[4]);
      const ready = typeof options.isReady === 'function' ? options.isReady(artifact) : true;
      if (status === 'failed' || (status === 'completed' && ready)) {
        return artifact;
      }
    }

    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    if (elapsedSeconds >= timeout) {
      throw new CliError(
        'NOTEBOOKLM_GENERATION_WAIT_TIMEOUT',
        `NotebookLM ${options.artifactType} generation wait timed out after ${timeout} seconds`,
        'Retry without --wait to capture the submission handle immediately, or re-run download/list after NotebookLM finishes generating the artifact.',
      );
    }

    const remainingSeconds = Math.max(0, timeout - elapsedSeconds);
    const sleepSeconds = Math.min(intervalSeconds, remainingSeconds);
    if (sleepSeconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, sleepSeconds * 1000));
    }
    intervalSeconds = Math.min(intervalSeconds * backoffFactor, maxInterval);
  }
}

export async function generateNotebooklmReportViaRpc(
  page: IPage,
  options: {
    wait?: boolean;
    timeout?: number;
    initialInterval?: number;
    maxInterval?: number;
    backoffFactor?: number;
  } = {},
): Promise<NotebooklmGenerateRow | null> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId) return null;

  const sources = await listNotebooklmSourcesViaRpc(page);
  const sourceIds = sources
    .map((row) => (typeof row.id === 'string' ? row.id.trim() : ''))
    .filter(Boolean);
  if (sourceIds.length === 0) return null;

  const baselineRows = await listNotebooklmArtifactsViaRpc(page);
  const baselineIds = new Set(
    baselineRows
      .filter((row) => Number(row[2] ?? 0) === NOTEBOOKLM_ARTIFACT_TYPE_REPORT)
      .map((row) => String(row[0] ?? ''))
      .filter(Boolean),
  );

  const rpc = await callNotebooklmRpc(
    page,
    NOTEBOOKLM_CREATE_ARTIFACT_RPC_ID,
    buildNotebooklmGenerateReportParams(state.notebookId, sourceIds),
  );
  const parsed = parseNotebooklmGenerationResult(rpc.result);
  const initialFailure = !parsed.artifact_id
    ? parseNotebooklmGenerationFailureFromRpcBody(rpc.response.body)
    : null;

  let createdAt: string | null | undefined;
  let artifactId = parsed.artifact_id;
  let status = parsed.status;
  let errorType = initialFailure?.error_type ?? (status === 'failed' ? 'generation_failed_unknown' : null);
  let message = initialFailure?.message ?? null;
  let source: NotebooklmGenerateRow['source'] = 'rpc+create-artifact';

  if (options.wait) {
    const artifact = await waitForNotebooklmGeneratedArtifactViaRpc(page, {
      artifactType: 'report',
      typeCode: NOTEBOOKLM_ARTIFACT_TYPE_REPORT,
      artifactId,
      baselineIds,
      timeout: options.timeout,
      initialInterval: options.initialInterval,
      maxInterval: options.maxInterval,
      backoffFactor: options.backoffFactor,
      isReady: (row) => typeof extractNotebooklmReportMarkdown(row) === 'string',
    });

    if (artifact) {
      artifactId = String(artifact[0] ?? '') || artifactId;
      status = parseNotebooklmGenerationStatus(artifact[4]);
      createdAt = toNotebooklmIsoTimestamp(artifact[15]);
      errorType = status === 'failed' ? errorType ?? 'generation_failed_unknown' : null;
      if (status !== 'failed') message = null;
      source = 'rpc+create-artifact+artifact-list';
    }
  }

  return {
    notebook_id: state.notebookId,
    artifact_id: artifactId,
    artifact_type: 'report',
    status,
    created_at: createdAt,
    error_type: errorType,
    message,
    source,
  };
}

export async function generateNotebooklmAudioViaRpc(
  page: IPage,
  options: {
    wait?: boolean;
    timeout?: number;
    initialInterval?: number;
    maxInterval?: number;
    backoffFactor?: number;
  } = {},
): Promise<NotebooklmGenerateRow | null> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId) return null;

  const sources = await listNotebooklmSourcesViaRpc(page);
  const sourceIds = sources
    .map((row) => (typeof row.id === 'string' ? row.id.trim() : ''))
    .filter(Boolean);
  if (sourceIds.length === 0) return null;

  const baselineRows = await listNotebooklmArtifactsViaRpc(page);
  const baselineIds = new Set(
    baselineRows
      .filter((row) => Number(row[2] ?? 0) === NOTEBOOKLM_ARTIFACT_TYPE_AUDIO)
      .map((row) => String(row[0] ?? ''))
      .filter(Boolean),
  );

  const rpc = await callNotebooklmRpc(
    page,
    NOTEBOOKLM_CREATE_ARTIFACT_RPC_ID,
    buildNotebooklmGenerateAudioParams(state.notebookId, sourceIds),
  );
  const parsed = parseNotebooklmGenerationResult(rpc.result);
  const initialFailure = !parsed.artifact_id
    ? parseNotebooklmGenerationFailureFromRpcBody(rpc.response.body)
    : null;

  let createdAt: string | null | undefined;
  let artifactId = parsed.artifact_id;
  let status = parsed.status;
  let errorType = initialFailure?.error_type ?? (status === 'failed' ? 'generation_failed_unknown' : null);
  let message = initialFailure?.message ?? null;
  let source: NotebooklmGenerateRow['source'] = 'rpc+create-artifact';

  if (options.wait) {
    const artifact = await waitForNotebooklmGeneratedArtifactViaRpc(page, {
      artifactType: 'audio',
      typeCode: NOTEBOOKLM_ARTIFACT_TYPE_AUDIO,
      artifactId,
      baselineIds,
      timeout: options.timeout,
      initialInterval: options.initialInterval,
      maxInterval: options.maxInterval,
      backoffFactor: options.backoffFactor,
      isReady: (row) => Boolean(extractNotebooklmAudioDownloadVariant(row)),
    });

    if (artifact) {
      artifactId = String(artifact[0] ?? '') || artifactId;
      status = parseNotebooklmGenerationStatus(artifact[4]);
      createdAt = toNotebooklmIsoTimestamp(artifact[15]);
      errorType = status === 'failed' ? errorType ?? 'generation_failed_unknown' : null;
      if (status !== 'failed') message = null;
      source = 'rpc+create-artifact+artifact-list';
    }
  }

  return {
    notebook_id: state.notebookId,
    artifact_id: artifactId,
    artifact_type: 'audio',
    status,
    created_at: createdAt,
    error_type: errorType,
    message,
    source,
  };
}

export async function generateNotebooklmSlideDeckViaRpc(
  page: IPage,
  options: {
    wait?: boolean;
    timeout?: number;
    initialInterval?: number;
    maxInterval?: number;
    backoffFactor?: number;
  } = {},
): Promise<NotebooklmGenerateRow | null> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId) return null;

  const sources = await listNotebooklmSourcesViaRpc(page);
  const sourceIds = sources
    .map((row) => (typeof row.id === 'string' ? row.id.trim() : ''))
    .filter(Boolean);
  if (sourceIds.length === 0) return null;

  const baselineRows = await listNotebooklmArtifactsViaRpc(page);
  const baselineIds = new Set(
    baselineRows
      .filter((row) => Number(row[2] ?? 0) === NOTEBOOKLM_ARTIFACT_TYPE_SLIDE_DECK)
      .map((row) => String(row[0] ?? ''))
      .filter(Boolean),
  );

  const rpc = await callNotebooklmRpc(
    page,
    NOTEBOOKLM_CREATE_ARTIFACT_RPC_ID,
    buildNotebooklmGenerateSlideDeckParams(state.notebookId, sourceIds),
  );
  const parsed = parseNotebooklmGenerationResult(rpc.result);
  const initialFailure = !parsed.artifact_id
    ? parseNotebooklmGenerationFailureFromRpcBody(rpc.response.body)
    : null;

  let createdAt: string | null | undefined;
  let artifactId = parsed.artifact_id;
  let status = parsed.status;
  let errorType = initialFailure?.error_type ?? (status === 'failed' ? 'generation_failed_unknown' : null);
  let message = initialFailure?.message ?? null;
  let source: NotebooklmGenerateRow['source'] = 'rpc+create-artifact';

  if (options.wait) {
    const artifact = await waitForNotebooklmGeneratedArtifactViaRpc(page, {
      artifactType: 'slide_deck',
      typeCode: NOTEBOOKLM_ARTIFACT_TYPE_SLIDE_DECK,
      artifactId,
      baselineIds,
      timeout: options.timeout,
      initialInterval: options.initialInterval,
      maxInterval: options.maxInterval,
      backoffFactor: options.backoffFactor,
      isReady: (row) => Boolean(
        extractNotebooklmSlideDeckDownloadUrl(row, 'pdf') ||
        extractNotebooklmSlideDeckDownloadUrl(row, 'pptx'),
      ),
    });

    if (artifact) {
      artifactId = String(artifact[0] ?? '') || artifactId;
      status = parseNotebooklmGenerationStatus(artifact[4]);
      createdAt = toNotebooklmIsoTimestamp(artifact[15]);
      errorType = status === 'failed' ? errorType ?? 'generation_failed_unknown' : null;
      if (status !== 'failed') message = null;
      source = 'rpc+create-artifact+artifact-list';
    }
  }

  return {
    notebook_id: state.notebookId,
    artifact_id: artifactId,
    artifact_type: 'slide_deck',
    status,
    created_at: createdAt,
    error_type: errorType,
    message,
    source,
  };
}

export async function listNotebooklmDownloadArtifactsViaRpc(page: IPage): Promise<NotebooklmDownloadListRow[]> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId) return [];

  const rows = await listNotebooklmArtifactsViaRpc(page);
  return parseNotebooklmDownloadListRows(
    rows,
    state.notebookId,
    state.url || `https://${NOTEBOOKLM_DOMAIN}/notebook/${state.notebookId}`,
  );
}

export function pickNotebooklmArtifactIdCompletionCandidates(
  rows: NotebooklmDownloadListRow[],
  artifactType: NotebooklmDownloadListRow['artifact_type'],
): string[] {
  return rows
    .filter((row) => row.artifact_type === artifactType)
    .map((row) => row.artifact_id)
    .filter((artifactId) => typeof artifactId === 'string' && artifactId.trim().length > 0);
}

async function listNotebooklmDownloadArtifactsForCompletionProbe(): Promise<NotebooklmDownloadListRow[] | null> {
  return browserSession(getBrowserFactory(), async (page) => {
    const rebound = await ensureNotebooklmNotebookBinding(page);
    if (rebound) return null;

    await requireNotebooklmSession(page);
    const state = await getNotebooklmPageState(page);
    if (state.kind !== 'notebook') return [];

    return listNotebooklmDownloadArtifactsViaRpc(page);
  }, { workspace: `site:${NOTEBOOKLM_SITE}` });
}

export async function completeNotebooklmArtifactIds(
  artifactType: NotebooklmDownloadListRow['artifact_type'],
): Promise<string[]> {
  try {
    const firstProbe = await listNotebooklmDownloadArtifactsForCompletionProbe();
    const rows = firstProbe ?? await listNotebooklmDownloadArtifactsForCompletionProbe();
    if (!Array.isArray(rows) || rows.length === 0) return [];
    return pickNotebooklmArtifactIdCompletionCandidates(rows, artifactType);
  } catch {
    return [];
  }
}

export async function downloadNotebooklmReportViaRpc(
  page: IPage,
  outputPath: string,
  artifactId?: string | null,
): Promise<NotebooklmReportDownloadRow | null> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId) return null;

  const rows = await listNotebooklmArtifactsViaRpc(page);
  const artifact = selectNotebooklmCompletedArtifact(rows, NOTEBOOKLM_ARTIFACT_TYPE_REPORT, artifactId);
  if (!artifact) return null;

  const markdown = extractNotebooklmReportMarkdown(artifact);
  if (typeof markdown !== 'string') return null;

  const resolvedOutputPath = resolvePath(outputPath);
  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, markdown, 'utf8');

  return {
    notebook_id: state.notebookId,
    artifact_id: String(artifact[0] ?? ''),
    title: normalizeNotebooklmTitle(artifact[1], 'Untitled Report'),
    kind: 'report',
    output_path: resolvedOutputPath,
    created_at: toNotebooklmIsoTimestamp(artifact[15]),
    url: state.url || `https://${NOTEBOOKLM_DOMAIN}/notebook/${state.notebookId}`,
    source: 'rpc',
  };
}

export async function downloadNotebooklmAudioViaRpc(
  page: IPage,
  outputPath: string,
  artifactId?: string | null,
): Promise<NotebooklmAudioDownloadRow | null> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId) return null;

  const rows = await listNotebooklmArtifactsViaRpc(page);
  const artifact = selectNotebooklmCompletedArtifact(rows, NOTEBOOKLM_ARTIFACT_TYPE_AUDIO, artifactId);
  if (!artifact) return null;

  const variant = extractNotebooklmAudioDownloadVariant(artifact);
  if (!variant) return null;

  const resolvedOutputPath = resolvePath(outputPath);
  const cookieHeader = formatCookieHeader(await page.getCookies({ url: variant.url }));
  const result = await httpDownload(variant.url, resolvedOutputPath, {
    cookies: cookieHeader || undefined,
    headers: {
      Referer: state.url || `https://${NOTEBOOKLM_DOMAIN}/notebook/${state.notebookId}`,
    },
    timeout: 120000,
  });

  if (!result.success) {
    throw new CliError(
      'DOWNLOAD_ERROR',
      `Failed to download audio artifact "${String(artifact[0] ?? '')}": ${result.error || 'unknown error'}`,
      'The audio URL may have expired. Refresh the NotebookLM notebook tab and retry.',
    );
  }

  return {
    notebook_id: state.notebookId,
    artifact_id: String(artifact[0] ?? ''),
    artifact_type: 'audio',
    title: normalizeNotebooklmTitle(artifact[1], 'Untitled Audio'),
    output_path: resolvedOutputPath,
    created_at: toNotebooklmIsoTimestamp(artifact[15]),
    url: state.url || `https://${NOTEBOOKLM_DOMAIN}/notebook/${state.notebookId}`,
    download_url: variant.url,
    mime_type: variant.mime_type,
    source: 'rpc+artifact-url',
  };
}

export async function downloadNotebooklmVideoViaRpc(
  page: IPage,
  outputPath: string,
  artifactId?: string | null,
): Promise<NotebooklmVideoDownloadRow | null> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId) return null;

  const rows = await listNotebooklmArtifactsViaRpc(page);
  const artifact = selectNotebooklmCompletedArtifact(rows, NOTEBOOKLM_ARTIFACT_TYPE_VIDEO, artifactId);
  if (!artifact) return null;

  const variant = extractNotebooklmVideoDownloadVariant(artifact);
  if (!variant) return null;

  const resolvedOutputPath = resolvePath(outputPath);
  const cookieHeader = formatCookieHeader(await page.getCookies({ url: variant.url }));
  const result = await httpDownload(variant.url, resolvedOutputPath, {
    cookies: cookieHeader || undefined,
    headers: {
      Referer: state.url || `https://${NOTEBOOKLM_DOMAIN}/notebook/${state.notebookId}`,
    },
    timeout: 120000,
  });

  if (!result.success) {
    throw new CliError(
      'DOWNLOAD_ERROR',
      `Failed to download video artifact "${String(artifact[0] ?? '')}": ${result.error || 'unknown error'}`,
      'The video URL may have expired. Refresh the NotebookLM notebook tab and retry.',
    );
  }

  return {
    notebook_id: state.notebookId,
    artifact_id: String(artifact[0] ?? ''),
    artifact_type: 'video',
    title: normalizeNotebooklmTitle(artifact[1], 'Untitled Video'),
    output_path: resolvedOutputPath,
    created_at: toNotebooklmIsoTimestamp(artifact[15]),
    url: state.url || `https://${NOTEBOOKLM_DOMAIN}/notebook/${state.notebookId}`,
    download_url: variant.url,
    mime_type: variant.mime_type,
    source: 'rpc+artifact-url',
  };
}

export async function downloadNotebooklmSlideDeckViaRpc(
  page: IPage,
  outputPath: string,
  artifactId?: string | null,
  outputFormat: NotebooklmSlideDeckDownloadFormat = 'pdf',
): Promise<NotebooklmSlideDeckDownloadRow | null> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId) return null;

  const rows = await listNotebooklmArtifactsViaRpc(page);
  const artifact = selectNotebooklmCompletedArtifact(rows, NOTEBOOKLM_ARTIFACT_TYPE_SLIDE_DECK, artifactId);
  if (!artifact) return null;

  const downloadUrl = extractNotebooklmSlideDeckDownloadUrl(artifact, outputFormat);
  if (!downloadUrl) return null;

  const resolvedOutputPath = resolvePath(outputPath);
  const cookieHeader = formatCookieHeader(await page.getCookies({ url: downloadUrl }));
  const result = await httpDownload(downloadUrl, resolvedOutputPath, {
    cookies: cookieHeader || undefined,
    headers: {
      Referer: state.url || `https://${NOTEBOOKLM_DOMAIN}/notebook/${state.notebookId}`,
    },
    timeout: 120000,
  });

  if (!result.success) {
    throw new CliError(
      'DOWNLOAD_ERROR',
      `Failed to download slide deck artifact "${String(artifact[0] ?? '')}": ${result.error || 'unknown error'}`,
      'The artifact URL may have expired. Refresh the NotebookLM notebook tab and retry.',
    );
  }

  return {
    notebook_id: state.notebookId,
    artifact_id: String(artifact[0] ?? ''),
    artifact_type: 'slide_deck',
    title: normalizeNotebooklmTitle(artifact[1], 'Untitled Slide Deck'),
    output_path: resolvedOutputPath,
    created_at: toNotebooklmIsoTimestamp(artifact[15]),
    url: state.url || `https://${NOTEBOOKLM_DOMAIN}/notebook/${state.notebookId}`,
    download_url: downloadUrl,
    download_format: outputFormat,
    source: 'rpc+artifact-url',
  };
}

export async function listNotebooklmNotesViaRpc(page: IPage): Promise<NotebooklmNoteDetailRow[]> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId) return [];

  const rpc = await callNotebooklmRpc(
    page,
    'cFji9',
    [state.notebookId],
  );

  return parseNotebooklmNotesRpcResult(
    rpc.result,
    state.notebookId,
    state.url || `https://${NOTEBOOKLM_DOMAIN}/notebook/${state.notebookId}`,
  );
}

export async function createNotebooklmNoteViaRpc(
  page: IPage,
  title: string,
  content: string,
): Promise<NotebooklmNoteDetailRow | null> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId) return null;

  const rpc = await callNotebooklmRpc(
    page,
    'CYK0Xb',
    buildNotebooklmCreateNoteParams(state.notebookId),
  );

  const raw = unwrapNotebooklmSingletonResult(rpc.result);
  const noteId = Array.isArray(raw)
    ? typeof raw[0] === 'string'
      ? raw[0]
      : Array.isArray(raw[0]) && typeof raw[0][0] === 'string'
        ? raw[0][0]
        : ''
    : '';
  if (!noteId) return null;

  await callNotebooklmRpc(
    page,
    'cYAfTb',
    buildNotebooklmUpdateNoteParams(state.notebookId, noteId, title, content),
  );

  return {
    notebook_id: state.notebookId,
    id: noteId,
    title,
    content,
    url: state.url || `https://${NOTEBOOKLM_DOMAIN}/notebook/${state.notebookId}`,
    source: 'rpc',
  };
}

export async function renameNotebooklmNoteViaRpc(
  page: IPage,
  noteId: string,
  title: string,
): Promise<NotebooklmNoteDetailRow | null> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId) return null;

  const rows = await listNotebooklmNotesViaRpc(page);
  const matched = rows.find((row) => row.id === noteId) ?? null;
  if (!matched) return null;

  await callNotebooklmRpc(
    page,
    'cYAfTb',
    buildNotebooklmUpdateNoteParams(state.notebookId, noteId, title, matched.content),
  );

  return {
    notebook_id: state.notebookId,
    id: noteId,
    title,
    content: matched.content,
    url: state.url || `https://${NOTEBOOKLM_DOMAIN}/notebook/${state.notebookId}`,
    source: 'rpc',
  };
}

export async function deleteNotebooklmNoteViaRpc(
  page: IPage,
  noteId: string,
): Promise<NotebooklmNoteDeleteRow | null> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId) return null;

  await callNotebooklmRpc(
    page,
    'AH0mwd',
    buildNotebooklmDeleteNoteParams(state.notebookId, noteId),
  );

  return {
    notebook_id: state.notebookId,
    note_id: noteId,
    deleted: true,
    source: 'rpc',
  };
}

export async function saveNotebooklmVisibleNoteViaRpc(
  page: IPage,
  noteId?: string,
): Promise<NotebooklmNoteDetailRow | null> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId) return null;

  const visible = await readNotebooklmVisibleNoteFromPage(page);
  if (!visible) return null;

  const rows = await listNotebooklmNotesViaRpc(page);
  const explicitId = typeof noteId === 'string' ? noteId.trim() : '';
  if (explicitId) {
    const matched = rows.find((row) => row.id === explicitId) ?? null;
    if (!matched) {
      throw new CliError(
        'NOTEBOOKLM_NOTE_ID_NOT_FOUND',
        `NotebookLM note id "${explicitId}" was not found`,
        `No NotebookLM note with id "${explicitId}" was found in the current notebook.`,
      );
    }
    if (visible.id && visible.id !== explicitId) {
      throw new CliError(
        'NOTEBOOKLM_NOTE_ID_MISMATCH',
        `Requested note id "${explicitId}" does not match the currently visible note editor`,
        `The visible note editor is currently bound to "${visible.id}". Open note "${explicitId}" first, or omit --note-id.`,
      );
    }

    await callNotebooklmRpc(
      page,
      'cYAfTb',
      buildNotebooklmUpdateNoteParams(state.notebookId, explicitId, visible.title, visible.content),
    );

    return {
      notebook_id: state.notebookId,
      id: explicitId,
      title: visible.title,
      content: visible.content,
      url: state.url || `https://${NOTEBOOKLM_DOMAIN}/notebook/${state.notebookId}`,
      source: 'rpc',
    };
  }

  const resolved = resolveNotebooklmVisibleNoteId(visible, rows);

  if (resolved.reason === 'ambiguous') {
    throw new CliError(
      'NOTEBOOKLM_NOTE_AMBIGUOUS',
      `NotebookLM found multiple notes titled "${visible.title}"`,
      'Open the current note editor so a stable note id is visible, or make the current note content/title unique before retrying notes-save.',
    );
  }

  if (!resolved.id) {
    throw new CliError(
      'NOTEBOOKLM_NOTE_UNRESOLVED',
      `NotebookLM could not resolve the currently visible note "${visible.title}" to a stable note id`,
      'For now, notes-save requires either a stable editor note id or a unique title/content match in the notebook note list.',
    );
  }

  await callNotebooklmRpc(
    page,
    'cYAfTb',
    buildNotebooklmUpdateNoteParams(state.notebookId, resolved.id, visible.title, visible.content),
  );

  return {
    notebook_id: state.notebookId,
    id: resolved.id,
    title: visible.title,
    content: visible.content,
    url: state.url || `https://${NOTEBOOKLM_DOMAIN}/notebook/${state.notebookId}`,
    source: 'rpc',
  };
}

export async function getNotebooklmShareStatusViaRpc(page: IPage): Promise<NotebooklmShareStatusRow | null> {
  const state = await getNotebooklmPageState(page);
  if (state.kind !== 'notebook' || !state.notebookId) return null;

  const rpc = await callNotebooklmRpc(
    page,
    'JFMDGd',
    [state.notebookId, [2]],
  );

  return parseNotebooklmShareStatusResult(rpc.result, state.notebookId);
}

export function listNotebooklmSupportedLanguages(): NotebooklmLanguageRow[] {
  return Object.entries(NOTEBOOKLM_SUPPORTED_LANGUAGES).map(([code, name]) => ({
    code,
    name,
    source: 'static',
  }));
}

export async function getNotebooklmOutputLanguageViaRpc(page: IPage): Promise<NotebooklmLanguageStatusRow | null> {
  const rpc = await callNotebooklmRpc(
    page,
    'ZwVcOc',
    buildNotebooklmGetLanguageParams(),
    { sourcePath: '/' },
  );

  const language = parseNotebooklmLanguageGetResult(rpc.result);
  if (!language) return null;

  return {
    language,
    name: NOTEBOOKLM_SUPPORTED_LANGUAGES[language] ?? null,
    source: 'rpc',
  };
}

export async function setNotebooklmOutputLanguageViaRpc(
  page: IPage,
  language: string,
): Promise<NotebooklmLanguageStatusRow | null> {
  const rpc = await callNotebooklmRpc(
    page,
    'hT54vc',
    buildNotebooklmSetLanguageParams(language),
    { sourcePath: '/' },
  );

  const current = parseNotebooklmLanguageSetResult(rpc.result) ?? language;
  return {
    language: current,
    name: NOTEBOOKLM_SUPPORTED_LANGUAGES[current] ?? null,
    source: 'rpc',
  };
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
    const collectAttributeHints = (node, hints, maxDepth = 8) => {
      let current = node;
      let depth = 0;
      while (current && depth < maxDepth) {
        for (const attr of Array.from(current.attributes || [])) {
          if (/^(id|for|aria-labelledby|aria-controls|aria-describedby|data-)/.test(attr.name)) {
            hints.push(attr.value || '');
          }
        }
        current = current.parentElement;
        depth += 1;
      }
    };
    const collectSelectedNoteHints = (hints) => {
      const selectors = [
        'button[aria-labelledby^="note-labels-"][aria-selected="true"]',
        'button[aria-labelledby^="note-labels-"][aria-current="true"]',
        'button[aria-labelledby^="note-labels-"][aria-pressed="true"]',
        '.selected button[aria-labelledby^="note-labels-"]',
        '.active button[aria-labelledby^="note-labels-"]',
        'button[aria-labelledby^="artifact-labels-"][aria-selected="true"]',
        'button[aria-labelledby^="artifact-labels-"][aria-current="true"]',
        'button[aria-labelledby^="artifact-labels-"][aria-pressed="true"]',
        '.selected button[aria-labelledby^="artifact-labels-"]',
        '.active button[aria-labelledby^="artifact-labels-"]',
      ];
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (!(node instanceof HTMLElement)) continue;
        collectAttributeHints(node, hints, 2);
      }
    };
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
    const idHints = [];
    collectAttributeHints(titleNode, idHints);
    collectAttributeHints(editor, idHints);
    collectSelectedNoteHints(idHints);
    return {
      id: idHints.find((value) => /(?:note|artifact)-labels-[A-Za-z0-9_-]{6,}/i.test(value)) || '',
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

function buildNotebooklmNotebookUrl(notebookId: string): string {
  return `https://${NOTEBOOKLM_DOMAIN}/notebook/${notebookId}`;
}

async function maybeCanonicalizeNotebooklmNotebookPage(
  page: IPage,
  state: Pick<NotebooklmPageState, 'kind' | 'notebookId' | 'url'>,
): Promise<void> {
  if (state.kind !== 'notebook' || !state.notebookId) return;
  const canonicalUrl = buildNotebooklmNotebookUrl(state.notebookId);
  if (state.url === canonicalUrl) return;
  await page.goto(canonicalUrl);
  if (typeof page.wait === 'function') {
    await page.wait(1);
  }
}

export async function ensureNotebooklmNotebookBinding(page: IPage): Promise<boolean> {
  if (!page.getCurrentUrl) return false;
  if (process.env.OPENCLI_CDP_ENDPOINT) return false;

  try {
    const actualState = await getNotebooklmPageState(page);
    if (actualState.kind === 'notebook') {
      await maybeCanonicalizeNotebooklmNotebookPage(page, actualState);
      return false;
    }
  } catch {
    // Fall back to the lighter current-url heuristic if page evaluation is unavailable.
  }

  const currentUrl = await page.getCurrentUrl().catch(() => null);
  if (currentUrl && classifyNotebooklmPage(currentUrl) === 'notebook') return false;

  try {
    await bindCurrentTab(`site:${NOTEBOOKLM_SITE}`, {
      matchDomain: NOTEBOOKLM_DOMAIN,
      matchPathPrefix: '/notebook/',
    });
    try {
      const reboundState = await getNotebooklmPageState(page);
      await maybeCanonicalizeNotebooklmNotebookPage(page, reboundState);
    } catch {
      // Binding itself is still useful even when the immediate state probe fails.
    }
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
