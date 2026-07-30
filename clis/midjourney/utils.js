import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
  TimeoutError,
} from '@jackwener/opencli/errors';
import { log } from '@jackwener/opencli/logger';

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export const MIDJOURNEY_DOMAIN = 'www.midjourney.com';
export const MIDJOURNEY_URL = 'https://www.midjourney.com';
export const MIDJOURNEY_IMAGINE_URL = `${MIDJOURNEY_URL}/imagine`;
export const MIDJOURNEY_CDN = 'https://cdn.midjourney.com';
export const COMPOSER_SELECTOR = '#desktop_input_bar';
export const CREDITS_PER_FAST_MINUTE = 60_000;
export const MIDJOURNEY_SITE_DIR = path.join(os.homedir(), '.opencli', 'sites', 'midjourney');
export const USAGE_SNAPSHOT_PATH = path.join(MIDJOURNEY_SITE_DIR, 'usage-snapshots.jsonl');
export const IMAGE_EXTENSIONS = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
]);
export const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;

// Midjourney job ids are UUID-shaped but historical ids do not always use the
// RFC 4122 version/variant nibbles, so validate the canonical 8-4-4-4-12 shape.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CSRF_HEADERS = { 'X-CSRF-Protection': '1' };

export function unwrapEvaluateResult(payload) {
  if (payload && !Array.isArray(payload) && typeof payload === 'object' && 'session' in payload && 'data' in payload) {
    return payload.data;
  }
  return payload;
}

export function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return ['true', '1', 'yes', 'on'].includes(normalized);
}

export function normalizePositiveInt(value, fallback, max, label) {
  const parsed = value == null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ArgumentError(`${label} must be a positive integer`);
  }
  if (parsed > max) {
    throw new ArgumentError(`${label} must be <= ${max}`);
  }
  return parsed;
}

export function parseJobId(value) {
  const raw = String(value ?? '').trim();
  if (UUID_RE.test(raw)) return raw.toLowerCase();
  try {
    const parsed = new URL(raw);
    const match = parsed.pathname.match(/^\/jobs\/([0-9a-f-]{36})\/?$/i);
    if (parsed.protocol === 'https:' && parsed.hostname === MIDJOURNEY_DOMAIN && match && UUID_RE.test(match[1])) {
      return match[1].toLowerCase();
    }
  } catch {}
  throw new ArgumentError(
    'job-id must be a Midjourney UUID or https://www.midjourney.com/jobs/<uuid> URL',
    'Example: opencli midjourney status d5664250-5f1f-4cd0-9637-2ce0153dd30a',
  );
}

export function parseImageIndices(value, batchSize = 4) {
  const max = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : 4;
  const raw = String(value ?? 'all').trim().toLowerCase();
  if (!raw || raw === 'all') return Array.from({ length: max }, (_, index) => index);
  if (!/^\d+$/.test(raw)) {
    throw new ArgumentError(`--index must be "all" or an integer from 1 to ${max}`);
  }
  const userIndex = Number(raw);
  if (userIndex < 1 || userIndex > max) {
    throw new ArgumentError(`--index must be between 1 and ${max} for this job`);
  }
  return [userIndex - 1];
}

export function normalizePrompt(value) {
  const prompt = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!prompt) {
    throw new ArgumentError(
      'prompt cannot be empty',
      'Example: opencli midjourney generate "a blue ceramic teapot --ar 1:1"',
    );
  }
  return prompt;
}

