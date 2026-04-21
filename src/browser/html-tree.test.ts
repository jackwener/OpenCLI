import { describe, expect, it } from 'vitest';
import { buildHtmlTreeJs, type BuildHtmlTreeJsOptions, type HtmlTreeResult } from './html-tree.js';

/**
 * The serializer runs in a page context via `page.evaluate`. In unit tests we
 * substitute `document` with a minimal stub that mirrors the DOM surface used
 * by the expression, then Function-eval the returned JS.
 */
function runTreeJs(
    root: unknown,
    selectorMatches: unknown[],
    selector: string | null,
    budgets: Omit<BuildHtmlTreeJsOptions, 'selector'> = {},
): HtmlTreeResult {
    const js = buildHtmlTreeJs({ selector, ...budgets });
    const fakeDocument = {
        querySelectorAll: () => selectorMatches,
        documentElement: root,
    };
    const fn = new Function('document', `return ${js};`);
    return fn(fakeDocument) as HtmlTreeResult;
}

function runTreeJsInvalid(selector: string, errorMessage: string): unknown {
    const js = buildHtmlTreeJs({ selector });
    const fakeDocument = {
        querySelectorAll: () => { const e = new Error(errorMessage); e.name = 'SyntaxError'; throw e; },
        documentElement: null,
    };
    const fn = new Function('document', `return ${js};`);
    return fn(fakeDocument);
}

function el(tag: string, attrs: Record<string, string>, children: Array<ChildOf>, extras: Partial<CompoundExtras> = {}): FakeEl {
    return {
        nodeType: 1,
        tagName: tag.toUpperCase(),
        attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
        childNodes: children,
        getAttribute: (name: string) => (name in attrs ? attrs[name]! : null),
        value: extras.value,
        multiple: extras.multiple,
        files: extras.files,
        options: extras.options,
    };
}

function txt(value: string): FakeText { return { nodeType: 3, nodeValue: value }; }

type CompoundExtras = {
    value: string;
    multiple: boolean;
    files: Array<{ name: string }>;
    options: Array<{ value: string; label?: string; text?: string; selected?: boolean; disabled?: boolean }>;
};
type FakeEl = {
    nodeType: 1;
    tagName: string;
    attributes: Array<{ name: string; value: string }>;
    childNodes: Array<ChildOf>;
    getAttribute: (name: string) => string | null;
    value?: string;
    multiple?: boolean;
    files?: Array<{ name: string }>;
    options?: Array<{ value: string; label?: string; text?: string; selected?: boolean; disabled?: boolean }>;
};
type FakeText = { nodeType: 3; nodeValue: string };
type ChildOf = FakeEl | FakeText;

describe('buildHtmlTreeJs', () => {
    it('serializes a simple element into {tag, attrs, text, children}', () => {
        const root = el('div', { class: 'hero', id: 'x' }, [txt('Hello')]);
        const result = runTreeJs(root, [root], null);
        expect(result.selector).toBeNull();
        expect(result.matched).toBe(1);
        expect(result.tree).toEqual({
            tag: 'div',
            attrs: { class: 'hero', id: 'x' },
            text: 'Hello',
            children: [],
        });
    });

    it('collapses whitespace in direct text content only', () => {
        const root = el('p', {}, [
            txt('  line  \n  one  '),
            el('span', {}, [txt('inner text')]),
            txt('\tline two\t'),
        ]);
        const result = runTreeJs(root, [root], null);
        expect(result.tree?.text).toBe('line one line two');
        expect(result.tree?.children[0].text).toBe('inner text');
    });

    it('recurses into element children and preserves their attrs', () => {
        const root = el('ul', { role: 'list' }, [
            el('li', { 'data-id': '1' }, [txt('first')]),
            el('li', { 'data-id': '2' }, [txt('second')]),
        ]);
        const result = runTreeJs(root, [root], null);
        expect(result.tree?.children).toHaveLength(2);
        expect(result.tree?.children[0]).toEqual({
            tag: 'li',
            attrs: { 'data-id': '1' },
            text: 'first',
            children: [],
        });
    });

    it('returns matched=N and serializes only the first match', () => {
        const first = el('article', { id: 'a' }, [txt('first')]);
        const second = el('article', { id: 'b' }, [txt('second')]);
        const result = runTreeJs(null, [first, second], 'article');
        expect(result.matched).toBe(2);
        expect(result.tree?.attrs.id).toBe('a');
    });

    it('returns tree=null and matched=0 when selector matches nothing', () => {
        const result = runTreeJs(null, [], '.nothing');
        expect(result.matched).toBe(0);
        expect(result.tree).toBeNull();
    });

    it('catches SyntaxError from querySelectorAll and returns {invalidSelector:true, reason}', () => {
        const result = runTreeJsInvalid('##$@@', "'##$@@' is not a valid selector") as {
            selector: string;
            invalidSelector: boolean;
            reason: string;
        };
        expect(result.invalidSelector).toBe(true);
        expect(result.selector).toBe('##$@@');
        expect(result.reason).toContain('not a valid selector');
    });

    it('omits `truncated` when no budget is hit', () => {
        const root = el('div', {}, [el('span', {}, [txt('ok')])]);
        const result = runTreeJs(root, [root], null, { depth: 5, childrenMax: 10, textMax: 100 });
        expect(result.truncated).toBeUndefined();
    });
});

