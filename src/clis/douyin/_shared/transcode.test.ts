import { describe, expect, it, vi } from 'vitest';
import type { IPage } from '../../../types.js';
import { TimeoutError } from '../../../errors.js';
import { pollTranscodeWithFetch } from './transcode.js';
import type { TranscodeResult } from './types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePage(): IPage {
  return {
    goto: vi.fn(),
    evaluate: vi.fn(),
    getCookies: vi.fn(),
    snapshot: vi.fn(),
    click: vi.fn(),
    typeText: vi.fn(),
    pressKey: vi.fn(),
    scrollTo: vi.fn(),
    getFormState: vi.fn(),
    wait: vi.fn(),
    tabs: vi.fn(),
    selectTab: vi.fn(),
    networkRequests: vi.fn(),
    consoleMessages: vi.fn(),
    scroll: vi.fn(),
    autoScroll: vi.fn(),
    installInterceptor: vi.fn(),
    getInterceptedRequests: vi.fn(),
    screenshot: vi.fn(),
  } as unknown as IPage;
}

const COMPLETE_RESULT: TranscodeResult & { encode: number } = {
  encode: 2,
  duration: 30,
  fps: 30,
  height: 1920,
  width: 1080,
  poster_uri: 'tos-cn-i-alisg.volces.com/poster/abc',
  poster_url: 'https://p3-creator.douyinpic.com/poster/abc',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('pollTranscodeWithFetch', () => {
  it('returns TranscodeResult immediately when first response has encode=2', async () => {
    const fetchFn = vi.fn().mockResolvedValue(COMPLETE_RESULT);
    const page = makePage();

    const result = await pollTranscodeWithFetch(fetchFn, page, 'vid_123');

    expect(result).toEqual(COMPLETE_RESULT);
    expect(fetchFn).toHaveBeenCalledOnce();
    const [, method, url] = fetchFn.mock.calls[0] as [IPage, string, string];
    expect(method).toBe('GET');
    expect(url).toContain('video_id=vid_123');
    expect(url).toContain('aid=1128');
  });

  it('polls multiple times until encode=2 is received', async () => {
    const pending = { encode: 1, duration: 0, fps: 0, height: 0, width: 0, poster_uri: '', poster_url: '' };
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(COMPLETE_RESULT);
    const page = makePage();

    // Use a large timeoutMs so it doesn't expire, but override POLL_INTERVAL via
    // a short timeout knowing we'll get 3 calls quickly with mocked promises.
    // Since pollTranscodeWithFetch uses setTimeout for 3s between polls, we need
    // to mock timers to keep tests fast.
    vi.useFakeTimers();

    const resultPromise = pollTranscodeWithFetch(fetchFn, page, 'vid_456', 60_000);

    // Advance timers for each pending poll cycle
    await vi.runAllTimersAsync();

    const result = await resultPromise;
    expect(result).toEqual(COMPLETE_RESULT);
    expect(fetchFn).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  it('throws TimeoutError when encode never becomes 2 within timeoutMs', async () => {
    const pending = { encode: 1, duration: 0, fps: 0, height: 0, width: 0, poster_uri: '', poster_url: '' };
    const fetchFn = vi.fn().mockResolvedValue(pending);
    const page = makePage();

    vi.useFakeTimers();

    const resultPromise = pollTranscodeWithFetch(fetchFn, page, 'vid_789', 5_000);
    // Suppress unhandled-rejection so vitest doesn't flag it
    resultPromise.catch(() => undefined);

    // Advance time past the 5s timeout
    await vi.runAllTimersAsync();

    await expect(resultPromise).rejects.toBeInstanceOf(TimeoutError);

    vi.useRealTimers();
  });

  it('URL encodes video_id in the request URL', async () => {
    const fetchFn = vi.fn().mockResolvedValue(COMPLETE_RESULT);
    const page = makePage();

    await pollTranscodeWithFetch(fetchFn, page, 'vid with spaces');

    const [, , url] = fetchFn.mock.calls[0] as [IPage, string, string];
    expect(url).toContain('video_id=vid%20with%20spaces');
  });
});