export function promptFromFullCommand(value) {
  return String(value ?? '')
    .replace(/^\s*\/?imagine\s*(?:prompt\s*:)?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function promptCore(value) {
  return promptFromFullCommand(value)
    .split(/\s+--[a-z][a-z0-9-]*/i, 1)[0]
    .replace(/^(?:https?:\/\/\S+\s+)+/i, '')
    .trim();
}

export function promptKeySignature(value) {
  const prompt = promptFromFullCommand(value);
  const parameter = (name) => prompt.match(new RegExp(`(?:^|\\s)--${name}\\s+([^\\s]+)`, 'i'))?.[1]?.toLowerCase() || null;
  const flag = (name) => new RegExp(`(?:^|\\s)--${name}(?=\\s|$)`, 'i').test(prompt);
  const version = (raw) => {
    if (raw == null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? String(parsed) : raw;
  };
  return JSON.stringify({
    model: version(parameter('(?:v|version)')),
    niji: version(parameter('niji')),
    resolution: flag('hd') ? 'hd' : flag('sd') ? 'sd' : null,
    speed: flag('relax') ? 'relax' : flag('turbo') ? 'turbo' : flag('fast') ? 'fast' : null,
    repeat: parameter('(?:r|repeat)'),
    profile: parameter('(?:p|profile)'),
    draft: flag('draft'),
    raw: flag('raw'),
  });
}

export function submittedJobIdsFromCaptures(captures, expectedCount, baselineIds = new Set()) {
  if (!Array.isArray(captures) || captures.length === 0) return [];
  const successes = captures.flatMap((payload) => Array.isArray(payload?.success) ? payload.success : []);
  const ids = [...new Set(successes
    .map((row) => String(row?.job_id || '').toLowerCase())
    .filter((id) => UUID_RE.test(id) && !baselineIds.has(id)))];
  if (ids.length === expectedCount) return ids;
  const failures = captures.flatMap((payload) => Array.isArray(payload?.failure) ? payload.failure : []);
  if (failures.length && ids.length === 0) {
    const detail = failures.map((row) => row?.message || row?.error || JSON.stringify(row)).join('; ');
    throw new CommandExecutionError(`Midjourney rejected the submitted job: ${detail}`);
  }
  if (successes.length || ids.length) {
    throw new CommandExecutionError(
      `Midjourney submit response was ambiguous; expected ${expectedCount} new job(s), received ${ids.length}`,
    );
  }
  return [];
}

export function uploadedStorageUrlsFromCaptures(captures) {
  if (!Array.isArray(captures)) return [];
  const payloads = captures.flatMap((capture) => [capture, capture?.data, capture?.response].filter(Boolean));
  return [...new Set(payloads.flatMap((payload) => {
    const bucketPathname = String(payload?.bucketPathname || '').replace(/^\/+/, '');
    if (!/^[0-9a-f-]{36}\/[0-9a-f]{32,}\.(?:png|jpe?g|webp|gif)$/i.test(bucketPathname)) return [];
    const thumbnailPath = bucketPathname.replace(/(\.(?:png|jpe?g|webp|gif))$/i, '_384_N$1');
    return [`${MIDJOURNEY_CDN}/u/${thumbnailPath}`];
  }))];
}

export function isVideoJob(job) {
  return Array.isArray(job?.video_segments)
    || /video|vid_/i.test(`${job?.event_type || ''} ${job?.job_type || ''}`);
}

export function inferJobModel(job) {
  const command = promptFromFullCommand(job?.full_command);
  const niji = command.match(/(?:^|\s)--niji\s+(\d+(?:\.\d+)?)/i)?.[1];
  if (niji) return `niji${Number(niji)}`;
  const version = command.match(/(?:^|\s)--(?:v|version)\s+(\d+(?:\.\d+)?)/i)?.[1];
  if (version) return `v${Number(version)}`;
  const type = String(job?.job_type || '');
  const typeVersion = type.match(/^v(\d+)(?:-(\d+))?_/i);
  if (typeVersion) return `v${typeVersion[1]}${typeVersion[2] ? `.${typeVersion[2]}` : ''}`;
  if (/^niji[_-]/i.test(type)) return 'niji';
  if (isVideoJob(job)) return 'video';
  return null;
}

export function inferJobResolution(job) {
  const command = promptFromFullCommand(job?.full_command);
  if (/(?:^|\s)--hd(?=\s|$)/i.test(command)) return 'hd';
  if (/(?:^|\s)--sd(?=\s|$)/i.test(command)) return 'sd';
  return null;
}

export function normalizeJobStatus(value) {
  const status = stringOrNull(value);
  if (!status) return null;
  const normalized = status.toLowerCase().replace('canceled', 'cancelled');
  return normalized === 'error' ? 'failed' : normalized;
}

export function jobStatusRow(job) {
  const progressRaw = numberOrNull(job?.progress_pct ?? job?.progress);
  const progressPct = progressRaw == null
    ? null
    : Number((progressRaw <= 1 ? progressRaw * 100 : progressRaw).toFixed(2));
  return {
    jobId: stringOrNull(job?.id),
    parentJobId: stringOrNull(job?.parent_id),
    status: normalizeJobStatus(job?.current_status ?? job?.status),
    progressPct,
    operation: stringOrNull(job?.event_type ?? job?.job_type),
    model: inferJobModel(job),
    resolution: inferJobResolution(job),
    createdAt: isoOrNull(job?.enqueue_time ?? job?.created_at),
    completedAt: isoOrNull(job?.completed_at ?? job?.completion_time),
    width: numberOrNull(job?.width),
    height: numberOrNull(job?.height),
    batchSize: numberOrNull(job?.batch_size),
    error: stringOrNull(job?.error_message ?? job?.error ?? job?.message),
    url: job?.id ? jobUrl(job.id) : null,
  };
}

export function isoFromMillis(value) {
  const millis = Number(value);
  if (!Number.isFinite(millis) || millis <= 0) return null;
  return new Date(millis).toISOString();
}

export function creditsToFastMinutes(value) {
  const credits = Number(value);
  if (!Number.isFinite(credits) || credits < 0) return null;
  return Number((credits / CREDITS_PER_FAST_MINUTE).toFixed(2));
}

export function numberOrNull(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function stringOrNull(value) {
  if (value == null) return null;
  const parsed = String(value).trim();
  return parsed ? parsed : null;
}

export function isoOrNull(value) {
  if (value == null || value === '') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function jobUrl(jobId, index = 0) {
  return `${MIDJOURNEY_URL}/jobs/${jobId}?index=${index}`;
}

export function originalImageUrl(jobId, index) {
  return `${MIDJOURNEY_CDN}/${jobId}/0_${index}.png`;
}

export function resolveOutputDir(value) {
  const raw = String(value || '~/Pictures/Midjourney').trim();
  if (!raw) throw new ArgumentError('--output cannot be empty');
  const expanded = raw === '~' ? os.homedir() : raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(2)) : raw;
  return path.resolve(expanded);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function midjourneyJson(page, endpoint, options = {}) {
  try {
    return await page.fetchJson(endpoint, {
      ...options,
      headers: { ...CSRF_HEADERS, ...(options.headers || {}) },
    });
  } catch (error) {
    const message = errorMessage(error);
    if (/HTTP\s+(401|403)|unauthori[sz]ed|login|sign in/i.test(message)) {
      throw new AuthRequiredError(MIDJOURNEY_DOMAIN, 'Log into Midjourney in Chrome, then retry.');
    }
    throw new CommandExecutionError(`Midjourney API request failed: ${message}`);
  }
}

export async function getMidjourneyAccount(page) {
  const account = await midjourneyJson(page, '/api/subscriptions-check');
  if (!account || typeof account !== 'object' || Array.isArray(account)) {
    throw new CommandExecutionError('Midjourney subscription endpoint returned a malformed payload');
  }
  if (!account.user_id) {
    throw new AuthRequiredError(MIDJOURNEY_DOMAIN, 'Log into Midjourney in Chrome, then retry.');
  }
  return account;
}

export function assertGenerationEntitlement(account) {
  if (account.status !== 'active' || !account.plan?.type) {
    throw new CommandExecutionError(
      'Midjourney generation requires an active subscription.',
      `Check the account at ${MIDJOURNEY_URL}/account.`,
    );
  }
  const remaining = Number(account.total_credits ?? account.credits_total ?? 0);
  if (!(remaining > 0) && !account.abilities?.can_relax) {
    throw new CommandExecutionError(
      'No Midjourney generation credits remain for this billing period.',
      `Check usage at ${MIDJOURNEY_URL}/account.`,
    );
  }
}

export async function fetchHistory(page, userId, limit = 20) {
  return (await fetchHistoryPage(page, userId, limit)).data;
}

export async function fetchHistoryPage(page, userId, limit = 20, cursor = null) {
  const cursorQuery = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
  const payload = await midjourneyJson(
    page,
    `/api/imagine?user_id=${encodeURIComponent(userId)}&page_size=${encodeURIComponent(limit)}${cursorQuery}`,
  );
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.data)) {
    throw new CommandExecutionError('Midjourney history endpoint returned a malformed payload');
  }
  return {
    data: payload.data,
    cursor: stringOrNull(payload.cursor),
    checkpoint: stringOrNull(payload.checkpoint),
  };
}

export async function fetchJobStatuses(page, jobIds) {
  if (!Array.isArray(jobIds) || !jobIds.length) return [];
  const payload = await midjourneyJson(page, '/api/job-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { jobIds, _frontend_source: 'opencli_adapter' },
  });
  if (!Array.isArray(payload)) {
    throw new CommandExecutionError('Midjourney job-status endpoint returned a malformed payload');
  }
  return payload;
}

export async function fetchJobStatus(page, jobId, { allowMissing = false } = {}) {
  const payload = await fetchJobStatuses(page, [jobId]);
  const job = payload.find((row) => row?.id === jobId) || null;
  if (!job && !allowMissing) {
    throw new EmptyResultError('midjourney status', `Job ${jobId} was not found in the current account.`);
  }
  return job;
}

export async function cancelMidjourneyJob(page, jobId) {
  let result;
  try {
    result = unwrapEvaluateResult(await page.evaluate(async (id) => {
      const response = await fetch('/api/job-cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' },
        body: JSON.stringify({ job_id: id }),
      });
      return { ok: response.ok, status: response.status, body: await response.text() };
    }, jobId));
  } catch (error) {
    throw new CommandExecutionError(`Midjourney cancel request failed: ${errorMessage(error)}`);
  }
  if (!result?.ok) {
    if ([401, 403].includes(Number(result?.status))) {
      throw new AuthRequiredError(MIDJOURNEY_DOMAIN, 'Log into Midjourney in Chrome, then retry.');
    }
    throw new CommandExecutionError(
      `Midjourney cancel request failed: HTTP ${result?.status ?? 0}${result?.body ? ` ${result.body}` : ''}`,
    );
  }
  return result;
}

export async function getVisibleJobIds(page) {
  const payload = unwrapEvaluateResult(await page.evaluate(() => {
    const ids = new Set();
    for (const link of document.querySelectorAll('a[href*="/jobs/"]')) {
      const match = String(link.getAttribute('href') || '').match(/\/jobs\/([0-9a-f-]{36})/i);
      if (match) ids.add(match[1].toLowerCase());
    }
    return [...ids];
  }));
  return Array.isArray(payload) ? payload.filter((id) => UUID_RE.test(id)) : [];
}

