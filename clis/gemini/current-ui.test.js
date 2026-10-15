import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { selectGeminiTool, sendGeminiMessage, readGeminiSnapshot } from './utils.js';

function toolsPage(moreLabel, { disabled = false, hidden = false, toolInMenu = false } = {}) {
    const dom = new JSDOM(`<main><button id="mode" aria-label="打开模式选择器，当前模式为 Flash" aria-haspopup="menu"></button><button id="tools" aria-label="上传和工具" aria-haspopup="menu"></button></main>
      <div role="menu" id="drawer" style="display:none"><button aria-label="${moreLabel}" ${disabled ? 'disabled' : ''} ${hidden ? 'hidden' : ''}>${moreLabel}</button>${toolInMenu ? '<button id="direct">Deep Research</button>' : ''}</div>
      <div role="menu" id="submenu" style="display:none"><button id="research">Deep Research</button></div>`,
    { url: 'https://gemini.google.com/app', runScripts: 'outside-only' });
    const document = dom.window.document;
    let position = 0;
    for (const node of document.querySelectorAll('*')) {
        const left = position++ * 140;
        node.style.opacity = '1';
        node.getBoundingClientRect = () => {
            const hiddenAncestor = node.closest('[hidden], [style*="display: none"], [style*="display:none"]');
            return { left, top: 0, width: hiddenAncestor ? 0 : 120, height: hiddenAncestor ? 0 : 36 };
        };
    }
    document.querySelector('#tools').onclick = () => { document.querySelector('#drawer').style.display = 'block'; };
    document.querySelector('#mode').onclick = vi.fn();
    const more = document.querySelector('#drawer button');
    more.onclick = vi.fn(() => { document.querySelector('#submenu').style.display = 'block'; });
    const research = document.querySelector('#research');
    research.onclick = vi.fn();
    if (toolInMenu) document.querySelector('#direct').onclick = vi.fn();
    return { dom, more, research, page: { evaluate: vi.fn(async script => dom.window.eval(script)), wait: vi.fn(async () => {}) } };
}

describe('Gemini nested tools drawer', () => {
    it('opens the hover submenu without a second click that can close it', async () => {
        const { page, more, research } = toolsPage('More tools');
        page.cdp = vi.fn(async (method, params) => {
            expect(method).toBe('Input.dispatchMouseEvent');
            expect(params.type).toBe('mouseMoved');
            more.click();
        });
        expect(await selectGeminiTool(page, ['Deep Research'])).toBe('Deep Research');
        expect(page.cdp).toHaveBeenCalledTimes(1);
        expect(more.onclick).toHaveBeenCalledTimes(1);
        expect(research.onclick).toHaveBeenCalledTimes(1);
    });
    it('reopens a drawer dismissed during page startup without reselecting a tool', async () => {
        const { page, dom, more, research } = toolsPage('More tools');
        const trigger = dom.window.document.querySelector('#tools');
        trigger.onclick = vi.fn(() => {
            if (trigger.onclick.mock.calls.length === 2) dom.window.document.querySelector('#drawer').style.display = 'block';
        });
        expect(await selectGeminiTool(page, ['Deep Research'])).toBe('Deep Research');
        expect(trigger.onclick).toHaveBeenCalledTimes(2);
        expect(more.onclick).toHaveBeenCalledTimes(1);
        expect(research.onclick).toHaveBeenCalledTimes(1);
    });
    it('waits for delayed submenu rendering without clicking the trigger again', async () => {
        const { page, dom, more, research } = toolsPage('More tools');
        more.onclick = vi.fn();
        let submenuWaits = 0;
        page.wait = vi.fn(async () => {
            if (more.onclick.mock.calls.length && ++submenuWaits === 2) dom.window.document.querySelector('#submenu').style.display = 'block';
        });
        expect(await selectGeminiTool(page, ['Deep Research'])).toBe('Deep Research');
        expect(more.onclick).toHaveBeenCalledTimes(1);
        expect(research.onclick).toHaveBeenCalledTimes(1);
    });

    it('uses a native tools trigger click when available', async () => {
        const { page, dom, more, research } = toolsPage('More tools');
        page.nativeClick = vi.fn(async (x, y) => {
            const node = Array.from(dom.window.document.querySelectorAll('button')).find(button => {
                const rect = button.getBoundingClientRect();
                return rect.width && x === rect.left + rect.width / 2 && y === rect.top + rect.height / 2;
            });
            expect(node).toBeDefined();
            node.click();
        });
        expect(await selectGeminiTool(page, ['Deep Research'])).toBe('Deep Research');
        expect(page.nativeClick).toHaveBeenCalledTimes(1);
        expect(more.onclick).toHaveBeenCalledTimes(1);
        expect(research.onclick).toHaveBeenCalledTimes(1);
    });

    it.each(['更多工具', 'More tools'])('selects Deep Research through %s', async label => {
        const { page, more, research, dom } = toolsPage(label);
        expect(await selectGeminiTool(page, ['Deep Research'])).toBe('Deep Research');
        expect(more.onclick).toHaveBeenCalledTimes(1);
        expect(research.onclick).toHaveBeenCalledTimes(1);
        expect(dom.window.document.querySelector('#mode').onclick).not.toHaveBeenCalled();
    });
    it.each([{ disabled: true }, { hidden: true }])('does not click an unavailable submenu: %j', async options => {
        const { page, more, research } = toolsPage('More tools', options);
        expect(await selectGeminiTool(page, ['Deep Research'])).toBe('');
        expect(more.onclick).not.toHaveBeenCalled();
        expect(research.onclick).not.toHaveBeenCalled();
    });
    it('keeps the direct legacy menu path', async () => {
        const { page, more, dom } = toolsPage('More tools', { toolInMenu: true });
        expect(await selectGeminiTool(page, ['Deep Research'])).toBe('Deep Research');
        expect(more.onclick).not.toHaveBeenCalled();
        expect(dom.window.document.querySelector('#direct').onclick).toHaveBeenCalledTimes(1);
    });
});


