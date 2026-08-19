import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  cancelMidjourneyJob,
  creditsToFastMinutes,
  downloadRawVideo,
  downloadRenderedVideo,
  normalizePositiveInt,
  originalImageUrl,
  parseImageIndices,
  parseJobId,
  parseReferenceArgument,
  promptCore,
  promptFromFullCommand,
  promptKeySignature,
  jobStatusRow,
  selectSiteSetting,
  waitForCompletedJob,
  waitForDerivedJob,
  waitForSubmittedJobsAfter,
  submittedJobIdsFromCaptures,
  uploadedStorageUrlsFromCaptures,
} from './utils.js';

const JOB = 'd5664250-5f1f-4cd0-9637-2ce0153dd30a';
const tempDirs = [];

afterEach(async () => {
  vi.restoreAllMocks();
  delete globalThis.window;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

it('parseJobId accepts UUIDs and canonical URLs', () => {
  expect(parseJobId(JOB.toUpperCase())).toBe(JOB);
  expect(parseJobId(`https://www.midjourney.com/jobs/${JOB}`)).toBe(JOB);
  expect(() => parseJobId('not-a-job')).toThrow();
});

it('parseImageIndices handles all and validates bounds', () => {
  expect(parseImageIndices('all', 4)).toEqual([0, 1, 2, 3]);
  expect(parseImageIndices('2', 4)).toEqual([1]);
  expect(parseImageIndices('4', 4)).toEqual([3]);
  expect(() => parseImageIndices('0', 4)).toThrow();
  expect(() => parseImageIndices('5', 4)).toThrow();
});

it('normalizers preserve command contracts', () => {
  expect(normalizePositiveInt(undefined, 10, 100, '--limit')).toBe(10);
  expect(() => normalizePositiveInt(101, 10, 100, '--limit')).toThrow();
  expect(promptFromFullCommand('/imagine prompt:  blue circle   --ar 1:1')).toBe('blue circle --ar 1:1');
  expect(promptCore('blue circle --no text --ar 1:1 --v 8.2')).toBe('blue circle');
  expect(promptKeySignature('blue circle --v 8.2 --sd --fast --raw'))
    .toBe(promptKeySignature('blue circle --raw --fast --sd --v 8.2'));
  expect(promptCore('https://s.mj.run/ref blue circle --v 7.0')).toBe('blue circle');
  expect(promptKeySignature('blue circle --v 7')).toBe(promptKeySignature('blue circle --v 7.0 --oref https://s.mj.run/ref'));
});

it('credit and CDN helpers match observed Midjourney contracts', () => {
  expect(creditsToFastMinutes(12_000_000)).toBe(200);
  expect(originalImageUrl(JOB, 3)).toBe(`https://cdn.midjourney.com/${JOB}/0_3.png`);
});

it('reference parsing converts job URLs and preserves style codes', () => {
  expect(parseReferenceArgument(`https://www.midjourney.com/jobs/${JOB}?index=2`, '--image-ref'))
    .toEqual([{ kind: 'url', value: `https://cdn.midjourney.com/${JOB}/0_2.png`, source: `https://www.midjourney.com/jobs/${JOB}?index=2` }]);
  expect(parseReferenceArgument('["12345","https://example.com/a.png"]', '--style-ref', { allowStyleCode: true })).toEqual([
    { kind: 'styleCode', value: '12345' },
    { kind: 'url', value: 'https://example.com/a.png' },
  ]);
  expect(() => parseReferenceArgument('["a","b"]', '--omni-ref', { multiple: false })).toThrow();
});

it('job normalization preserves missing fields as null', () => {
  const row = jobStatusRow({
    id: JOB,
    current_status: 'completed',
    full_command: 'blue circle --v 8.2 --sd',
    enqueue_time: '2026-07-29 14:32:34.372731+00:00',
  });
  expect(row.status).toBe('completed');
  expect(row.model).toBe('v8.2');
  expect(row.resolution).toBe('sd');
  expect(row.width).toBeNull();
  expect(row.progressPct).toBeNull();
  expect(row.completedAt).toBeNull();
  expect(jobStatusRow({ id: JOB, current_status: 'error' }).status).toBe('failed');
  expect(jobStatusRow({ id: JOB, full_command: 'blue --v 7.0' }).model).toBe('v7');
  expect(jobStatusRow({ id: JOB, full_command: 'blue --niji 6.0' }).model).toBe('niji6');
});

function fakePage({ history = [], statuses = [] } = {}) {
  return {
    async fetchJson(endpoint) {
      if (endpoint.startsWith('/api/imagine?')) return { data: history };
      if (endpoint === '/api/job-status') return statuses;
      throw new Error(`Unexpected endpoint: ${endpoint}`);
    },
    async wait() {},
  };
}

it('submission correlation returns exactly the new prompt matches in enqueue order', async () => {
  const first = '11111111-1111-1111-1111-111111111111';
  const second = '22222222-2222-2222-2222-222222222222';
  const submittedAt = Date.parse('2026-07-30T00:00:00Z');
  const page = fakePage({ history: [
    { id: second, full_command: '/imagine prompt: unique test --fast --v 8.2 --sd', enqueue_time: '2026-07-30T00:00:02Z' },
    { id: first, full_command: 'unique test --v 8.2 --sd --fast', enqueue_time: '2026-07-30T00:00:01Z' },
  ] });
  expect(await waitForSubmittedJobsAfter(
    page, 'user', 'unique test --v 8.2 --sd --fast', new Set(), 1, submittedAt, 2,
  )).toEqual([first, second]);
});

it('submission correlation requests enough history rows for the largest repeat batch', async () => {
  const submittedAt = Date.parse('2026-07-30T00:00:00Z');
  const history = Array.from({ length: 40 }, (_, index) => ({
    id: `${String(index).padStart(8, '0')}-1111-1111-1111-${String(index).padStart(12, '0')}`,
    full_command: 'repeat test --v 8.2 --sd --fast --repeat 40',
    enqueue_time: new Date(submittedAt + index * 1000).toISOString(),
  }));
  const requestedSizes = [];
  const page = {
    async fetchJson(endpoint) {
      const size = Number(new URL(endpoint, 'https://www.midjourney.com').searchParams.get('page_size'));
      requestedSizes.push(size);
      return { data: history.slice(0, size) };
    },
    async wait() {},
  };
  const ids = await waitForSubmittedJobsAfter(
    page,
    'user',
    'repeat test --v 8.2 --sd --fast --repeat 40',
    new Set(),
    1,
    submittedAt,
    40,
  );
  expect(ids).toHaveLength(40);
  expect(requestedSizes).toEqual([40]);
});

it('submission correlation tolerates UI-only local reference weights omitted from history', async () => {
  const jobId = '77777777-7777-7777-7777-777777777777';
  const submittedAt = Date.parse('2026-07-30T00:00:00Z');
  const page = fakePage({ history: [{
    id: jobId,
    full_command: 'local reference test --fast --sd --v 8.2',
    enqueue_time: '2026-07-30T00:00:01Z',
  }] });
  expect(await waitForSubmittedJobsAfter(
    page,
    'user',
    'local reference test --fast --sd --v 8.2 --iw 1.2',
    new Set(),
    1,
    submittedAt,
    1,
  )).toEqual([jobId]);
});

it('submission correlation fails closed on ambiguous duplicate jobs', async () => {
  const submittedAt = Date.parse('2026-07-30T00:00:00Z');
  const page = fakePage({ history: [
    { id: '33333333-3333-3333-3333-333333333333', full_command: 'duplicate prompt --v 8.2', enqueue_time: '2026-07-30T00:00:01Z' },
    { id: '44444444-4444-4444-4444-444444444444', full_command: 'duplicate prompt --v 8.2', enqueue_time: '2026-07-30T00:00:02Z' },
  ] });
  await expect(waitForSubmittedJobsAfter(
    page, 'user', 'duplicate prompt --v 8.2', new Set(), 0.001, submittedAt, 1,
  )).rejects.toThrow(/ambiguous/);
});

it('submit response correlation uses exact returned job ids and rejects ambiguity', () => {
  const first = '88888888-8888-8888-8888-888888888888';
  const second = '99999999-9999-9999-9999-999999999999';
  expect(submittedJobIdsFromCaptures([{ success: [{ job_id: first }], failure: [] }], 1)).toEqual([first]);
  expect(
    () => submittedJobIdsFromCaptures([{ success: [{ job_id: first }, { job_id: second }] }], 1),
  ).toThrow(/ambiguous/);
  expect(
    () => submittedJobIdsFromCaptures([{ success: [], failure: [{ message: 'blocked' }] }], 1),
  ).toThrow(/blocked/);
});

it('storage upload correlation converts exact response paths to visible thumbnail URLs', () => {
  expect(uploadedStorageUrlsFromCaptures([
    {
      shortUrl: 'https://s.mj.run/example',
      bucketPathname: `${JOB}/38cbdeb79dbb812e60a8b65a5a03dc18434dc68905cef8f5179ea2430e63ae2c.png`,
    },
    { bucketPathname: '../unsafe.png' },
  ])).toEqual([
    `https://cdn.midjourney.com/u/${JOB}/38cbdeb79dbb812e60a8b65a5a03dc18434dc68905cef8f5179ea2430e63ae2c_384_N.png`,
  ]);
});

it('derived-job and completion correlation use parent and lifecycle fields', async () => {
  const parent = '55555555-5555-5555-5555-555555555555';
  const child = '66666666-6666-6666-6666-666666666666';
  const submittedAt = Date.parse('2026-07-30T00:00:00Z');
  const page = fakePage({
    history: [{ id: child, parent_id: parent, enqueue_time: '2026-07-30T00:00:01Z' }],
    statuses: [{ id: child, current_status: 'completed' }],
  });
  expect(await waitForDerivedJob(page, 'user', parent, new Set(), 1, submittedAt)).toBe(child);
  expect((await waitForCompletedJob(page, child, 1)).current_status).toBe('completed');
});

it('submission polling propagates authentication failures immediately', async () => {
  let polls = 0;
  const page = {
    async fetchJson() {
      polls += 1;
      throw new Error('HTTP 401 unauthorized');
    },
    async wait() {},
  };
  await expect(waitForSubmittedJobsAfter(
    page, 'user', 'auth failure', new Set(), 5, Date.now(), 1,
  )).rejects.toThrow(/Log into Midjourney/);
  expect(polls).toBe(1);
});

it('job cancellation uses the current web API contract and rejects HTTP failures', async () => {
  globalThis.window = {};
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    expect(options).toMatchObject({ method: 'POST' });
    expect(JSON.parse(options.body)).toEqual({ job_id: JOB });
    return new Response('', { status: 200 });
  }));
  const page = { async evaluate(fn, ...args) { return fn(...args); } };
  await expect(cancelMidjourneyJob(page, JOB)).resolves.toMatchObject({ ok: true, status: 200 });

  globalThis.fetch.mockResolvedValueOnce(new Response('blocked', { status: 409 }));
  await expect(cancelMidjourneyJob(page, JOB)).rejects.toThrow(/HTTP 409 blocked/);
});

