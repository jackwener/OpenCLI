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
    STUDIO_API,
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
    sunoHeadersJs,
    unwrapEvaluateResult,
} from './utils.js';

import * as crypto from 'node:crypto';
import * as os from 'node:os';

function displayPath(filePath) {
    if (!filePath) return '-';
    const home = os.homedir();
    return filePath.startsWith(home) ? `~${filePath.slice(home.length)}` : filePath;
}

// Strategy: UI_SELECTOR (visible-ui), with response capture for clip identity.
// Suno's /api/c/check can return required=true while its own Create page
// completes verification without a human challenge. Do not replay or fabricate
// verification tokens: click Create once and let the site's runtime submit.
// Unsupported controls fail before submission rather than silently changing
// the request. The site's runtime owns any verification token.
const SIMPLE_PROMPT = 'textarea[rows="1"]:not([data-cowrite-input])';
const LYRICS = '[aria-label="Lyrics editor"][contenteditable="true"]';
const STYLES = '[data-testid="create-form-styles-wrapper"] textarea';
const NEGATIVE = 'input[placeholder="Exclude styles"]';
const CREATE = 'button[aria-label="Create song"]';
const GENERATE_URL = 'https://studio-api-prod.suno.com/api/generate/v2-web/';
const CLIP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function nativeFailure(message, cause) {
    const failure = new CommandExecutionError(message);
    // The runtime follows cause to retain a write lease for unknown outcomes.
    failure.cause = cause;
    return failure;
}

async function clickSunoControl(page, selector) {
    const clicked = await page.evaluate(`(() => {
        const controls = document.querySelectorAll(${JSON.stringify(selector)});
        if (controls.length !== 1 || controls[0].disabled) return false;
        controls[0].click();
        return true;
    })()`);
    if (!clicked) throw new CommandExecutionError('Suno form control is missing or disabled; no generation was submitted.');
}

export async function dispatchSunoCreateOnce(page, invocationId) {
    if (!CLIP_ID.test(invocationId || '')) throw new CommandExecutionError('Suno Create needs a unique invocation id; no generation was submitted.');
    // Page.evaluate may re-execute after target navigation. sessionStorage
    // survives same-tab reloads, so an invocation can dispatch at most once.
    // This is only a local duplicate-write guard, never a Suno verification token.
    return page.evaluate(`(() => {
        if (location.origin !== ${JSON.stringify(SUNO_URL)}) return {status: 'not_dispatched'};
        const key = ${JSON.stringify('opencli:suno:create:' + invocationId)};
        try { if (sessionStorage.getItem(key)) return {status: 'already_dispatched'}; }
        catch { return {status: 'storage_unavailable'}; }
        const buttons = document.querySelectorAll(${JSON.stringify(CREATE)});
        if (buttons.length !== 1) return {status: 'not_dispatched'};
        const button = buttons[0];
        if (button.disabled || getComputedStyle(button).visibility === 'hidden') return {status: 'not_dispatched'};
        button.scrollIntoView({block: 'center', inline: 'center'});
        const r = button.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return {status: 'not_dispatched'};
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const hit = document.elementFromPoint(x, y);
        if (!hit || !(hit === button || button.contains(hit))) return {status: 'not_dispatched'};
        try {
            sessionStorage.setItem(key, 'dispatched');
            if (sessionStorage.getItem(key) !== 'dispatched') return {status: 'storage_unavailable'};
        }
        catch { return {status: 'storage_unavailable'}; }
        button.click();
        return {status: 'dispatched'};
    })()`);
}

