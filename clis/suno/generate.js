/**
 * `opencli suno generate` — submit a Suno music-generation request, wait for
 * both clips to finish, and download selected formats locally.
 *
 * Targets the /api/generate/v2-web/ endpoint (cookie auth). Each generation
 * returns 2 candidate clips by design — both are downloaded so the caller
 * can A/B them.
 *
 * Modes:
 *   - Custom (when --lyrics is provided): API receives prompt(lyrics)+tags
 *     +title+negative_tags. Use this for professional control over lyrics,
 *     structure metatags, style, and exclusions.
 *   - Simple (default): API receives a description in `prompt`; Suno picks
 *     the lyrics, tags, and title.
 *
 * Creative knobs (--weirdness / --style-weight) map directly to the
 * `metadata.control_sliders` the web UI exposes.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
    DEFAULT_SUNO_MODEL,
    SUNO_DOMAIN,
    SUNO_MODELS,
    SUNO_URL,
    checkSunoCaptcha,
    clampSlider,
    downloadSunoClip,
    ensureSunoSession,
    normalizeBooleanFlag,
    parseFormats,
    pollSunoClips,
    requirePositiveInt,
    resolveSunoOutputDir,
    submitSunoGeneration,
} from './utils.js';

import * as crypto from 'node:crypto';
import * as os from 'node:os';

function displayPath(filePath) {
    if (!filePath) return '-';
    const home = os.homedir();
    return filePath.startsWith(home) ? `~${filePath.slice(home.length)}` : filePath;
}

export const generateCommand = cli({
    site: 'suno',
    name: 'generate',
    access: 'write',
    description: 'Generate music with Suno (V5.5 chirp-fenix by default) and download clips locally',
    domain: SUNO_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    defaultFormat: 'plain',
    args: [
        { name: 'prompt', positional: true, required: false, help: 'Simple-mode description (ignored when --lyrics is provided)' },
        { name: 'lyrics', help: 'Custom-mode lyrics (with [Verse]/[Chorus] metatags). Triggers Custom mode.' },
        { name: 'tags', help: 'Custom-mode style tags (genre, BPM, instruments...). Used with --lyrics.' },
        { name: 'negative-tags', help: 'Custom-mode style exclusions (e.g. "no vocals, no autotune"). Used with --lyrics.' },
        { name: 'title', help: 'Song title (default: auto-derived from prompt)' },
        { name: 'instrumental', type: 'boolean', default: false, help: 'No vocals' },
        { name: 'model', help: `Model id: ${SUNO_MODELS.join(', ')}. Default: ${DEFAULT_SUNO_MODEL}` },
        { name: 'weirdness', help: 'Creative weirdness slider (0..1). Default: 0.5' },
        { name: 'style-weight', help: 'Style adherence slider (0..1). Default: 0.5' },
        { name: 'formats', help: 'Comma-separated download formats: mp3, m4a, wav, video, cover, metadata. Default: mp3,metadata' },
        { name: 'op', help: 'Output directory (default: ~/Music/suno)' },
        { name: 'timeout', type: 'int', default: 300, help: 'Max seconds to wait for clips to finish (default: 300)' },
        { name: 'sd', type: 'boolean', default: false, help: 'Skip download; only print clip ids and Suno URLs' },
        { name: 'confirm-paid', type: 'boolean', default: false, help: 'Required to allow paid downloads (wav). Without it, paid formats are skipped with a warning.' },
    ],
    columns: ['status', 'clip', 'title', 'files', 'link'],
    func: async (page, kwargs) => {
        const lyrics = kwargs.lyrics ? String(kwargs.lyrics) : '';
        const tags = kwargs.tags ? String(kwargs.tags) : '';
        const negativeTags = kwargs['negative-tags'] ? String(kwargs['negative-tags']) : '';
        const description = kwargs.prompt ? String(kwargs.prompt) : '';
        const titleArg = kwargs.title ? String(kwargs.title) : '';
        const model = kwargs.model ? String(kwargs.model).trim() : DEFAULT_SUNO_MODEL;
        if (!SUNO_MODELS.includes(model)) {
            throw new ArgumentError(`Unsupported --model "${model}"`, `Choices: ${SUNO_MODELS.join(', ')}`);
        }

        const isCustom = lyrics.trim() !== '';
        if (!isCustom && !description.trim()) {
            throw new ArgumentError(
                'Either provide a Simple-mode prompt as the positional argument, or pass --lyrics for Custom mode.',
                'Examples:\n  opencli suno generate "lo-fi study beat, 80 bpm"\n  opencli suno generate --lyrics "[Verse]\\n..." --tags "synthwave, 120 bpm"',
            );
        }
        if (!isCustom && (tags || negativeTags)) {
            throw new ArgumentError('--tags and --negative-tags only apply in Custom mode (alongside --lyrics).');
        }

        const requestedFormats = parseFormats(kwargs.formats);
        const confirmPaid = normalizeBooleanFlag(kwargs['confirm-paid']);
        const skipDownload = normalizeBooleanFlag(kwargs.sd);
        const PAID_FORMATS = new Set(['wav']);
        const skippedPaid = [];
        const formats = requestedFormats.filter(f => {
            if (PAID_FORMATS.has(f) && !confirmPaid) {
                skippedPaid.push(f);
                return false;
            }
            return true;
        });
        if (!skipDownload && !formats.length) {
            throw new ArgumentError('All requested formats require --confirm-paid true', 'Add --confirm-paid true or include a free format such as mp3 or metadata.');
        }
        const outputDir = resolveSunoOutputDir(kwargs.op);
        const timeout = requirePositiveInt(kwargs.timeout, '--timeout');
        const makeInstrumental = normalizeBooleanFlag(kwargs.instrumental);
        const weirdness = clampSlider(kwargs.weirdness, '--weirdness', 0.5);
        const styleWeight = clampSlider(kwargs['style-weight'], '--style-weight', 0.5);

        // Title: required by API. Auto-derive from first 60 chars of source prompt if not provided.
        const titleSource = titleArg || (isCustom ? (tags || lyrics.split('\n')[0]) : description);
        const title = titleSource.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Untitled';

        const session = await ensureSunoSession(page);
        if (!session.planId) {
            throw new CommandExecutionError(
                `Suno generation needs a resolved plan id for the user_tier field, but billing/info did not surface one for this account (subscription_type=${session.planKey}). Verify the account is active at ${SUNO_URL}/account, then retry.`,
            );
        }
        const deviceId = session.deviceId;
        const captcha = await checkSunoCaptcha(page, deviceId);
        if (!captcha?.ok) {
            throw new CommandExecutionError(
                `Suno captcha pre-flight failed${captcha?.status ? ` (HTTP ${captcha.status})` : ''}.`,
                `Open ${SUNO_URL}/create in Chrome and verify the account is ready, then retry.`,
            );
        }
        if (captcha?.required) {
            throw new CommandExecutionError(
                'Suno requires a CAPTCHA challenge for this account/IP right now.',
                `Open ${SUNO_URL}/create in Chrome, solve a Create challenge once, then retry.`,
            );
        }
        if (session.totalCreditsAvailable < 10) {
            const b = session.breakdown;
            throw new CommandExecutionError(
                `Suno generation needs ~10 credits; you have ${session.totalCreditsAvailable} (monthly ${b.monthlyRemaining}/${b.monthlyLimit} + packs ${b.purchasedPacks} + leftover ${b.pack}). Top up at ${SUNO_URL}/account.`,
            );
        }

        const transactionUuid = crypto.randomUUID();
        const createSessionToken = crypto.randomUUID();

        const submission = await submitSunoGeneration(page, {
            mode: isCustom ? 'custom' : 'simple',
            model,
            title,
            lyrics,
            tags,
            negativeTags,
            description,
            makeInstrumental,
            weirdness,
            styleWeight,
            userTier: session.planId,
            createSessionToken,
            transactionUuid,
            deviceId,
        });

        if (!Array.isArray(submission.clips)) {
            throw new CommandExecutionError('Suno generation returned malformed clips payload.');
        }
        const clipIds = submission.clips.map(c => c?.id);
        if (clipIds.some(id => !id)) {
            throw new CommandExecutionError('Suno generation returned malformed clip identity.');
        }
        if (!clipIds.length) {
            throw new CommandExecutionError('Suno accepted the request but returned no clip ids.');
        }

        const clips = await pollSunoClips(page, clipIds, timeout, deviceId);
        const completed = clips.filter(c => c.status === 'complete');
        if (!completed.length) {
            const errors = clips.map(c => `${c.id.slice(0, 8)}:${c.status}`).join(', ');
            throw new CommandExecutionError(`All Suno clips failed (${errors}). Open ${SUNO_URL}/song/${clipIds[0]} to inspect.`);
        }

        const rows = [];
        for (const clip of clips) {
            const link = `${SUNO_URL}/song/${clip.id}`;
            if (clip.status !== 'complete') {
                rows.push({
                    status: `❌ ${clip.status}`,
                    clip: clip.id.slice(0, 8),
                    title: clip.title || '(untitled)',
                    files: '-',
                    link: `🔗 ${link}`,
                });
                continue;
            }
            if (skipDownload) {
                rows.push({
                    status: '🎵 generated',
                    clip: clip.id.slice(0, 8),
                    title: clip.title || '(untitled)',
                    files: '📁 -',
                    link: `🔗 ${link}`,
                });
                continue;
            }
            const result = await downloadSunoClip(page, clip, outputDir, formats, deviceId);
            if (!result.written.some(w => w.ok)) {
                throw new CommandExecutionError(`Suno download wrote no files for clip ${clip.id}`);
            }
            const writtenSummary = result.written
                .map(w => w.ok ? `${w.format}:${displayPath(w.file)}` : `${w.format}:✗(${w.reason})`)
                .join(' | ');
            const skippedSummary = skippedPaid.length
                ? ` | skipped(needs --confirm-paid):${skippedPaid.join(',')}`
                : '';
            const anyFailed = result.written.some(w => !w.ok);
            rows.push({
                status: anyFailed ? '⚠ partial' : '✅ saved',
                clip: clip.id.slice(0, 8),
                title: clip.title || '(untitled)',
                files: `📁 ${writtenSummary}${skippedSummary}`,
                link: `🔗 ${link}`,
            });
        }
        return rows;
    },
});
