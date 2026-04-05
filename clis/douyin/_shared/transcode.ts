/**
 * Transcode poller for Douyin video processing.
 *
 * After a video is uploaded via TOS and the "confirm upload" API is called,
 * Douyin transcodes the video asynchronously. This module polls the transcode
 * status endpoint until encode=2 (complete) or a timeout is reached.
 */

import type { IPage } from '@jackwener/opencli/types';
import { TimeoutError } from '@jackwener/opencli/errors';
import { browserFetch } from './browser-fetch.js';
import type { TranscodeResult } from './types.js';

const POLL_INTERVAL_MS = 3_000;
const DEFAULT_TIMEOUT_MS = 300_000;

const TRANSCODE_URL_BASE =
  'https://creator.douyin.com/web/api/media/video/transend/';

type BrowserFetchFn = (
  page: IPage,
  method: 'GET' | 'POST',
  url: string,
) => Promise<unknown>;

/**
 * Lower-level poll function that accepts an injected fetch function.
 * Exported for testability.
 */
export async function pollTranscodeWithFetch(
  fetchFn: BrowserFetchFn,
  page: IPage,
  videoId: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<TranscodeResult> {
  const url = `${TRANSCODE_URL_BASE}?video_id=${encodeURIComponent(videoId)}&aid=1128`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = (await fetchFn(page, 'GET', url)) as {
      encode: number;
    } & TranscodeResult;

    if (result.encode === 2) {
      return result;
    }

    // Wait before next poll, but don't exceed the deadline
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise<void>(resolve =>
      setTimeout(resolve, Math.min(POLL_INTERVAL_MS, remaining)),
    );
  }

  throw new TimeoutError(
    `Douyin transcode for video ${videoId}`,
    Math.round(timeoutMs / 1000),
  );
}

/**
 * Poll Douyin's transcode status endpoint until the video is fully transcoded
 * (encode=2) or the timeout expires.
 *
 * @param page - Browser page for making credentialed API calls
 * @param videoId - The video_id returned from the confirm upload step
 * @param timeoutMs - Maximum wait time in ms (default: 300 000 = 5 minutes)
 * @returns TranscodeResult including duration, fps, dimensions, and poster info
 * @throws TimeoutError if transcode does not complete within timeoutMs
 */
export async function pollTranscode(
  page: IPage,
  videoId: string,
  timeoutMs?: number,
): Promise<TranscodeResult> {
  return pollTranscodeWithFetch(browserFetch, page, videoId, timeoutMs);
}