async function nativeState(page) {
    return page.evaluate(`(() => {
        const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
        return {
            simple: document.querySelector('button[role="tab"][aria-label="Simple"]')?.getAttribute('aria-selected') === 'true',
            advanced: document.querySelector('button[role="tab"][aria-label="Advanced"]')?.getAttribute('aria-selected') === 'true',
            prompt: document.querySelector(${JSON.stringify(SIMPLE_PROMPT)})?.value,
            lyrics: document.querySelector(${JSON.stringify(LYRICS)})?.innerText.trim(),
            styles: document.querySelector(${JSON.stringify(STYLES)})?.value,
            negative: document.querySelector(${JSON.stringify(NEGATIVE)})?.value,
            weirdness: parseInt(document.querySelector('[role="slider"][aria-label="Weirdness"]')?.getAttribute('aria-valuenow'), 10),
            styleWeight: parseInt(document.querySelector('[role="slider"][aria-label="Style Influence"]')?.getAttribute('aria-valuenow'), 10),
            models: Array.from(document.querySelectorAll('button[aria-haspopup="menu"]')).filter(e => visible(e) && /^v[0-9]/.test(e.innerText.trim())).map(e => e.innerText.trim()),
            clear: document.querySelector('button[aria-label="Clear all form inputs"]')?.disabled === false,
            enabled: document.querySelector(${JSON.stringify(CREATE)})?.disabled === false,
            ids: Array.from(document.querySelectorAll('[data-testid="clip-row"] a[href^="/song/"]')).map(e => e.getAttribute('href').split('/').pop()),
            manualChallenge: Array.from(document.querySelectorAll('iframe')).some(e => {
                const r = e.getBoundingClientRect();
                return visible(e) && r.width > 30 && r.height > 30 &&
                    ['challenges.cloudflare.com', 'hcaptcha.com', 'recaptcha'].some(host => e.src.includes(host));
            }),
        };
    })()`);
}

async function selectNativeModel(page, name) {
    const state = await nativeState(page);
    if (state.models.length !== 1) throw new CommandExecutionError('Suno model picker changed; no generation was submitted.');
    if (state.models[0] === name) return;
    const opened = await page.evaluate(`(() => {
        const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
        const buttons = Array.from(document.querySelectorAll('button[aria-haspopup="menu"]')).filter(e => visible(e) && /^v[0-9]/.test(e.innerText.trim()));
        if (buttons.length !== 1 || buttons[0].disabled) return false;
        buttons[0].click(); return true;
    })()`);
    if (!opened) throw new CommandExecutionError('Suno model picker is unavailable; no generation was submitted.');
    await page.wait(0.2);
    const selected = await page.evaluate(`(() => {
        const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
        const items = Array.from(document.querySelectorAll('[role="menuitemradio"]')).filter(e =>
            visible(e) && e.innerText.trim().split(String.fromCharCode(10))[0] === ${JSON.stringify(name)});
        if (items.length !== 1) return false;
        items[0].click(); return true;
    })()`);
    if (!selected) throw new CommandExecutionError(`Suno model ${name} is unavailable in the Create menu; no generation was submitted.`);
    await page.wait(0.2);
    const verified = await nativeState(page);
    if (verified.models.length !== 1 || verified.models[0] !== name) throw new CommandExecutionError('Suno model selection did not read back; no generation was submitted.');
}

async function setNativeSlider(page, label, value) {
    const target = Math.round(value * 100);
    if (Math.abs(value * 100 - target) > 1e-6) throw new ArgumentError(`Suno Create sliders use 1% steps; ${label} cannot represent ${value} exactly. No generation was submitted.`);
    const selector = `[role="slider"][aria-label="${label}"]`;
    const focused = await page.evaluate(`(() => {
        const e = document.querySelector(${JSON.stringify(selector)});
        if (!e || e.getAttribute('aria-disabled') === 'true') return false;
        e.scrollIntoView({block:'center'});
        e.focus();
        return document.activeElement === e;
    })()`);
    if (!focused) throw new CommandExecutionError(`Suno ${label} slider is unavailable; no generation was submitted.`);
    for (let i = 0; i <= 100; i++) {
        const current = await page.evaluate(`parseInt(document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-valuenow'), 10)`);
        if (current === target) return;
        if (!Number.isInteger(current) || i === 100) break;
        await page.pressKey(current < target ? 'ArrowRight' : 'ArrowLeft');
    }
    throw new CommandExecutionError(`Suno ${label} slider did not read back ${target}%; no generation was submitted.`);
}