export async function waitForSubmittedJob(page, userId, prompt, baselineIds, timeoutSeconds) {
  return waitForSubmittedJobAfter(page, userId, prompt, baselineIds, timeoutSeconds, Date.now());
}

export async function waitForSubmittedJobAfter(page, userId, prompt, baselineIds, timeoutSeconds, submittedAtMs) {
  return (await waitForSubmittedJobsAfter(page, userId, prompt, baselineIds, timeoutSeconds, submittedAtMs, 1))[0];
}

export async function waitForSubmittedJobsAfter(
  page,
  userId,
  prompt,
  baselineIds,
  timeoutSeconds,
  submittedAtMs,
  expectedCount = 1,
) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  const expected = promptFromFullCommand(prompt);
  const expectedCore = promptCore(prompt);
  const expectedSignature = promptKeySignature(prompt);
  const historyPageSize = Math.min(100, Math.max(20, expectedCount));
  let ambiguousIds = [];
  let consecutivePollFailures = 0;
  while (Date.now() < deadline) {
    let recent = [];
    try {
      recent = await fetchHistory(page, userId, historyPageSize);
      consecutivePollFailures = 0;
    } catch (error) {
      if (error instanceof AuthRequiredError) throw error;
      consecutivePollFailures += 1;
      if (consecutivePollFailures >= 3) throw error;
      await page.wait(1.5);
      continue;
    }
    const newRows = recent.filter((row) => {
      const id = String(row?.id || '').toLowerCase();
      const enqueuedAt = Date.parse(String(row?.enqueue_time || ''));
      return UUID_RE.test(id)
        && !baselineIds.has(id)
        && Number.isFinite(enqueuedAt)
        && enqueuedAt >= submittedAtMs - 5000;
    });
    const matching = newRows.filter((row) => {
      const candidate = promptFromFullCommand(row.full_command);
      return candidate === expected || (
        expectedCore
        && promptCore(candidate) === expectedCore
        && promptKeySignature(candidate) === expectedSignature
      );
    });
    if (matching.length === expectedCount) {
      return [...matching]
        .sort((left, right) => Date.parse(left.enqueue_time) - Date.parse(right.enqueue_time))
        .map((row) => String(row.id).toLowerCase());
    }
    if (matching.length > expectedCount) ambiguousIds = matching.map((row) => String(row.id).toLowerCase());
    await page.wait(1.5);
  }
  if (ambiguousIds.length > expectedCount) {
    throw new CommandExecutionError(
      `Midjourney submission is ambiguous; ${ambiguousIds.length} new jobs matched the prompt`,
      ambiguousIds.map((id) => jobUrl(id)).join(', '),
    );
  }
  throw new TimeoutError(
    'Midjourney job submission',
    timeoutSeconds,
    `Expected ${expectedCount} uniquely matched job(s) after submission.`,
  );
}

export async function waitForDerivedJob(page, userId, parentJobId, baselineIds, timeoutSeconds, submittedAtMs) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let candidates = [];
  let consecutivePollFailures = 0;
  while (Date.now() < deadline) {
    let recent;
    try {
      recent = await fetchHistory(page, userId, 50);
      consecutivePollFailures = 0;
    } catch (error) {
      if (error instanceof AuthRequiredError) throw error;
      consecutivePollFailures += 1;
      if (consecutivePollFailures >= 3) throw error;
      await page.wait(1.5);
      continue;
    }
    candidates = recent.filter((row) => {
      const id = String(row?.id || '').toLowerCase();
      const parent = String(row?.parent_id || '').toLowerCase();
      const enqueuedAt = Date.parse(String(row?.enqueue_time || ''));
      return UUID_RE.test(id)
        && !baselineIds.has(id)
        && parent === String(parentJobId).toLowerCase()
        && Number.isFinite(enqueuedAt)
        && enqueuedAt >= submittedAtMs - 5000;
    });
    if (candidates.length === 1) return String(candidates[0].id).toLowerCase();
    await page.wait(1.5);
  }
  if (candidates.length > 1) {
    throw new CommandExecutionError(
      `Midjourney action is ambiguous; ${candidates.length} derived jobs matched parent ${parentJobId}`,
      candidates.map((row) => jobUrl(row.id)).join(', '),
    );
  }
  throw new TimeoutError('Midjourney derived job submission', timeoutSeconds, `No new child job appeared for ${parentJobId}.`);
}

export async function waitForCompletedJob(page, jobId, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastStatus = 'unknown';
  while (Date.now() < deadline) {
    const job = await fetchJobStatus(page, jobId, { allowMissing: true });
    if (job) {
      lastStatus = String(job.current_status || job.status || 'unknown').toLowerCase();
      if (lastStatus === 'completed') return job;
      if (['failed', 'cancelled', 'canceled', 'error'].includes(lastStatus)) {
        throw new CommandExecutionError(`Midjourney job ${jobId} ended with status "${lastStatus}"`);
      }
    }
    await page.wait(2);
  }
  throw new TimeoutError(
    `Midjourney job ${jobId} (last status: ${lastStatus})`,
    timeoutSeconds,
    `Check the job at ${jobUrl(jobId)} and retry status or download later.`,
  );
}