describe('buildHtmlTreeJs budget knobs', () => {
    it('caps tree at `depth` and reports truncated.depth', () => {
        const deep = el('a', {}, [
            el('b', {}, [
                el('c', {}, [el('d', {}, [txt('deep')])]),
            ]),
        ]);
        // depth=1 → root + one level of children; grandchildren should be dropped.
        const result = runTreeJs(deep, [deep], null, { depth: 1 });
        expect(result.tree?.tag).toBe('a');
        expect(result.tree?.children).toHaveLength(1);
        expect(result.tree?.children[0].tag).toBe('b');
        // The "b" node had element children but we hit the depth budget before
        // recursing into them — children array is empty, truncated.depth is true.
        expect(result.tree?.children[0].children).toEqual([]);
        expect(result.truncated?.depth).toBe(true);
    });

    it('depth=0 keeps only the root', () => {
        const root = el('ul', {}, [
            el('li', {}, [txt('a')]),
            el('li', {}, [txt('b')]),
        ]);
        const result = runTreeJs(root, [root], null, { depth: 0 });
        expect(result.tree?.children).toEqual([]);
        expect(result.truncated?.depth).toBe(true);
    });

    it('caps children per node at `childrenMax` and reports children_dropped count', () => {
        const root = el('ul', {}, [
            el('li', {}, [txt('1')]),
            el('li', {}, [txt('2')]),
            el('li', {}, [txt('3')]),
            el('li', {}, [txt('4')]),
            el('li', {}, [txt('5')]),
        ]);
        const result = runTreeJs(root, [root], null, { childrenMax: 2 });
        expect(result.tree?.children).toHaveLength(2);
        expect(result.truncated?.children_dropped).toBe(3);
    });

    it('caps direct text per node at `textMax` and reports text_truncated count', () => {
        const root = el('p', {}, [
            txt('a'.repeat(50)),
            el('span', {}, [txt('b'.repeat(50))]),
        ]);
        const result = runTreeJs(root, [root], null, { textMax: 10 });
        expect(result.tree?.text).toHaveLength(10);
        expect(result.tree?.children[0].text).toHaveLength(10);
        expect(result.truncated?.text_truncated).toBe(2);
    });

    // Blocker B regression: compound contract must ride along with the
    // json tree so `browser get html --as json` surfaces the full contract
    // to agents without an extra round-trip.
    it('attaches compound info to date/file/select nodes and omits it elsewhere', () => {
        const date = el('input', { type: 'date', min: '2026-01-01' }, [], { value: '2026-04-21' });
        const file = el('input', { type: 'file', accept: 'image/*' }, [], { multiple: true, files: [{ name: 'a.png' }] });
        const sel = el('select', { name: 'country' }, [], {
            options: [
                { value: 'us', label: 'United States', selected: true },
                { value: 'ca', label: 'Canada' },
            ],
        });
        const plain = el('input', { type: 'text' }, [], { value: 'hi' });
        const root = el('form', {}, [date, file, sel, plain]);
        const result = runTreeJs(root, [root], null) as HtmlTreeResult & {
            tree: { children: Array<{ compound?: unknown }> };
        };
        expect(result.tree?.children[0].compound).toMatchObject({ control: 'date', format: 'YYYY-MM-DD', current: '2026-04-21', min: '2026-01-01' });
        expect(result.tree?.children[1].compound).toMatchObject({ control: 'file', multiple: true, current: ['a.png'], accept: 'image/*' });
        expect(result.tree?.children[2].compound).toMatchObject({ control: 'select', multiple: false, current: 'United States' });
        expect(result.tree?.children[3].compound).toBeUndefined();
    });

    it('combines budgets and reports every hit', () => {
        const root = el('ul', {}, [
            el('li', {}, [txt('x'.repeat(20)), el('em', {}, [txt('y')])]),
            el('li', {}, []),
            el('li', {}, []),
        ]);
        const result = runTreeJs(root, [root], null, { depth: 1, childrenMax: 2, textMax: 5 });
        expect(result.tree?.children).toHaveLength(2);
        expect(result.truncated?.children_dropped).toBe(1);
        expect(result.truncated?.text_truncated).toBe(1);
        expect(result.truncated?.depth).toBe(true);
    });
});