export async function prepareSunoNative(page, payload) {
    const advanced = payload.mode === 'custom' || payload.makeInstrumental;
    if (advanced && payload.mode === 'custom' && payload.makeInstrumental) throw new ArgumentError('Suno Advanced cannot combine nonempty lyrics with --instrumental; no generation was submitted.');
    if (advanced && (payload.mode === 'simple' ? payload.description : payload.tags).length > 1000) throw new ArgumentError('Suno Advanced styles allow at most 1000 characters; no generation was submitted.');
    if (payload.mode === 'simple' && payload.description.length > 3000) throw new ArgumentError('Suno Simple mode allows at most 3000 characters; no generation was submitted.');
    if (payload.mode === 'custom' && payload.lyrics.length > 5000) throw new ArgumentError('Suno Advanced lyrics allow at most 5000 characters; no generation was submitted.');
    if (payload.negativeTags.length > 1000) throw new ArgumentError('Suno Advanced exclusions allow at most 1000 characters; no generation was submitted.');
    await page.goto(`${SUNO_URL}/create`);
    await page.wait({ selector: 'button[role="tab"][aria-label="Simple"]', timeout: 30 });
    const tab = `button[role="tab"][aria-label="${advanced ? 'Advanced' : 'Simple'}"]`;
    // The Create page can restore its previous mode after the tabs first
    // appear. Use a native click and verify the selected tab before filling.
    let selectedMode = false;
    for (let attempt = 0; attempt < 3; attempt++) {
        await page.click(tab);
        await page.wait(0.3);
        const state = await nativeState(page);
        selectedMode = advanced ? state.advanced : state.simple;
        if (selectedMode) break;
    }
    if (!selectedMode) throw new CommandExecutionError('Suno Create mode did not stay selected; no generation was submitted.');
    await page.wait({ selector: advanced ? STYLES : SIMPLE_PROMPT, timeout: 10 });
    // Hidden Chrome tabs can leave Suno's lazy rows unpainted indefinitely.
    // A compositor capture flushes the real UI; discard it, do not save images.
    await page.screenshot({ format: 'jpeg', quality: 1 });
    const initial = await nativeState(page);
    if (initial.manualChallenge) throw new CommandExecutionError('Suno shows a human verification challenge. Complete it in the Create tab; no generation was submitted.');
    if (initial.clear) {
        await clickSunoControl(page, 'button[aria-label="Clear all form inputs"]');
        await page.wait(0.2);
        const confirmClear = await page.evaluate(`(() => {
            const dialogs = Array.from(document.querySelectorAll('[role="alertdialog"]')).filter(e => e.getClientRects().length);
            const d = dialogs.length === 1 ? dialogs[0] : null;
            return d?.querySelector('h2')?.textContent === 'Clear entire form?' &&
                d.querySelector('button.hxc-btn-variant-primary')?.textContent === 'Confirm';
        })()`);
        if (!confirmClear) throw new CommandExecutionError('Suno clear-form confirmation changed; no generation was submitted.');
        await clickSunoControl(page, '[role="alertdialog"] button.hxc-btn-variant-primary');
        await page.wait(0.3);
        const cleared = await nativeState(page);
        if (advanced ? (cleared.lyrics !== '' || cleared.styles !== '' || cleared.negative !== '') : cleared.prompt !== '') {
            throw new CommandExecutionError('Suno did not clear the previous form; no generation was submitted.');
        }
    }
    await selectNativeModel(page, payload.modelName);
    const styleText = payload.mode === 'custom' ? payload.tags : payload.description;
    if (advanced) {
        if (payload.lyrics && !(await page.fillText(LYRICS, payload.lyrics))?.verified) throw new CommandExecutionError('Suno lyrics did not read back correctly; no generation was submitted.');
        if (styleText && !(await page.fillText(STYLES, styleText))?.verified) throw new CommandExecutionError('Suno styles did not read back correctly; no generation was submitted.');
        if (payload.negativeTags && !(await page.fillText(NEGATIVE, payload.negativeTags))?.verified) throw new CommandExecutionError('Suno exclusions did not read back correctly; no generation was submitted.');
        await setNativeSlider(page, 'Weirdness', payload.weirdness);
        await setNativeSlider(page, 'Style Influence', payload.styleWeight);
    } else {
        const filled = await page.fillText(SIMPLE_PROMPT, payload.description);
        if (!filled?.verified) throw new CommandExecutionError('Suno description did not read back correctly; no generation was submitted.');
        if (payload.weirdness !== 0.5 || payload.styleWeight !== 0.5) throw new ArgumentError('Suno Simple Create has no slider controls; no generation was submitted.');
    }
    let final;
    for (let attempt = 0; attempt < 10; attempt++) {
        await page.wait(0.2);
        final = await nativeState(page);
        if (final.enabled) break;
    }
    const advancedMatches = final.advanced && final.lyrics === payload.lyrics.trim() && final.styles === styleText &&
        final.negative === payload.negativeTags && final.weirdness === Math.round(payload.weirdness * 100) &&
        final.styleWeight === Math.round(payload.styleWeight * 100);
    if (!(advanced ? advancedMatches : final.simple && final.prompt === payload.description) ||
        final.models.length !== 1 || final.models[0] !== payload.modelName || !final.enabled) {
        throw new CommandExecutionError('Suno native form read-back did not match the requested mode, inputs, sliders, or model; no generation was submitted.');
    }
    // DOM rows can remain placeholders indefinitely in a hidden tab. A feed
    // snapshot includes their ids, so later hydration cannot masquerade as a
    // newly created clip.
    const baseline = unwrapEvaluateResult(await page.evaluate(`(async () => {
        const res = await fetch('${STUDIO_API}/api/feed/v2?page=0', { headers: ${sunoHeadersJs(payload.deviceId)} });
        if (!res.ok) return { ok: false, status: res.status };
        const body = await res.json().catch(() => null);
        return { ok: Array.isArray(body?.clips), ids: body?.clips?.map(c => c?.id) };
    })()`));
    if (!baseline?.ok || !Array.isArray(baseline.ids) || baseline.ids.some(id => !CLIP_ID.test(id || ''))) {
        throw new CommandExecutionError('Suno could not establish a complete recent-clip baseline; no generation was submitted.');
    }
    return [...new Set([...final.ids, ...baseline.ids])];
}

