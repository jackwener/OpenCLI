import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ArgumentError, AuthRequiredError, CommandExecutionError, ConfigError, TimeoutError } from '@jackwener/opencli/errors';

export const MINIMAX_API_KEY_VAR = 'MINIMAX_API_KEY';
export const MUSIC_REGIONS = {
    global: { host: 'api.minimax.io', endpoint: 'https://api.minimax.io/v1/music_generation' },
    cn: { host: 'api.minimaxi.com', endpoint: 'https://api.minimaxi.com/v1/music_generation' },
};

const AUTH_CODES = new Set([1004, 2049]);

export function requireApiKey() {
    const key = String(process.env[MINIMAX_API_KEY_VAR] ?? '').trim();
    if (!key) {
        throw new ConfigError(
            `Missing ${MINIMAX_API_KEY_VAR}`,
            `Export an API key issued for the selected MiniMax region as ${MINIMAX_API_KEY_VAR}.`,
        );
    }
    return key;
}

export function buildRequest(options) {
    const body = {
        model: options.model,
        output_format: options.outputFormat,
        audio_setting: { format: options.audioFormat },
    };
    if (options.prompt) body.prompt = options.prompt;
    if (options.lyrics) body.lyrics = options.lyrics;
    if (options.sampleRate != null) body.audio_setting.sample_rate = options.sampleRate;
    if (options.bitrate != null) body.audio_setting.bitrate = options.bitrate;
    if (options.instrumental) body.is_instrumental = true;
    if (options.lyricsOptimizer) body.lyrics_optimizer = true;
    if (options.aigcWatermark) body.aigc_watermark = true;
    return body;
}

