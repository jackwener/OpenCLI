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
import { getErrorMessage } from '../../errors.js';
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
  formatCookieHeader,
} from '../../download/index.js';
import { DownloadProgressTracker, formatBytes } from '../../download/progress.js';
import { mapConcurrent } from '../../utils.js';

export interface DownloadResult {
  status: 'success' | 'skipped' | 'failed';
  path?: string;
  size?: number;
  error?: string;
  duration?: number;
}



/**
 * Extract cookies from browser page.
 */
async function extractBrowserCookies(page: IPage, domain: string): Promise<string> {
  try {
    const cookies = await page.getCookies({ domain });
    return formatCookieHeader(cookies);
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
    const cookies = await page.getCookies({ domain });
    return cookies
      .filter((cookie) => cookie.name)
      .map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path ?? '/',
        secure: cookie.secure ?? false,
        httpOnly: cookie.httpOnly ?? false,
      }));
  } catch {
    return [];
  }
}

function dedupeCookies(
  cookies: Array<{ name: string; value: string; domain: string; path: string; secure: boolean; httpOnly: boolean }>,
): Array<{ name: string; value: string; domain: string; path: string; secure: boolean; httpOnly: boolean }> {
  const deduped = new Map<string, { name: string; value: string; domain: string; path: string; secure: boolean; httpOnly: boolean }>();
  for (const cookie of cookies) {
    deduped.set(`${cookie.domain}\t${cookie.path}\t${cookie.name}`, cookie);
  }
  return [...deduped.values()];
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
interface DownloadParams {
  url?: string;
  dir?: string;
  filename?: string;
  concurrency?: number;
  skip_existing?: boolean;
  timeout?: number;
  use_ytdlp?: boolean;
  ytdlp_args?: unknown;
  type?: string;
  progress?: boolean;
  content?: string;
  metadata?: Record<string, unknown>;
}

export async function stepDownload(
  page: IPage | null,
  params: unknown,
  data: unknown,
  args: Record<string, unknown>,
): Promise<unknown> {
  // Parse parameters with defaults
  const p: DownloadParams =
    typeof params === 'object' && params !== null ? (params as DownloadParams) : {};
  const urlTemplate = typeof params === 'string' ? params : (p.url ?? '');
  const dirTemplate = p.dir ?? './downloads';
  const filenameTemplate = p.filename ?? '';
  const concurrency = typeof p.concurrency === 'number' ? p.concurrency : 3;
  const skipExisting = p.skip_existing !== false;
  const timeout = typeof p.timeout === 'number' ? p.timeout * 1000 : 30000;
  const useYtdlp = p.use_ytdlp ?? false;
  const ytdlpArgs: string[] = Array.isArray(p.ytdlp_args)
    ? p.ytdlp_args.map((v) => String(v))
    : [];
  const contentType = p.type ?? 'auto';
  const showProgress = p.progress !== false;
  const contentTemplate = p.content;
  const metadataTemplate = p.metadata;

  // Resolve output directory
  const dir = String(render(dirTemplate, { args, data }));
  fs.mkdirSync(dir, { recursive: true });

  // Normalize data to array. Items are row records (string-keyed) produced by
  // upstream steps; we treat them as Record<string, unknown> and narrow per-use.
  const items: Array<Record<string, unknown>> =
    Array.isArray(data) ? (data as Array<Record<string, unknown>>)
    : data ? [data as Record<string, unknown>]
    : [];
  if (items.length === 0) {
    return [];
  }

  // Create progress tracker
  const tracker = new DownloadProgressTracker(items.length, showProgress);

  // Cache cookie lookups per domain so mixed-domain batches stay isolated without repeated browser calls.
  const cookieHeaderCache = new Map<string, Promise<string>>();
  let cookiesFile: string | undefined;

  if (page) {
    // For yt-dlp, we need to export cookies to Netscape format
    if (useYtdlp || items.some((item, index) => {
      const url = String(render(urlTemplate, { args, data, item, index }));
      return requiresYtdlp(url);
    })) {
      try {
        const ytdlpDomains = [...new Set(items.flatMap((item, index) => {
          const url = String(render(urlTemplate, { args, data, item, index }));
          if (!useYtdlp && !requiresYtdlp(url)) return [];
          try {
            return [new URL(url).hostname];
          } catch {
            return [];
          }
        }))];
        const cookiesArray = dedupeCookies(
          (await Promise.all(ytdlpDomains.map((domain) => extractCookiesArray(page, domain)))).flat(),
        );

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
  type DownloadedItem = Record<string, unknown> & { _download: DownloadResult };
  const results = await mapConcurrent(items, concurrency, async (item, index): Promise<DownloadedItem> => {
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
        let cookies = '';
        if (page) {
          try {
            const targetDomain = new URL(url).hostname;
            let cookiePromise = cookieHeaderCache.get(targetDomain);
            if (!cookiePromise) {
              cookiePromise = extractBrowserCookies(page, targetDomain);
              cookieHeaderCache.set(targetDomain, cookiePromise);
            }
            cookies = await cookiePromise;
          } catch {
            cookies = '';
          }
        }

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
    } catch (err) {
      const msg = getErrorMessage(err);
      result = { success: false, size: 0, error: msg };
      if (progressBar) {
        progressBar.fail(msg);
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
