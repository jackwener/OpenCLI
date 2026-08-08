// tiktok-symphony generate — create images from a prompt plus reference images.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import {
    CARD_QUERY_SRC,
    CREATE_URL,
    DEEP_QUERY_SRC,
    DROP_ZONE_SELECTOR,
    HOST,
    IMAGE_MODELS,
    MAX_REFERENCE_IMAGES,
    OUTPUTS_PER_GENERATION,
    REF_COUNT_SRC,
    attachReference,
    normalizePositiveInteger,
    readReferenceImages,
    readStable,
    resolveModel,
    selectFooterOption,
    submitComposer,
    typePrompt,
    waitForValue,
} from './utils.js';

/** Every rendered output asset id anywhere on the page. */
const PAGE_ASSETS_SRC = `(() => {
    ${DEEP_QUERY_SRC}
    const ids = [];
    for (const img of __deepAll(document, (el) => el.tagName === 'IMG')) {
        const m = /\\/ad-creative-sg\\/([A-Za-z0-9]+)~/.exec(img.src || '');
        if (m && !ids.includes(m[1])) ids.push(m[1]);
    }
    return ids.sort();
})()`;

/** The finished outputs of one generation card, newest card first. */
function cardAssetsSrc(prompt) {
    return `(() => {
        ${CARD_QUERY_SRC}
        const card = __cardFor(${JSON.stringify(prompt)});
        if (!card) return null;
        const out = [];
        for (const img of __deepAll(card, (el) => el.tagName === 'IMG')) {
            const m = /\\/ad-creative-sg\\/([A-Za-z0-9]+)~/.exec(img.src || '');
            if (m && img.naturalWidth > 0 && !out.some((a) => a.assetId === m[1])) {
                out.push({ assetId: m[1], url: img.src });
            }
        }
        return out;
    })()`;
}

cli({
    site: 'tiktok-symphony',
    name: 'generate',
    description: 'Generate images from a prompt and up to 4 reference images (spends Symphony credits)',
    access: 'write',
    example: 'opencli tiktok-symphony generate "turn this into 3D chibi style" --refs ./cat.png',
    domain: HOST,
    strategy: Strategy.UI,
    browser: true,
    navigateBefore: false,
    defaultWindowMode: 'foreground',
    args: [
        { name: 'prompt', type: 'string', required: true, positional: true, help: 'What to generate' },
        { name: 'refs', type: 'string', default: '', help: `Comma-separated reference image paths (max ${MAX_REFERENCE_IMAGES})` },
        { name: 'model', type: 'string', default: IMAGE_MODELS[0], help: `Model: ${IMAGE_MODELS.join(' / ')}` },
        { name: 'timeout', type: 'int', default: 300, help: 'Seconds to wait for rendering' },
    ],
    columns: ['index', 'assetId', 'url', 'model', 'prompt'],
    func: async (page, args) => {
        const prompt = String(args.prompt ?? '').trim();
        if (!prompt) throw new ArgumentError('prompt is required and cannot be blank');

        const model = resolveModel(args.model);
        const timeoutSec = normalizePositiveInteger(args.timeout, 300, 'timeout', { min: 30 });
        const references = await readReferenceImages(args.refs, MAX_REFERENCE_IMAGES);

        // Always land on a freshly loaded composer: submitting does not clear
        // the prompt or references, so a reused tab would silently resend them.
        await page.goto(CREATE_URL, { waitUntil: 'load' });
        await waitForValue(page, `(() => !!document.querySelector('${DROP_ZONE_SELECTOR}') || null)()`, {
            label: 'Symphony composer',
            timeoutMs: 30000,
        });

        await selectImageTab(page);

        const staleRefs = await page.evaluate(REF_COUNT_SRC);
        if (staleRefs) {
            throw new CommandExecutionError(
                `composer still holds ${staleRefs} reference image(s) after reload — refusing to generate with unknown inputs`,
            );
        }

        for (const [i, ref] of references.entries()) {
            await attachReference(page, ref, i);
        }

        await selectFooterOption(page, { allowed: IMAGE_MODELS, target: model, label: 'model' });
        await typePrompt(page, prompt);

        // Let the feed finish streaming in before snapshotting: assets that
        // arrive late would otherwise look like they came from this run.
        const before = await readStable(page, PAGE_ASSETS_SRC);
        const known = new Set(Array.isArray(before) ? before : []);

        await submitComposer(page);

        const fresh = await waitForOutputs(page, prompt, known, timeoutSec);

        return fresh.slice(0, OUTPUTS_PER_GENERATION).map((asset, i) => ({
            index: i + 1,
            assetId: asset.assetId,
            url: asset.url,
            model,
            prompt,
        }));
    },
});

/** Switch the composer to the Image tab, then prove we landed there. */
async function selectImageTab(page) {
    await page.evaluate(`(() => {
        ${DEEP_QUERY_SRC}
        const topbar = document.querySelector('[data-chatbox-part=topbar]');
        if (!topbar) return null;
        const tabs = __deepAll(topbar, (el) => el.getAttribute('role') === 'tab');
        if (!tabs.length) return null;
        // Prefer the labelled tab; fall back to position so a translated UI
        // still works (Video is first, Image second).
        const byText = tabs.find((t) => /image|hình|图片|画像/i.test(t.textContent || ''));
        const target = byText || tabs[1] || tabs[0];
        if (target && target.getAttribute('aria-selected') !== 'true') target.click();
        return true;
    })()`);

    // The Image tab is the only one offering these models — use that as proof.
    const model = await waitForValue(page, `(() => {
        ${DEEP_QUERY_SRC}
        const footer = document.querySelector('[data-chatbox-part=footer]');
        if (!footer) return null;
        for (const dd of __deepAll(footer, (el) => __ksTag(el, 'ks-dropdown-menu'))) {
            const btn = __deepAll(dd, (el) => __ksTag(el, 'ks-button'))[0];
            const label = btn ? __ownText(btn) : '';
            if (label) return label;
        }
        return null;
    })()`, { label: 'Image tab model selector', timeoutMs: 20000 });

    if (!IMAGE_MODELS.includes(model)) {
        throw new CommandExecutionError(
            `composer is not on the Image tab (model selector reads "${model}") — the tab layout may have changed`,
        );
    }
}

/**
 * Wait for the generation to finish.
 *
 * There is no spinner or status class to bind to: outputs simply appear inside
 * the card one at a time, so completion means "the card holds N rendered
 * assets".
 */
async function waitForOutputs(page, prompt, known, timeoutSec) {
    const deadline = Date.now() + timeoutSec * 1000;
    const src = cardAssetsSrc(prompt);
    let best = [];

    for (;;) {
        const assets = await page.evaluate(src);
        const fresh = (Array.isArray(assets) ? assets : []).filter((a) => !known.has(a.assetId));
        if (fresh.length > best.length) best = fresh;
        if (best.length >= OUTPUTS_PER_GENERATION) break;
        if (Date.now() >= deadline) {
            if (best.length === 0) throw new TimeoutError('image generation', timeoutSec);
            break; // partial render — return what actually finished
        }
        await new Promise((r) => setTimeout(r, 3000));
    }

    // One settling read: a card caught mid-swap can briefly show a recycled src.
    const settled = await readStable(page, src, { tries: 4, intervalMs: 1500 });
    const confirmed = (Array.isArray(settled) ? settled : []).filter((a) => !known.has(a.assetId));
    return confirmed.length >= best.length ? confirmed : best;
}
