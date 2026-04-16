import * as fs from 'node:fs';
import { CliError } from '@jackwener/opencli/errors';

const DEFAULT_MAYBEAI_APP_API_URL = 'http://127.0.0.1:7010';
const REQUEST_TIMEOUT_MS = 120_000;

export interface MaybeAiImageAppRequestOptions {
  apiUrl?: string;
}

export function resolveMaybeAiAppApiUrl(kwargs: Record<string, unknown> = {}): string {
  const explicit = typeof kwargs['api-url'] === 'string' ? kwargs['api-url'] : undefined;
  const env = process.env.MAYBEAI_APP_API_URL;
  return (explicit || env || DEFAULT_MAYBEAI_APP_API_URL).replace(/\/+$/, '');
}

export async function maybeAiAppGet(pathname: string, kwargs: Record<string, unknown> = {}): Promise<unknown> {
  return maybeAiAppRequest('GET', pathname, undefined, kwargs);
}

export async function maybeAiAppPost(pathname: string, body: unknown, kwargs: Record<string, unknown> = {}): Promise<unknown> {
  return maybeAiAppRequest('POST', pathname, body, kwargs);
}

async function maybeAiAppRequest(
  method: 'GET' | 'POST',
  pathname: string,
  body: unknown,
  kwargs: Record<string, unknown>,
): Promise<unknown> {
  const baseUrl = resolveMaybeAiAppApiUrl(kwargs);
  const url = `${baseUrl}${pathname}`;
  const headers = buildRequestHeaders(kwargs);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error: any) {
    throw new CliError(
      'FETCH_ERROR',
      `MaybeAI image app API request failed: ${url}`,
      `Ensure maybe-uni/cli API is running and MAYBEAI_APP_API_URL is correct. ${error?.message ?? String(error)}`,
    );
  }

  const text = await response.text();
  const parsed = parseJsonOrText(text);

  if (!response.ok) {
    const message = extractErrorMessage(parsed) || `MaybeAI image app API HTTP ${response.status}`;
    const hint = buildErrorHint(parsed, url);
    throw new CliError('API_ERROR', message, hint);
  }

  return parsed;
}

export function readJsonObjectInput(kwargs: Record<string, unknown>): Record<string, unknown> {
  const file = firstString(kwargs['input-file'], kwargs.file);
  const inline = firstString(kwargs.input, kwargs.json);

  if (file) {
    const raw = fs.readFileSync(file, 'utf8');
    return assertRecord(JSON.parse(raw), `JSON file must contain an object: ${file}`);
  }

  if (inline) {
    return assertRecord(JSON.parse(inline), '--input/--json must be a JSON object');
  }

  return {};
}

export function buildIntentBody(positionals: string[], kwargs: Record<string, unknown>): { intent: string; input: Record<string, unknown> } {
  const explicitIntent = firstString(kwargs.intent);
  const intent = (explicitIntent || positionals.join(' ')).trim();
  if (!intent) {
    throw new CliError(
      'ARGUMENT',
      'Missing intent',
      'Use: opencli maybeai-image-app select "给这个商品生成 Amazon 主图" --input \'{"products":["https://..."]}\'',
    );
  }
  return {
    intent,
    input: readJsonObjectInput(kwargs),
  };
}

export function buildAppBody(appId: string, kwargs: Record<string, unknown>): { app: string; input: Record<string, unknown> } {
  return {
    app: appId,
    input: readJsonObjectInput(kwargs),
  };
}

export function addGenerateOptions(body: Record<string, unknown>, kwargs: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...body };
  if (typeof kwargs['task-id'] === 'string' && kwargs['task-id'].trim()) {
    result['task_id'] = kwargs['task-id'].trim();
  }
  if (typeof kwargs['min-confidence'] === 'string' && kwargs['min-confidence'].trim()) {
    result['min_confidence'] = Number(kwargs['min-confidence']);
  }
  return result;
}

export const API_ARGS = [
  { name: 'api-url', help: 'MaybeAI app API URL; defaults to MAYBEAI_APP_API_URL or http://127.0.0.1:7010' },
  { name: 'auth-token', help: 'User auth token; defaults to MAYBEAI_AUTH_TOKEN' },
  { name: 'user-id', help: 'User id; defaults to MAYBEAI_USER_ID' },
];

export const INPUT_ARGS = [
  { name: 'input', help: 'Inline JSON input object' },
  { name: 'json', help: 'Alias of --input' },
  { name: 'input-file', help: 'Read input object from JSON file' },
  { name: 'file', help: 'Alias of --input-file' },
];

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function buildRequestHeaders(kwargs: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const authToken = firstString(kwargs['auth-token'], process.env.MAYBEAI_AUTH_TOKEN);
  const userId = firstString(kwargs['user-id'], process.env.MAYBEAI_USER_ID);

  if (authToken) {
    headers.Authorization = normalizeAuthToken(authToken);
  }
  if (userId) {
    headers['user-id'] = userId;
  }
  return headers;
}

function normalizeAuthToken(token: string): string {
  return /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}

function parseJsonOrText(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function assertRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CliError('ARGUMENT', message);
  }
  return value as Record<string, unknown>;
}

function extractErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return typeof payload === 'string' ? payload : undefined;
  const record = payload as Record<string, any>;
  return record.error?.message || record.detail || record.message;
}

function extractErrorHint(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, any>;
  return record.error?.hint || record.hint;
}

function buildErrorHint(payload: unknown, url: string): string {
  const baseHint = extractErrorHint(payload);
  const ids = extractTaskIdHint(payload);
  return [baseHint, ids, `Request URL: ${url}`].filter(Boolean).join(' | ');
}

function extractTaskIdHint(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, any>;
  const error = record.error && typeof record.error === 'object' ? record.error : {};
  const taskId = typeof error.taskId === 'string' ? error.taskId : undefined;
  const promptTaskId = typeof error.promptTaskId === 'string' ? error.promptTaskId : undefined;
  const taskIds = Array.isArray(error.taskIds)
    ? error.taskIds.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];

  const parts: string[] = [];
  if (taskId) parts.push(`taskId: ${taskId}`);
  if (promptTaskId) parts.push(`promptTaskId: ${promptTaskId}`);
  if (taskIds.length > 0) parts.push(`taskIds: ${taskIds.join(', ')}`);
  if (typeof error.retryCount === 'number') parts.push(`retryCount: ${error.retryCount}`);
  return parts.length > 0 ? parts.join(' | ') : undefined;
}