export async function submitSunoNative(page, payload, timeout) {
    const previousIds = new Set(await prepareSunoNative(page, payload));
    if (typeof page.startNetworkCapture !== 'function' || !await page.startNetworkCapture('/api/generate/v2-web/')) {
        throw new CommandExecutionError('Suno native generation needs browser response capture; no generation was submitted. Update the OpenCLI browser extension.');
    }
    await page.readNetworkCapture(); // Drain old requests before the only click.
    let recovery = `Do not rerun generate automatically. Check ${SUNO_URL}/create or run opencli suno list, then download the existing clip ids.`;
    try {
        const dispatch = await dispatchSunoCreateOnce(page, payload.transactionUuid);
        if (!['dispatched', 'already_dispatched'].includes(dispatch?.status)) {
            throw new CommandExecutionError('Suno Create is missing, disabled, covered, or cannot store the duplicate-write guard; no generation was submitted.');
        }
        const deadline = Date.now() + timeout * 1000;
        // Wait for the site's new result rows before reading the network capture.
        let state;
        do {
            await page.wait(1);
            await page.screenshot({ format: 'jpeg', quality: 1 });
            state = await nativeState(page);
            if (state.manualChallenge) {
                throw new CommandExecutionError(`Suno needs human verification in the Create tab. Complete it there and check for results. ${recovery}`);
            }
            if (new Set(state.ids.filter(id => !previousIds.has(id))).size >= 2) break;
        } while (Date.now() < deadline);
        const candidateIds = [...new Set(state.ids.filter(id => !previousIds.has(id)))];
        if (candidateIds.length) recovery = `Candidate new clip ids: ${candidateIds.join(', ')}. ${recovery}`;
        // Older extensions drain an in-flight capture; allow the site's own
        // result transition to settle before the first read. Newer extensions
        // retain unfinished entries, so poll until their bodies are complete.
        await page.wait({ time: 1 });
        const captured = new Map();
        let legacyEntry = 0;
        const absorb = entries => {
            for (const entry of entries.filter(e => e?.url === GENERATE_URL && e.method === 'POST')) {
                const identity = typeof entry.requestId === 'string' && entry.requestId
                    ? `id:${entry.requestId}` : `legacy:${legacyEntry++}`;
                captured.set(identity, entry);
            }
        };
        const settled = entry => entry.captureComplete === true ||
            (!entry.requestId && entry.captureComplete === undefined && typeof entry.responsePreview === 'string');
        do {
            absorb(await page.readNetworkCapture({ retainIncomplete: true }));
            if ([...captured.values()].some(settled)) {
                // Catch a second page-owned POST arriving just after the first.
                await page.wait({ time: 2 });
                absorb(await page.readNetworkCapture({ retainIncomplete: true }));
                break;
            }
            await page.wait({ time: 0.5 });
        } while (Date.now() < deadline);
        const responses = [...captured.values()];
        if (responses.length !== 1) throw new CommandExecutionError(`Suno native submission outcome is uncertain (expected one generation response, received ${responses.length}). ${recovery}`);
        const response = responses[0];
        if (response.responseStatus !== 200 || response.responseBodyTruncated || typeof response.responsePreview !== 'string') {
            throw new CommandExecutionError(`Suno native submission response is unavailable or unsuccessful (HTTP ${response.responseStatus || 'unknown'}). ${recovery}`);
        }
        let submission;
        try { submission = JSON.parse(response.responsePreview); } catch {
            throw new CommandExecutionError(`Suno native submission returned invalid JSON. ${recovery}`);
        }
        const clips = submission?.clips;
        const advanced = payload.mode === 'custom' || payload.makeInstrumental;
        let request = null;
        if (!response.requestBodyTruncated && typeof response.requestBodyPreview === 'string') {
            try { request = JSON.parse(response.requestBodyPreview); } catch {}
        }
        const expectedPrompt = advanced ? payload.lyrics : '';
        const expectedTags = advanced ? (payload.mode === 'custom' ? payload.tags : payload.description) : '';
        const requestSliders = request?.metadata?.control_sliders;
        const slidersMatch = !requestSliders ||
            ((requestSliders.weirdness_constraint === undefined || Math.abs(requestSliders.weirdness_constraint - payload.weirdness) < 0.001) &&
            (requestSliders.style_weight === undefined || Math.abs(requestSliders.style_weight - payload.styleWeight) < 0.001));
        const noReferences = ['cover_clip_id', 'continue_clip_id', 'artist_clip_id', 'persona_id', 'user_uploaded_images_b64']
            .every(field => request?.[field] == null);
        const requestMatches = request?.mv === payload.model && request.generation_type === 'TEXT' &&
            request.metadata?.create_mode === (advanced ? 'custom' : 'simple') &&
            request.prompt === expectedPrompt &&
            (advanced || request.gpt_description_prompt === payload.description) &&
            (request.tags || '') === expectedTags && (request.negative_tags || '') === payload.negativeTags &&
            request.make_instrumental === payload.makeInstrumental && noReferences && slidersMatch;
        if (!requestMatches || !Array.isArray(clips) || clips.length !== 2 ||
            new Set(clips.map(c => c?.id)).size !== 2 || clips.some(c =>
                !CLIP_ID.test(c?.id || '') || previousIds.has(c.id) || !state.ids.includes(c.id))) {
            const audit = {
                requestBodyCaptured: request !== null,
                requestModel: request?.mv ?? null,
                requestInputMatches: request ? {
                    prompt: request.prompt === expectedPrompt,
                    description: advanced || request.gpt_description_prompt === payload.description,
                    tags: (request.tags || '') === expectedTags,
                    negative: (request.negative_tags || '') === payload.negativeTags,
                    instrumental: request.make_instrumental === payload.makeInstrumental,
                    mode: request.metadata?.create_mode === (advanced ? 'custom' : 'simple'),
                    plainText: request.generation_type === 'TEXT',
                    noReferences,
                    sliders: slidersMatch,
                } : null,
                newIdsVisible: Array.isArray(clips) ? clips.map(c => !!c?.id && !previousIds.has(c.id) && state.ids.includes(c.id)) : null,
            };
            throw new CommandExecutionError(`Suno native request/response did not match this invocation (${JSON.stringify(audit)}). ${recovery}`);
        }
        return submission;
    } catch (error) {
        if (error instanceof CommandExecutionError) throw error;
        // A transport/click error may occur after the site accepted the write.
        // Never fall back to an API POST or a second Create click here.
        throw nativeFailure(`Suno native submission outcome is uncertain. ${recovery}`, error);
    }
}

