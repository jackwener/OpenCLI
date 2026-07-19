// tiktok-symphony generate — create images from a prompt plus reference images.
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
    TimeoutError,
} from '@jackwener/opencli/errors';
import {
    CREATE_URL,
    DEEP_QUERY_SRC,
    HOST,
    IMAGE_MODELS,
    MAX_REFERENCE_IMAGES,
    OUTPUTS_PER_GENERATION,
    normalizePositiveInteger,
    resolveModel,
    waitForValue,
} from './utils.js';

const PROMPT_SELECTOR = '[data-chatbox-part=textarea] .ProseMirror';
const DROP_ZONE_SELECTOR = 'fieldset[aria-label="File drop zone"]';
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;

const MIME_BY_EXT = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.avif': 'image/avif',
};

/** Count reference thumbnails currently attached to the composer. */
const REF_COUNT_SRC = `(() => {
    ${DEEP_QUERY_SRC}
    const header = document.querySelector('[data-chatbox-part=header]');
    if (!header) return null;
    // Static chrome (logo, page art) also lives here; uploaded references are
    // object URLs or land on the creative-tool upload host.
    return [...header.querySelectorAll('img')].filter((img) => {
        const s = img.src || '';
        return s.startsWith('blob:') || s.startsWith('data:')
            || /ibyteimg\\.com|creative-tool/.test(s);
    }).length;
})()`;

/** Every finished output asset id currently rendered in the Create feed. */
const FEED_ASSETS_SRC = `(() => {
    ${DEEP_QUERY_SRC}
    const ids = [];
    for (const img of __deepAll(document, (el) => el.tagName === 'IMG')) {
        const m = /\\/ad-creative-sg\\/([A-Za-z0-9]+)~/.exec(img.src || '');
        if (m && img.naturalWidth > 0 && !ids.includes(m[1])) ids.push(m[1]);
    }
    return ids;
})()`;

/** Current model shown on the footer dropdown button. */
const CURRENT_MODEL_SRC = `(() => {
    ${DEEP_QUERY_SRC}
    const footer = document.querySelector('[data-chatbox-part=footer]');
    if (!footer) return null;
    const dd = __deepAll(footer, (el) => __ksTag(el, 'ks-dropdown-menu'))[0];
    if (!dd) return null;
    const btn = __deepAll(dd, (el) => __ksTag(el, 'ks-button'))[0];
    // Read the button's own text: the menu is kept in the DOM, so the
    // dropdown's textContent would contain every model name at once.
    return btn ? __ownText(btn) : null;
})()`;

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

        const refPaths = String(args.refs ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        if (refPaths.length > MAX_REFERENCE_IMAGES) {
            throw new ArgumentError(`refs accepts at most ${MAX_REFERENCE_IMAGES} images, got ${refPaths.length}`);
        }

        // Read every reference up front so a bad path fails before we touch the UI.
        const references = [];
        for (const path of refPaths) {
            let buf;
            try {
                buf = await readFile(path);
            } catch (error) {
                throw new ArgumentError(`cannot read reference image "${path}": ${error?.message || error}`);
            }
            if (buf.length === 0) throw new ArgumentError(`reference image "${path}" is empty`);
            if (buf.length > MAX_REFERENCE_BYTES) {
                throw new ArgumentError(`reference image "${path}" is larger than ${MAX_REFERENCE_BYTES} bytes`);
            }
            const ext = extname(path).toLowerCase();
            const type = MIME_BY_EXT[ext];
            if (!type) {
                throw new ArgumentError(`unsupported reference image type "${ext || path}" (use ${Object.keys(MIME_BY_EXT).join(' / ')})`);
            }
            references.push({ name: basename(path), type, b64: buf.toString('base64') });
        }

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

        await selectModel(page, model);

        await page.typeText(PROMPT_SELECTOR, prompt);
        const typed = await page.evaluate(`(() => {
            const pm = document.querySelector('${PROMPT_SELECTOR}');
            return pm ? pm.textContent : null;
        })()`);
        if (!typed || !typed.includes(prompt.slice(0, 20))) {
            throw new CommandExecutionError('prompt did not register in the composer editor');
        }

        const before = await page.evaluate(FEED_ASSETS_SRC);
        const known = new Set(Array.isArray(before) ? before : []);

        await submit(page);

        const fresh = await waitForOutputs(page, known, timeoutSec);

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
    const model = await waitForValue(page, CURRENT_MODEL_SRC, { label: 'Image tab model selector', timeoutMs: 20000 });
    if (!IMAGE_MODELS.includes(model)) {
        throw new CommandExecutionError(
            `composer is not on the Image tab (model selector reads "${model}") — the tab layout may have changed`,
        );
    }
}

/**
 * Attach one reference image.
 *
 * The page exposes no file input and CDP file injection is refused, so the
 * supported path is the composer's own drop zone: build the File inside the
 * page and dispatch a real drop.
 */