it('setting mutation verifies the selected account-wide value after clicking', async () => {
  const settings = {
    model: 'v8.2',
    imageResolution: 'sd',
    personalization: false,
    raw: false,
    speed: 'fast',
    videoResolution: 'hd',
    videoBatchSize: 4,
  };
  const page = {
    evaluate: vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(settings)
      .mockResolvedValueOnce({ ok: true, changed: true })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ ...settings, videoResolution: 'sd' }),
    click: vi.fn(),
    wait: vi.fn(),
  };
  await expect(selectSiteSetting(page, 'Video Resolution', ['SD', 'HD'], 'SD')).resolves.toBe(true);
  expect(page.click).toHaveBeenCalledWith('[data-opencli-setting-target="1"]');
});

it('setting mutation verifies the selected video batch size after clicking', async () => {
  const settings = {
    model: 'v8.2',
    imageResolution: 'sd',
    personalization: false,
    raw: false,
    speed: 'fast',
    videoResolution: 'sd',
    videoBatchSize: 4,
  };
  const page = {
    evaluate: vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(settings)
      .mockResolvedValueOnce({ ok: true, changed: true })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ ...settings, videoBatchSize: 1 }),
    click: vi.fn(),
    wait: vi.fn(),
  };
  await expect(selectSiteSetting(page, 'Video Batch Size', ['1', '2', '4'], '1')).resolves.toBe(true);
});

