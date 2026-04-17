/**
 * Transcode poller for Douyin video processing.
 *
 * After a video is uploaded via TOS and the "confirm upload" API is called,
 * Douyin transcodes the video asynchronously. This module polls the transcode
 * status endpoint until encode=2 (complete) or a timeout is reached.
 */
import { TimeoutError } from '@jackwener/opencli/errors';
import { browserFetch } from './browser-fetch.js';
const POLL_INTERVAL_MS = 3_000;
const DEFAULT_TIMEOUT_MS = 300_000;
const TRANSCODE_URL_BASE = 'https://creator.douyin.com/web/api/media/video/transend/';
/**
 * Lower-level poll function that accepts an injected fetch function.
 * Exported for testability.
 */
export async function pollTranscodeWithFetch(fetchFn, page, videoId, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const url = `${TRANSCODE_URL_BASE}?video_id=${encodeURIComponent(videoId)}&aid=1128`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const result = (await fetchFn(page, 'GET', url));
        if (result.encode === 2) {
            return result;
        }
        // Wait before next poll, but don't exceed the deadline
        const remaining = deadline - Date.now();
        if (remaining <= 0)
            break;
        await new Promise(resolve => setTimeout(resolve, Math.min(POLL_INTERVAL_MS, remaining)));
    }
    throw new TimeoutError(`Douyin transcode for video ${videoId}`, Math.round(timeoutMs / 1000));
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
export async function pollTranscode(page, videoId, timeoutMs) {
    return pollTranscodeWithFetch(browserFetch, page, videoId, timeoutMs);
}
