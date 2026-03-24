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
  type HttpDownloadResult,
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

/** Let executor retry when browser cookie access fails due to a transient disconnect. */
function isTransientBrowserError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Extension disconnected')
    || message.includes('attach failed')
    || message.includes('no longer exists')
    || message.includes('CDP connection')
    || message.includes('Daemon command failed');
}

const HTML_ROUTE_EXTENSIONS = new Set(['.html', '.htm', '.php', '.asp', '.aspx', '.jsp', '.jspx', '.cfm', '.cgi']);
const HTML_OUTPUT_EXTENSIONS = new Set(['.html', '.htm']);

/** Decide whether this download target is explicitly or implicitly expected to be an HTML page. */
function expectsHtmlOutput(
  originalUrl: string,
  destPath: string,
  hasExplicitFilename: boolean,
): boolean {
  if (hasExplicitFilename) {
    return HTML_OUTPUT_EXTENSIONS.has(path.extname(destPath).toLowerCase());
  }

  const urlExt = path.extname(new URL(originalUrl).pathname).toLowerCase();
  if (HTML_ROUTE_EXTENSIONS.has(urlExt)) {
    return true;
  }

  if (!urlExt && !hasExplicitFilename) {
    return true;
  }

  return false;
}

/** Some protected downloads redirect anonymous requests to an HTML login page instead of the file. */
function isSuspiciousAnonymousSuccess(
  originalUrl: string,
  destPath: string,
  hasExplicitFilename: boolean,
  result: HttpDownloadResult,
): boolean {
  const contentType = result.contentType?.toLowerCase() ?? '';
  const htmlExpected = expectsHtmlOutput(originalUrl, destPath, hasExplicitFilename);
  return contentType.startsWith('text/html')
    && (!htmlExpected || (result.finalUrl !== undefined && result.finalUrl !== originalUrl));
}

/** Decide whether an anonymous fallback result is weak enough that browser cookie retry should win. */
function shouldRetryAnonymousFallback(
  originalUrl: string,
  destPath: string,
  hasExplicitFilename: boolean,
  result: HttpDownloadResult,
): boolean {
  if (result.success) {
    return isSuspiciousAnonymousSuccess(originalUrl, destPath, hasExplicitFilename, result);
  }

  return result.statusCode === 401 || result.statusCode === 403 || result.statusCode === 404;
}


/**
 * Extract cookies from browser page.
 */
async function extractBrowserCookies(page: IPage, domain?: string): Promise<string> {
  try {
    const cookies = await page.getCookies(domain ? { domain } : {});
    return formatCookieHeader(cookies);
  } catch (error) {
    if (isTransientBrowserError(error)) {
      throw error;
    }
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
  } catch (error) {
    if (isTransientBrowserError(error)) {
      throw error;
    }
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
  let cookiesFile: string | undefined;

  if (page) {
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
      } catch (error) {
        if (isTransientBrowserError(error)) {
          throw error;
        }
        // Ignore non-transient cookie extraction errors
      }
    }
  }

  let retryableStepError: unknown;

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

    let result: HttpDownloadResult;

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
        let cookieError: unknown;
        if (page) {
          try {
            cookies = await extractBrowserCookies(page);
          } catch (error) {
            if (isTransientBrowserError(error)) {
              cookieError = error;
            } else {
              throw error;
            }
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

        // Public files should still download anonymously when cookie access is flaky.
        if (cookieError && shouldRetryAnonymousFallback(url, destPath, Boolean(filenameTemplate), result)) {
          if (result.success && fs.existsSync(destPath)) {
            fs.unlinkSync(destPath);
          }
          retryableStepError ??= cookieError;
        }

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

  if (retryableStepError) {
    throw retryableStepError;
  }

  return results;
}