export async function renameSunoNativeClips(page, clips, title) {
    await page.screenshot({ format: 'jpeg', quality: 1 });
    for (const clip of clips) {
        if (!CLIP_ID.test(clip.id)) throw new CommandExecutionError('Invalid Suno clip identity for title edit.');
        const row = `[data-testid="clip-row"]:has(a[href="/song/${clip.id}"])`;
        const editor = '[data-testid="clip-row"] input[maxlength="80"]';
        try {
            await clickSunoControl(page, `${row} button[aria-label="Edit title"]`);
            const filled = await page.fillText(editor, title);
            if (!filled?.verified) throw new Error('title read-back');
            const submitted = await page.evaluate(`(() => {
                const inputs = document.querySelectorAll(${JSON.stringify(editor)});
                if (inputs.length !== 1) return false;
                inputs[0].dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', bubbles: true}));
                return true;
            })()`);
            if (!submitted) throw new Error('title editor unavailable');
            let saved = false;
            for (let attempt = 0; attempt < 10; attempt++) {
                await page.wait(0.5);
                saved = await page.evaluate(`(() => document.querySelector('a[href="/song/${clip.id}"]')?.textContent === ${JSON.stringify(title)})()`);
                if (saved) break;
            }
            if (!saved) throw new Error('title save');
            clip.title = title;
        } catch (error) {
            throw nativeFailure(`Suno generated ${clips.map(c => c.id).join(', ')} but could not verify title editing. Do not regenerate; inspect these clips at ${SUNO_URL}/create.`, error);
        }
    }
}