async function fetchMediaThroughPage(page, url, expectedMimePrefix) {
  const transferKey = `opencli_media_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  try {
    let payload;
    try {
      payload = unwrapEvaluateResult(await page.evaluate(async (mediaUrl, key) => {
        // CDN is public but Cloudflare-protected. Browser-origin fetch succeeds
        // with default same-origin credential mode; forcing cross-origin cookies
        // turns it into a credentialed CORS request and Midjourney rejects it.
        const response = await fetch(mediaUrl);
        if (!response.ok) return { ok: false, status: response.status, type: response.headers.get('content-type') || '' };
        const bytes = new Uint8Array(await response.arrayBuffer());
        window[key] = bytes;
        return {
          ok: true,
          status: response.status,
          type: response.headers.get('content-type') || '',
          size: bytes.length,
        };
      }, url, transferKey));
    } catch (error) {
      throw new CommandExecutionError(`Midjourney browser-context media fetch failed: ${errorMessage(error)}`);
    }
    if (!payload || typeof payload !== 'object' || !payload.ok) {
      throw new CommandExecutionError(`Midjourney media download failed: HTTP ${payload?.status ?? 0} from ${url}`);
    }
    if (!String(payload.type || '').startsWith(expectedMimePrefix)) {
      throw new CommandExecutionError(`Midjourney media download returned unexpected content type "${payload.type || 'unknown'}"`);
    }
    const size = Number(payload.size);
    if (!Number.isInteger(size) || size <= 0) {
      throw new CommandExecutionError(`Midjourney media download returned an empty file from ${url}`);
    }

    // Returning a complete base64 file in one Browser Bridge response can
    // exceed the daemon message limit. Pull it out in bounded chunks instead.
    const parts = [];
    const chunkSize = 96 * 1024;
    for (let offset = 0; offset < size; offset += chunkSize) {
      const base64 = unwrapEvaluateResult(await page.evaluate((key, start, length) => {
        const bytes = window[key];
        if (!(bytes instanceof Uint8Array)) return null;
        const chunk = bytes.subarray(start, Math.min(bytes.length, start + length));
        let binary = '';
        const binaryChunkSize = 0x8000;
        for (let index = 0; index < chunk.length; index += binaryChunkSize) {
          binary += String.fromCharCode(...chunk.subarray(index, index + binaryChunkSize));
        }
        return btoa(binary);
      }, transferKey, offset, chunkSize));
      if (typeof base64 !== 'string' || !base64) {
        throw new CommandExecutionError(`Midjourney media transfer lost its browser buffer at byte ${offset}`);
      }
      parts.push(Buffer.from(base64, 'base64'));
    }
    const buffer = Buffer.concat(parts);
    if (buffer.length !== size) {
      throw new CommandExecutionError(`Midjourney media transfer size mismatch: expected ${size}, received ${buffer.length}`);
    }
    return { buffer, mime: String(payload.type || '').split(';', 1)[0].toLowerCase() };
  } finally {
    await page.evaluate((key) => {
      delete window[key];
      return true;
    }, transferKey).catch(() => {});
  }
}

function sniffMediaMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (/^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'video/mp4';
  return null;
}

async function existingMedia(filePath, force, expectedMime) {
  if (force) return null;
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size <= 0) return null;
    const handle = await fs.open(filePath, 'r');
    try {
      const header = Buffer.alloc(16);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (sniffMediaMime(header.subarray(0, bytesRead)) !== expectedMime) return null;
    } finally {
      await handle.close();
    }
    return stat;
  } catch {
    return null;
  }
}

async function downloadOne(page, jobId, index, outputDir, force) {
  const candidates = [
    { url: originalImageUrl(jobId, index), extension: '.png', mime: 'image/png' },
    { url: `${MIDJOURNEY_CDN}/${jobId}/0_${index}.jpeg`, extension: '.jpg', mime: 'image/jpeg' },
    { url: `${MIDJOURNEY_CDN}/${jobId}/0_${index}.jpg`, extension: '.jpg', mime: 'image/jpeg' },
    { url: `${MIDJOURNEY_CDN}/${jobId}/0_${index}.webp`, extension: '.webp', mime: 'image/webp' },
  ];
  if (!force) {
    for (const candidate of candidates) {
      const filePath = path.join(outputDir, `${jobId}_${index}${candidate.extension}`);
      try {
        const existing = await existingMedia(filePath, false, candidate.mime);
        if (existing) {
          return { index, filePath, bytes: existing.size, url: candidate.url, mime: candidate.mime, cached: true };
        }
      } catch {}
    }
  }

  let media = null;
  let resolved = null;
  let lastError = null;
  for (const candidate of candidates) {
    try {
      media = await fetchMediaThroughPage(page, candidate.url, 'image/');
      resolved = candidate;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!media || !resolved) throw lastError || new CommandExecutionError(`No Midjourney original image was available for ${jobId}`);
  const actualMime = sniffMediaMime(media.buffer);
  if (!actualMime?.startsWith('image/')) {
    throw new CommandExecutionError(`Midjourney original image returned invalid media bytes from ${resolved.url}`);
  }
  if (media.mime !== actualMime) {
    log.warn(`Midjourney CDN reported ${media.mime || 'unknown'} for ${resolved.url}; detected ${actualMime} from file bytes`);
  }
  const extension = actualMime === 'image/png'
    ? '.png'
    : actualMime === 'image/webp'
      ? '.webp'
      : actualMime === 'image/gif'
        ? '.gif'
        : '.jpg';
  const filePath = path.join(outputDir, `${jobId}_${index}${extension}`);

  const tempPath = `${filePath}.part-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(tempPath, media.buffer);
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw new CommandExecutionError(`Could not write Midjourney image ${filePath}: ${errorMessage(error)}`);
  }
  return { index, filePath, bytes: media.buffer.length, url: resolved.url, mime: actualMime, cached: false };
}

export async function downloadOriginals(page, jobId, indices, outputDir, force = false) {
  await fs.mkdir(outputDir, { recursive: true });
  const files = [];
  for (const index of indices) files.push(await downloadOne(page, jobId, index, outputDir, force));
  return files;
}

export function rawVideoUrl(jobId, index) {
  return `${MIDJOURNEY_CDN}/video/${jobId}/${index}.mp4`;
}

