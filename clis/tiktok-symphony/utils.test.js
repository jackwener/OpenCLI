import { describe, expect, it } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import {
    IMAGE_MODELS,
    assetIdFromUrl,
    isOutputAssetUrl,
    normalizeLimit,
    normalizePositiveInteger,
    resolveModel,
} from './utils.js';

describe('tiktok-symphony resolveModel', () => {
    it('accepts the canonical names', () => {
        for (const model of IMAGE_MODELS) {
            expect(resolveModel(model)).toBe(model);
        }
    });

    it('is forgiving about case, spacing and dashes', () => {
        expect(resolveModel('nano banana')).toBe('Nano Banana');
        expect(resolveModel('NANO-BANANA')).toBe('Nano Banana');
        expect(resolveModel('flux_kontext_max')).toBe('Flux Kontext Max');
        expect(resolveModel('  Flux Kontext Max  ')).toBe('Flux Kontext Max');
    });

    it('falls back to the default only when nothing was passed', () => {
        expect(resolveModel(undefined)).toBe(IMAGE_MODELS[0]);
        expect(resolveModel(null)).toBe(IMAGE_MODELS[0]);
    });

    it('rejects an unknown model instead of silently using the default', () => {
        // A typo must not quietly bill the generation to a different model.
        expect(() => resolveModel('Nano Bananna')).toThrow(ArgumentError);
        expect(() => resolveModel('dall-e')).toThrow(ArgumentError);
    });
});

describe('tiktok-symphony arg validation', () => {
    it('accepts in-range values', () => {
        expect(normalizePositiveInteger(5, 20, 'limit')).toBe(5);
        expect(normalizePositiveInteger(undefined, 20, 'limit')).toBe(20);
        expect(normalizeLimit(200, 20, 200, 'limit')).toBe(200);
    });

    it('rejects rather than clamps out-of-range input', () => {
        expect(() => normalizePositiveInteger(0, 20, 'limit')).toThrow(ArgumentError);
        expect(() => normalizePositiveInteger(-1, 20, 'limit')).toThrow(ArgumentError);
        expect(() => normalizePositiveInteger(1.5, 20, 'limit')).toThrow(ArgumentError);
        expect(() => normalizePositiveInteger('abc', 20, 'limit')).toThrow(ArgumentError);
        expect(() => normalizeLimit(201, 20, 200, 'limit')).toThrow(ArgumentError);
    });

    it('enforces an explicit minimum', () => {
        expect(() => normalizePositiveInteger(10, 300, 'timeout', { min: 30 })).toThrow(ArgumentError);
        expect(normalizePositiveInteger(30, 300, 'timeout', { min: 30 })).toBe(30);
    });
});

describe('tiktok-symphony asset identity', () => {
    const output = 'https://p16-ad-site-sign-sg.tiktokcdn.com/ad-creative-sg/202607195d0d6178542d3c58473ba815~tplv-d5opwmad15-origin.image?lk3s=f193193c';
    const reference = 'https://p19-creative-tool-sg.ibyteimg.com/tos-alisg-i-n2703mo9gi-sg/c34e306361494713b4d9703779bd292c~tplv-n270';

    it('extracts the id from an output asset URL', () => {
        expect(assetIdFromUrl(output)).toBe('202607195d0d6178542d3c58473ba815');
    });

    it('returns null when there is no asset id to read', () => {
        expect(assetIdFromUrl(reference)).toBeNull();
        expect(assetIdFromUrl('')).toBeNull();
        expect(assetIdFromUrl(undefined)).toBeNull();
    });

    it('separates generated outputs from uploaded reference thumbnails', () => {
        // Both are CDN images; only the first is something `download` can fetch.
        expect(isOutputAssetUrl(output)).toBe(true);
        expect(isOutputAssetUrl(reference)).toBe(false);
    });
});