it('setting mutation fails closed when the click does not change the account-wide value', async () => {
  const settings = {
    model: 'v8.2',
    imageResolution: 'sd',
    personalization: false,
    raw: false,
    speed: 'fast',
    videoResolution: 'hd',
    videoBatchSize: 4,
  };
  const page = {
    evaluate: vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(settings)
      .mockResolvedValueOnce({ ok: true, changed: true })
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(settings),
    click: vi.fn(),
    wait: vi.fn(),
  };
  await expect(selectSiteSetting(page, 'Video Resolution', ['SD', 'HD'], 'SD'))
    .rejects.toThrow(/expected SD, found HD/);
});

it('submission and derived-job polling stop after three consecutive API failures', async () => {
  const failingPage = () => {
    let polls = 0;
    return {
      get polls() { return polls; },
      async fetchJson() {
        polls += 1;
        throw new Error('HTTP 503 unavailable');
      },
      async wait() {},
    };
  };
  const submissionPage = failingPage();
  await expect(waitForSubmittedJobsAfter(
    submissionPage, 'user', 'poll failure', new Set(), 5, Date.now(), 1,
  )).rejects.toThrow(/HTTP 503/);
  expect(submissionPage.polls).toBe(3);

  const derivedPage = failingPage();
  await expect(waitForDerivedJob(
    derivedPage, 'user', JOB, new Set(), 5, Date.now(),
  )).rejects.toThrow(/HTTP 503/);
  expect(derivedPage.polls).toBe(3);
});