export async function generateMusic(region, apiKey, body, timeoutSeconds) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
    timer.unref?.();
    let response;
    try {
        response = await fetch(region.endpoint, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${apiKey}`,
                'content-type': 'application/json',
                accept: 'application/json',
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } catch (error) {
        if (controller.signal.aborted) {
            throw new TimeoutError('MiniMax music generation', timeoutSeconds, 'The request may have been accepted; result and billing state are unknown. The API exposes no task id to resume, so check account history before submitting again.');
        }
        throw new CommandExecutionError(
            `MiniMax music request failed: ${error?.message ?? error}`,
            `Check that ${region.host} is reachable. The request may have reached MiniMax; check account history before retrying.`,
        );
    } finally {
        clearTimeout(timer);
    }
    if (response.status === 401 || response.status === 403) {
        throw new AuthRequiredError(region.host, `MiniMax ${region.host} rejected ${MINIMAX_API_KEY_VAR} (HTTP ${response.status}).`);
    }
    if (!response.ok) {
        throw new CommandExecutionError(`MiniMax music returned HTTP ${response.status} from ${region.host}`);
    }
    try {
        return await response.json();
    } catch (error) {
        throw new CommandExecutionError(`MiniMax music returned malformed JSON: ${error?.message ?? error}`);
    }
}

export function parseCompletedMusic(payload, region) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new CommandExecutionError('MiniMax music returned a malformed response envelope');
    }
    const base = payload.base_resp;
    if (!base || typeof base !== 'object' || !Number.isInteger(base.status_code)) {
        throw new CommandExecutionError('MiniMax music response is missing integer base_resp.status_code');
    }
    if (base.status_code !== 0) {
        const message = typeof base.status_msg === 'string' && base.status_msg.trim()
            ? `: ${base.status_msg.trim()}`
            : '';
        if (AUTH_CODES.has(base.status_code)) {
            throw new AuthRequiredError(region.host, `MiniMax ${region.host} rejected ${MINIMAX_API_KEY_VAR} (service ${base.status_code}${message}).`);
        }
        throw new CommandExecutionError(`MiniMax music failed (service ${base.status_code}${message})`);
    }
    const data = payload.data;
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Number.isInteger(data.status)) {
        throw new CommandExecutionError('MiniMax music response is missing integer data.status');
    }
    if (data.status === 1) {
        const traceId = typeof payload.trace_id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(payload.trace_id.trim())
            ? payload.trace_id.trim()
            : '';
        throw new CommandExecutionError(
            `MiniMax music returned status 1 (in progress) without a resumable task id${traceId ? ` (trace_id: ${traceId})` : ''}`,
            'Do not resubmit blindly: this endpoint exposes no query command, so check MiniMax account history first.',
        );
    }
    if (data.status !== 2) {
        throw new CommandExecutionError(`MiniMax music returned unknown data.status ${data.status}`);
    }
    if (typeof data.audio !== 'string' || !data.audio.trim()) {
        throw new CommandExecutionError('MiniMax music reported completion without data.audio');
    }
    return {
        audio: data.audio.trim(),
        expectedBytes: payload.extra_info == null ? null : parseExpectedSize(payload.extra_info),
    };
}

function parseExpectedSize(extraInfo) {
    if (!extraInfo || typeof extraInfo !== 'object' || Array.isArray(extraInfo)) {
        throw new CommandExecutionError('MiniMax music returned malformed extra_info');
    }
    if (extraInfo.music_size == null) return null;
    if (!Number.isSafeInteger(extraInfo.music_size) || extraInfo.music_size <= 0) {
        throw new CommandExecutionError('MiniMax music returned invalid extra_info.music_size');
    }
    return extraInfo.music_size;
}

export function requireAudioUrl(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new CommandExecutionError('MiniMax music returned data.audio that is not a URL');
    }
    if (url.protocol !== 'https:') {
        throw new CommandExecutionError(`MiniMax music returned a non-HTTPS audio URL (${url.protocol})`);
    }
    return url.toString();
}

export function decodeAudioHex(value, expectedBytes, format) {
    if (value.length === 0 || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) {
        throw new CommandExecutionError('MiniMax music returned invalid hexadecimal audio');
    }
    const bytes = Buffer.from(value, 'hex');
    if (expectedBytes != null && bytes.length !== expectedBytes) {
        throw new CommandExecutionError(`MiniMax music audio size mismatch (expected ${expectedBytes} bytes, got ${bytes.length})`);
    }
    if (format === 'wav' && (bytes.length < 12 || bytes.subarray(0, 4).toString('ascii') !== 'RIFF' || bytes.subarray(8, 12).toString('ascii') !== 'WAVE')) {
        throw new CommandExecutionError('MiniMax music returned bytes that are not a WAV file');
    }
    if (format === 'mp3' && !isMp3(bytes)) {
        throw new CommandExecutionError('MiniMax music returned bytes that are not an MP3 file');
    }
    return bytes;
}

function isMp3(bytes) {
    return bytes.length >= 3 && bytes.subarray(0, 3).toString('ascii') === 'ID3'
        || bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
}

export function resolveOutputDir(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return path.join(os.homedir(), 'Music', 'minimax');
    if (raw === '~') return os.homedir();
    if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
    if (raw.startsWith('~')) throw new ArgumentError(`Unsupported home-directory path: ${raw}`);
    return path.resolve(raw);
}

export function reserveAudioFile(dir, model, format, now = new Date()) {
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const target = path.join(dir, `${model}-${stamp}.${format}`);
    const lock = `${target}.lock`;
    const staging = `${target}.${process.pid}.${randomUUID()}.tmp`;
    try {
        fs.mkdirSync(dir, { recursive: true });
        if (!fs.statSync(dir).isDirectory()) throw new Error('not a directory');
        fs.accessSync(dir, fs.constants.W_OK);
        if (fs.existsSync(target)) throw new Error('target already exists');
        fs.writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
        if (fs.existsSync(target)) {
            fs.rmSync(lock, { force: true });
            throw new Error('target appeared during reservation');
        }
        return { target, lock, staging };
    } catch (error) {
        throw new CommandExecutionError(`MiniMax music cannot reserve output file ${target}: ${error?.message ?? error}`);
    }
}

export function commitAudioFile(reservation, bytes) {
    try {
        fs.writeFileSync(reservation.staging, bytes, { flag: 'wx', mode: 0o600 });
        // A same-filesystem hard link publishes the complete staging inode and
        // fails if target already exists on POSIX and Windows alike.
        fs.linkSync(reservation.staging, reservation.target);
        cleanupAudioFile(reservation);
        return reservation.target;
    } catch (error) {
        cleanupAudioFile(reservation);
        throw new CommandExecutionError(`MiniMax music could not atomically write ${reservation.target}: ${error?.message ?? error}`);
    }
}

export function cleanupAudioFile(reservation) {
    if (!reservation) return;
    fs.rmSync(reservation.staging, { force: true });
    fs.rmSync(reservation.lock, { force: true });
}
