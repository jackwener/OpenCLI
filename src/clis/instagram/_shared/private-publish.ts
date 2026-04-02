import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

import { CommandExecutionError } from '../../../errors.js';
import type { BrowserCookie, IPage } from '../../../types.js';
import type { InstagramProtocolCaptureEntry } from './protocol-capture.js';
import { instagramPrivateApiFetch } from './protocol-capture.js';
import {
  buildReadInstagramRuntimeInfoJs,
  extractInstagramRuntimeInfo,
  type InstagramRuntimeInfo,
} from './runtime-info.js';
export {
  buildReadInstagramRuntimeInfoJs,
  extractInstagramRuntimeInfo,
  type InstagramRuntimeInfo,
  resolveInstagramRuntimeInfo,
} from './runtime-info.js';

export interface InstagramPrivateApiContext {
  asbdId: string;
  csrfToken: string;
  igAppId: string;
  igWwwClaim: string;
  instagramAjax: string;
  webSessionId: string;
}

export interface InstagramImageAsset {
  filePath: string;
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  byteLength: number;
  bytes: Buffer;
}

export interface PreparedInstagramImageAsset extends InstagramImageAsset {
  cleanupPath?: string;
}

type PrivateApiFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
};

type PrivateApiFetchLike = (url: string | URL, init?: PrivateApiFetchInit) => Promise<Response>;

const INSTAGRAM_MIN_FEED_ASPECT_RATIO = 4 / 5;
const INSTAGRAM_MAX_FEED_ASPECT_RATIO = 1.91;
const INSTAGRAM_PRIVATE_PAD_COLOR = 'FFFFFF';
const INSTAGRAM_HOME_URL = 'https://www.instagram.com/';
const INSTAGRAM_PRIVATE_CAPTURE_PATTERN = '/api/v1/|/graphql/';
const INSTAGRAM_PRIVATE_CONFIG_RETRY_BUDGET = 2;
const INSTAGRAM_PRIVATE_UPLOAD_RETRY_BUDGET = 2;

export function derivePrivateApiContextFromCapture(
  entries: InstagramProtocolCaptureEntry[],
): InstagramPrivateApiContext | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const headers = entries[index]?.requestHeaders ?? {};
    const context = {
      asbdId: String(headers['X-ASBD-ID'] || ''),
      csrfToken: String(headers['X-CSRFToken'] || ''),
      igAppId: String(headers['X-IG-App-ID'] || ''),
      igWwwClaim: String(headers['X-IG-WWW-Claim'] || ''),
      instagramAjax: String(headers['X-Instagram-AJAX'] || ''),
      webSessionId: String(headers['X-Web-Session-ID'] || ''),
    };
    if (
      context.asbdId
      && context.csrfToken
      && context.igAppId
      && context.igWwwClaim
      && context.instagramAjax
      && context.webSessionId
    ) {
      return context;
    }
  }
  return null;
}

function derivePartialPrivateApiContextFromCapture(
  entries: InstagramProtocolCaptureEntry[],
): Partial<InstagramPrivateApiContext> {
  const context: Partial<InstagramPrivateApiContext> = {};
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const headers = entries[index]?.requestHeaders ?? {};
    if (!context.asbdId && headers['X-ASBD-ID']) context.asbdId = String(headers['X-ASBD-ID']);
    if (!context.csrfToken && headers['X-CSRFToken']) context.csrfToken = String(headers['X-CSRFToken']);
    if (!context.igAppId && headers['X-IG-App-ID']) context.igAppId = String(headers['X-IG-App-ID']);
    if (!context.igWwwClaim && headers['X-IG-WWW-Claim']) context.igWwwClaim = String(headers['X-IG-WWW-Claim']);
    if (!context.instagramAjax && headers['X-Instagram-AJAX']) context.instagramAjax = String(headers['X-Instagram-AJAX']);
    if (!context.webSessionId && headers['X-Web-Session-ID']) context.webSessionId = String(headers['X-Web-Session-ID']);
  }
  return context;
}

export function deriveInstagramJazoest(value: string): string {
  if (!value) return '';
  const sum = Array.from(value).reduce((total, char) => total + char.charCodeAt(0), 0);
  return `2${sum}`;
}

function isTransientPrivateFetchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|network|socket hang up|econnreset|etimedout/i.test(message);
}

function getCookieValue(cookies: BrowserCookie[], name: string): string {
  return cookies.find((cookie) => cookie.name === name)?.value || '';
}

