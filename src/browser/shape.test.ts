import { describe, expect, it } from 'vitest';
import { inferShape } from './shape.js';

describe('inferShape', () => {
    it('describes primitives at root', () => {
        expect(inferShape('hello')).toEqual({ $: 'string' });
        expect(inferShape(42)).toEqual({ $: 'number' });
        expect(inferShape(true)).toEqual({ $: 'boolean' });
        expect(inferShape(null)).toEqual({ $: 'null' });
    });

    it('summarizes long strings with their length', () => {
        const long = 'x'.repeat(200);
        expect(inferShape(long, { sampleStringLen: 80 })).toEqual({ $: 'string(len=200)' });
    });

    it('walks nested objects and emits dotted paths', () => {
        const shape = inferShape({ user: { id: 1, name: 'bob' } });
        expect(shape).toEqual({
            $: 'object',
            '$.user': 'object',
            '$.user.id': 'number',
            '$.user.name': 'string',
        });
    });

    it('quotes unsafe keys using bracket notation', () => {
        const shape = inferShape({ 'weird key': 1, '123bad': 2 });
        expect(shape['$["weird key"]']).toBe('number');
        expect(shape['$["123bad"]']).toBe('number');
    });

    it('samples the first array element and reports length', () => {
        const shape = inferShape({ items: [{ a: 1 }, { a: 2 }, { a: 3 }] });
        expect(shape['$.items']).toBe('array(3)');
        expect(shape['$.items[0]']).toBe('object');
        expect(shape['$.items[0].a']).toBe('number');
    });

    it('marks empty containers explicitly', () => {
        const shape = inferShape({ arr: [], obj: {} });
        expect(shape['$.arr']).toBe('array(0)');
        expect(shape['$.obj']).toBe('object(empty)');
    });

    it('collapses subtrees past maxDepth', () => {
        const deep = { a: { b: { c: { d: { e: { f: 'too deep' } } } } } };
        const shape = inferShape(deep, { maxDepth: 2 });
        expect(shape['$.a.b']).toMatch(/^object/);
        expect(shape['$.a.b.c']).toBeUndefined();
    });

    it('truncates when the byte budget is exhausted', () => {
        const wide: Record<string, unknown> = {};
        for (let i = 0; i < 500; i++) wide[`field_${i}`] = i;
        const shape = inferShape(wide, { maxBytes: 256 });
        expect(shape['(truncated)']).toMatch(/256B/);
        expect(Object.keys(shape).length).toBeLessThan(500);
    });

    it('stops descending into an array once the budget is hit by its own descriptor', () => {
        // Budget just large enough for `$` + one deep array descriptor, not its element.
        const shape = inferShape({ items: [{ deep: 1 }] }, { maxBytes: 40 });
        expect(shape['$.items[0]']).toBeUndefined();
        expect(shape['(truncated)']).toBeDefined();
    });

    it('handles the Twitter UserTweets payload envelope', () => {
        const payload = {
            data: {
                user: {
                    result: {
                        rest_id: '42',
                        timeline_v2: {
                            timeline: {
                                instructions: [
                                    { type: 'TimelinePinEntry', entries: [] },
                                    { entries: [{ entryId: 'tweet-1', content: { entryType: 'TimelineTimelineItem' } }] },
                                ],
                            },
                        },
                    },
                },
            },
        };
        const shape = inferShape(payload, { maxDepth: 10 });
        expect(shape['$.data.user.result.rest_id']).toBe('string');
        expect(shape['$.data.user.result.timeline_v2.timeline.instructions']).toBe('array(2)');
        expect(shape['$.data.user.result.timeline_v2.timeline.instructions[0]']).toBe('object');
    });
});
