import { describe, expect, it } from 'vitest';

import { ArgumentError } from '@jackwener/opencli/errors';
import { extractRedditMedia, parseRedditHomeLimit } from './home.js';

describe('reddit home command', () => {
    it('parseRedditHomeLimit accepts [1,100] and rejects out-of-range / non-integer without silent clamp', () => {
        expect(parseRedditHomeLimit(undefined)).toBe(25);
        expect(parseRedditHomeLimit(null)).toBe(25);
        expect(parseRedditHomeLimit('')).toBe(25);
        expect(parseRedditHomeLimit(1)).toBe(1);
        expect(parseRedditHomeLimit(25)).toBe(25);
        expect(parseRedditHomeLimit(100)).toBe(100);

        for (const bad of [0, -1, 101, 1.5, NaN, 'abc']) {
            expect(() => parseRedditHomeLimit(bad)).toThrow(ArgumentError);
        }
    });

    it('extractRedditMedia tolerates missing media without throwing', () => {
        expect(extractRedditMedia({ is_self: true })).toEqual({
            post_hint: '',
            url_overridden_by_dest: '',
            preview_image_url: '',
            gallery_urls: [],
        });
    });

});
