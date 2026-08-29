import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './mute-word.js';
import { createPageMock } from '../test-utils.js';
import { createTwitterDomPage } from './test-dom-utils.js';

function createTransformedTwitterDomPage(html, transform, url = 'https://x.com/settings/add_muted_keyword') {
    return createInspectableTransformedTwitterDomPage(html, transform, url).page;
}

function createInspectableTransformedTwitterDomPage(html, transform, url = 'https://x.com/settings/add_muted_keyword') {
    const dom = new JSDOM(html, {
        url,
        runScripts: 'outside-only',
    });
    dom.window.setTimeout = (callback) => {
        callback();
        return 0;
    };
    const page = createPageMock([], {
        evaluate: vi.fn((script) => Promise.resolve(dom.window.eval(transform(String(script))))),
    });
    return { page, dom };
}

describe('twitter mute-word command', () => {
    it('navigates to the muted-word form and reports success when the script confirms', async () => {
        const cmd = getRegistry().get('twitter/mute-word');
        const page = createPageMock([{ ok: true, message: 'Muted word added.' }]);

        const result = await cmd.func(page, { keyword: '  opencli-muted-token  ' });

        expect(page.goto).toHaveBeenCalledWith('https://x.com/settings/add_muted_keyword');
        expect(page.wait).toHaveBeenCalledWith({ selector: '[data-testid="primaryColumn"]' });
        const script = page.evaluate.mock.calls[0][0];
        expect(script).toContain('input[name="keyword"]');
        expect(script).toContain("labels = new Set(['save', 'add', 'done', '保存', '添加', '完成'])");
        expect(result).toEqual([{
            keyword: 'opencli-muted-token',
            status: 'success',
            message: 'Muted word added.',
        }]);
    });

    it('embeds the keyword safely in the browser script', async () => {
        const cmd = getRegistry().get('twitter/mute-word');
        const page = createPageMock([{ ok: true, message: 'Muted word added.' }]);
        const keyword = '"); window.__opencliInjected = true; //';

        await cmd.func(page, { keyword });

        const script = page.evaluate.mock.calls[0][0];
        expect(script).toContain(JSON.stringify(keyword));
        expect(script).not.toContain('const keyword = ""); window.__opencliInjected = true; //";');
    });

    it('throws ArgumentError for an empty keyword before browser work', async () => {
        const cmd = getRegistry().get('twitter/mute-word');
        const page = createPageMock();

        await expect(cmd.func(page, { keyword: '   ' })).rejects.toMatchObject({
            name: 'ArgumentError',
            message: 'twitter mute-word keyword cannot be empty',
        });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('typed-fails before write when the muted-word input is missing', async () => {
        const cmd = getRegistry().get('twitter/mute-word');
        const page = createTwitterDomPage(`
            <main data-testid="primaryColumn">
                <button>Save</button>
            </main>
        `, 'https://x.com/settings/add_muted_keyword');

        await expect(cmd.func(page, { keyword: 'spoilers' })).rejects.toMatchObject({
            name: 'CommandExecutionError',
            code: 'COMMAND_EXEC',
            exitCode: 1,
            message: 'Could not find muted word input. Are you logged in?',
        });
    });

    it('typed-fails before write when the save button is missing', async () => {
        const cmd = getRegistry().get('twitter/mute-word');
        const page = createTwitterDomPage(`
            <main data-testid="primaryColumn">
                <input name="keyword" />
            </main>
        `, 'https://x.com/settings/add_muted_keyword');

        await expect(cmd.func(page, { keyword: 'spoilers' })).rejects.toMatchObject({
            name: 'CommandExecutionError',
            code: 'COMMAND_EXEC',
            exitCode: 1,
            message: 'Could not find muted word Save button.',
        });
    });

    it('treats a missing post-submit confirmation as unconfirmed', async () => {
        const cmd = getRegistry().get('twitter/mute-word');
        const page = createTwitterDomPage(`
            <main data-testid="primaryColumn">
                <input name="keyword" />
                <button>Save</button>
            </main>
        `, 'https://x.com/settings/add_muted_keyword');

        await expect(cmd.func(page, { keyword: 'spoilers' })).rejects.toMatchObject({
            name: 'TimeoutError',
            code: 'TIMEOUT',
            exitCode: 75,
            hint: expect.stringContaining('may already have been added'),
        });
    });

    it('does not treat pre-existing page text as post-submit confirmation', async () => {
        const cmd = getRegistry().get('twitter/mute-word');
        const page = createTwitterDomPage(`
            <main data-testid="primaryColumn">
                <p>spoilers</p>
                <input name="keyword" />
                <button>Save</button>
            </main>
        `, 'https://x.com/settings/add_muted_keyword');

        await expect(cmd.func(page, { keyword: 'spoilers' })).rejects.toMatchObject({
            name: 'TimeoutError',
            code: 'TIMEOUT',
            exitCode: 75,
        });
    });

    it('confirms success when the click transitions to the muted keywords list', async () => {
        const cmd = getRegistry().get('twitter/mute-word');
        const page = createTransformedTwitterDomPage(`
            <main data-testid="primaryColumn">
                <input name="keyword" />
                <button>Save</button>
            </main>
        `, (script) => script.replace('saveButton.click();', "history.pushState({}, '', '/settings/muted_keywords'); saveButton.click();"));

        const result = await cmd.func(page, { keyword: 'spoilers' });

        expect(result).toEqual([{
            keyword: 'spoilers',
            status: 'success',
            message: 'Muted word added.',
        }]);
    });

    it('does not treat an already-present success toast as post-submit confirmation', async () => {
        const cmd = getRegistry().get('twitter/mute-word');
        const page = createTwitterDomPage(`
            <main data-testid="primaryColumn">
                <div role="status">spoilers added</div>
                <input name="keyword" />
                <button>Save</button>
            </main>
        `, 'https://x.com/settings/add_muted_keyword');

        await expect(cmd.func(page, { keyword: 'spoilers' })).rejects.toMatchObject({
            name: 'TimeoutError',
            code: 'TIMEOUT',
            exitCode: 75,
        });
    });

    it('does not treat an already-open muted keywords route as a transition', async () => {
        const cmd = getRegistry().get('twitter/mute-word');
        const page = createTwitterDomPage(`
            <main data-testid="primaryColumn">
                <input name="keyword" />
                <button>Save</button>
            </main>
        `, 'https://x.com/settings/muted_keywords');

        await expect(cmd.func(page, { keyword: 'spoilers' })).rejects.toMatchObject({
            name: 'TimeoutError',
            code: 'TIMEOUT',
            exitCode: 75,
        });
    });

    it('typed-fails before clicking body-only unrelated controls', async () => {
        const cmd = getRegistry().get('twitter/mute-word');
        const { page, dom } = createInspectableTransformedTwitterDomPage(`
            <input aria-label="Word" />
            <button>Add</button>
        `, (script) => script.replace(
            'saveButton.click();',
            'window.__clicked = (window.__clicked || 0) + 1; saveButton.click();',
        ));

        await expect(cmd.func(page, { keyword: 'spoilers' })).rejects.toMatchObject({
            name: 'CommandExecutionError',
            code: 'COMMAND_EXEC',
            exitCode: 1,
            message: 'Could not find muted word input. Are you logged in?',
        });
        expect(dom.window.__clicked || 0).toBe(0);
    });

    it('does not treat the edited textbox value itself as confirmation', async () => {
        const cmd = getRegistry().get('twitter/mute-word');
        const page = createTwitterDomPage(`
            <main data-testid="primaryColumn">
                <div role="textbox" aria-label="Word"></div>
                <button>Save</button>
            </main>
        `, 'https://x.com/settings/add_muted_keyword');

        await expect(cmd.func(page, { keyword: 'spoilers' })).rejects.toMatchObject({
            name: 'TimeoutError',
            code: 'TIMEOUT',
            exitCode: 75,
        });
    });

    it('throws CommandExecutionError when no page is provided', async () => {
        const cmd = getRegistry().get('twitter/mute-word');
        await expect(cmd.func(undefined, { keyword: 'spoilers' })).rejects.toThrow(CommandExecutionError);
    });
});
