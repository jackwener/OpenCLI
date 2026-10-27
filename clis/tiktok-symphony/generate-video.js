// tiktok-symphony generate-video — render a clip with the Video composer.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import {
    CARD_QUERY_SRC,
    COMPOSER_URL,
    DROP_ZONE_SELECTOR,
    HOST,
    REF_COUNT_SRC,
    VIDEO_DURATIONS,
    VIDEO_FRAME_MODES,
    VIDEO_MODELS,
    VIDEO_MODES,
    attachReference,
    normalizePositiveInteger,
    readReferenceImages,
    resolveVideoDuration,
    resolveVideoFrameMode,
    resolveVideoMode,
    resolveVideoModel,
    selectFooterOption,
    submitComposer,
    typePrompt,
    waitForValue,
} from './utils.js';

const DURATION_LABELS = VIDEO_DURATIONS.map((d) => `${d}s`);
const FRAME_LABELS = VIDEO_FRAME_MODES.map((f) => f.label);

/**
 * The clip rendered by one generation card.
 *
 * A finished card swaps its progress readout for a <video>. Note the playback
 * URL is NOT on the `ad-creative-sg` host that images use — it is served from
 * `v16-ad-creative.tiktokcdn-row.com/video/tos/...` and carries no assetId at
 * all. The only thing to exclude is the page's static demo clip, which sits
 * outside any card but is cheap to rule out by host.
 */
function cardStateSrc(prompt) {
    return `(() => {
        ${CARD_QUERY_SRC}
        const card = __cardFor(${JSON.stringify(prompt)});
        if (!card) return null;
        const state = __cardState(card);
        state.clip = null;
        for (const v of __deepAll(card, (el) => el.tagName === 'VIDEO')) {
            const src = v.src || v.currentSrc || '';
            if (src && !/lf-creative-factory/.test(src)) { state.clip = src; break; }
        }
        return state;
    })()`;
}