async function writeMediaBuffer(filePath, buffer) {
  const tempPath = `${filePath}.part-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(tempPath, buffer);
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw new CommandExecutionError(`Could not write Midjourney media ${filePath}: ${errorMessage(error)}`);
  }
}

export async function downloadRawVideo(page, jobId, index, outputDir, force = false) {
  await fs.mkdir(outputDir, { recursive: true });
  const url = rawVideoUrl(jobId, index);
  const filePath = path.join(outputDir, `${jobId}_${index + 1}_raw.mp4`);
  const existing = await existingMedia(filePath, force, 'video/mp4');
  if (existing) return { index, kind: 'video-raw', filePath, bytes: existing.size, url, mime: 'video/mp4', cached: true };
  const media = await fetchMediaThroughPage(page, url, 'video/');
  const actualMime = sniffMediaMime(media.buffer);
  if (actualMime !== 'video/mp4') {
    throw new CommandExecutionError(`Midjourney raw video returned invalid MP4 bytes from ${url}`);
  }
  if (media.mime !== actualMime) {
    log.warn(`Midjourney CDN reported ${media.mime || 'unknown'} for ${url}; detected ${actualMime} from file bytes`);
  }
  await writeMediaBuffer(filePath, media.buffer);
  return { index, kind: 'video-raw', filePath, bytes: media.buffer.length, url, mime: actualMime, cached: false };
}

export async function downloadRenderedVideo(page, jobId, index, kind, outputDir, force = false) {
  const config = kind === 'video-social'
    ? { label: 'Download for Social', extension: '.mp4', mime: 'video/mp4' }
    : kind === 'gif'
      ? { label: 'Download as GIF', extension: '.gif', mime: 'image/gif' }
      : null;
  if (!config) throw new ArgumentError('Rendered video kind must be video-social or gif');
  await fs.mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `${jobId}_${index + 1}_${kind.replace('video-', '')}${config.extension}`);
  const existing = await existingMedia(filePath, force, config.mime);
  if (existing) return { index, kind, filePath, bytes: existing.size, url: null, mime: config.mime, cached: true };

  await page.goto(jobUrl(jobId, index));
  await page.wait({ selector: 'video[src]', timeout: 20 });
  await page.click('button[title="Options"]');
  await page.wait(0.3);
  const marked = unwrapEvaluateResult(await page.evaluate((label) => {
    document.querySelectorAll('[data-opencli-video-download]').forEach((node) => node.removeAttribute('data-opencli-video-download'));
    const button = [...document.querySelectorAll('button[role="menuitem"],button')]
      .find((node) => node.textContent?.trim() === label && node.getBoundingClientRect().width > 0);
    if (!button) return false;
    button.setAttribute('data-opencli-video-download', '1');
    return true;
  }, config.label));
  if (!marked) throw new CommandExecutionError(`Midjourney did not expose "${config.label}" for video ${jobId}`);
  await page.click('[data-opencli-video-download="1"]');
  if (typeof page.waitForDownload !== 'function') {
    throw new CommandExecutionError('Browser Bridge download lifecycle support is required for social video/GIF export');
  }
  const downloaded = await page.waitForDownload(jobId, 60_000);
  if (!downloaded?.downloaded || downloaded.state !== 'complete' || !downloaded.filename) {
    throw new CommandExecutionError(`Midjourney ${kind} download did not complete: ${downloaded?.error || downloaded?.state || 'unknown'}`);
  }
  const sourcePath = path.resolve(String(downloaded.filename));
  const sourceStat = await fs.stat(sourcePath).catch(() => null);
  if (!sourceStat?.isFile() || sourceStat.size <= 0) {
    throw new CommandExecutionError(`Browser reported a completed download but the file is missing: ${sourcePath}`);
  }
  const handle = await fs.open(sourcePath, 'r');
  let actualMime;
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    actualMime = sniffMediaMime(header.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
  if (actualMime !== config.mime) {
    throw new CommandExecutionError(
      `Midjourney ${kind} returned invalid media bytes; expected ${config.mime}, detected ${actualMime || 'unknown'}`,
    );
  }
  if (downloaded.mime && downloaded.mime !== actualMime) {
    log.warn(`Browser Bridge reported ${downloaded.mime} for ${sourcePath}; detected ${actualMime} from file bytes`);
  }
  const tempPath = `${filePath}.part-${process.pid}-${Date.now()}`;
  try {
    await fs.copyFile(sourcePath, tempPath);
    await fs.rename(tempPath, filePath);
    if (sourcePath !== filePath) await fs.unlink(sourcePath).catch(() => {});
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw new CommandExecutionError(`Could not store Midjourney ${kind} at ${filePath}: ${errorMessage(error)}`);
  }
  return {
    index,
    kind,
    filePath,
    bytes: sourceStat.size,
    url: stringOrNull(downloaded.finalUrl ?? downloaded.url),
    mime: actualMime,
    cached: false,
  };
}

export function displayPath(filePath) {
  const home = os.homedir();
  return filePath.startsWith(home) ? `~${filePath.slice(home.length)}` : filePath;
}

export async function recordQuotaSnapshot(account, source = 'unknown') {
  const row = {
    observedAt: new Date().toISOString(),
    source: String(source),
    plan: stringOrNull(account?.plan?.type),
    subscriptionStatus: stringOrNull(account?.status),
    billingStart: isoFromMillis(account?.billing_period?.start),
    billingEnd: isoFromMillis(account?.billing_period?.end),
    periodCredits: numberOrNull(account?.period_credits),
    periodCreditsUsed: numberOrNull(account?.period_credits_used ?? account?.credit_period_usage),
    remainingCredits: numberOrNull(account?.total_credits ?? account?.credits_total),
  };
  try {
    await fs.mkdir(MIDJOURNEY_SITE_DIR, { recursive: true });
    await fs.appendFile(USAGE_SNAPSHOT_PATH, `${JSON.stringify(row)}\n`, 'utf8');
  } catch (error) {
    // A local monitoring write must never turn a completed paid job into a
    // reported command failure: that would invite an accidental paid retry.
    log.warn(`Could not persist Midjourney quota snapshot: ${errorMessage(error)}`);
  }
  return row;
}

export async function readQuotaTrend(account) {
  let raw = '';
  try {
    raw = await fs.readFile(USAGE_SNAPSHOT_PATH, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new CommandExecutionError(`Could not read Midjourney usage snapshots: ${errorMessage(error)}`);
  }
  const currentStart = isoFromMillis(account?.billing_period?.start);
  const rows = raw.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try {
      const parsed = JSON.parse(line);
      return parsed?.billingStart === currentStart ? [parsed] : [];
    } catch {
      return [];
    }
  }).filter((row) => Number.isFinite(Date.parse(row.observedAt)) && Number.isFinite(Number(row.periodCreditsUsed)));
  if (rows.length < 2) return { avgDailyMinutes: null, projectedExhaustionDate: null };
  const first = rows[0];
  const last = rows.at(-1);
  const elapsedDays = (Date.parse(last.observedAt) - Date.parse(first.observedAt)) / 86_400_000;
  const usedMinutes = creditsToFastMinutes(Number(last.periodCreditsUsed) - Number(first.periodCreditsUsed));
  if (!(elapsedDays >= 1) || !(usedMinutes > 0)) return { avgDailyMinutes: null, projectedExhaustionDate: null };
  const avgDailyMinutes = Number((usedMinutes / elapsedDays).toFixed(2));
  const remainingMinutes = creditsToFastMinutes(account?.total_credits ?? account?.credits_total);
  const projected = remainingMinutes > 0
    ? new Date(Date.now() + (remainingMinutes / avgDailyMinutes) * 86_400_000).toISOString()
    : null;
  return { avgDailyMinutes, projectedExhaustionDate: projected };
}

export function parseReferenceArgument(value, label, { multiple = true, allowStyleCode = false } = {}) {
  if (value == null || value === '') return [];
  let items;
  const raw = String(value).trim();
  if (raw.startsWith('[')) {
    try {
      items = JSON.parse(raw);
    } catch (error) {
      throw new ArgumentError(`${label} must be a path/URL or a JSON array: ${errorMessage(error)}`);
    }
  } else {
    items = [raw];
  }
  if (!Array.isArray(items) || items.length === 0 || items.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new ArgumentError(`${label} must contain one or more non-empty strings`);
  }
  if (!multiple && items.length !== 1) throw new ArgumentError(`${label} accepts exactly one reference`);
  return items.map((item) => item.trim()).map((item) => {
    if (allowStyleCode && /^\d+$/.test(item)) return { kind: 'styleCode', value: item };
    if (/^https:\/\//i.test(item)) {
      try {
        const parsed = new URL(item);
        const match = parsed.hostname === MIDJOURNEY_DOMAIN
          ? parsed.pathname.match(/^\/jobs\/([0-9a-f-]{36})\/?$/i)
          : null;
        if (match && UUID_RE.test(match[1])) {
          const index = Number(parsed.searchParams.get('index') || 0);
          if (!Number.isInteger(index) || index < 0 || index > 3) {
            throw new ArgumentError(`${label} Midjourney job URL index must be 0..3: ${item}`);
          }
          return { kind: 'url', value: originalImageUrl(match[1].toLowerCase(), index), source: item };
        }
      } catch (error) {
        if (error instanceof ArgumentError) throw error;
      }
      return { kind: 'url', value: item };
    }
    const expanded = item === '~' ? os.homedir() : item.startsWith('~/') ? path.join(os.homedir(), item.slice(2)) : item;
    return { kind: 'local', value: path.resolve(expanded) };
  });
}

export async function validateLocalReferences(refs, label) {
  for (const ref of refs.filter((item) => item.kind === 'local')) {
    let stat;
    try {
      stat = await fs.stat(ref.value);
    } catch {
      throw new ArgumentError(`${label} file does not exist: ${ref.value}`);
    }
    if (!stat.isFile() || stat.size <= 0) throw new ArgumentError(`${label} must reference a non-empty file: ${ref.value}`);
    if (stat.size > MAX_REFERENCE_BYTES) throw new ArgumentError(`${label} exceeds Midjourney's 10MB upload limit: ${ref.value}`);
    const ext = path.extname(ref.value).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) throw new ArgumentError(`${label} must be PNG, JPEG, WEBP, or GIF: ${ref.value}`);
  }
  return refs;
}

async function visibleImageSources(page) {
  const payload = unwrapEvaluateResult(await page.evaluate(() => [...document.querySelectorAll('img[src]')]
    .filter((img) => {
      const rect = img.getBoundingClientRect();
      let card = img.parentElement;
      while (card && !String(card.className).includes('group/img')) card = card.parentElement;
      return Boolean(card) && rect.width > 24 && rect.height > 24 && /cdn\.midjourney\.com\/u\//.test(img.src);
    })
    .map((img) => img.src)));
  return Array.isArray(payload) ? payload.map(String) : [];
}

