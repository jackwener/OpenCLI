/**
 * Media download helper — shared logic for batch downloading images/videos.
 *
 * Used by: xiaohongshu/download, twitter/download, bilibili/download,
 * and future media adapters.
 *
 * Flow: MediaItem[] → DownloadProgressTracker → httpDownload/ytdlpDownload → results
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  httpDownload,
  ytdlpDownload,
  checkYtdlp,
  getTempDir,
  exportCookiesToNetscape,
} from './index.js';
import type { BrowserCookie } from '../types.js';
import { DownloadProgressTracker, formatBytes } from './progress.js';

// ============================================================
// Types
// ============================================================

export interface MediaItem {
  type: 'image' | 'video' | 'video-tweet' | 'video-ytdlp';
  url: string;
  /** Optional custom filename (without directory) */
  filename?: string;
}

export interface MediaDownloadOptions {
  output: string;
  /** Subdirectory inside output */
  subdir?: string;
  /** Cookie string for HTTP downloads */
  cookies?: string;
  /** Raw browser cookies — auto-exported to Netscape for yt-dlp, auto-cleaned up */
  browserCookies?: BrowserCookie[];
  /** Timeout in ms (default: 30000 for images, 60000 for videos) */
  timeout?: number;
  /** File name prefix (default: 'download') */
  filenamePrefix?: string;
  /** Extra yt-dlp args */
  ytdlpExtraArgs?: string[];
  /** Whether to show progress (default: true) */
  verbose?: boolean;
}

export interface MediaDownloadResult {
  index: number;
  type: string;
  status: string;
  size: string;
}

// ============================================================
// Main API
// ============================================================

/**
 * Batch download media files with progress tracking.
 *
 * Handles:
 * - DownloadProgressTracker for terminal UX
 * - Automatic httpDownload vs ytdlpDownload routing via MediaItem.type
 * - Cookie export to Netscape format for yt-dlp (auto-cleanup)
 * - Directory creation
 * - Error handling with per-file results
 */
export async function downloadMedia(
  items: MediaItem[],
  options: MediaDownloadOptions,
): Promise<MediaDownloadResult[]> {
  const {
    output,
    subdir,
    cookies,
    browserCookies,
    timeout,
    filenamePrefix = 'download',
    ytdlpExtraArgs = [],
    verbose = true,
  } = options;

  if (!items || items.length === 0) {
    return [{ index: 0, type: '-', status: 'failed', size: 'No media found' }];
  }

  // Create output directory
  const outputDir = subdir ? path.join(output, subdir) : output;
  fs.mkdirSync(outputDir, { recursive: true });

  // Pre-check yt-dlp availability (once, not per-item)
  const hasYtdlp = checkYtdlp();

  // Auto-export browser cookies to Netscape format for yt-dlp
  let cookiesFile: string | undefined;
  const needsYtdlp = items.some(m => m.type === 'video-tweet' || m.type === 'video-ytdlp');
  if (needsYtdlp && browserCookies && browserCookies.length > 0) {
    const tempDir = getTempDir();
    fs.mkdirSync(tempDir, { recursive: true });
    cookiesFile = path.join(tempDir, `media_cookies_${Date.now()}.txt`);
    exportCookiesToNetscape(browserCookies, cookiesFile);
  }

  const tracker = new DownloadProgressTracker(items.length, verbose);
  const results: MediaDownloadResult[] = [];

  try {
    for (let i = 0; i < items.length; i++) {
      const media = items[i];
      const isVideo = media.type !== 'image';
      const ext = isVideo ? 'mp4' : 'jpg';
      const filename = media.filename || `${filenamePrefix}_${i + 1}.${ext}`;
      const destPath = path.join(outputDir, filename);

      const progressBar = tracker.onFileStart(filename, i);

      try {
        let result: { success: boolean; size: number; error?: string };
        const useYtdlp = (media.type === 'video-tweet' || media.type === 'video-ytdlp') && hasYtdlp;

        if (useYtdlp) {
          result = await ytdlpDownload(media.url, destPath, {
            cookiesFile,
            extraArgs: ytdlpExtraArgs,
            onProgress: (percent) => {
              if (progressBar) progressBar.update(percent, 100);
            },
          });
        } else {
          // Direct HTTP download for images and direct video URLs
          const dlTimeout = timeout || (isVideo ? 60000 : 30000);
          result = await httpDownload(media.url, destPath, {
            cookies,
            timeout: dlTimeout,
            onProgress: (received, total) => {
              if (progressBar) progressBar.update(received, total);
            },
          });
        }

        if (progressBar) {
          progressBar.complete(result.success, result.success ? formatBytes(result.size) : undefined);
        }
        tracker.onFileComplete(result.success);

        results.push({
          index: i + 1,
          type: media.type === 'video-tweet' || media.type === 'video-ytdlp' ? 'video' : media.type,
          status: result.success ? 'success' : 'failed',
          size: result.success ? formatBytes(result.size) : (result.error || 'unknown error'),
        });
      } catch (err: any) {
        if (progressBar) progressBar.fail(err.message);
        tracker.onFileComplete(false);

        results.push({
          index: i + 1,
          type: media.type,
          status: 'failed',
          size: err.message,
        });
      }
    }
  } finally {
    tracker.finish();

    // Auto-cleanup exported cookies file
    if (cookiesFile && fs.existsSync(cookiesFile)) {
      fs.unlinkSync(cookiesFile);
    }
  }

  return results;
}