cli({
    site: 'tiktok-symphony',
    name: 'generate-video',
    aliases: ['video'],
    description: 'Generate a video clip from a prompt and optional reference images (spends Symphony credits)',
    access: 'write',
    example: 'opencli tiktok-symphony generate-video "a duck floating on a pool, slow zoom out" --duration 5',
    domain: HOST,
    strategy: Strategy.UI,
    browser: true,
    navigateBefore: false,
    defaultWindowMode: 'foreground',
    args: [
        { name: 'prompt', type: 'string', required: true, positional: true, help: 'What to generate' },
        {
            name: 'mode',
            type: 'string',
            default: 'auto',
            help: `Sub-app: ${VIDEO_MODES.map((m) => m.key).join(' / ')}. "auto" picks text with no refs, image with 1, reference with 2+`,
        },
        { name: 'refs', type: 'string', default: '', help: 'Comma-separated reference image paths (image: 1-2, reference: 1-4)' },
        { name: 'frames', type: 'string', default: 'first', help: `Image mode only: ${VIDEO_FRAME_MODES.map((f) => f.key).join(' / ')}` },
        { name: 'model', type: 'string', default: VIDEO_MODELS[0], help: `Model: ${VIDEO_MODELS.join(' / ')}` },
        { name: 'duration', type: 'string', default: '5', help: `Clip length: ${DURATION_LABELS.join(' / ')}` },
        { name: 'timeout', type: 'int', default: 5400, help: 'Seconds to wait when --wait true (rendering has been observed to exceed an hour)' },
        {
            name: 'wait',
            type: 'boolean',
            default: false,
            help: 'Block until the clip renders. Off by default: rendering runs for tens of minutes, so the job is submitted and `generations` picks it up later',
        },
    ],
    columns: ['index', 'status', 'assetId', 'url', 'mode', 'model', 'duration', 'prompt'],
    func: async (page, args) => {
        const prompt = String(args.prompt ?? '').trim();
        if (!prompt) throw new ArgumentError('prompt is required and cannot be blank');

        const model = resolveVideoModel(args.model);
        const duration = resolveVideoDuration(args.duration);
        const timeoutSec = normalizePositiveInteger(args.timeout, 5400, 'timeout', { min: 60 });

        const refPaths = String(args.refs ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        const mode = String(args.mode ?? 'auto').trim().toLowerCase() === 'auto'
            ? autoMode(refPaths.length)
            : resolveVideoMode(args.mode);

        const frameMode = resolveVideoFrameMode(args.frames);
        const maxRefs = mode.key === 'image' ? frameMode.refs : mode.maxRefs;

        if (refPaths.length < mode.minRefs) {
            throw new ArgumentError(`mode "${mode.key}" needs at least ${mode.minRefs} reference image(s) — pass --refs`);
        }
        if (mode.key === 'text' && refPaths.length > 0) {
            throw new ArgumentError('mode "text" takes no reference images — use --mode image or --mode reference');
        }
        if (mode.key !== 'image' && frameMode.key !== VIDEO_FRAME_MODES[0].key) {
            // Only the Image sub-app renders this dropdown; accepting the flag
            // elsewhere would silently drop it.
            throw new ArgumentError(`--frames only applies to --mode image, not "${mode.key}"`);
        }
        if (mode.key === 'image' && frameMode.key === 'first-last' && refPaths.length !== 2) {
            throw new ArgumentError('--frames first-last needs exactly 2 reference images (start and end frame)');
        }

        const references = await readReferenceImages(args.refs, maxRefs);

        // Land on the sub-app URL directly: each Video mode is its own `subApp`,
        // so navigating there beats clicking the mode dropdown, and a fresh load
        // is required anyway because submitting never clears the composer.
        await page.goto(`${COMPOSER_URL}?subApp=${mode.subApp}`, { waitUntil: 'load' });
        await waitForValue(page, `(() => !!document.querySelector('${DROP_ZONE_SELECTOR}') || null)()`, {
            label: 'Symphony composer',
            timeoutMs: 30000,
        });

        // The model dropdown only carries these names on the Video tab, so its
        // presence doubles as proof the right sub-app hydrated.
        await selectFooterOption(page, { allowed: VIDEO_MODELS, target: model, label: 'model' });

        const staleRefs = await page.evaluate(REF_COUNT_SRC);
        if (staleRefs) {
            throw new CommandExecutionError(
                `composer still holds ${staleRefs} reference image(s) after reload — refusing to generate with unknown inputs`,
            );
        }

        if (mode.key === 'image') {
            await selectFooterOption(page, { allowed: FRAME_LABELS, target: frameMode.label, label: 'frames' });
        }

        for (const [i, ref] of references.entries()) {
            await attachReference(page, ref, i);
        }

        await selectFooterOption(page, { allowed: DURATION_LABELS, target: duration.label, label: 'duration' });
        await typePrompt(page, prompt);
        await submitComposer(page);

        const stateSrc = cardStateSrc(prompt);

        // A card carrying a progress readout is the site acknowledging the job;
        // without it we would report success for a request that never started.
        const started = await waitForValue(page, `(() => {
            const s = ${stateSrc};
            return s && (s.cardProgress !== null || s.cardErrorCode || s.clip) ? s : null;
        })()`, { label: 'generation to start', timeoutMs: 120000, intervalMs: 2000 });
        rejectIfFailed(started);

        const row = {
            index: 1,
            status: 'generating',
            assetId: null,
            url: null,
            mode: mode.key,
            model,
            duration: duration.label,
            prompt,
        };

        if (!args.wait) return [row];

        const url = await waitForClip(page, stateSrc, timeoutSec);
        return [{ ...row, status: 'ready', assetId: assetIdFromVideoUrl(url), url }];
    },
});

/** Pick the sub-app that matches how many references the caller supplied. */
function autoMode(refCount) {
    if (refCount === 0) return resolveVideoMode('text');
    if (refCount === 1) return resolveVideoMode('image');
    return resolveVideoMode('reference');
}

/**
 * Wait for the clip to finish.
 *
 * Rendering is slow (tens of minutes) and the card exposes a percentage that
 * stalls near the end, so the only trustworthy completion signal is a new
 * <video> mounting in the feed.
 */
async function waitForClip(page, stateSrc, timeoutSec) {
    const deadline = Date.now() + timeoutSec * 1000;

    for (;;) {
        const state = await page.evaluate(stateSrc);

        // The feed keeps only a handful of cards: a burst of other generations
        // can push ours out while we wait, and silently polling a card that no
        // longer exists would look identical to "still rendering".
        if (!state) {
            throw new CommandExecutionError(
                'the generation card left the Create feed before the clip appeared — check `opencli tiktok-symphony jobs`',
            );
        }
        rejectIfFailed(state);
        if (state.clip) return state.clip;

        if (Date.now() >= deadline) throw new TimeoutError('video generation', timeoutSec);
        await new Promise((r) => setTimeout(r, 10000));
    }
}

/**
 * Surface a rejected render as a failure.
 *
 * Moderation refusals arrive as ordinary card text, not a dialog or an HTTP
 * error, so nothing else stops the command from reporting a clip that will
 * never exist. The credits are spent either way.
 */
function rejectIfFailed(state) {
    if (!state?.errorCode) return;
    const detail = state.cardErrorText || 'the site rejected this generation';
    const task = state.cardTaskId ? ` (task ${state.cardTaskId})` : '';
    throw new CommandExecutionError(`generation rejected [${state.cardErrorCode}]${task}: ${detail}`);
}

/** Clip URLs carry the same `/ad-creative-sg/<assetId>~...` handle as images. */
function assetIdFromVideoUrl(url) {
    const m = /\/ad-creative-sg\/([A-Za-z0-9]+)[~/?]/.exec(String(url || ''));
    return m ? m[1] : null;
}