export async function openImagePanel(page) {
  const markInput = async () => unwrapEvaluateResult(await page.evaluate(() => {
    document.querySelectorAll('[data-opencli-image-input]').forEach((node) => node.removeAttribute('data-opencli-image-input'));
    const inputs = [...document.querySelectorAll('input[type="file"][accept*="image"]')];
    const active = inputs.find((input) => {
      let root = input.parentElement;
      for (let depth = 0; depth < 8 && root; depth += 1, root = root.parentElement) {
        const rect = root.getBoundingClientRect();
        if (rect.width > 100 && rect.height > 40) return true;
      }
      return false;
    });
    if (!active) return false;
    active.setAttribute('data-opencli-image-input', '1');
    return true;
  }));
  if (!await markInput()) {
    await clickVisibleControl(page, 'Add Images');
    await page.wait({ selector: 'input[type="file"][accept*="image"]', timeout: 10 });
    if (!await markInput()) throw new CommandExecutionError('Midjourney image upload input did not become active');
  }
}

export async function clearImagePrompts(page) {
  await openImagePanel(page);
  const clearVisible = unwrapEvaluateResult(await page.evaluate(() => {
    const button = document.querySelector('button[title="Clear Image Prompts"]');
    if (!button) return false;
    const rect = button.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }));
  if (clearVisible) await clickVisibleControl(page, 'Clear Image Prompts');
}

export async function closeImagePanel(page) {
  const visible = Boolean(unwrapEvaluateResult(await page.evaluate(() => {
    const isVisible = (node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(node).display !== 'none';
    };
    const clear = document.querySelector('button[title="Clear Image Prompts"]');
    const slot = [...document.querySelectorAll('div,span')]
      .find((node) => node.children.length === 0 && node.textContent?.trim() === 'Image Prompts' && isVisible(node));
    return Boolean((clear && isVisible(clear)) || slot);
  })));
  if (!visible) return;
  await clickVisibleControl(page, 'Add Images');
  await page.wait(0.25);
}

