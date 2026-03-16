/**
 * Download utilities: HTTP downloads, yt-dlp wrapper, format conversion.
 */

import { spawn, execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as https from 'node:https';
import * as http from 'node:http';
import * as os from 'node:os';
import { URL } from 'node:url';
import type { ProgressBar } from './progress.js';

export interface DownloadOptions {
  cookies?: string;
  headers?: Record<string, string>;
  timeout?: number;
  onProgress?: (received: number, total: number) => void;
}

export interface YtdlpOptions {
  cookies?: string;
  cookiesFile?: string;
  format?: string;
  extraArgs?: string[];
  onProgress?: (percent: number) => void;
}

/**
 * Check if yt-dlp is available in PATH.
 */
export function checkYtdlp(): boolean {
  try {
    execSync('yt-dlp --version', { encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if ffmpeg is available in PATH.
 */
export function checkFfmpeg(): boolean {
  try {
    execSync('ffmpeg -version', { encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect content type from URL and optional headers.
 */
export function detectContentType(url: string, contentType?: string): 'image' | 'video' | 'document' | 'binary' {
  // Check content-type header first
  if (contentType) {
    if (contentType.startsWith('image/')) return 'image';
    if (contentType.startsWith('video/')) return 'video';
    if (contentType.startsWith('text/') || contentType.includes('json') || contentType.includes('xml')) return 'document';
  }

  // Detect from URL
  const urlLower = url.toLowerCase();
  const ext = path.extname(new URL(url).pathname).toLowerCase();

  // Image extensions
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif'].includes(ext)) {
    return 'image';
  }

  // Video extensions
  if (['.mp4', '.webm', '.avi', '.mov', '.mkv', '.flv', '.m3u8', '.ts'].includes(ext)) {
    return 'video';
  }

  // Video platforms (need yt-dlp)
  if (urlLower.includes('youtube.com') || urlLower.includes('youtu.be') ||
      urlLower.includes('bilibili.com') || urlLower.includes('twitter.com') ||
      urlLower.includes('x.com') || urlLower.includes('tiktok.com') ||
      urlLower.includes('vimeo.com') || urlLower.includes('twitch.tv')) {
    return 'video';
  }

  // Document extensions
  if (['.html', '.htm', '.json', '.xml', '.txt', '.md', '.markdown'].includes(ext)) {
    return 'document';
  }

  return 'binary';
}

/**
 * Check if URL requires yt-dlp for download.
 */
export function requiresYtdlp(url: string): boolean {
  const urlLower = url.toLowerCase();
  return (
    urlLower.includes('youtube.com') ||
    urlLower.includes('youtu.be') ||
    urlLower.includes('bilibili.com/video') ||
    urlLower.includes('twitter.com') ||
    urlLower.includes('x.com') ||
    urlLower.includes('tiktok.com') ||
    urlLower.includes('vimeo.com') ||
    urlLower.includes('twitch.tv')
  );
}

/**
 * HTTP download with progress callback.
 */
export async function httpDownload(
  url: string,
  destPath: string,
  options: DownloadOptions = {},
): Promise<{ success: boolean; size: number; error?: string }> {
  const { cookies, headers = {}, timeout = 30000, onProgress } = options;

  return new Promise((resolve) => {
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const requestHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ...headers,
    };

    if (cookies) {
      requestHeaders['Cookie'] = cookies;
    }

    // Ensure directory exists
    const dir = path.dirname(destPath);
    fs.mkdirSync(dir, { recursive: true });

    const tempPath = `${destPath}.tmp`;
    const file = fs.createWriteStream(tempPath);

    const request = protocol.get(url, { headers: requestHeaders, timeout }, (response) => {
      // Handle redirects
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlinkSync(tempPath);
        httpDownload(response.headers.location, destPath, options).then(resolve);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(tempPath);
        resolve({ success: false, size: 0, error: `HTTP ${response.statusCode}` });
        return;
      }

      const totalSize = parseInt(response.headers['content-length'] || '0', 10);
      let received = 0;

      response.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (onProgress) onProgress(received, totalSize);
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        // Rename temp file to final destination
        fs.renameSync(tempPath, destPath);
        resolve({ success: true, size: received });
      });
    });

    request.on('error', (err) => {
      file.close();
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      resolve({ success: false, size: 0, error: err.message });
    });

    request.on('timeout', () => {
      request.destroy();
      file.close();
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      resolve({ success: false, size: 0, error: 'Timeout' });
    });
  });
}

/**
 * Export cookies to Netscape format for yt-dlp.
 */
export function exportCookiesToNetscape(
  cookies: Array<{ name: string; value: string; domain: string; path?: string; secure?: boolean; httpOnly?: boolean }>,
  filePath: string,
): void {
  const lines = [
    '# Netscape HTTP Cookie File',
    '# https://curl.se/docs/http-cookies.html',
    '# This is a generated file!  Do not edit.',
    '',
  ];

  for (const cookie of cookies) {
    const domain = cookie.domain.startsWith('.') ? cookie.domain : `.${cookie.domain}`;
    const includeSubdomains = 'TRUE';
    const cookiePath = cookie.path || '/';
    const secure = cookie.secure ? 'TRUE' : 'FALSE';
    const expiry = Math.floor(Date.now() / 1000) + 86400 * 365; // 1 year from now
    lines.push(`${domain}\t${includeSubdomains}\t${cookiePath}\t${secure}\t${expiry}\t${cookie.name}\t${cookie.value}`);
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join('\n'));
}

/**
 * Download video using yt-dlp.
 */
export async function ytdlpDownload(
  url: string,
  destPath: string,
  options: YtdlpOptions = {},
): Promise<{ success: boolean; size: number; error?: string }> {
  const { cookiesFile, format = 'best', extraArgs = [], onProgress } = options;

  if (!checkYtdlp()) {
    return { success: false, size: 0, error: 'yt-dlp not installed. Install with: pip install yt-dlp' };
  }

  return new Promise((resolve) => {
    const dir = path.dirname(destPath);
    fs.mkdirSync(dir, { recursive: true });

    // Build yt-dlp arguments
    const args = [
      url,
      '-o', destPath,
      '-f', format,
      '--no-playlist',
      '--progress',
    ];

    if (cookiesFile && fs.existsSync(cookiesFile)) {
      args.push('--cookies', cookiesFile);
    } else {
      // Try to use browser cookies
      args.push('--cookies-from-browser', 'chrome');
    }

    args.push(...extraArgs);

    const proc = spawn('yt-dlp', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let lastPercent = 0;
    let errorOutput = '';

    proc.stderr.on('data', (data: Buffer) => {
      const line = data.toString();
      errorOutput += line;

      // Parse progress from yt-dlp output
      const match = line.match(/(\d+\.?\d*)%/);
      if (match && onProgress) {
        const percent = parseFloat(match[1]);
        if (percent > lastPercent) {
          lastPercent = percent;
          onProgress(percent);
        }
      }
    });

    proc.stdout.on('data', (data: Buffer) => {
      const line = data.toString();
      const match = line.match(/(\d+\.?\d*)%/);
      if (match && onProgress) {
        const percent = parseFloat(match[1]);
        if (percent > lastPercent) {
          lastPercent = percent;
          onProgress(percent);
        }
      }
    });

    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(destPath)) {
        const stats = fs.statSync(destPath);
        resolve({ success: true, size: stats.size });
      } else {
        // Check for common yt-dlp output patterns
        const patterns = fs.readdirSync(dir).filter(f => f.startsWith(path.basename(destPath, path.extname(destPath))));
        if (patterns.length > 0) {
          const actualFile = path.join(dir, patterns[0]);
          const stats = fs.statSync(actualFile);
          resolve({ success: true, size: stats.size });
        } else {
          resolve({ success: false, size: 0, error: errorOutput.slice(0, 200) || `Exit code ${code}` });
        }
      }
    });

    proc.on('error', (err) => {
      resolve({ success: false, size: 0, error: err.message });
    });
  });
}

/**
 * Save document content to file.
 */
export async function saveDocument(
  content: string,
  destPath: string,
  format: 'json' | 'markdown' | 'html' | 'text' = 'markdown',
  metadata?: Record<string, any>,
): Promise<{ success: boolean; size: number; error?: string }> {
  try {
    const dir = path.dirname(destPath);
    fs.mkdirSync(dir, { recursive: true });

    let output: string;

    if (format === 'json') {
      output = JSON.stringify({ ...metadata, content }, null, 2);
    } else if (format === 'markdown') {
      // Add frontmatter if metadata exists
      const frontmatter = metadata ? `---\n${Object.entries(metadata).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n\n` : '';
      output = frontmatter + content;
    } else {
      output = content;
    }

    fs.writeFileSync(destPath, output, 'utf-8');
    return { success: true, size: Buffer.byteLength(output, 'utf-8') };
  } catch (err: any) {
    return { success: false, size: 0, error: err.message };
  }
}

/**
 * Sanitize filename by removing invalid characters.
 */
export function sanitizeFilename(name: string, maxLength: number = 200): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') // Remove invalid chars
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(/_+/g, '_') // Collapse multiple underscores
    .replace(/^_|_$/g, '') // Trim underscores
    .slice(0, maxLength);
}

/**
 * Generate filename from URL if not provided.
 */
export function generateFilename(url: string, index: number, extension?: string): string {
  try {
    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname;
    const basename = path.basename(pathname);

    if (basename && basename !== '/' && basename.includes('.')) {
      return sanitizeFilename(basename);
    }

    // Generate from hostname and index
    const ext = extension || detectExtension(url);
    const hostname = parsedUrl.hostname.replace(/^www\./, '');
    return sanitizeFilename(`${hostname}_${index + 1}${ext}`);
  } catch {
    const ext = extension || '.bin';
    return `download_${index + 1}${ext}`;
  }
}

/**
 * Detect file extension from URL.
 */
function detectExtension(url: string): string {
  const type = detectContentType(url);
  switch (type) {
    case 'image': return '.jpg';
    case 'video': return '.mp4';
    case 'document': return '.md';
    default: return '.bin';
  }
}

/**
 * Get temp directory for cookie files.
 */
export function getTempDir(): string {
  return path.join(os.tmpdir(), 'opencli-download');
}