describe('Gemini native composer input', () => {
    it('preserves rich editor paragraphs across consecutive native submissions', async () => {
        const dom = new JSDOM('<form><div contenteditable="true" role="textbox" aria-label="Enter a prompt for Gemini"><p><br></p></div><button type="button" aria-label="Send">Send</button></form>',
            { url: 'https://gemini.google.com/app', runScripts: 'outside-only' });
        const composer = dom.window.document.querySelector('[contenteditable]');
        const paragraph = composer.firstChild;
        const button = dom.window.document.querySelector('button');
        for (const node of dom.window.document.querySelectorAll('*')) {
            node.style.opacity = '1';
            node.getBoundingClientRect = () => ({ left: 0, right: 100, top: 0, bottom: 30, width: 100, height: 30 });
        }
        const preserved = [];
        button.onclick = vi.fn();
        const page = {
            evaluate: vi.fn(async script => dom.window.eval(script)),
            wait: vi.fn(async () => {}),
            nativeType: vi.fn(async text => {
                preserved.push(paragraph.isConnected);
                if (paragraph.isConnected) paragraph.textContent = text;
                else composer.textContent = text;
            }),
        };
        expect(await sendGeminiMessage(page, 'first question')).toBe('button');
        expect(await sendGeminiMessage(page, 'second question')).toBe('button');
        expect(preserved).toEqual([true, true]);
        expect(button.onclick).toHaveBeenCalledTimes(2);
    });
});


describe('Gemini inactive automation tab', () => {
    it('selects its own inactive tab before reading the rendered answer', async () => {
        const dom = new JSDOM('<main><div class="model-response-text" style="display:none">Current reply</div></main>',
            { url: 'https://gemini.google.com/app/test', runScripts: 'outside-only' });
        const response = dom.window.document.querySelector('.model-response-text');
        for (const node of dom.window.document.querySelectorAll('*')) {
            node.style.opacity = '1';
            node.getBoundingClientRect = () => ({ width: 100, height: node === response && response.style.display === 'none' ? 0 : 30 });
        }
        const page = {
            evaluate: vi.fn(async script => dom.window.eval(script)),
            tabs: vi.fn(async () => [{ page: 'owned-gemini', url: dom.window.location.href, active: false }]),
            selectTab: vi.fn(async () => { response.style.display = 'block'; }),
        };
        const state = await readGeminiSnapshot(page);
        expect(page.selectTab).toHaveBeenCalledWith('owned-gemini');
        expect(state.turns).toContainEqual({ Role: 'Assistant', Text: 'Current reply' });
    });
});
