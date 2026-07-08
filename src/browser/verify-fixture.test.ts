import { describe, expect, it } from 'vitest';
import { deriveFixture, expandFixtureArgs, parseSeedArgs, validateRows, validateRowShape, type Fixture } from './verify-fixture.js';

describe('validateRows', () => {
    it('passes when rows meet all expectations', () => {
        const fixture: Fixture = {
            expect: {
                rowCount: { min: 1, max: 3 },
                columns: ['id', 'title', 'url'],
                types: { id: 'number', title: 'string', url: 'string' },
                patterns: { url: '^https://' },
                notEmpty: ['title', 'url'],
            },
        };
        const rows = [
            { id: 1, title: 'a', url: 'https://x.com/a' },
            { id: 2, title: 'b', url: 'https://x.com/b' },
        ];
        expect(validateRows(rows, fixture)).toEqual([]);
    });

    it('reports rowCount below min', () => {
        const failures = validateRows([], { expect: { rowCount: { min: 1 } } });
        expect(failures).toHaveLength(1);
        expect(failures[0]).toMatchObject({ rule: 'rowCount' });
        expect(failures[0].detail).toContain('at least 1');
    });

    it('reports rowCount above max', () => {
        const failures = validateRows(
            [{}, {}, {}, {}],
            { expect: { rowCount: { max: 3 } } },
        );
        expect(failures).toHaveLength(1);
        expect(failures[0].detail).toContain('at most 3');
    });

    it('reports missing columns per row', () => {
        const failures = validateRows(
            [{ a: 1 }, { a: 2, b: 3 }],
            { expect: { columns: ['a', 'b'] } },
        );
        // row 0 missing 'b', row 1 complete
        expect(failures).toEqual([
            { rule: 'column', detail: 'missing column "b"', rowIndex: 0 },
        ]);
    });

    it('reports type mismatch including null', () => {
        const failures = validateRows(
            [{ a: 'abc' }, { a: null }, { a: 42 }],
            { expect: { types: { a: 'string' } } },
        );
        // row 0 string ok, row 1 null fail, row 2 number fail
        expect(failures).toHaveLength(2);
        expect(failures[0].rowIndex).toBe(1);
        expect(failures[0].detail).toContain('null');
        expect(failures[1].rowIndex).toBe(2);
        expect(failures[1].detail).toContain('number');
    });

    it('accepts union types like "number|string"', () => {
        const failures = validateRows(
            [{ id: 1 }, { id: 'abc' }],
            { expect: { types: { id: 'number|string' } } },
        );
        expect(failures).toEqual([]);
    });

    it('accepts "any" as wildcard type', () => {
        const failures = validateRows(
            [{ v: 1 }, { v: 'x' }, { v: null }, { v: [1, 2] }],
            { expect: { types: { v: 'any' } } },
        );
        expect(failures).toEqual([]);
    });

    it('reports pattern mismatch with row index and truncated value', () => {
        const failures = validateRows(
            [{ url: 'https://ok.com' }, { url: 'not-a-url' }],
            { expect: { patterns: { url: '^https?://' } } },
        );
        expect(failures).toHaveLength(1);
        expect(failures[0]).toMatchObject({ rule: 'pattern', rowIndex: 1 });
        expect(failures[0].detail).toContain('not-a-url');
    });

    it('skips pattern check for null/undefined values', () => {
        const failures = validateRows(
            [{ url: null }, { url: undefined }],
            { expect: { patterns: { url: '^x' } } },
        );
        expect(failures).toEqual([]);
    });

    it('reports invalid regex without crashing', () => {
        const failures = validateRows(
            [{ a: 'x' }],
            { expect: { patterns: { a: '[unclosed' } } },
        );
        expect(failures.some((f) => f.rule === 'pattern' && f.detail.includes('invalid'))).toBe(true);
    });

    it('treats empty/whitespace/null as failing notEmpty', () => {
        const failures = validateRows(
            [{ t: '' }, { t: '   ' }, { t: null }, { t: 'ok' }],
            { expect: { notEmpty: ['t'] } },
        );
        expect(failures).toHaveLength(3);
        expect(failures.map((f) => f.rowIndex)).toEqual([0, 1, 2]);
    });

    it('no failures when fixture has no expect block', () => {
        expect(validateRows([{ anything: 1 }], {})).toEqual([]);
    });

    it('mustNotContain flags substring bleed in columns', () => {
        const failures = validateRows(
            [
                { description: 'Lead engineer, 5 years exp. address: Shanghai. category: IT' },
                { description: 'Clean text.' },
            ],
            {
                expect: {
                    mustNotContain: { description: ['address:', 'category:'] },
                },
            },
        );
        expect(failures).toHaveLength(2);
        expect(failures.every((f) => f.rule === 'mustNotContain')).toBe(true);
        expect(failures.every((f) => f.rowIndex === 0)).toBe(true);
    });

    it('mustNotContain skips null/undefined values', () => {
        const failures = validateRows(
            [{ description: null }, { description: undefined }],
            { expect: { mustNotContain: { description: ['x'] } } },
        );
        expect(failures).toEqual([]);
    });

    it('mustBeTruthy catches silent 0 / false / "" fallbacks', () => {
        const failures = validateRows(
            [{ count: 10 }, { count: 0 }, { count: false }, { count: '' }, { count: null }],
            { expect: { mustBeTruthy: ['count'] } },
        );
        expect(failures).toHaveLength(4);
        expect(failures.every((f) => f.rule === 'mustBeTruthy')).toBe(true);
        expect(failures.map((f) => f.rowIndex)).toEqual([1, 2, 3, 4]);
    });
});

