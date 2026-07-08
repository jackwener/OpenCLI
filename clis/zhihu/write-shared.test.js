import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { CliError } from '@jackwener/opencli/errors';
import { __test__ } from './write-shared.js';
class FakeNode {
    attrs;
    textContent;
    hasAvatar;
    constructor(attrs, textContent = null, hasAvatar = false) {
        this.attrs = attrs;
        this.textContent = textContent;
        this.hasAvatar = hasAvatar;
    }
    getAttribute(name) {
        return this.attrs[name] ?? null;
    }
    querySelector(selector) {
        if (this.hasAvatar && selector.includes('img'))
            return {};
        return null;
    }
}
class FakeRoot {
    selectors;
    constructor(selectors) {
        this.selectors = selectors;
    }
    querySelectorAll(selector) {
        return this.selectors[selector] ?? [];
    }
}
function createPageForDom(documentRoot, state = undefined) {
    return {
        evaluate: vi.fn().mockImplementation(async (js) => {
            const previousDocument = globalThis.document;
            const previousWindow = globalThis.window;
            const previousState = globalThis.__INITIAL_STATE__;
            const windowObject = { __INITIAL_STATE__: state };
            try {
                Object.assign(globalThis, {
                    document: documentRoot,
                    window: windowObject,
                    __INITIAL_STATE__: state,
                });
                return globalThis.eval(js);
            }
            finally {
                Object.assign(globalThis, {
                    document: previousDocument,
                    window: previousWindow,
                    __INITIAL_STATE__: previousState,
                });
            }
        }),
    };
}
describe('zhihu write shared helpers', () => {
    it('rejects missing --execute', () => {
        expect(() => __test__.requireExecute({})).toThrowError(CliError);
    });
    it('accepts a non-empty text payload', async () => {
        await expect(__test__.resolvePayload({ text: 'hello' })).resolves.toBe('hello');
    });
    it('rejects whitespace-only payloads', async () => {
        await expect(__test__.resolvePayload({ text: '   ' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    });
    it('rejects missing file payloads as INVALID_INPUT', async () => {
        await expect(__test__.resolvePayload({ file: join(tmpdir(), 'zhihu-write-shared-missing.txt') })).rejects.toMatchObject({
            code: 'INVALID_INPUT',
            message: expect.stringContaining('File not found'),
        });
    });
    it('rejects invalid UTF-8 file payloads as INVALID_INPUT', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'zhihu-write-shared-'));
        const file = join(dir, 'payload.txt');
        await writeFile(file, Buffer.from([0xc3, 0x28]));
        try {
            await expect(__test__.resolvePayload({ file })).rejects.toMatchObject({
                code: 'INVALID_INPUT',
                message: expect.stringContaining('decoded as UTF-8'),
            });
        }
        finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
    it('rejects generic file read failures as INVALID_INPUT', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'zhihu-write-shared-'));
        const file = join(dir, 'payload.txt');
        await writeFile(file, 'hello');
        try {
            await expect(__test__.resolvePayload({ file }, {
                stat: async () => ({ isFile: () => true }),
                readFile: async () => {
                    throw new Error('boom');
                },
                decodeUtf8: (raw) => new TextDecoder('utf-8', { fatal: true }).decode(raw),
            })).rejects.toMatchObject({
                code: 'INVALID_INPUT',
                message: expect.stringContaining('could not be read'),
            });
        }
        finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
    it('prefers the state slug before DOM fallback', async () => {
        const documentRoot = new FakeRoot({
            'header, nav, [role="banner"], [role="navigation"]': [],
            'a[href^="/people/"]': [new FakeNode({ href: '/people/not-used', 'data-testid': 'profile-link' }, null, true)],
        });
        expect(__test__.resolveCurrentUserSlugFromDom({ me: { slug: 'alice' } }, documentRoot)).toBe('alice');
    });
    it('accepts nav avatar links as a conservative fallback', async () => {
        const navRoot = new FakeRoot({
            'a[href^="/people/"]': [new FakeNode({ href: '/people/alice' }, null, true)],
        });
        const documentRoot = new FakeRoot({
            'header, nav, [role="banner"], [role="navigation"]': [navRoot],
            'a[href^="/people/"]': [],
        });
        expect(__test__.resolveCurrentUserSlugFromDom(undefined, documentRoot)).toBe('alice');
    });
    it('accepts document-wide fallback only for explicit account/profile signals', async () => {
        const documentRoot = new FakeRoot({
            'header, nav, [role="banner"], [role="navigation"]': [],
            'a[href^="/people/"]': [
                new FakeNode({ href: '/people/alice', 'data-testid': 'account-profile-link' }),
            ],
        });
        expect(__test__.resolveCurrentUserSlugFromDom(undefined, documentRoot)).toBe('alice');
    });
    it('does not accept a document-wide author avatar link as current-user fallback', async () => {
        const documentRoot = new FakeRoot({
            'header, nav, [role="banner"], [role="navigation"]': [],
            'a[href^="/people/"]': [new FakeNode({ href: '/people/author-1' }, 'Author', true)],
        });
        expect(__test__.resolveCurrentUserSlugFromDom(undefined, documentRoot)).toBeNull();
    });
    it('does not accept generic document metadata like user or dropdown alone', async () => {
        const documentRoot = new FakeRoot({
            'header, nav, [role="banner"], [role="navigation"]': [],
            'a[href^="/people/"]': [
                new FakeNode({ href: '/people/author-1', 'data-testid': 'user-menu-dropdown' }, 'Author'),
            ],
        });
        expect(__test__.resolveCurrentUserSlugFromDom(undefined, documentRoot)).toBeNull();
    });
    it('freezes a stable current-user identity before write', async () => {
        const navRoot = new FakeRoot({
            'a[href^="/people/"]': [new FakeNode({ href: '/people/alice' }, null, true)],
        });
        const documentRoot = new FakeRoot({
            'header, nav, [role="banner"], [role="navigation"]': [navRoot],
            'a[href^="/people/"]': [],
        });
        const page = createPageForDom(documentRoot);
        await expect(__test__.resolveCurrentUserIdentity(page)).resolves.toBe('alice');
    });
    it('rejects when current-user identity cannot be resolved', async () => {
        const documentRoot = new FakeRoot({
            'header, nav, [role="banner"], [role="navigation"]': [],
            'a[href^="/people/"]': [],
            'header img[alt*="\u4e3b\u9875"]': [],
        });
        const page = createPageForDom(documentRoot);
        await expect(__test__.resolveCurrentUserIdentity(page)).rejects.toMatchObject({
            code: 'ACTION_NOT_AVAILABLE',
        });
    });
    it('rejects reserved buildResultRow extra keys', () => {
        expect(() => __test__.buildResultRow('done', 'question', '123', 'applied', { status: 'oops' })).toThrowError(CliError);
    });
});
