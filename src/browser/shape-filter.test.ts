import { describe, expect, it } from 'vitest';
import type { Shape } from './shape.js';
import {
    collectShapeSegments,
    extractSegments,
    parseFilter,
    shapeMatchesFilter,
} from './shape-filter.js';

describe('parseFilter', () => {
    it('splits comma-separated fields, trims, and drops empty tokens', () => {
        const r = parseFilter('author, text , likes');
        expect(r).toEqual({ fields: ['author', 'text', 'likes'] });
    });

    it('dedupes while preserving first-seen order', () => {
        const r = parseFilter('a,b,a,c,b');
        expect(r).toEqual({ fields: ['a', 'b', 'c'] });
    });

    it('rejects empty string as invalid_filter', () => {
        const r = parseFilter('');
        expect(r).toMatchObject({ reason: expect.stringContaining('non-empty') });
    });

    it('rejects whitespace-only as invalid_filter', () => {
        const r = parseFilter('   ');
        expect(r).toMatchObject({ reason: expect.stringContaining('non-empty') });
    });

    it('rejects commas-only as invalid_filter', () => {
        const r = parseFilter(',,,');
        expect(r).toMatchObject({ reason: expect.stringContaining('non-empty') });
    });

    it('accepts a single field', () => {
        expect(parseFilter('author')).toEqual({ fields: ['author'] });
    });
});

describe('extractSegments', () => {
    it('returns empty for root', () => {
        expect(extractSegments('$')).toEqual([]);
    });

    it('splits dotted path and drops $', () => {
        expect(extractSegments('$.data.user.name')).toEqual(['data', 'user', 'name']);
    });

    it('drops numeric array indices', () => {
        expect(extractSegments('$.items[0].author')).toEqual(['items', 'author']);
        expect(extractSegments('$.rows[0][12]')).toEqual(['rows']);
    });

    it('unwraps bracket-quoted keys', () => {
        expect(extractSegments('$.data["weird key"]')).toEqual(['data', 'weird key']);
    });

    it('handles bracket-quoted keys at root', () => {
        expect(extractSegments('$["123bad"]')).toEqual(['123bad']);
    });

    it('mixes bracket keys and dot segments', () => {
        expect(extractSegments('$.data.user["nick name"].age'))
            .toEqual(['data', 'user', 'nick name', 'age']);
    });
});

describe('collectShapeSegments', () => {
    it('collects every segment name from every path in a shape', () => {
        const shape: Shape = {
            '$': 'object',
            '$.data': 'object',
            '$.data.items': 'array(3)',
            '$.data.items[0]': 'object',
            '$.data.items[0].author': 'string',
            '$.data.items[0].text': 'string',
        };
        const segs = collectShapeSegments(shape);
        expect(segs.has('data')).toBe(true);
        expect(segs.has('items')).toBe(true);
        expect(segs.has('author')).toBe(true);
        expect(segs.has('text')).toBe(true);
        expect(segs.has('$')).toBe(false);
        expect(segs.has('[0]')).toBe(false);
    });

    it('returns an empty set for an empty shape', () => {
        expect(collectShapeSegments({}).size).toBe(0);
    });
});

describe('shapeMatchesFilter', () => {
    const shape: Shape = {
        '$': 'object',
        '$.data': 'object',
        '$.data.items': 'array(1)',
        '$.data.items[0].author': 'string',
        '$.data.items[0].text': 'string',
        '$.data.items[0].likes': 'number',
    };

    it('returns true when every field matches some path segment (AND)', () => {
        expect(shapeMatchesFilter(shape, ['author', 'text', 'likes'])).toBe(true);
    });

    it('matches nested container names, not just leaves (any-segment rule)', () => {
        // `data` and `items` are container segments, not leaves; still must match.
        expect(shapeMatchesFilter(shape, ['data', 'items'])).toBe(true);
    });

    it('returns false when any field is missing', () => {
        expect(shapeMatchesFilter(shape, ['author', 'missing'])).toBe(false);
    });

    it('is case-sensitive', () => {
        expect(shapeMatchesFilter(shape, ['Author'])).toBe(false);
        expect(shapeMatchesFilter(shape, ['author'])).toBe(true);
    });

    it('empty filter list vacuously matches', () => {
        expect(shapeMatchesFilter(shape, [])).toBe(true);
    });

    it('rejects requests whose shape has no body (empty shape)', () => {
        expect(shapeMatchesFilter({}, ['author'])).toBe(false);
    });
});