async function injectImagesFallback(page, localPaths) {
  // Older Browser Bridge builds do not expose CDP set-file-input. Keep each
  // evaluate payload small so high-resolution references do not exceed the
  // daemon message limit, then reconstruct the File objects in page context.
  const uploadKey = `opencli_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await page.evaluate((key) => {
    window[key] = [];
    return true;
  }, uploadKey);
  try {
    for (const localPath of localPaths) {
      const descriptor = {
        name: path.basename(localPath),
        mime: IMAGE_EXTENSIONS.get(path.extname(localPath).toLowerCase()),
      };
      const fileIndex = unwrapEvaluateResult(await page.evaluate((key, item) => {
        const files = window[key];
        if (!Array.isArray(files)) return -1;
        files.push({ ...item, chunks: [] });
        return files.length - 1;
      }, uploadKey, descriptor));
      if (!Number.isInteger(fileIndex) || fileIndex < 0) {
        throw new CommandExecutionError('Midjourney reference upload fallback could not initialize its transfer buffer');
      }
      const base64 = (await fs.readFile(localPath)).toString('base64');
      const chunkSize = 96 * 1024;
      for (let offset = 0; offset < base64.length; offset += chunkSize) {
        const chunk = base64.slice(offset, offset + chunkSize);
        const appended = unwrapEvaluateResult(await page.evaluate((key, index, value) => {
          const file = window[key]?.[index];
          if (!file || !Array.isArray(file.chunks)) return false;
          file.chunks.push(value);
          return true;
        }, uploadKey, fileIndex, chunk));
        if (!appended) throw new CommandExecutionError('Midjourney reference upload fallback lost its transfer buffer');
      }
    }
    const result = unwrapEvaluateResult(await page.evaluate((key) => {
    const input = document.querySelector('[data-opencli-image-input="1"]');
    if (!(input instanceof HTMLInputElement)) return { ok: false, reason: 'image file input not found' };
    const transfer = new DataTransfer();
    for (const item of window[key] || []) {
      const binary = atob(item.chunks.join(''));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      transfer.items.add(new File([bytes], item.name, { type: item.mime }));
    }
    input.files = transfer.files;
    const nativeEvent = new Event('change', { bubbles: true });
    const propsKey = Object.keys(input).find((key) => key.startsWith('__reactProps$'));
    if (propsKey && typeof input[propsKey]?.onChange === 'function') {
      input[propsKey].onChange({ target: input, currentTarget: input, nativeEvent });
    } else {
      input.dispatchEvent(nativeEvent);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return { ok: true, count: transfer.files.length };
    }, uploadKey));
    if (!result?.ok) throw new CommandExecutionError(`Midjourney reference upload fallback failed: ${result?.reason || 'unknown error'}`);
  } finally {
    await page.evaluate((key) => {
      delete window[key];
      return true;
    }, uploadKey).catch(() => {});
  }
}

async function markReferenceTarget(page, sourceUrl, slotLabel) {
  const result = unwrapEvaluateResult(await page.evaluate((url, label) => {
    document.querySelectorAll('[data-opencli-ref-source],[data-opencli-ref-target]').forEach((el) => {
      el.removeAttribute('data-opencli-ref-source');
      el.removeAttribute('data-opencli-ref-target');
    });
    const source = [...document.querySelectorAll('img[src]')].find((img) => img.src === url);
    const labelNode = [...document.querySelectorAll('div,span')].find((node) => node.children.length === 0 && node.textContent?.trim() === label);
    if (!source || !labelNode) return { ok: false, source: Boolean(source), target: Boolean(labelNode) };
    let target = labelNode.parentElement;
    while (target && target.parentElement) {
      const rect = target.getBoundingClientRect();
      if (rect.width >= 120 && rect.height >= 45) break;
      target = target.parentElement;
    }
    if (!target) return { ok: false, source: true, target: false };
    source.setAttribute('data-opencli-ref-source', '1');
    target.setAttribute('data-opencli-ref-target', '1');
    return { ok: true };
  }, sourceUrl, slotLabel));
  if (!result?.ok) throw new CommandExecutionError(`Could not locate Midjourney ${slotLabel} slot after upload`);
}

async function verifyReferenceTarget(page, slotLabel) {
  const assigned = unwrapEvaluateResult(await page.evaluate((label) => {
    const labelNode = [...document.querySelectorAll('div,span')]
      .find((node) => node.children.length === 0 && node.textContent?.trim() === label);
    if (!labelNode) return false;
    const peerLabels = ['Image Prompts', 'Style References', 'Omni Reference'].filter((item) => item !== label);
    let target = labelNode;
    for (let depth = 0; depth < 8 && target?.parentElement; depth += 1) {
      target = target.parentElement;
      const text = target.textContent || '';
      if (peerLabels.some((peer) => text.includes(peer))) break;
      const empty = [...target.querySelectorAll('div')]
        .some((node) => /^Select images? below$/i.test(node.textContent?.trim() || ''));
      if (!empty && target.querySelector('button,img')) return true;
    }
    return false;
  }, slotLabel));
  if (!assigned) throw new CommandExecutionError(`Midjourney ${slotLabel} reference assignment was not verified`);
}

export async function uploadReferenceLibrary(page, localPaths) {
  if (!localPaths.length) return [];
  await openImagePanel(page);
  const beforeSources = await visibleImageSources(page);
  const before = new Set(beforeSources);
  let captureReady = false;
  if (typeof page.installInterceptor === 'function'
    && typeof page.getInterceptedRequests === 'function'
    && typeof page.waitForCapture === 'function') {
    try {
      await page.installInterceptor('/api/storage-upload-file');
      await page.getInterceptedRequests();
      captureReady = true;
    } catch {}
  }
  let uploaded = false;
  if (typeof page.setFileInput === 'function') {
    try {
      await page.setFileInput(localPaths, '[data-opencli-image-input="1"]');
      uploaded = true;
    } catch (error) {
      const message = errorMessage(error);
      if (!/Unknown action|not supported|Not allowed|No element found/i.test(message)) throw error;
    }
  }
  if (!uploaded) await injectImagesFallback(page, localPaths);

  let capturedSources = [];
  if (captureReady) {
    try {
      await page.waitForCapture(10);
      capturedSources = uploadedStorageUrlsFromCaptures(await page.getInterceptedRequests());
    } catch {}
  }

  let newSources = [];
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await page.wait(1);
    const currentSources = await visibleImageSources(page);
    const capturedVisible = capturedSources.filter((url) => currentSources.includes(url));
    if (capturedVisible.length >= localPaths.length) return capturedVisible.slice(0, localPaths.length);
    newSources = currentSources.filter((url) => !before.has(url));
    if (newSources.length >= localPaths.length) break;
  }
  if (newSources.length < localPaths.length) {
    throw new TimeoutError('Midjourney reference upload', 30, `Expected ${localPaths.length} uploaded image(s), saw ${newSources.length}.`);
  }

  return newSources.slice(0, localPaths.length);
}

async function openEndFramePicker(page) {
  const marked = unwrapEvaluateResult(await page.evaluate(() => {
    document.querySelectorAll('[data-opencli-end-frame-picker]').forEach((node) => {
      node.removeAttribute('data-opencli-end-frame-picker');
    });
    const label = [...document.querySelectorAll('div')]
      .find((node) => node.children.length === 0 && node.textContent?.trim() === 'End Frame');
    let target = label;
    for (let depth = 0; depth < 7 && target; depth += 1, target = target.parentElement) {
      if (String(target.className).includes('cursor-pointer')) {
        target.setAttribute('data-opencli-end-frame-picker', '1');
        return true;
      }
    }
    return false;
  }));
  if (!marked) throw new CommandExecutionError('Midjourney manual video composer did not expose the End Frame picker');
  await page.click('[data-opencli-end-frame-picker="1"]');
  await page.wait({ selector: 'input[type="file"][accept*="image"]', timeout: 10 });
}

export async function uploadReferencesToSlot(page, localPaths, slot) {
  if (!localPaths.length) return [];
  if (slot === 'end') await openEndFramePicker(page);
  const selected = await uploadReferenceLibrary(page, localPaths);

  // Uploading while the persistent composer retained a video state can leave
  // the library open beside Start/End Frame slots. Reassert image mode before
  // assigning image-generation references; End Frame intentionally stays in
  // the manual video composer.
  if (slot !== 'end') {
    await ensureImageComposer(page);
    await openImagePanel(page);
  }

  const label = slot === 'style'
    ? 'Style References'
    : slot === 'end'
      ? 'End Frame'
      : slot === 'image'
        ? 'Image Prompts'
        : 'Omni Reference';
  if (slot === 'omni' && selected.length !== 1) throw new ArgumentError('Omni Reference accepts exactly one local image');
  if (typeof page.drag !== 'function') throw new CommandExecutionError('Browser Bridge does not support Reference drag-and-drop');
  for (const url of selected) {
    await markReferenceTarget(page, url, label);
    await page.drag('[data-opencli-ref-source="1"]', '[data-opencli-ref-target="1"]');
    await page.wait(0.8);
    await verifyReferenceTarget(page, label);
  }
  return selected;
}

function normalizeButtonText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export async function clickCreationAction(page, text, occurrence = 0) {
  const target = unwrapEvaluateResult(await page.evaluate((label, wantedIndex) => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const close = [...document.querySelectorAll('button[title="Close"]')].filter(visible).at(-1);
    const scope = close?.parentElement?.parentElement;
    if (!scope) return { ok: false, reason: 'job detail scope not found' };
    const matches = [...scope.querySelectorAll('button')]
      .filter(visible)
      .filter((button) => String(button.textContent || '').replace(/\s+/g, ' ').trim() === label);
    const button = matches[wantedIndex];
    if (!button) return { ok: false, reason: `button ${label} occurrence ${wantedIndex} not found`, count: matches.length };
    if (button.disabled) return { ok: false, reason: `button ${label} is disabled`, count: matches.length };
    const rect = button.getBoundingClientRect();
    return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, count: matches.length };
  }, normalizeButtonText(text), occurrence));
  if (!target?.ok) throw new CommandExecutionError(`Midjourney Creation Action unavailable: ${target?.reason || text}`);
  if (typeof page.nativeClick !== 'function') throw new CommandExecutionError('Browser Bridge native click support is required for Creation Actions');
  await page.nativeClick(target.x, target.y);
  return target;
}

export async function clickVisibleControl(page, label) {
  const target = unwrapEvaluateResult(await page.evaluate((wanted) => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).display !== 'none';
    };
    const button = [...document.querySelectorAll('button')].find((node) => visible(node) && (
      node.textContent?.trim().replace(/\s+/g, ' ') === wanted
      || node.title === wanted
      || node.getAttribute('aria-label') === wanted
    ));
    if (!button || button.disabled) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, label));
  if (!target) throw new CommandExecutionError(`Visible Midjourney control "${label}" was not found`);
  if (typeof page.nativeClick !== 'function') throw new CommandExecutionError('Browser Bridge native click support is required');
  await page.nativeClick(target.x, target.y);
}

export async function clickComposerSubmit(page) {
  const marked = unwrapEvaluateResult(await page.evaluate(() => {
    document.querySelectorAll('[data-opencli-composer-submit]').forEach((node) => {
      node.removeAttribute('data-opencli-composer-submit');
    });
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).display !== 'none';
    };
    const input = document.querySelector('#desktop_input_bar');
    const row = input?.parentElement;
    if (!input || !row) return false;
    const textSubmit = [...row.querySelectorAll('button')]
      .find((button) => visible(button) && button.textContent?.trim() === 'Submit');
    const following = [...row.querySelectorAll('button')].filter((button) => (
      visible(button)
      && Boolean(input.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING)
    ));
    // In the compact composer the submit icon is the first button after the
    // text area and Settings is the second. One unlabeled trailing button is
    // ambiguous, so fail closed instead of risking a click on Settings.
    const button = textSubmit || (following.length >= 2 ? following[0] : null);
    if (!button || button.disabled) return false;
    button.setAttribute('data-opencli-composer-submit', '1');
    return true;
  }));
  if (!marked) throw new CommandExecutionError('Midjourney composer submit control was not found');
  await page.click('[data-opencli-composer-submit="1"]');
}

export async function toggleSettingsPanel(page) {
  let target = unwrapEvaluateResult(await page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).display !== 'none';
    };
    const labeled = [...document.querySelectorAll('button')].find((node) => visible(node) && (
      node.textContent?.trim().replace(/\s+/g, ' ') === 'Settings'
      || node.title === 'Settings'
      || node.getAttribute('aria-label') === 'Settings'
    ));
    if (labeled) {
      const rect = labeled.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    const input = document.querySelector('#desktop_input_bar');
    let root = input?.parentElement;
    for (let depth = 0; depth < 4 && root; depth += 1, root = root.parentElement) {
      const buttons = [...root.querySelectorAll('button')].filter(visible);
      const nonImage = buttons.filter((button) => button.getAttribute('aria-label') !== 'Add Images');
      if (buttons.some((button) => button.getAttribute('aria-label') === 'Add Images') && nonImage.length) {
        const button = nonImage.at(-1);
        const rect = button.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
    }
    return null;
  }));
  if (!target) throw new CommandExecutionError('Visible Midjourney Settings control was not found');
  if (typeof page.nativeClick !== 'function') throw new CommandExecutionError('Browser Bridge native click support is required');
  await page.nativeClick(target.x, target.y);
  await page.wait(0.4);
}

export async function isSettingsPanelVisible(page) {
  return Boolean(unwrapEvaluateResult(await page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).display !== 'none';
    };
    const label = document.querySelector('a[href*="GPU-Speed"]');
    const fast = [...document.querySelectorAll('button')].find((node) => node.textContent?.trim() === 'Fast' && visible(node));
    return Boolean((label && visible(label)) || fast);
  })));
}

export async function ensureImageComposer(page) {
  const composerMode = async () => unwrapEvaluateResult(await page.evaluate(() => {
    const visible = (button) => Boolean(button && button.getBoundingClientRect().width > 0);
    if (visible(document.querySelector('button[title="Switch to Image"]'))) return 'video';
    if (visible(document.querySelector('button[title="Switch to Video"]'))) return 'image';
    return 'unknown';
  }));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const mode = await composerMode();
    if (mode !== 'video') return;
    await clickVisibleControl(page, 'Switch to Image');
    await page.wait(0.75);
  }
  if (await composerMode() === 'video') {
    throw new CommandExecutionError('Midjourney composer did not switch from video to image mode');
  }
}

export async function readSiteSettings(page) {
  const settingsVisible = await isSettingsPanelVisible(page);
  if (!settingsVisible) {
    await toggleSettingsPanel(page);
  }
  const result = unwrapEvaluateResult(await page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).display !== 'none';
    };
    const exactNode = (text) => [...document.querySelectorAll('h2,a,div,span')]
      .filter((node) => node.textContent?.trim() === text && visible(node))
      .sort((left, right) => left.children.length - right.children.length)[0] || null;
    const isSelected = (button) => button.getAttribute('aria-pressed') === 'true'
      || button.getAttribute('aria-checked') === 'true'
      || ['active', 'checked', 'on'].includes(button.getAttribute('data-state'))
      || String(button.className).includes('text-splash');
    const selectedNear = (anchorText, candidates) => {
      let anchor = exactNode(anchorText);
      if (!anchor) return null;
      for (let depth = 0; depth < 7 && anchor; depth += 1, anchor = anchor.parentElement) {
        const buttons = [...anchor.querySelectorAll('button')].filter(visible);
        const matching = buttons.filter((button) => candidates.includes(button.textContent?.trim()));
        if (matching.length >= Math.min(2, candidates.length)) {
          const selected = matching.find(isSelected);
          return selected?.textContent?.trim() || null;
        }
      }
      return null;
    };
    const versionLink = [...document.querySelectorAll('a[href*="Version"]')].find(visible);
    let version = null;
    let versionRoot = versionLink;
    for (let depth = 0; depth < 6 && versionRoot; depth += 1, versionRoot = versionRoot.parentElement) {
      const menu = versionRoot.querySelector('[aria-haspopup="menu"]');
      if (menu && /^\d+(?:\.\d+)?$/.test(menu.textContent?.trim() || '')) {
        version = menu.textContent.trim();
        break;
      }
    }
    const imageResolution = selectedNear('Version', ['Standard', 'HD']);
    const personalization = selectedNear('Personalize', ['On', 'Off']);
    const raw = selectedNear('Raw', ['Standard', 'Raw']);
    return {
      model: version ? `v${version}` : null,
      imageResolution: imageResolution ? imageResolution.toLowerCase().replace('standard', 'sd') : null,
      personalization: personalization ? personalization === 'On' : null,
      raw: raw ? raw === 'Raw' : null,
      speed: (selectedNear('Speed', ['Relax', 'Fast', 'Turbo']) || '').toLowerCase() || null,
      videoResolution: (selectedNear('Video Resolution', ['SD', 'HD']) || '').toLowerCase() || null,
      videoBatchSize: Number(selectedNear('Video Batch Size', ['1', '2', '4'])) || null,
    };
  }));
  if (!result || typeof result !== 'object') throw new CommandExecutionError('Midjourney settings panel returned an unexpected shape');
  const missing = ['model', 'imageResolution', 'speed'].filter((key) => result[key] == null);
  if (missing.length) {
    throw new CommandExecutionError(`Midjourney settings panel is missing required field(s): ${missing.join(', ')}`);
  }
  return result;
}

export async function selectSiteSetting(page, anchorText, candidates, targetText) {
  await readSiteSettings(page);
  const target = unwrapEvaluateResult(await page.evaluate((anchorLabel, values, wanted) => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).display !== 'none';
    };
    document.querySelectorAll('[data-opencli-setting-target]').forEach((node) => node.removeAttribute('data-opencli-setting-target'));
    const anchors = [...document.querySelectorAll('h2,a,div,span')]
      .filter((node) => node.textContent?.trim() === anchorLabel && visible(node))
      .sort((left, right) => left.children.length - right.children.length);
    let root = anchors[0] || null;
    for (let depth = 0; depth < 7 && root; depth += 1, root = root.parentElement) {
      const buttons = [...root.querySelectorAll('button')].filter(visible);
      const matching = buttons.filter((button) => values.includes(button.textContent?.trim()));
      if (matching.length >= Math.min(2, values.length)) {
        const button = matching.find((item) => item.textContent?.trim() === wanted);
        if (!button) return { ok: false, reason: `${wanted} option not found` };
        if (button.disabled) return { ok: false, reason: `${wanted} option is disabled` };
        const selected = button.getAttribute('aria-pressed') === 'true'
          || button.getAttribute('aria-checked') === 'true'
          || ['active', 'checked', 'on'].includes(button.getAttribute('data-state'))
          || String(button.className).includes('text-splash');
        if (selected) return { ok: true, changed: false };
        button.setAttribute('data-opencli-setting-target', '1');
        return { ok: true, changed: true };
      }
    }
    return { ok: false, reason: `${anchorLabel} setting group not found` };
  }, anchorText, candidates, targetText));
  if (!target?.ok) throw new CommandExecutionError(`Could not set Midjourney ${anchorText}: ${target?.reason || targetText}`);
  if (target.changed) {
    await page.click('[data-opencli-setting-target="1"]');
    await page.wait(0.4);
    const verified = await readSiteSettings(page);
    const selected = anchorText === 'Video Resolution'
      ? String(verified.videoResolution || '').toUpperCase()
      : anchorText === 'Video Batch Size'
        ? String(verified.videoBatchSize || '')
        : null;
    if (selected !== targetText) {
      throw new CommandExecutionError(
        `Could not verify Midjourney ${anchorText}: expected ${targetText}, found ${selected || 'unknown'}`,
      );
    }
  }
  return target.changed;
}
