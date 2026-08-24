import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, ConfigError, TimeoutError } from '@jackwener/opencli/errors';
import './music.js';
import {
    MINIMAX_API_KEY_VAR,
    cleanupAudioFile,
    commitAudioFile,
    reserveAudioFile,
    resolveOutputDir,
} from './utils.js';

const GLOBAL_ENDPOINT = 'https://api.minimax.io/v1/music_generation';
const CN_ENDPOINT = 'https://api.minimaxi.com/v1/music_generation';
const tempDirs = [];

function command() {
    return getRegistry().get('minimax/music');
}

function tempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-minimax-'));
    tempDirs.push(dir);
    return dir;
}

function response(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function completed(audio = 'https://cdn.minimax.io/music/track.mp3', extraInfo) {
    return {
        data: { status: 2, audio },
        trace_id: 'trace-diagnostic-only',
        ...(extraInfo === undefined ? {} : { extra_info: extraInfo }),
        base_resp: { status_code: 0, status_msg: 'success' },
    };
}

function vocal(overrides = {}) {
    return { prompt: 'dream pop', lyrics: '[Verse]\nNight rain', execute: true, ...overrides };
}

beforeEach(() => {
    process.env[MINIMAX_API_KEY_VAR] = 'test-key';
});

afterEach(() => {
    delete process.env[MINIMAX_API_KEY_VAR];
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('minimax music contract', () => {
    it('registers one stable public write command without retired free models', () => {
        const cmd = command();
        expect(cmd).toMatchObject({ browser: false, strategy: 'public', access: 'write' });
        const args = new Map(cmd.args.map((arg) => [arg.name, arg]));
        expect(args.get('model')).toMatchObject({ default: 'music-3.0', choices: ['music-3.0', 'music-2.6'] });
        expect(args.get('region').choices).toEqual(['global', 'cn']);
        expect(args.get('execute').type).toBe('boolean');
        expect(cmd.columns).toEqual(['status', 'model', 'region', 'output_format', 'audio_format', 'audio_url', 'file', 'expires_in_hours']);
    });

    it.each([
        [{ prompt: 'x', lyrics: 'song' }, /--execute/],
        [vocal({ model: 'music-3.0-free' }), /--model/],
        [{ prompt: 'style', execute: true }, /requires --lyrics/],
        [{ 'lyrics-optimizer': true, execute: true }, /--lyrics-optimizer requires prompt/],
        [vocal({ 'lyrics-optimizer': true }), /--lyrics-optimizer requires prompt/],
        [{ prompt: 'style', lyrics: 'song', instrumental: true, execute: true }, /--instrumental requires prompt/],
        [vocal({ timeout: 0 }), /--timeout/],
        [vocal({ 'aigc-watermark': true }), /only supported with --region cn/],
        [vocal({ op: '/tmp/unused' }), /--op requires --output-format hex/],
    ])('rejects invalid or ambiguous input before fetch: %j', async (args, message) => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(command().func(args)).rejects.toThrow(message);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends the exact Global request and returns a completed URL row', async () => {
        const fetchMock = vi.fn(async () => response(completed()));
        vi.stubGlobal('fetch', fetchMock);
        const rows = await command().func(vocal({
            lyrics: undefined,
            model: 'music-2.6',
            'audio-format': 'wav',
            'sample-rate': 44100,
            bitrate: 256000,
            'lyrics-optimizer': true,
        }));
        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(GLOBAL_ENDPOINT);
        expect(init).toMatchObject({
            method: 'POST',
            headers: { authorization: 'Bearer test-key', 'content-type': 'application/json', accept: 'application/json' },
        });
        expect(JSON.parse(init.body)).toEqual({
            model: 'music-2.6',
            prompt: 'dream pop',
            output_format: 'url',
            audio_setting: { format: 'wav', sample_rate: 44100, bitrate: 256000 },
            lyrics_optimizer: true,
        });
        expect(rows).toEqual([{
            status: 'completed', model: 'music-2.6', region: 'global', output_format: 'url', audio_format: 'wav',
            audio_url: 'https://cdn.minimax.io/music/track.mp3', file: null, expires_in_hours: 24,
        }]);
    });

    it('uses the exact China endpoint and sends the CN-only watermark', async () => {
        const fetchMock = vi.fn(async () => response(completed('https://cdn.minimaxi.com/music/track.mp3')));
        vi.stubGlobal('fetch', fetchMock);
        const rows = await command().func(vocal({ region: 'cn', 'aigc-watermark': true }));
        expect(fetchMock.mock.calls[0][0]).toBe(CN_ENDPOINT);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ aigc_watermark: true });
        expect(rows[0]).toMatchObject({ region: 'cn', audio_url: 'https://cdn.minimaxi.com/music/track.mp3' });
    });

    it('fails missing and rejected credentials with typed errors', async () => {
        delete process.env[MINIMAX_API_KEY_VAR];
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(command().func(vocal())).rejects.toBeInstanceOf(ConfigError);
        expect(fetchMock).not.toHaveBeenCalled();

        process.env[MINIMAX_API_KEY_VAR] = 'bad-key';
        fetchMock.mockResolvedValueOnce(response({ error: 'denied' }, 401));
        await expect(command().func(vocal())).rejects.toBeInstanceOf(AuthRequiredError);
        fetchMock.mockResolvedValueOnce(response({ base_resp: { status_code: 2049, status_msg: 'invalid key' } }));
        await expect(command().func(vocal())).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('typed-fails service, malformed, and incomplete responses without retrying', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response({ base_resp: { status_code: 1008, status_msg: 'insufficient balance' } }))
            .mockResolvedValueOnce(response({ data: {}, base_resp: { status_code: 0 } }))
            .mockResolvedValueOnce(response({ data: { status: 1 }, trace_id: 'trace-123', base_resp: { status_code: 0 } }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(command().func(vocal())).rejects.toThrow(/service 1008: insufficient balance/);
        await expect(command().func(vocal())).rejects.toThrow(/data.status/);
        await expect(command().func(vocal())).rejects.toThrow(/without a resumable task id \(trace_id: trace-123\)/);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('typed-fails non-success HTTP and malformed JSON', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response('server error', { status: 500 }))
            .mockResolvedValueOnce(new Response('{not-json', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(command().func(vocal())).rejects.toThrow(/HTTP 500/);
        await expect(command().func(vocal())).rejects.toThrow(/malformed JSON/);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('rejects a completed URL response that is not HTTPS', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => response(completed('http://cdn.example.test/track.mp3'))));
        await expect(command().func(vocal())).rejects.toThrow(/non-HTTPS audio URL/);
    });

    it('reports client timeout as unknown bill/result state and never retries', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn((_url, init) => new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }));
        vi.stubGlobal('fetch', fetchMock);
        const pending = command().func(vocal({ timeout: 1 })).catch((error) => error);
        await vi.advanceTimersByTimeAsync(1000);
        const error = await pending;
        expect(error).toBeInstanceOf(TimeoutError);
        expect(error.hint).toMatch(/result and billing state are unknown/);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('preflights a same-second output collision before fetch', async () => {
        const dir = tempDir();
        vi.setSystemTime(new Date('2026-08-24T08:30:45.000Z'));
        fs.writeFileSync(path.join(dir, 'music-3.0-20260824T083045Z.mp3'), 'existing');
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(command().func(vocal({ 'output-format': 'hex', op: dir }))).rejects.toBeInstanceOf(CommandExecutionError);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(fs.readFileSync(path.join(dir, 'music-3.0-20260824T083045Z.mp3'), 'utf8')).toBe('existing');
    });

    it('uses a real same-directory lock so a second process cannot reserve the name', () => {
        const dir = tempDir();
        const now = new Date('2026-08-24T08:30:45.000Z');
        const first = reserveAudioFile(dir, 'music-3.0', 'mp3', now);
        expect(() => reserveAudioFile(dir, 'music-3.0', 'mp3', now)).toThrow(/cannot reserve output file/);
        cleanupAudioFile(first);
        expect(fs.readdirSync(dir)).toEqual([]);
    });

    it('hard-link publication never overwrites a target that appears after reservation', () => {
        const dir = tempDir();
        const reservation = reserveAudioFile(dir, 'music-3.0', 'mp3', new Date('2026-08-24T08:30:45.000Z'));
        fs.writeFileSync(reservation.target, 'foreign');
        expect(() => commitAudioFile(reservation, Buffer.from('ID3music'))).toThrow(/could not atomically write/);
        expect(fs.readFileSync(reservation.target, 'utf8')).toBe('foreign');
        expect(fs.readdirSync(dir)).toEqual([path.basename(reservation.target)]);
    });

    it('atomically writes valid hex audio and leaves no staging file', async () => {
        const dir = tempDir();
        const bytes = Buffer.from('ID3music');
        vi.stubGlobal('fetch', vi.fn(async () => response(completed(bytes.toString('hex'), { music_size: bytes.length }))));
        const rows = await command().func(vocal({ 'output-format': 'hex', op: dir }));
        expect(rows[0]).toMatchObject({ audio_url: null, file: expect.stringMatching(/\.mp3$/), expires_in_hours: null });
        expect(fs.readFileSync(rows[0].file)).toEqual(bytes);
        expect(fs.readdirSync(dir)).toEqual([path.basename(rows[0].file)]);
    });

    it('cleans reservations after network or audio-integrity failure', async () => {
        const networkDir = tempDir();
        const invalidDir = tempDir();
        const sizeDir = tempDir();
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce(response(completed(Buffer.from('not-mp3').toString('hex'), { music_size: 7 })))
            .mockResolvedValueOnce(response(completed(Buffer.from('ID3music').toString('hex'), { music_size: 999 })));
        vi.stubGlobal('fetch', fetchMock);
        await expect(command().func(vocal({ 'output-format': 'hex', op: networkDir }))).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command().func(vocal({ 'output-format': 'hex', op: invalidDir }))).rejects.toThrow(/not an MP3/);
        await expect(command().func(vocal({ 'output-format': 'hex', op: sizeDir }))).rejects.toThrow(/audio size mismatch/);
        expect(fs.readdirSync(networkDir)).toEqual([]);
        expect(fs.readdirSync(invalidDir)).toEqual([]);
        expect(fs.readdirSync(sizeDir)).toEqual([]);
    });

    it('expands only the current-user home shorthand', () => {
        expect(resolveOutputDir('~')).toBe(os.homedir());
        expect(resolveOutputDir('~/Music/minimax')).toBe(path.join(os.homedir(), 'Music', 'minimax'));
        expect(() => resolveOutputDir('~someone/music')).toThrow(ArgumentError);
    });
});
