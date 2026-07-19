// Shared helpers for the tiktok-symphony adapters (Symphony Creative Studio).
import { ArgumentError, TimeoutError } from '@jackwener/opencli/errors';

export const HOST = 'ads.tiktok.com';

export const CREATE_URL =
    'https://ads.tiktok.com/creative/creativestudio/image-to-video?subApp=CreativeStudio/ImageGeneration/I2VImageGeneration';

export const LIBRARY_URL = 'https://ads.tiktok.com/creative/creativestudio/create/history';

/** The two image models the Image tab exposes. Order matters for help text. */
export const IMAGE_MODELS = ['Nano Banana', 'Flux Kontext Max'];

/** Number of output images one Image generation produces. */
export const OUTPUTS_PER_GENERATION = 4;

/** Reference images the composer accepts. Enforced by the site, mirrored here. */
export const MAX_REFERENCE_IMAGES = 4;

/**
 * Validate a positive integer arg without silently flooring or clamping it.
 * Out-of-range input is a caller mistake, not something to quietly fix up.
 */
export function normalizePositiveInteger(value, defaultValue, label = 'value', { min = 1 } = {}) {
    const raw = value ?? defaultValue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) throw new ArgumentError(`${label} must be a positive integer`);
    if (n < min) throw new ArgumentError(`${label} must be >= ${min}`);
    return n;
}

/** Positive integer with an explicit ceiling. */
export function normalizeLimit(value, defaultValue, maxValue, label = 'limit') {
    const n = normalizePositiveInteger(value, defaultValue, label);
    if (n > maxValue) throw new ArgumentError(`${label} must be <= ${maxValue}`);
    return n;
}

/**
 * Map user input onto a canonical model name, case- and spacing-insensitively.
 * Rejects anything else rather than falling back to the default, so a typo
 * cannot silently bill a generation to the wrong model.
 */
export function resolveModel(value, defaultValue = IMAGE_MODELS[0]) {
    const raw = String(value ?? defaultValue).trim();
    const key = raw.toLowerCase().replace(/[\s_-]+/g, '');
    const hit = IMAGE_MODELS.find((m) => m.toLowerCase().replace(/[\s_-]+/g, '') === key);
    if (!hit) throw new ArgumentError(`Unknown model "${raw}". Valid: ${IMAGE_MODELS.join(' / ')}`);
    return hit;
}

/**
 * Generated assets live at .../ad-creative-sg/<assetId>~tplv-<template>.<ext>.
 * The DOM carries no real generation id, so this path segment is the only
 * stable handle we can hand back to the user for `download`.
 */
export function assetIdFromUrl(url) {
    const m = /\/ad-creative-sg\/([A-Za-z0-9]+)~/.exec(String(url || ''));
    return m ? m[1] : null;
}

/** True for a CDN URL that is a finished generation output (not a reference thumb). */
export function isOutputAssetUrl(url) {
    return /ad-site-sign-sg\.tiktokcdn\.com\/ad-creative-sg\//.test(String(url || ''));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll a page-context expression until it returns something non-null.
 *
 * The Symphony UI is a client-rendered SPA: `navigateBefore` resolves as soon
 * as the document loads, well before the `ks-*` header and composer hydrate.
 * Every read here has to tolerate that gap rather than assume the DOM is ready.
 *
 * @returns the first non-null value the expression produced
 * @throws {TimeoutError} when the deadline passes without one
 */
export async function waitForValue(page, js, { timeoutMs = 20000, intervalMs = 500, label = 'page state' } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    for (;;) {
        last = await page.evaluate(js);
        if (last !== null && last !== undefined && last !== false) return last;
        if (Date.now() >= deadline) throw new TimeoutError(label, Math.round(timeoutMs / 1000));
        await sleep(intervalMs);
    }
}

/**
 * Page-context source for a deep querySelectorAll that descends into shadow
 * roots. The Symphony UI is built from `ks-*` web components, so nearly every
 * control we need is behind at least one shadow boundary.
 *
 * Shipped as a string because `page.evaluate` callbacks cannot close over
 * Node-side scope; each evaluate injects this and calls it.
 */
export const DEEP_QUERY_SRC = `
function __deepAll(root, test) {
    const out = [];
    const walk = (node) => {
        for (const el of node.querySelectorAll('*')) {
            if (test(el)) out.push(el);
            if (el.shadowRoot) walk(el.shadowRoot);
        }
    };
    walk(root || document);
    return out;
}
function __ksTag(el, prefix) {
    // ks-* elements carry a version suffix (ks-button-1-1-1m). Match the
    // prefix only, or a version bump silently breaks every selector.
    return el.tagName.toLowerCase().startsWith(prefix);
}
function __ownText(el) {
    return [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .join('');
}
`;
