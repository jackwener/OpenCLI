/**
 * Pipeline step: download — file download with concurrency and progress.
 *
 * Supports:
 * - Direct HTTP downloads (images, documents)
 * - yt-dlp integration for video platforms
 * - Browser cookie forwarding for authenticated downloads
 * - Filename templating and deduplication
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { IPage } from '../../types.js';
import { render } from '../template.js';
import {
  httpDownload,
  ytdlpDownload,
  saveDocument,
  detectContentType,
  requiresYtdlp,
  sanitizeFilename,
  generateFilename,
  exportCookiesToNetscape,
  getTempDir,
} from '../../download/index.js';
import { DownloadProgressTracker, formatBytes } from '../../download/progress.js';

export interface DownloadResult {
  status: 'success' | 'skipped' | 'failed';
  path?: string;
  size?: number;
  error?: string;
  duration?: number;
}

/**
 * Simple async concurrency limiter for downloads.
 */
async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Extract cookies from browser page.
 */
async function extractBrowserCookies(page: IPage, domain?: string): Promise<string> {
  try {
    // Use browser evaluate to get document.cookie
    const cookieString = await page.evaluate(`(() => document.cookie)()`);
    return typeof cookieString === 'string' ? cookieString : '';
  } catch {
    return '';
  }
}

/**
 * Extract cookies as array for yt-dlp Netscape format.
 */
async function extractCookiesArray(
  page: IPage,
  domain: string,
): Promise<Array<{ name: string; value: string; domain: string; path: string; secure: boolean; httpOnly: boolean }>> {
  try {
    const cookieString = await extractBrowserCookies(page);
    if (!cookieString) return [];

    return cookieString.split(';').map((c) => {
      const [name, ...rest] = c.trim().split('=');
      return {
        name: name || '',
        value: rest.join('=') || '',
        domain,
        path: '/',
        secure: true,
        httpOnly: false,
      };
    }).filter((c) => c.name);
  } catch {
    return [];
  }
}

/**
 * Download step handler for YAML pipelines.
 *
 * Usage in YAML:
 * ```yaml
 * pipeline:
 *   - download:
 *       url: ${{ item.imageUrl }}
 *       dir: ./downloads
 *       filename: ${{ item.title }}.jpg
 *       concurrency: 5
 *       skip_existing: true
 *       use_ytdlp: false
 *       type: auto
 * ```
 */