describe('validateRowShape', () => {
    it('passes flat rows with a compact key set', () => {
        const failures = validateRowShape([
            { id: '1', title: 'A', author: { name: 'Ada' }, tags: ['ai', 'web'] },
        ]);
        expect(failures).toEqual([]);
    });

    it('reports rows with too many top-level keys', () => {
        const row = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`k${i}`, i]));
        const failures = validateRowShape([row]);
        expect(failures).toEqual([
            {
                rule: 'shapeKeyCount',
                detail: 'row has 13 top-level keys, expected at most 12',
                rowIndex: 0,
            },
        ]);
    });

    it('reports nesting deeper than one level', () => {
        const failures = validateRowShape([
            { title: 'A', stats: { author: { name: 'Ada' } } },
        ]);
        expect(failures).toEqual([
            {
                rule: 'shapeDepth',
                detail: '"stats" nesting depth is 2, expected at most 1',
                rowIndex: 0,
            },
        ]);
    });

    it('reports nested id-shaped fields even when one-level nesting is otherwise allowed', () => {
        const failures = validateRowShape([
            { title: 'A', author: { user_id: 'u1', name: 'Ada' } },
        ]);
        expect(failures).toEqual([
            {
                rule: 'shapeNestedId',
                detail: 'id-shaped field "author.user_id" must be a top-level row key',
                rowIndex: 0,
            },
        ]);
    });
});

describe('deriveFixture', () => {
    it('returns rowCount.min=0 when rows are empty', () => {
        expect(deriveFixture([])).toEqual({ expect: { rowCount: { min: 0 } } });
    });

    it('extracts columns from first row and infers types per column', () => {
        const fixture = deriveFixture([
            { id: 1, title: 'a', url: 'https://x' },
            { id: 2, title: 'b', url: 'https://y' },
        ]);
        expect(fixture.expect?.columns).toEqual(['id', 'title', 'url']);
        expect(fixture.expect?.types).toEqual({
            id: 'number',
            title: 'string',
            url: 'string',
        });
        expect(fixture.expect?.rowCount).toEqual({ min: 1 });
    });

    it('unions mixed types across rows as "a|b"', () => {
        const fixture = deriveFixture([
            { v: 1 },
            { v: 'two' },
            { v: null },
        ]);
        expect(fixture.expect?.types?.v).toBe('null|number|string');
    });

    it('embeds args when provided', () => {
        const fixture = deriveFixture([{ x: 1 }], { limit: 5 });
        expect(fixture.args).toEqual({ limit: 5 });
    });

    it('embeds positional argv array when provided', () => {
        const fixture = deriveFixture([{ x: 1 }], ['123', '--limit', '3']);
        expect(fixture.args).toEqual(['123', '--limit', '3']);
    });

    it('does not add patterns or notEmpty automatically', () => {
        const fixture = deriveFixture([{ a: 'x' }]);
        expect(fixture.expect?.patterns).toBeUndefined();
        expect(fixture.expect?.notEmpty).toBeUndefined();
    });
});

describe('expandFixtureArgs', () => {
    it('returns [] for undefined', () => {
        expect(expandFixtureArgs(undefined)).toEqual([]);
    });

    it('expands object form as --key value pairs', () => {
        expect(expandFixtureArgs({ limit: 3, sort: 'hot' })).toEqual(['--limit', '3', '--sort', 'hot']);
    });

    it('passes array form verbatim, stringifying values', () => {
        expect(expandFixtureArgs(['123456', '--limit', 3])).toEqual(['123456', '--limit', '3']);
    });

    it('handles empty object and empty array', () => {
        expect(expandFixtureArgs({})).toEqual([]);
        expect(expandFixtureArgs([])).toEqual([]);
    });

    it('preserves positional + flag mix (e.g. <tid> --limit 3)', () => {
        expect(expandFixtureArgs(['https://example.com/thread-1', '--comments', '5'])).toEqual([
            'https://example.com/thread-1',
            '--comments',
            '5',
        ]);
    });
});

describe('parseSeedArgs', () => {
    it('treats plain text as one positional arg', () => {
        expect(parseSeedArgs('opencli-verify')).toEqual(['opencli-verify']);
    });

    it('accepts JSON array seed args', () => {
        expect(parseSeedArgs('["subject", "--limit", 3]')).toEqual(['subject', '--limit', 3]);
    });

    it('accepts JSON object seed args', () => {
        expect(parseSeedArgs('{"limit":3,"sort":"hot"}')).toEqual({ limit: 3, sort: 'hot' });
    });

    it('ignores empty input', () => {
        expect(parseSeedArgs(undefined)).toBeUndefined();
        expect(parseSeedArgs('   ')).toBeUndefined();
    });
});