async function attachReference(page, ref, index) {
    const dropped = await page.evaluate((b64, name, type, selector) => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const file = new File([bytes], name, { type });
        const dt = new DataTransfer();
        dt.items.add(file);
        const zone = document.querySelector(selector);
        if (!zone) return false;
        for (const kind of ['dragenter', 'dragover', 'drop']) {
            zone.dispatchEvent(new DragEvent(kind, { bubbles: true, cancelable: true, dataTransfer: dt }));
        }
        return true;
    }, ref.b64, ref.name, ref.type, DROP_ZONE_SELECTOR);

    if (!dropped) throw new CommandExecutionError(`could not find the composer drop zone for "${ref.name}"`);

    const want = index + 1;
    try {
        await waitForValue(page, `(() => {
            const n = ${REF_COUNT_SRC};
            return n >= ${want} ? n : null;
        })()`, { label: `reference upload "${ref.name}"`, timeoutMs: 60000, intervalMs: 700 });
    } catch (error) {
        if (error instanceof TimeoutError) {
            throw new CommandExecutionError(`reference image "${ref.name}" did not attach to the composer`);
        }
        throw error;
    }
}

/** Pick a model from the footer dropdown and confirm the button label changed. */
async function selectModel(page, model) {
    const current = await page.evaluate(CURRENT_MODEL_SRC);
    if (current === model) return;

    await page.evaluate(`(() => {
        ${DEEP_QUERY_SRC}
        const footer = document.querySelector('[data-chatbox-part=footer]');
        const dd = __deepAll(footer, (el) => __ksTag(el, 'ks-dropdown-menu'))[0];
        if (!dd) return null;
        const btn = __deepAll(dd, (el) => __ksTag(el, 'ks-button'))[0];
        if (!btn) return null;
        const real = (btn.shadowRoot && btn.shadowRoot.querySelector('button')) || btn;
        real.click();
        return true;
    })()`);

    await page.evaluate(`(() => {
        ${DEEP_QUERY_SRC}
        // Options render as ks-text; the dropdown button is a ks-button, so
        // matching on tag keeps us from clicking the trigger again.
        const opt = __deepAll(document, (el) => __ksTag(el, 'ks-text') && __ownText(el) === ${JSON.stringify(model)})[0];
        if (!opt) return null;
        opt.click();
        return true;
    })()`);

    const now = await waitForValue(page, `(() => {
        const m = ${CURRENT_MODEL_SRC};
        return m === ${JSON.stringify(model)} ? m : null;
    })()`, { label: `model switch to ${model}`, timeoutMs: 15000 }).catch(() => null);

    if (now !== model) {
        throw new CommandExecutionError(`could not switch the model to "${model}"`);
    }
}

/** Click the composer's send button once it is enabled. */
async function submit(page) {
    const clicked = await waitForValue(page, `(() => {
        ${DEEP_QUERY_SRC}
        const footer = document.querySelector('[data-chatbox-part=footer]');
        if (!footer) return null;
        const btn = __deepAll(footer, (el) => __ksTag(el, 'ks-icon-button')
            && __deepAll(el, (x) => __ksTag(x, 'ks-icon-arrow-up')).length > 0)[0];
        if (!btn) return null;
        const real = (btn.shadowRoot && btn.shadowRoot.querySelector('button')) || btn;
        if (real.disabled || btn.hasAttribute('disabled')) return null;
        real.click();
        return true;
    })()`, { label: 'send button', timeoutMs: 20000 }).catch(() => null);

    if (!clicked) {
        throw new CommandExecutionError('the send button never became enabled — the composer may have rejected the input');
    }
}

/**
 * Wait for the generation to finish.
 *
 * There is no spinner or status class to bind to: outputs simply appear in the
 * feed one at a time, so completion means "N new rendered assets".
 */
async function waitForOutputs(page, known, timeoutSec) {
    const deadline = Date.now() + timeoutSec * 1000;
    let best = [];

    for (;;) {
        const ids = await page.evaluate(FEED_ASSETS_SRC);
        const fresh = (Array.isArray(ids) ? ids : []).filter((id) => !known.has(id));
        if (fresh.length > best.length) best = fresh;
        if (best.length >= OUTPUTS_PER_GENERATION) break;
        if (Date.now() >= deadline) {
            if (best.length === 0) {
                throw new TimeoutError('image generation', timeoutSec);
            }
            break; // partial render — return what actually finished
        }
        await new Promise((r) => setTimeout(r, 3000));
    }

    const urls = await page.evaluate(`(() => {
        ${DEEP_QUERY_SRC}
        const want = ${JSON.stringify(best)};
        const out = {};
        for (const img of __deepAll(document, (el) => el.tagName === 'IMG')) {
            const m = /\\/ad-creative-sg\\/([A-Za-z0-9]+)~/.exec(img.src || '');
            if (m && want.includes(m[1]) && !out[m[1]]) out[m[1]] = img.src;
        }
        return out;
    })()`);

    return best.map((assetId) => ({ assetId, url: (urls && urls[assetId]) || null }));
}