export const generateCommand = cli({
    site: 'suno',
    name: 'generate',
    access: 'write',
    description: 'Generate music with Suno v6, v6-wild, or v6-mini and download clips locally',
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
        { name: 'model', help: `Model: ${SUNO_MODELS.join(', ')}. Default: account default (usually ${DEFAULT_SUNO_MODEL})` },
        { name: 'weirdness', help: 'Creative weirdness slider (0..1). Default: 0.5' },
        { name: 'style-weight', help: 'Style adherence slider (0..1). Default: 0.5' },
        { name: 'formats', help: 'Comma-separated download formats: mp3, m4a, wav, video, cover, metadata. Default: mp3,metadata' },
        { name: 'op', help: 'Output directory (default: ~/Music/suno)' },
        { name: 'timeout', type: 'int', default: 300, help: 'Max seconds to wait for clips to finish (default: 300)' },
        { name: 'sd', type: 'boolean', default: false, help: 'Skip download; only print clip ids and Suno URLs' },
        { name: 'via-ui', type: 'boolean', default: false, help: 'Use Suno Create even when webpage verification is not required' },
        { name: 'confirm-paid', type: 'boolean', default: false, help: 'Required to allow paid downloads (wav). Without it, paid formats are skipped with a warning.' },
    ],
    columns: ['status', 'clip', 'title', 'files', 'link'],
    func: async (page, kwargs) => {
        const lyrics = kwargs.lyrics ? String(kwargs.lyrics) : '';
        const tags = kwargs.tags ? String(kwargs.tags) : '';
        const negativeTags = kwargs['negative-tags'] ? String(kwargs['negative-tags']) : '';
        const description = kwargs.prompt ? String(kwargs.prompt) : '';
        const titleArg = kwargs.title ? String(kwargs.title) : '';
        const requestedModel = kwargs.model ? String(kwargs.model).trim() : null;
        if (requestedModel && !SUNO_MODELS.includes(requestedModel)) {
            throw new ArgumentError(`Unsupported --model "${requestedModel}"`, `Choices: ${SUNO_MODELS.join(', ')}`);
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
            throw new ArgumentError('All requested formats require --confirm-paid true', 'Add --confirm-paid true or include a non-WAV format such as mp3 or metadata.');
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
        const availableModels = session.models?.filter(m => m.canUse && SUNO_MODELS.includes(m.name)) || [];
        const modelName = requestedModel || availableModels.find(m => m.isDefault)?.name || availableModels[0]?.name || DEFAULT_SUNO_MODEL;
        const availableModel = availableModels.find(m => m.name === modelName);
        if (!availableModel) throw new CommandExecutionError(`Suno model ${modelName} is unavailable for this account; no generation was submitted.`);
        if (!session.planId) {
            throw new CommandExecutionError(
                `Suno generation needs a resolved plan id for the user_tier field, but billing/info did not surface one for this account (subscription_type=${session.planKey}). Verify the account is active at ${SUNO_URL}/account, then retry.`,
            );
        }
        const deviceId = session.deviceId;
        const forceNative = normalizeBooleanFlag(kwargs['via-ui']);
        // A failed pre-flight is not proof that the official Create page cannot
        // complete verification. Never let it block an explicitly selected UI path.
        const captcha = forceNative ? null : await checkSunoCaptcha(page, deviceId).catch(() => null);
        if (session.totalCreditsAvailable < 10) {
            const b = session.breakdown;
            throw new CommandExecutionError(
                `Suno generation needs ~10 credits; you have ${session.totalCreditsAvailable} (monthly ${b.monthlyRemaining}/${b.monthlyLimit} + packs ${b.purchasedPacks} + leftover ${b.pack}). Top up at ${SUNO_URL}/account.`,
            );
        }

        const transactionUuid = crypto.randomUUID();
        const createSessionToken = crypto.randomUUID();

        const payload = {
            mode: isCustom ? 'custom' : 'simple',
            model: availableModel.externalKey,
            modelName,
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
        };
        const useNative = forceNative || captcha?.ok !== true || captcha.required === true;
        const submission = useNative
            ? await submitSunoNative(page, payload, timeout)
            : await submitSunoGeneration(page, payload);

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

        let clips;
        try {
            clips = await pollSunoClips(page, clipIds, timeout, deviceId);
        } catch (error) {
            if (!useNative) throw error;
            throw nativeFailure(`Suno submitted ${clipIds.join(', ')} but polling did not finish. Do not regenerate; inspect or download these existing ids.`, error);
        }
        const completed = clips.filter(c => c.status === 'complete');
        if (useNative && (weirdness !== 0.5 || styleWeight !== 0.5) && completed.some(c => {
            const sliders = c.metadata?.control_sliders;
            return !sliders || !Number.isFinite(sliders.weirdness_constraint) || !Number.isFinite(sliders.style_weight) ||
                Math.abs(sliders.weirdness_constraint - weirdness) >= 0.001 ||
                Math.abs(sliders.style_weight - styleWeight) >= 0.001;
        })) {
            throw new CommandExecutionError(`Suno generated ${clipIds.join(', ')} but the requested slider values were not confirmed by the feed. Do not regenerate; inspect these existing clips.`);
        }
        if (!completed.length) {
            const errors = clips.map(c => `${c.id.slice(0, 8)}:${c.status}`).join(', ');
            throw new CommandExecutionError(`All Suno clips failed (${errors}). Open ${SUNO_URL}/song/${clipIds[0]} to inspect.`);
        }

        if (useNative) {
            await renameSunoNativeClips(page, completed, title);
            const titledIds = completed.map(c => c.id);
            let verified = false;
            try {
                for (let attempt = 0; attempt < 5; attempt++) {
                    const persisted = await pollSunoClips(page, clipIds, timeout, deviceId);
                    if (clipIds.every(id => persisted.some(c => c.id === id)) && titledIds.every(id => persisted.find(c => c.id === id)?.title === title)) {
                        clips = persisted;
                        verified = true;
                        break;
                    }
                    await page.wait(1);
                }
            } catch (error) {
                throw nativeFailure(`Suno generated ${clipIds.join(', ')} but title persistence could not be checked. Do not regenerate; inspect these existing clips.`, error);
            }
            if (!verified) throw new CommandExecutionError(`Suno generated ${clipIds.join(', ')} but the server did not confirm the requested title. Do not regenerate; inspect these existing clips.`);
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