function browserPageFor(bytes, mime = 'video/mp4') {
  let evaluateCalls = 0;
  globalThis.window = {};
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes, {
    status: 200,
    headers: { 'content-type': mime },
  })));
  return {
    get evaluateCalls() { return evaluateCalls; },
    async evaluate(fn, ...args) {
      evaluateCalls += 1;
      return fn(...args);
    },
  };
}

function mp4Bytes(size = 260_000) {
  const bytes = new Uint8Array(size);
  bytes.set(Buffer.from('....ftypisom', 'ascii'));
  for (let index = 12; index < bytes.length; index += 1) bytes[index] = index % 251;
  return bytes;
}

it('raw-video downloads cross the browser bridge in bounded chunks', async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencli-midjourney-media-'));
  tempDirs.push(outputDir);
  const bytes = mp4Bytes();
  const page = browserPageFor(bytes);
  const result = await downloadRawVideo(page, JOB, 0, outputDir, true);
  expect(result.cached).toBe(false);
  expect(result.bytes).toBe(bytes.length);
  expect(page.evaluateCalls).toBeGreaterThanOrEqual(5);
  expect(await fs.readFile(result.filePath)).toEqual(Buffer.from(bytes));
  expect(Object.keys(globalThis.window)).toEqual([]);
});

it('a corrupt non-empty cache entry is replaced instead of reported as cached', async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencli-midjourney-cache-'));
  tempDirs.push(outputDir);
  const filePath = path.join(outputDir, `${JOB}_1_raw.mp4`);
  await fs.writeFile(filePath, 'not an mp4');
  const bytes = mp4Bytes(16_000);
  const page = browserPageFor(bytes);
  const result = await downloadRawVideo(page, JOB, 0, outputDir, false);
  expect(result.cached).toBe(false);
  expect(await fs.readFile(filePath)).toEqual(Buffer.from(bytes));
});

it('rendered downloads trust file magic over stale Browser Bridge MIME metadata', async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencli-midjourney-rendered-'));
  tempDirs.push(outputDir);
  const sourcePath = path.join(outputDir, 'browser-download.gif');
  const gif = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(128, 1)]);
  await fs.writeFile(sourcePath, gif);
  const page = {
    async goto() {},
    async wait() {},
    async click() {},
    async evaluate() { return true; },
    async waitForDownload() {
      return {
        downloaded: true,
        state: 'complete',
        filename: sourcePath,
        mime: 'video/mp4',
        finalUrl: 'https://cdn.midjourney.com/video/example.gif',
      };
    },
  };
  const result = await downloadRenderedVideo(page, JOB, 0, 'gif', outputDir, true);
  expect(result.mime).toBe('image/gif');
  expect(result.bytes).toBe(gif.length);
  expect(await fs.readFile(result.filePath)).toEqual(gif);
  await expect(fs.stat(sourcePath)).rejects.toMatchObject({ code: 'ENOENT' });
});
