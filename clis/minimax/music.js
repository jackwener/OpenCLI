import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import {
    MUSIC_REGIONS,
    buildRequest,
    cleanupAudioFile,
    commitAudioFile,
    decodeAudioHex,
    generateMusic,
    parseCompletedMusic,
    requireApiKey,
    requireAudioUrl,
    reserveAudioFile,
    resolveOutputDir,
} from './utils.js';

const MODELS = ['music-3.0', 'music-2.6'];
const OUTPUT_FORMATS = ['url', 'hex'];
const AUDIO_FORMATS = ['mp3', 'wav', 'pcm'];
const SAMPLE_RATES = [16000, 24000, 32000, 44100];
const BITRATES = [32000, 64000, 128000, 256000];

function choice(value, fallback, allowed, flag) {
    const normalized = String(value ?? fallback).trim().toLowerCase();
    if (!allowed.includes(normalized)) {
        throw new ArgumentError(`minimax music ${flag} must be one of: ${allowed.join(', ')}`);
    }
    return normalized;
}

function boolean(value, flag) {
    if (value == null || value === '') return false;
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    throw new ArgumentError(`minimax music ${flag} must be true or false`);
}

function optionalInteger(value, allowed, flag) {
    if (value == null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || !allowed.includes(parsed)) {
        throw new ArgumentError(`minimax music ${flag} must be one of: ${allowed.join(', ')}`);
    }
    return parsed;
}

function boundedInteger(value, fallback, min, max, flag) {
    const parsed = Number(value ?? fallback);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw new ArgumentError(`minimax music ${flag} must be an integer from ${min} to ${max}`);
    }
    return parsed;
}

function text(value, max, flag) {
    const normalized = String(value ?? '').trim();
    if (normalized.length > max) throw new ArgumentError(`minimax music ${flag} must be at most ${max} characters`);
    return normalized;
}

cli({
    site: 'minimax',
    name: 'music',
    access: 'write',
    description: 'Generate music for legacy paid MiniMax Music API accounts',
    domain: 'api.minimax.io',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'prompt', positional: true, help: 'Music style, mood, and scenario (max 2000 characters)' },
        { name: 'lyrics', help: 'Lyrics with section tags and newlines (max 3500 characters)' },
        { name: 'model', default: 'music-3.0', choices: MODELS, help: 'Legacy paid generation model' },
        { name: 'region', default: 'global', choices: Object.keys(MUSIC_REGIONS), help: 'API deployment: global or cn' },
        { name: 'output-format', default: 'url', choices: OUTPUT_FORMATS, help: 'Return a 24-hour URL or save inline hex audio' },
        { name: 'audio-format', default: 'mp3', choices: AUDIO_FORMATS, help: 'Rendered audio format' },
        { name: 'sample-rate', type: 'int', choices: SAMPLE_RATES.map(String), help: 'Audio sample rate in Hz' },
        { name: 'bitrate', type: 'int', choices: BITRATES.map(String), help: 'Audio bitrate in bps' },
        { name: 'instrumental', type: 'boolean', default: false, help: 'Generate instrumental music; requires prompt and forbids lyrics' },
        { name: 'lyrics-optimizer', type: 'boolean', default: false, help: 'Generate lyrics from prompt when --lyrics is omitted' },
        { name: 'aigc-watermark', type: 'boolean', default: false, help: 'CN-only audio watermark' },
        { name: 'op', help: 'Directory for --output-format hex (default: ~/Music/minimax)' },
        { name: 'timeout', type: 'int', default: 600, help: 'HTTP generation timeout in seconds (1-1800)' },
        { name: 'execute', type: 'boolean', default: false, help: 'Submit the billable generation request' },
    ],
    columns: ['status', 'model', 'region', 'output_format', 'audio_format', 'audio_url', 'file', 'expires_in_hours'],
    func: async (kwargs) => {
        const model = choice(kwargs.model, 'music-3.0', MODELS, '--model');
        const regionKey = choice(kwargs.region, 'global', Object.keys(MUSIC_REGIONS), '--region');
        const outputFormat = choice(kwargs['output-format'], 'url', OUTPUT_FORMATS, '--output-format');
        const audioFormat = choice(kwargs['audio-format'], 'mp3', AUDIO_FORMATS, '--audio-format');
        const sampleRate = optionalInteger(kwargs['sample-rate'], SAMPLE_RATES, '--sample-rate');
        const bitrate = optionalInteger(kwargs.bitrate, BITRATES, '--bitrate');
        const timeoutSeconds = boundedInteger(kwargs.timeout, 600, 1, 1800, '--timeout');
        const instrumental = boolean(kwargs.instrumental, '--instrumental');
        const lyricsOptimizer = boolean(kwargs['lyrics-optimizer'], '--lyrics-optimizer');
        const aigcWatermark = boolean(kwargs['aigc-watermark'], '--aigc-watermark');
        const execute = boolean(kwargs.execute, '--execute');
        const prompt = text(kwargs.prompt, 2000, 'prompt');
        const lyrics = text(kwargs.lyrics, 3500, '--lyrics');

        if (instrumental && (!prompt || lyrics || lyricsOptimizer)) {
            throw new ArgumentError('minimax music --instrumental requires prompt and cannot be combined with --lyrics or --lyrics-optimizer');
        }
        if (lyricsOptimizer && (!prompt || lyrics)) {
            throw new ArgumentError('minimax music --lyrics-optimizer requires prompt and cannot be combined with --lyrics');
        }
        if (!instrumental && !lyrics && !lyricsOptimizer) {
            throw new ArgumentError('minimax music vocal generation requires --lyrics, or prompt with --lyrics-optimizer');
        }
        if (aigcWatermark && regionKey !== 'cn') {
            throw new ArgumentError('minimax music --aigc-watermark is only supported with --region cn');
        }
        if (kwargs.op != null && outputFormat !== 'hex') {
            throw new ArgumentError('minimax music --op requires --output-format hex');
        }
        const outputDir = outputFormat === 'hex' ? resolveOutputDir(kwargs.op) : null;
        if (!execute) throw new ArgumentError('Refusing to spend MiniMax quota without --execute');

        const region = MUSIC_REGIONS[regionKey];
        const apiKey = requireApiKey();
        const reservation = outputFormat === 'hex' ? reserveAudioFile(outputDir, model, audioFormat) : null;
        let committed = false;
        try {
            const payload = await generateMusic(region, apiKey, buildRequest({
                model, prompt, lyrics, outputFormat, audioFormat, sampleRate, bitrate,
                instrumental, lyricsOptimizer, aigcWatermark,
            }), timeoutSeconds);
            const completed = parseCompletedMusic(payload, region);
            let audioUrl = null;
            let file = null;
            if (outputFormat === 'url') {
                audioUrl = requireAudioUrl(completed.audio);
            } else {
                file = commitAudioFile(reservation, decodeAudioHex(completed.audio, completed.expectedBytes, audioFormat));
                committed = true;
            }
            return [{
                status: 'completed',
                model,
                region: regionKey,
                output_format: outputFormat,
                audio_format: audioFormat,
                audio_url: audioUrl,
                file,
                expires_in_hours: outputFormat === 'url' ? 24 : null,
            }];
        } finally {
            if (reservation && !committed) cleanupAudioFile(reservation);
        }
    },
});