export async function resolveInstagramPrivatePublishConfig(page: IPage): Promise<{
  apiContext: InstagramPrivateApiContext;
  jazoest: string;
}> {
  let lastError: unknown;
  for (let attempt = 0; attempt < INSTAGRAM_PRIVATE_CONFIG_RETRY_BUDGET; attempt += 1) {
    try {
      if (typeof page.startNetworkCapture === 'function') {
        await page.startNetworkCapture(INSTAGRAM_PRIVATE_CAPTURE_PATTERN);
      }
      await page.goto(`${INSTAGRAM_HOME_URL}?__opencli_private_probe=${Date.now()}`);
      await page.wait({ time: 2 });

      const [cookies, runtime, entries] = await Promise.all([
        page.getCookies({ domain: 'instagram.com' }),
        page.evaluate(buildReadInstagramRuntimeInfoJs()) as Promise<InstagramRuntimeInfo>,
        typeof page.readNetworkCapture === 'function'
          ? page.readNetworkCapture() as Promise<unknown[]>
          : Promise.resolve([]),
      ]);

      const captureEntries = (Array.isArray(entries) ? entries : []) as InstagramProtocolCaptureEntry[];
      const capturedContext = derivePrivateApiContextFromCapture(captureEntries)
        ?? derivePartialPrivateApiContextFromCapture(captureEntries);

      const csrfToken = runtime?.csrfToken || getCookieValue(cookies, 'csrftoken') || capturedContext.csrfToken || '';
      const igAppId = runtime?.appId || capturedContext.igAppId || '';
      const instagramAjax = runtime?.instagramAjax || capturedContext.instagramAjax || '';
      if (!csrfToken) {
        throw new CommandExecutionError('Instagram private route could not derive CSRF token from browser session');
      }
      if (!igAppId) {
        throw new CommandExecutionError('Instagram private route could not derive X-IG-App-ID from instagram runtime');
      }
      if (!instagramAjax) {
        throw new CommandExecutionError('Instagram private route could not derive X-Instagram-AJAX from instagram runtime');
      }
      const asbdId = capturedContext.asbdId || '';
      const igWwwClaim = capturedContext.igWwwClaim || '';
      const webSessionId = capturedContext.webSessionId || '';

      return {
        apiContext: {
          asbdId,
          csrfToken,
          igAppId,
          igWwwClaim,
          instagramAjax,
          webSessionId,
        },
        jazoest: deriveInstagramJazoest(csrfToken),
      };
    } catch (error) {
      lastError = error;
      if (!isTransientPrivateFetchError(error) || attempt >= INSTAGRAM_PRIVATE_CONFIG_RETRY_BUDGET - 1) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function buildConfigureBody(input: {
  uploadId: string;
  caption: string;
  jazoest: string;
}): string {
  const body = new URLSearchParams();
  body.set('archive_only', 'false');
  body.set('caption', input.caption);
  body.set('clips_share_preview_to_feed', '1');
  body.set('disable_comments', '0');
  body.set('disable_oa_reuse', 'false');
  body.set('igtv_share_preview_to_feed', '1');
  body.set('is_meta_only_post', '0');
  body.set('is_unified_video', '1');
  body.set('like_and_view_counts_disabled', '0');
  body.set('media_share_flow', 'creation_flow');
  body.set('share_to_facebook', '');
  body.set('share_to_fb_destination_type', 'USER');
  body.set('source_type', 'library');
  body.set('upload_id', input.uploadId);
  body.set('video_subtitles_enabled', '0');
  body.set('jazoest', input.jazoest);
  return body.toString();
}

export function buildConfigureSidecarPayload(input: {
  uploadIds: string[];
  caption: string;
  clientSidecarId: string;
  jazoest: string;
}): Record<string, unknown> {
  return {
    archive_only: false,
    caption: input.caption,
    children_metadata: input.uploadIds.map((uploadId) => ({ upload_id: uploadId })),
    client_sidecar_id: input.clientSidecarId,
    disable_comments: '0',
    is_meta_only_post: false,
    is_open_to_public_submission: false,
    like_and_view_counts_disabled: 0,
    media_share_flow: 'creation_flow',
    share_to_facebook: '',
    share_to_fb_destination_type: 'USER',
    source_type: 'library',
    jazoest: input.jazoest,
  };
}

function inferMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.jpg':
    case '.jpeg':
    default:
      return 'image/jpeg';
  }
}

function readPngDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (bytes.subarray(0, 8).toString('hex').toUpperCase() !== '89504E470D0A1A0A') return null;
  if (bytes.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function readJpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) break;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame && segmentLength >= 7) {
      return {
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
      };
    }
    offset += segmentLength;
  }
  return null;
}

function readWebpDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 30) return null;
  if (bytes.subarray(0, 4).toString('ascii') !== 'RIFF' || bytes.subarray(8, 12).toString('ascii') !== 'WEBP') {
    return null;
  }

  const chunkType = bytes.subarray(12, 16).toString('ascii');
  if (chunkType === 'VP8X' && bytes.length >= 30) {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
    };
  }

  if (chunkType === 'VP8 ' && bytes.length >= 30) {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }

  if (chunkType === 'VP8L' && bytes.length >= 25) {
    const bits = bytes.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  return null;
}

function readImageDimensions(filePath: string, bytes: Buffer): { width: number; height: number } {
  const ext = path.extname(filePath).toLowerCase();
  const dimensions = ext === '.png'
    ? readPngDimensions(bytes)
    : ext === '.webp'
      ? readWebpDimensions(bytes)
      : readJpegDimensions(bytes);
  if (!dimensions) {
    throw new CommandExecutionError(`Failed to read image dimensions for ${filePath}`);
  }
  return dimensions;
}

export function readImageAsset(filePath: string): InstagramImageAsset {
  const bytes = fs.readFileSync(filePath);
  const { width, height } = readImageDimensions(filePath, bytes);
  return {
    filePath,
    fileName: path.basename(filePath),
    mimeType: inferMimeType(filePath),
    width,
    height,
    byteLength: bytes.length,
    bytes,
  };
}

export function isInstagramFeedAspectRatioAllowed(width: number, height: number): boolean {
  const ratio = width / Math.max(height, 1);
  return ratio >= INSTAGRAM_MIN_FEED_ASPECT_RATIO - 0.001
    && ratio <= INSTAGRAM_MAX_FEED_ASPECT_RATIO + 0.001;
}

export function getInstagramFeedNormalizedDimensions(
  width: number,
  height: number,
): { width: number; height: number } | null {
  const ratio = width / Math.max(height, 1);
  if (ratio < INSTAGRAM_MIN_FEED_ASPECT_RATIO) {
    return {
      width: Math.ceil(height * INSTAGRAM_MIN_FEED_ASPECT_RATIO),
      height,
    };
  }
  if (ratio > INSTAGRAM_MAX_FEED_ASPECT_RATIO) {
    return {
      width,
      height: Math.ceil(width / INSTAGRAM_MAX_FEED_ASPECT_RATIO),
    };
  }
  return null;
}

function buildPrivateNormalizedImagePath(filePath: string): string {
  const parsed = path.parse(filePath);
  return path.join(
    os.tmpdir(),
    `opencli-instagram-private-${parsed.name}-${crypto.randomUUID()}${parsed.ext || '.png'}`,
  );
}

export function prepareImageAssetForPrivateUpload(filePath: string): PreparedInstagramImageAsset {
  const asset = readImageAsset(filePath);
  const normalizedDimensions = getInstagramFeedNormalizedDimensions(asset.width, asset.height);
  if (!normalizedDimensions) {
    return asset;
  }

  if (process.platform !== 'darwin') {
    throw new CommandExecutionError(
      `Instagram private publish does not support auto-normalizing ${asset.fileName} on ${process.platform}`,
      `Use images within ${INSTAGRAM_MIN_FEED_ASPECT_RATIO.toFixed(2)}-${INSTAGRAM_MAX_FEED_ASPECT_RATIO.toFixed(2)} aspect ratio, or use the UI route`,
    );
  }

  const outputPath = buildPrivateNormalizedImagePath(filePath);
  const result = spawnSync('sips', [
    '--padToHeightWidth',
    String(normalizedDimensions.height),
    String(normalizedDimensions.width),
    '--padColor',
    INSTAGRAM_PRIVATE_PAD_COLOR,
    filePath,
    '--out',
    outputPath,
  ], {
    encoding: 'utf8',
  });

  if (result.error || result.status !== 0 || !fs.existsSync(outputPath)) {
    const detail = [result.error?.message, result.stderr, result.stdout]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' ');
    throw new CommandExecutionError(
      `Instagram private publish failed to normalize ${asset.fileName}`,
      detail || 'sips padToHeightWidth failed',
    );
  }

  return {
    ...readImageAsset(outputPath),
    cleanupPath: outputPath,
  };
}

function buildPrivateApiHeaders(context: InstagramPrivateApiContext): Record<string, string> {
  return Object.fromEntries(Object.entries({
    'X-ASBD-ID': context.asbdId,
    'X-CSRFToken': context.csrfToken,
    'X-IG-App-ID': context.igAppId,
    'X-IG-WWW-Claim': context.igWwwClaim,
    'X-Instagram-AJAX': context.instagramAjax,
    'X-Web-Session-ID': context.webSessionId,
  }).filter(([, value]) => !!value));
}

