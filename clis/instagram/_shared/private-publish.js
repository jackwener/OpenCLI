import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { instagramPrivateApiFetch } from './protocol-capture.js';
import { buildReadInstagramRuntimeInfoJs, } from './runtime-info.js';
export { buildReadInstagramRuntimeInfoJs, extractInstagramRuntimeInfo, resolveInstagramRuntimeInfo, } from './runtime-info.js';
const INSTAGRAM_MIN_FEED_ASPECT_RATIO = 4 / 5;
const INSTAGRAM_MAX_FEED_ASPECT_RATIO = 1.91;
const INSTAGRAM_MIN_STORY_ASPECT_RATIO = 9 / 16;
const INSTAGRAM_MAX_STORY_ASPECT_RATIO = 3 / 4;
const INSTAGRAM_PRIVATE_PAD_COLOR = 'FFFFFF';
const INSTAGRAM_HOME_URL = 'https://www.instagram.com/';
const INSTAGRAM_PRIVATE_CAPTURE_PATTERN = '/api/v1/|/graphql/';
const INSTAGRAM_PRIVATE_CONFIG_RETRY_BUDGET = 2;
const INSTAGRAM_PRIVATE_UPLOAD_RETRY_BUDGET = 2;
const INSTAGRAM_PRIVATE_SIDECAR_TRANSCODE_ATTEMPTS = 20;
const INSTAGRAM_PRIVATE_SIDECAR_TRANSCODE_WAIT_MS = 2000;
const INSTAGRAM_MAX_STORY_VIDEO_DURATION_MS = 15_000;
const INSTAGRAM_STORY_SIG_KEY = '19ce5f445dbfd9d29c59dc2a78c616a7fc090a8e018b9267bc4240a30244c53b';
const INSTAGRAM_STORY_SIG_KEY_VERSION = '4';
const INSTAGRAM_STORY_DEVICE = {
    manufacturer: 'samsung',
    model: 'SM-G930F',
    android_version: 24,
    android_release: '7.0',
};
export function derivePrivateApiContextFromCapture(entries) {
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
        if (context.asbdId
            && context.csrfToken
            && context.igAppId
            && context.igWwwClaim
            && context.instagramAjax
            && context.webSessionId) {
            return context;
        }
    }
    return null;
}
function derivePartialPrivateApiContextFromCapture(entries) {
    const context = {};
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const headers = entries[index]?.requestHeaders ?? {};
        if (!context.asbdId && headers['X-ASBD-ID'])
            context.asbdId = String(headers['X-ASBD-ID']);
        if (!context.csrfToken && headers['X-CSRFToken'])
            context.csrfToken = String(headers['X-CSRFToken']);
        if (!context.igAppId && headers['X-IG-App-ID'])
            context.igAppId = String(headers['X-IG-App-ID']);
        if (!context.igWwwClaim && headers['X-IG-WWW-Claim'])
            context.igWwwClaim = String(headers['X-IG-WWW-Claim']);
        if (!context.instagramAjax && headers['X-Instagram-AJAX'])
            context.instagramAjax = String(headers['X-Instagram-AJAX']);
        if (!context.webSessionId && headers['X-Web-Session-ID'])
            context.webSessionId = String(headers['X-Web-Session-ID']);
    }
    return context;
}
export function deriveInstagramJazoest(value) {
    if (!value)
        return '';
    const sum = Array.from(value).reduce((total, char) => total + char.charCodeAt(0), 0);
    return `2${sum}`;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function isTransientPrivateFetchError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return /fetch failed|network|socket hang up|econnreset|etimedout/i.test(message);
}
function getCookieValue(cookies, name) {
    return cookies.find((cookie) => cookie.name === name)?.value || '';
}
export async function resolveInstagramPrivatePublishConfig(page) {
    let lastError;
    for (let attempt = 0; attempt < INSTAGRAM_PRIVATE_CONFIG_RETRY_BUDGET; attempt += 1) {
        try {
            if (typeof page.startNetworkCapture === 'function') {
                await page.startNetworkCapture(INSTAGRAM_PRIVATE_CAPTURE_PATTERN);
            }
            await page.goto(`${INSTAGRAM_HOME_URL}?__opencli_private_probe=${Date.now()}`);
            await page.wait({ time: 2 });
            const [cookies, runtime, entries] = await Promise.all([
                page.getCookies({ domain: 'instagram.com' }),
                page.evaluate(buildReadInstagramRuntimeInfoJs()),
                typeof page.readNetworkCapture === 'function'
                    ? page.readNetworkCapture()
                    : Promise.resolve([]),
            ]);
            const captureEntries = (Array.isArray(entries) ? entries : []);
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
        }
        catch (error) {
            lastError = error;
            if (!isTransientPrivateFetchError(error) || attempt >= INSTAGRAM_PRIVATE_CONFIG_RETRY_BUDGET - 1) {
                throw error;
            }
        }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
export function buildConfigureBody(input) {
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
export function buildConfigureSidecarPayload(input) {
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
function inferMimeType(filePath) {
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
function readPngDimensions(bytes) {
    if (bytes.length < 24)
        return null;
    if (bytes.subarray(0, 8).toString('hex').toUpperCase() !== '89504E470D0A1A0A')
        return null;
    if (bytes.subarray(12, 16).toString('ascii') !== 'IHDR')
        return null;
    return {
        width: bytes.readUInt32BE(16),
        height: bytes.readUInt32BE(20),
    };
}
function readJpegDimensions(bytes) {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
        return null;
    let offset = 2;
    while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
            offset += 1;
            continue;
        }
        const marker = bytes[offset + 1];
        offset += 2;
        if (marker === 0xd8 || marker === 0xd9)
            continue;
        if (offset + 2 > bytes.length)
            break;
        const segmentLength = bytes.readUInt16BE(offset);
        if (segmentLength < 2 || offset + segmentLength > bytes.length)
            break;
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
function readWebpDimensions(bytes) {
    if (bytes.length < 30)
        return null;
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
function readImageDimensions(filePath, bytes) {
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
export function readImageAsset(filePath) {
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
export function isInstagramFeedAspectRatioAllowed(width, height) {
    const ratio = width / Math.max(height, 1);
    return ratio >= INSTAGRAM_MIN_FEED_ASPECT_RATIO - 0.001
        && ratio <= INSTAGRAM_MAX_FEED_ASPECT_RATIO + 0.001;
}
export function getInstagramFeedNormalizedDimensions(width, height) {
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
export function isInstagramStoryAspectRatioAllowed(width, height) {
    const ratio = width / Math.max(height, 1);
    return ratio >= INSTAGRAM_MIN_STORY_ASPECT_RATIO - 0.001
        && ratio <= INSTAGRAM_MAX_STORY_ASPECT_RATIO + 0.001;
}
export function getInstagramStoryNormalizedDimensions(width, height) {
    const ratio = width / Math.max(height, 1);
    if (ratio < INSTAGRAM_MIN_STORY_ASPECT_RATIO) {
        return {
            width: Math.ceil(height * INSTAGRAM_MIN_STORY_ASPECT_RATIO),
            height,
        };
    }
    if (ratio > INSTAGRAM_MAX_STORY_ASPECT_RATIO) {
        return {
            width,
            height: Math.ceil(width / INSTAGRAM_MAX_STORY_ASPECT_RATIO),
        };
    }
    return null;
}
function buildPrivateNormalizedImagePath(filePath) {
    const parsed = path.parse(filePath);
    return path.join(os.tmpdir(), `opencli-instagram-private-${parsed.name}-${crypto.randomUUID()}${parsed.ext || '.png'}`);
}
export function prepareImageAssetForPrivateUpload(filePath) {
    const asset = readImageAsset(filePath);
    const normalizedDimensions = getInstagramFeedNormalizedDimensions(asset.width, asset.height);
    if (!normalizedDimensions) {
        return asset;
    }
    if (process.platform !== 'darwin') {
        throw new CommandExecutionError(`Instagram private publish does not support auto-normalizing ${asset.fileName} on ${process.platform}`, `Use images within ${INSTAGRAM_MIN_FEED_ASPECT_RATIO.toFixed(2)}-${INSTAGRAM_MAX_FEED_ASPECT_RATIO.toFixed(2)} aspect ratio, or use the UI route`);
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
        throw new CommandExecutionError(`Instagram private publish failed to normalize ${asset.fileName}`, detail || 'sips padToHeightWidth failed');
    }
    return {
        ...readImageAsset(outputPath),
        cleanupPath: outputPath,
    };
}
export function prepareImageAssetForPrivateStoryUpload(filePath) {
    const asset = readImageAsset(filePath);
    const normalizedDimensions = getInstagramStoryNormalizedDimensions(asset.width, asset.height);
    if (!normalizedDimensions) {
        return asset;
    }
    if (process.platform !== 'darwin') {
        throw new CommandExecutionError(`Instagram private story publish does not support auto-normalizing ${asset.fileName} on ${process.platform}`, `Use images within ${INSTAGRAM_MIN_STORY_ASPECT_RATIO.toFixed(2)}-${INSTAGRAM_MAX_STORY_ASPECT_RATIO.toFixed(2)} aspect ratio, or use the UI route`);
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
        throw new CommandExecutionError(`Instagram private story publish failed to normalize ${asset.fileName}`, detail || 'sips padToHeightWidth failed');
    }
    return {
        ...readImageAsset(outputPath),
        cleanupPath: outputPath,
    };
}
function runSwiftJsonScript(script, args, stage) {
    const scriptPath = path.join(os.tmpdir(), `opencli-instagram-${crypto.randomUUID()}.swift`);
    fs.writeFileSync(scriptPath, script);
    try {
        const result = spawnSync('swift', [scriptPath, ...args], {
            encoding: 'utf8',
        });
        if (result.error || result.status !== 0) {
            const detail = [result.error?.message, result.stderr, result.stdout]
                .map((value) => String(value || '').trim())
                .filter(Boolean)
                .join(' ');
            throw new CommandExecutionError(`Instagram private publish failed to ${stage}`, detail || 'swift helper failed');
        }
        return JSON.parse(String(result.stdout || '{}'));
    }
    catch (error) {
        if (error instanceof CommandExecutionError)
            throw error;
        throw new CommandExecutionError(`Instagram private publish failed to ${stage}`, error instanceof Error ? error.message : String(error));
    }
    finally {
        fs.rmSync(scriptPath, { force: true });
    }
}
function readVideoMetadata(filePath) {
    if (process.platform !== 'darwin') {
        throw new CommandExecutionError(`Instagram private mixed-media publish does not support reading video metadata on ${process.platform}`, 'Use macOS for private mixed-media publishing, or rely on the UI fallback');
    }
    const metadata = runSwiftJsonScript(`
import AVFoundation
import Foundation

let path = CommandLine.arguments[1]
let url = URL(fileURLWithPath: path)
let asset = AVURLAsset(url: url)
guard let track = asset.tracks(withMediaType: .video).first else {
  fputs("{\\"error\\":\\"missing-video-track\\"}", stderr)
  exit(1)
}
let transformed = track.naturalSize.applying(track.preferredTransform)
let width = Int(abs(transformed.width.rounded()))
let height = Int(abs(transformed.height.rounded()))
let durationMs = Int((CMTimeGetSeconds(asset.duration) * 1000.0).rounded())
let payload: [String: Int] = [
  "width": width,
  "height": height,
  "durationMs": durationMs,
]
let data = try JSONSerialization.data(withJSONObject: payload, options: [])
FileHandle.standardOutput.write(data)
`, [filePath], 'read video metadata');
    if (!metadata.width || !metadata.height || !metadata.durationMs) {
        throw new CommandExecutionError(`Instagram private publish failed to read video metadata for ${filePath}`);
    }
    return {
        width: metadata.width,
        height: metadata.height,
        durationMs: metadata.durationMs,
    };
}
function buildPrivateVideoCoverPath(filePath) {
    const parsed = path.parse(filePath);
    return path.join(os.tmpdir(), `opencli-instagram-private-video-cover-${parsed.name}-${crypto.randomUUID()}.jpg`);
}
function buildPrivateStoryVideoPath(filePath) {
    const parsed = path.parse(filePath);
    return path.join(os.tmpdir(), `opencli-instagram-story-video-${parsed.name}-${crypto.randomUUID()}${parsed.ext || '.mp4'}`);
}
function generateVideoCoverImage(filePath) {
    if (process.platform !== 'darwin') {
        throw new CommandExecutionError(`Instagram private mixed-media publish does not support generating video covers on ${process.platform}`, 'Use macOS for private mixed-media publishing, or rely on the UI fallback');
    }
    const outputPath = buildPrivateVideoCoverPath(filePath);
    runSwiftJsonScript(`
import AVFoundation
import AppKit
import Foundation

let inputPath = CommandLine.arguments[1]
let outputPath = CommandLine.arguments[2]
let asset = AVURLAsset(url: URL(fileURLWithPath: inputPath))
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
let image = try generator.copyCGImage(at: CMTime(seconds: 0, preferredTimescale: 600), actualTime: nil)
let rep = NSBitmapImageRep(cgImage: image)
guard let data = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.9]) else {
  fputs("{\\"error\\":\\"jpeg-encode-failed\\"}", stderr)
  exit(1)
}
try data.write(to: URL(fileURLWithPath: outputPath))
let payload = ["ok": true]
let json = try JSONSerialization.data(withJSONObject: payload, options: [])
FileHandle.standardOutput.write(json)
`, [filePath, outputPath], 'generate video cover');
    return {
        ...readImageAsset(outputPath),
        cleanupPath: outputPath,
    };
}
export function readVideoAsset(filePath) {
    const bytes = fs.readFileSync(filePath);
    const metadata = readVideoMetadata(filePath);
    const coverImage = generateVideoCoverImage(filePath);
    return {
        filePath,
        fileName: path.basename(filePath),
        mimeType: 'video/mp4',
        width: metadata.width,
        height: metadata.height,
        durationMs: metadata.durationMs,
        byteLength: bytes.length,
        bytes,
        coverImage,
        cleanupPaths: coverImage.cleanupPath ? [coverImage.cleanupPath] : [],
    };
}
function trimVideoForInstagramStory(filePath, maxDurationMs) {
    if (process.platform !== 'darwin') {
        throw new CommandExecutionError(`Instagram private story publish does not support trimming long videos on ${process.platform}`, 'Use macOS for private story video publishing, or trim the video to 15 seconds first');
    }
    const outputPath = buildPrivateStoryVideoPath(filePath);
    runSwiftJsonScript(`
import AVFoundation
import Foundation

let inputPath = CommandLine.arguments[1]
let outputPath = CommandLine.arguments[2]
let durationMs = Int(CommandLine.arguments[3]) ?? 15000
let asset = AVURLAsset(url: URL(fileURLWithPath: inputPath))
guard let exportSession = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetHighestQuality) else {
  fputs("{\\"error\\":\\"missing-export-session\\"}", stderr)
  exit(1)
}
exportSession.outputURL = URL(fileURLWithPath: outputPath)
exportSession.outputFileType = .mp4
exportSession.shouldOptimizeForNetworkUse = true
exportSession.timeRange = CMTimeRange(
  start: .zero,
  duration: CMTime(seconds: Double(durationMs) / 1000.0, preferredTimescale: 600)
)
let semaphore = DispatchSemaphore(value: 0)
exportSession.exportAsynchronously {
  semaphore.signal()
}
semaphore.wait()
if exportSession.status != .completed {
  let message = exportSession.error?.localizedDescription ?? "export-failed"
  fputs(message, stderr)
  exit(1)
}
let payload = ["ok": true]
let json = try JSONSerialization.data(withJSONObject: payload, options: [])
FileHandle.standardOutput.write(json)
`, [filePath, outputPath, String(maxDurationMs)], 'trim story video');
    return outputPath;
}
function prepareVideoAssetForPrivateStoryUpload(filePath) {
    const asset = readVideoAsset(filePath);
    if (asset.durationMs <= INSTAGRAM_MAX_STORY_VIDEO_DURATION_MS) {
        return asset;
    }
    const trimmedPath = trimVideoForInstagramStory(filePath, INSTAGRAM_MAX_STORY_VIDEO_DURATION_MS);
    const trimmedAsset = readVideoAsset(trimmedPath);
    return {
        ...trimmedAsset,
        cleanupPaths: [
            ...(trimmedAsset.cleanupPaths || []),
            trimmedPath,
        ],
    };
}
function toUnixSeconds(now) {
    const value = now();
    return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
}
export function buildConfigureToStoryPhotoPayload(input) {
    const now = input.now ?? (() => Date.now());
    const timestamp = toUnixSeconds(now);
    return {
        source_type: '4',
        upload_id: input.uploadId,
        story_media_creation_date: String(timestamp - 17),
        client_shared_at: String(timestamp - 5),
        client_timestamp: String(timestamp),
        configure_mode: 1,
        edits: {
            crop_original_size: [input.width, input.height],
            crop_center: [0, 0],
            crop_zoom: 1.3333334,
        },
        extra: {
            source_width: input.width,
            source_height: input.height,
        },
        jazoest: input.jazoest,
    };
}
export function buildConfigureToStoryVideoPayload(input) {
    const now = input.now ?? (() => Date.now());
    const timestamp = toUnixSeconds(now);
    const durationSeconds = Number((input.durationMs / 1000).toFixed(3));
    return {
        source_type: '4',
        upload_id: input.uploadId,
        story_media_creation_date: String(timestamp - 17),
        client_shared_at: String(timestamp - 5),
        client_timestamp: String(timestamp),
        configure_mode: 1,
        poster_frame_index: 0,
        length: durationSeconds,
        audio_muted: false,
        filter_type: '0',
        video_result: 'deprecated',
        extra: {
            source_width: input.width,
            source_height: input.height,
        },
        jazoest: input.jazoest,
    };
}
function buildFormEncodedBodyFromPayload(payload) {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(payload)) {
        if (value === undefined || value === null)
            continue;
        if (typeof value === 'object') {
            body.set(key, JSON.stringify(value));
            continue;
        }
        body.set(key, String(value));
    }
    return body.toString();
}
function buildSignedBody(payload) {
    const jsonPayload = JSON.stringify(payload);
    const signature = crypto
        .createHmac('sha256', INSTAGRAM_STORY_SIG_KEY)
        .update(jsonPayload)
        .digest('hex');
    const body = new URLSearchParams();
    body.set('ig_sig_key_version', INSTAGRAM_STORY_SIG_KEY_VERSION);
    body.set('signed_body', `${signature}.${jsonPayload}`);
    return body.toString();
}
function buildPrivateApiHeaders(context) {
    return Object.fromEntries(Object.entries({
        'X-ASBD-ID': context.asbdId,
        'X-CSRFToken': context.csrfToken,
        'X-IG-App-ID': context.igAppId,
        'X-IG-WWW-Claim': context.igWwwClaim,
        'X-Instagram-AJAX': context.instagramAjax,
        'X-Web-Session-ID': context.webSessionId,
    }).filter(([, value]) => !!value));
}
function buildRuploadHeaders(asset, uploadId, context) {
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
function buildVideoEditParams(asset) {
    const cropSize = Math.min(asset.width, asset.height);
    const trimEndSeconds = Number((asset.durationMs / 1000).toFixed(3));
    return {
        crop_height: cropSize,
        crop_width: cropSize,
        crop_x1: Math.max(0, Math.floor((asset.width - cropSize) / 2)),
        crop_y1: Math.max(0, Math.floor((asset.height - cropSize) / 2)),
        mute: false,
        trim_end: trimEndSeconds,
        trim_start: 0,
    };
}
function buildVideoRuploadHeaders(asset, uploadId, context) {
    return {
        ...buildPrivateApiHeaders(context),
        'Accept': '*/*',
        'Offset': '0',
        'X-Entity-Length': String(asset.byteLength),
        'X-Entity-Name': `fb_uploader_${uploadId}`,
        'X-Instagram-Rupload-Params': JSON.stringify({
            'client-passthrough': '1',
            'is_unified_video': '0',
            'is_sidecar': '1',
            'media_type': 2,
            'for_album': false,
            'video_format': '',
            'upload_id': uploadId,
            'upload_media_duration_ms': asset.durationMs,
            'upload_media_height': asset.height,
            'upload_media_width': asset.width,
            'video_transform': null,
            'video_edit_params': buildVideoEditParams(asset),
        }),
    };
}
function buildStoryVideoRuploadHeaders(asset, uploadId, context) {
    return {
        ...buildPrivateApiHeaders(context),
        'Accept': '*/*',
        'Offset': '0',
        'X-Entity-Length': String(asset.byteLength),
        'X-Entity-Name': `fb_uploader_${uploadId}`,
        'X-Instagram-Rupload-Params': JSON.stringify({
            'client-passthrough': '1',
            'media_type': 2,
            'upload_id': uploadId,
            'upload_media_duration_ms': asset.durationMs,
            'upload_media_height': asset.height,
            'upload_media_width': asset.width,
            'video_transform': null,
            'video_edit_params': buildVideoEditParams(asset),
        }),
    };
}
function buildVideoCoverRuploadHeaders(asset, uploadId, context) {
    return {
        ...buildPrivateApiHeaders(context),
        'Accept': '*/*',
        'Content-Type': asset.coverImage.mimeType,
        'Offset': '0',
        'X-Entity-Length': String(asset.coverImage.byteLength),
        'X-Entity-Name': `fb_uploader_${uploadId}`,
        'X-Entity-Type': asset.coverImage.mimeType,
        'X-Instagram-Rupload-Params': JSON.stringify({
            media_type: 2,
            upload_id: uploadId,
            upload_media_height: asset.height,
            upload_media_width: asset.width,
        }),
    };
}
async function parseJsonResponse(response, stage) {
    const text = await response.text();
    let data;
    try {
        data = text ? JSON.parse(text) : {};
    }
    catch {
        throw new CommandExecutionError(`Instagram private publish ${stage} returned invalid JSON`);
    }
    if (!response.ok) {
        const detail = text ? ` ${text.slice(0, 500)}` : '';
        throw new CommandExecutionError(`Instagram private publish ${stage} failed: ${response.status}${detail}`);
    }
    return data;
}
async function fetchPrivateUploadWithRetry(fetcher, url, init) {
    let lastError;
    for (let attempt = 0; attempt < INSTAGRAM_PRIVATE_UPLOAD_RETRY_BUDGET; attempt += 1) {
        try {
            return await fetcher(url, init);
        }
        catch (error) {
            lastError = error;
            if (!isTransientPrivateFetchError(error) || attempt >= INSTAGRAM_PRIVATE_UPLOAD_RETRY_BUDGET - 1) {
                throw error;
            }
        }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
async function prepareInstagramMediaAsset(item) {
    if (item.type === 'video') {
        return {
            type: 'video',
            asset: readVideoAsset(item.filePath),
        };
    }
    return {
        type: 'image',
        asset: prepareImageAssetForPrivateUpload(item.filePath),
    };
}
function cleanupPreparedMediaAssets(assets) {
    for (const prepared of assets) {
        if (prepared.type === 'image') {
            if (prepared.asset.cleanupPath) {
                fs.rmSync(prepared.asset.cleanupPath, { force: true });
            }
            continue;
        }
        for (const cleanupPath of prepared.asset.cleanupPaths || []) {
            fs.rmSync(cleanupPath, { force: true });
        }
        if (prepared.asset.coverImage.cleanupPath) {
            fs.rmSync(prepared.asset.coverImage.cleanupPath, { force: true });
        }
    }
}
async function uploadPreparedMediaAsset(fetcher, prepared, uploadId, context, mode = 'feed') {
    if (prepared.type === 'image') {
        const response = await fetchPrivateUploadWithRetry(fetcher, `https://i.instagram.com/rupload_igphoto/fb_uploader_${uploadId}`, {
            method: 'POST',
            headers: buildRuploadHeaders(prepared.asset, uploadId, context),
            body: prepared.asset.bytes,
        });
        const json = await parseJsonResponse(response, 'upload');
        if (String(json?.status || '') !== 'ok') {
            throw new CommandExecutionError(`Instagram private publish upload failed for ${prepared.asset.fileName}`);
        }
        return;
    }
    const videoResponse = await fetchPrivateUploadWithRetry(fetcher, `https://i.instagram.com/rupload_igvideo/fb_uploader_${uploadId}`, {
        method: 'POST',
        headers: mode === 'story'
            ? buildStoryVideoRuploadHeaders(prepared.asset, uploadId, context)
            : buildVideoRuploadHeaders(prepared.asset, uploadId, context),
        body: prepared.asset.bytes,
    });
    const videoJson = await parseJsonResponse(videoResponse, 'video upload');
    if (String(videoJson?.status || '') !== 'ok') {
        throw new CommandExecutionError(`Instagram private publish video upload failed for ${prepared.asset.fileName}`);
    }
    const coverResponse = await fetchPrivateUploadWithRetry(fetcher, `https://i.instagram.com/rupload_igphoto/fb_uploader_${uploadId}`, {
        method: 'POST',
        headers: buildVideoCoverRuploadHeaders(prepared.asset, uploadId, context),
        body: prepared.asset.coverImage.bytes,
    });
    const coverJson = await parseJsonResponse(coverResponse, 'video cover upload');
    if (String(coverJson?.status || '') !== 'ok') {
        throw new CommandExecutionError(`Instagram private publish video cover upload failed for ${prepared.asset.fileName}`);
    }
}
async function publishSidecarWithRetry(input) {
    const waitMs = input.waitMs ?? sleep;
    const requestInit = {
        method: 'POST',
        headers: {
            ...buildPrivateApiHeaders(input.apiContext),
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(input.payload),
    };
    for (let attempt = 0; attempt < INSTAGRAM_PRIVATE_SIDECAR_TRANSCODE_ATTEMPTS; attempt += 1) {
        const response = await input.fetcher('https://www.instagram.com/api/v1/media/configure_sidecar/', requestInit);
        const text = await response.text();
        let json = {};
        try {
            json = text ? JSON.parse(text) : {};
        }
        catch {
            throw new CommandExecutionError('Instagram private publish configure_sidecar returned invalid JSON');
        }
        if (!response.ok) {
            const detail = text ? ` ${text.slice(0, 500)}` : '';
            throw new CommandExecutionError(`Instagram private publish configure_sidecar failed: ${response.status}${detail}`);
        }
        const message = String(json?.message || '');
        if (response.status === 202
            || /transcode not finished yet/i.test(message)) {
            if (attempt >= INSTAGRAM_PRIVATE_SIDECAR_TRANSCODE_ATTEMPTS - 1) {
                throw new CommandExecutionError('Instagram private publish configure_sidecar timed out waiting for video transcode', text.slice(0, 500));
            }
            await waitMs(INSTAGRAM_PRIVATE_SIDECAR_TRANSCODE_WAIT_MS);
            continue;
        }
        if (String(json?.status || '').toLowerCase() === 'fail') {
            throw new CommandExecutionError('Instagram private publish configure_sidecar failed', message || text.slice(0, 500));
        }
        return { code: json?.media?.code };
    }
    throw new CommandExecutionError('Instagram private publish configure_sidecar failed');
}
export async function publishMediaViaPrivateApi(input) {
    const now = input.now ?? (() => Date.now());
    const clientSidecarId = String(now());
    const uploadIds = input.mediaItems.length > 1
        ? input.mediaItems.map((_, index) => String(now() + index + 1))
        : [String(now())];
    const fetcher = input.fetcher ?? ((url, init) => instagramPrivateApiFetch(input.page, url, init));
    const prepareMediaAsset = input.prepareMediaAsset ?? prepareInstagramMediaAsset;
    const assets = await Promise.all(input.mediaItems.map((item) => prepareMediaAsset(item)));
    try {
        for (let index = 0; index < assets.length; index += 1) {
            const asset = assets[index];
            const uploadId = uploadIds[index];
            await uploadPreparedMediaAsset(fetcher, asset, uploadId, input.apiContext);
        }
        if (uploadIds.length === 1) {
            if (assets[0]?.type !== 'image') {
                throw new CommandExecutionError('Instagram private publish only supports single-video uploads through instagram reel');
            }
            const response = await fetcher('https://www.instagram.com/api/v1/media/configure/', {
                method: 'POST',
                headers: {
                    ...buildPrivateApiHeaders(input.apiContext),
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: buildConfigureBody({
                    uploadId: uploadIds[0],
                    caption: input.caption,
                    jazoest: input.jazoest,
                }),
            });
            const json = await parseJsonResponse(response, 'configure');
            return { code: json?.media?.code, uploadIds };
        }
        const result = await publishSidecarWithRetry({
            fetcher,
            payload: buildConfigureSidecarPayload({
                uploadIds,
                caption: input.caption,
                clientSidecarId,
                jazoest: input.jazoest,
            }),
            apiContext: input.apiContext,
            waitMs: input.waitMs,
        });
        return { code: result.code, uploadIds };
    }
    finally {
        cleanupPreparedMediaAssets(assets);
    }
}
export async function publishImagesViaPrivateApi(input) {
    return publishMediaViaPrivateApi({
        page: input.page,
        mediaItems: input.imagePaths.map((filePath) => ({ type: 'image', filePath })),
        caption: input.caption,
        apiContext: input.apiContext,
        jazoest: input.jazoest,
        now: input.now,
        fetcher: input.fetcher,
        waitMs: input.waitMs,
        prepareMediaAsset: input.prepareAsset
            ? async (item) => ({
                type: 'image',
                asset: await input.prepareAsset(item.filePath),
            })
            : undefined,
    });
}
export async function publishStoryViaPrivateApi(input) {
    const now = input.now ?? (() => Date.now());
    const uploadId = String(now());
    const fetcher = input.fetcher ?? ((url, init) => instagramPrivateApiFetch(input.page, url, init));
    const prepareMediaAsset = input.prepareMediaAsset ?? (async (item) => item.type === 'video'
        ? { type: 'video', asset: prepareVideoAssetForPrivateStoryUpload(item.filePath) }
        : { type: 'image', asset: prepareImageAssetForPrivateStoryUpload(item.filePath) });
    const prepared = await prepareMediaAsset(input.mediaItem);
    const currentUserId = input.currentUserId
        || ('getCookies' in input.page
            ? String((await (input.page.getCookies?.({ domain: 'instagram.com' }) ?? Promise.resolve([])))
                .find((cookie) => cookie.name === 'ds_user_id')?.value || '')
            : '');
    if (!currentUserId) {
        throw new CommandExecutionError('Instagram story publish could not derive current user id from browser session');
    }
    const signedPayloadBase = {
        _csrftoken: input.apiContext.csrfToken,
        _uid: currentUserId,
        _uuid: crypto.randomUUID(),
        device: INSTAGRAM_STORY_DEVICE,
    };
    const buildSignedStoryPhotoBody = (width, height) => buildSignedBody({
        ...buildConfigureToStoryPhotoPayload({
            uploadId,
            width,
            height,
            now,
            jazoest: input.jazoest,
        }),
        ...signedPayloadBase,
    });
    const buildSignedStoryVideoBody = (width, height, durationMs) => buildSignedBody({
        ...buildConfigureToStoryVideoPayload({
            uploadId,
            width,
            height,
            durationMs,
            now,
            jazoest: input.jazoest,
        }),
        ...signedPayloadBase,
    });
    try {
        await uploadPreparedMediaAsset(fetcher, prepared, uploadId, input.apiContext, 'story');
        if (prepared.type === 'image') {
            const response = await fetcher('https://i.instagram.com/api/v1/media/configure_to_story/', {
                method: 'POST',
                headers: {
                    ...buildPrivateApiHeaders(input.apiContext),
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: buildSignedStoryPhotoBody(prepared.asset.width, prepared.asset.height),
            });
            const json = await parseJsonResponse(response, 'configure_to_story');
            return {
                mediaPk: String(json?.media?.pk || json?.media?.id || '').split('_')[0] || undefined,
                uploadId,
            };
        }
        await parseJsonResponse(await fetcher('https://i.instagram.com/api/v1/media/configure_to_story/', {
            method: 'POST',
            headers: {
                ...buildPrivateApiHeaders(input.apiContext),
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: buildSignedStoryPhotoBody(prepared.asset.width, prepared.asset.height),
        }), 'configure_to_story cover');
        const response = await fetcher('https://i.instagram.com/api/v1/media/configure_to_story/?video=1', {
            method: 'POST',
            headers: {
                ...buildPrivateApiHeaders(input.apiContext),
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: buildSignedStoryVideoBody(prepared.asset.width, prepared.asset.height, prepared.asset.durationMs),
        });
        const json = await parseJsonResponse(response, 'configure_to_story');
        return {
            mediaPk: String(json?.media?.pk || json?.media?.id || '').split('_')[0] || undefined,
            uploadId,
        };
    }
    finally {
        cleanupPreparedMediaAssets([prepared]);
    }
}