export async function stepDownload(
  page: IPage | null,
  params: any,
  data: any,
  args: Record<string, any>,
): Promise<any> {
  // Parse parameters with defaults
  const urlTemplate = typeof params === 'string' ? params : (params?.url ?? '');
  const dirTemplate = params?.dir ?? './downloads';
  const filenameTemplate = params?.filename ?? '';
  const concurrency = typeof params?.concurrency === 'number' ? params.concurrency : 3;
  const skipExisting = params?.skip_existing !== false;
  const timeout = typeof params?.timeout === 'number' ? params.timeout * 1000 : 30000;
  const useYtdlp = params?.use_ytdlp ?? false;
  const ytdlpArgs = Array.isArray(params?.ytdlp_args) ? params.ytdlp_args : [];
  const contentType = params?.type ?? 'auto';
  const showProgress = params?.progress !== false;
  const contentTemplate = params?.content;
  const metadataTemplate = params?.metadata;

  // Resolve output directory
  const dir = String(render(dirTemplate, { args, data }));
  fs.mkdirSync(dir, { recursive: true });

  // Normalize data to array
  const items: any[] = Array.isArray(data) ? data : data ? [data] : [];
  if (items.length === 0) {
    return [];
  }

  // Create progress tracker
  const tracker = new DownloadProgressTracker(items.length, showProgress);

  // Extract cookies if browser is available
  let cookies = '';
  let cookiesFile: string | undefined;

  if (page) {
    cookies = await extractBrowserCookies(page);

    // For yt-dlp, we need to export cookies to Netscape format
    if (useYtdlp || items.some((item, index) => {
      const url = String(render(urlTemplate, { args, data, item, index }));
      return requiresYtdlp(url);
    })) {
      try {
        // Try to get domain from first URL
        const firstUrl = String(render(urlTemplate, { args, data, item: items[0], index: 0 }));
        const domain = new URL(firstUrl).hostname;
        const cookiesArray = await extractCookiesArray(page, domain);

        if (cookiesArray.length > 0) {
          const tempDir = getTempDir();
          fs.mkdirSync(tempDir, { recursive: true });
          cookiesFile = path.join(tempDir, `cookies_${Date.now()}.txt`);
          exportCookiesToNetscape(cookiesArray, cookiesFile);
        }
      } catch {
        // Ignore cookie extraction errors
      }
    }
  }

  // Process downloads with concurrency
  const results = await mapConcurrent(items, concurrency, async (item, index): Promise<any> => {
    const startTime = Date.now();

    // Render URL
    const url = String(render(urlTemplate, { args, data, item, index }));
    if (!url) {
      tracker.onFileComplete(false);
      return {
        ...item,
        _download: { status: 'failed', error: 'Empty URL' } as DownloadResult,
      };
    }

    // Render filename
    let filename: string;
    if (filenameTemplate) {
      filename = String(render(filenameTemplate, { args, data, item, index }));
    } else {
      filename = generateFilename(url, index);
    }
    filename = sanitizeFilename(filename);

    const destPath = path.join(dir, filename);

    // Check if file exists and skip_existing is true
    if (skipExisting && fs.existsSync(destPath)) {
      tracker.onFileComplete(true, true);
      return {
        ...item,
        _download: {
          status: 'skipped',
          path: destPath,
          size: fs.statSync(destPath).size,
        } as DownloadResult,
      };
    }

    // Create progress bar for this file
    const progressBar = tracker.onFileStart(filename, index);

    // Determine download method
    const detectedType = contentType === 'auto' ? detectContentType(url) : contentType;
    const shouldUseYtdlp = useYtdlp || (detectedType === 'video' && requiresYtdlp(url));

    let result: { success: boolean; size: number; error?: string };

    try {
      if (detectedType === 'document' && contentTemplate) {
        // Save extracted content as document
        const content = String(render(contentTemplate, { args, data, item, index }));
        const metadata = metadataTemplate
          ? Object.fromEntries(
              Object.entries(metadataTemplate).map(([k, v]) => [k, render(v, { args, data, item, index })]),
            )
          : undefined;

        const ext = path.extname(filename).toLowerCase();
        const format = ext === '.json' ? 'json' : ext === '.html' ? 'html' : 'markdown';
        result = await saveDocument(content, destPath, format, metadata);

        if (progressBar) {
          progressBar.complete(result.success, result.success ? formatBytes(result.size) : undefined);
        }
      } else if (shouldUseYtdlp) {
        // Use yt-dlp for video downloads
        result = await ytdlpDownload(url, destPath, {
          cookiesFile,
          extraArgs: ytdlpArgs,
          onProgress: (percent) => {
            if (progressBar) {
              progressBar.update(percent, 100);
            }
          },
        });

        if (progressBar) {
          progressBar.complete(result.success, result.success ? formatBytes(result.size) : undefined);
        }
      } else {
        // Direct HTTP download
        result = await httpDownload(url, destPath, {
          cookies,
          timeout,
          onProgress: (received, total) => {
            if (progressBar) {
              progressBar.update(received, total);
            }
          },
        });

        if (progressBar) {
          progressBar.complete(result.success, result.success ? formatBytes(result.size) : undefined);
        }
      }
    } catch (err: any) {
      result = { success: false, size: 0, error: err.message };
      if (progressBar) {
        progressBar.fail(err.message);
      }
    }

    tracker.onFileComplete(result.success);

    const duration = Date.now() - startTime;

    return {
      ...item,
      _download: {
        status: result.success ? 'success' : 'failed',
        path: result.success ? destPath : undefined,
        size: result.size,
        error: result.error,
        duration,
      } as DownloadResult,
    };
  });

  // Cleanup temp cookie file
  if (cookiesFile && fs.existsSync(cookiesFile)) {
    try {
      fs.unlinkSync(cookiesFile);
    } catch {
      // Ignore cleanup errors
    }
  }

  // Show summary
  tracker.finish();

  return results;
}