function buildRuploadHeaders(
  asset: InstagramImageAsset,
  uploadId: string,
  context: InstagramPrivateApiContext,
): Record<string, string> {
  return {
    ...buildPrivateApiHeaders(context),
    'Accept': '*/*',
    'Content-Type': asset.mimeType,
    'Offset': '0',
    'X-Entity-Length': String(asset.byteLength),
    'X-Entity-Name': `fb_uploader_${uploadId}`,
    'X-Entity-Type': asset.mimeType,
    'X-Instagram-Rupload-Params': JSON.stringify({
      media_type: 1,
      upload_id: uploadId,
      upload_media_height: asset.height,
      upload_media_width: asset.width,
    }),
  };
}

async function parseJsonResponse(response: Response, stage: string): Promise<any> {
  const text = await response.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new CommandExecutionError(`Instagram private publish ${stage} returned invalid JSON`);
  }
  if (!response.ok) {
    const detail = text ? ` ${text.slice(0, 500)}` : '';
    throw new CommandExecutionError(`Instagram private publish ${stage} failed: ${response.status}${detail}`);
  }
  return data;
}

async function fetchPrivateUploadWithRetry(
  fetcher: PrivateApiFetchLike,
  url: string,
  init: PrivateApiFetchInit,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < INSTAGRAM_PRIVATE_UPLOAD_RETRY_BUDGET; attempt += 1) {
    try {
      return await fetcher(url, init);
    } catch (error) {
      lastError = error;
      if (!isTransientPrivateFetchError(error) || attempt >= INSTAGRAM_PRIVATE_UPLOAD_RETRY_BUDGET - 1) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function publishImagesViaPrivateApi(input: {
  page: unknown;
  imagePaths: string[];
  caption: string;
  apiContext: InstagramPrivateApiContext;
  jazoest: string;
  now?: () => number;
  fetcher?: PrivateApiFetchLike;
  prepareAsset?: (filePath: string) => PreparedInstagramImageAsset | Promise<PreparedInstagramImageAsset>;
}): Promise<{ code?: string; uploadIds: string[] }> {
  const now = input.now ?? (() => Date.now());
  const clientSidecarId = String(now());
  const uploadIds = input.imagePaths.length > 1
    ? input.imagePaths.map((_, index) => String(now() + index + 1))
    : [String(now())];
  const fetcher: PrivateApiFetchLike = input.fetcher ?? ((url, init) => instagramPrivateApiFetch(input.page as any, url, init as any));
  const prepareAsset = input.prepareAsset ?? prepareImageAssetForPrivateUpload;
  const assets = await Promise.all(input.imagePaths.map((filePath) => prepareAsset(filePath)));

  try {
    for (let index = 0; index < assets.length; index += 1) {
      const asset = assets[index]!;
      const uploadId = uploadIds[index]!;
      const response = await fetchPrivateUploadWithRetry(fetcher, `https://i.instagram.com/rupload_igphoto/fb_uploader_${uploadId}`, {
        method: 'POST',
        headers: buildRuploadHeaders(asset, uploadId, input.apiContext),
        body: asset.bytes,
      });
      const json = await parseJsonResponse(response, 'upload');
      if (String(json?.status || '') !== 'ok') {
        throw new CommandExecutionError(`Instagram private publish upload failed for ${asset.fileName}`);
      }
    }

    if (uploadIds.length === 1) {
      const response = await fetcher('https://www.instagram.com/api/v1/media/configure/', {
        method: 'POST',
        headers: {
          ...buildPrivateApiHeaders(input.apiContext),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: buildConfigureBody({
          uploadId: uploadIds[0]!,
          caption: input.caption,
          jazoest: input.jazoest,
        }),
      });
      const json = await parseJsonResponse(response, 'configure');
      return { code: json?.media?.code, uploadIds };
    }

    const response = await fetcher('https://www.instagram.com/api/v1/media/configure_sidecar/', {
      method: 'POST',
      headers: {
        ...buildPrivateApiHeaders(input.apiContext),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildConfigureSidecarPayload({
        uploadIds,
        caption: input.caption,
        clientSidecarId,
        jazoest: input.jazoest,
      })),
    });
    const json = await parseJsonResponse(response, 'configure_sidecar');
    return { code: json?.media?.code, uploadIds };
  } finally {
    for (const asset of assets) {
      if (asset.cleanupPath) {
        fs.rmSync(asset.cleanupPath, { force: true });
      }
    }
  }
}
