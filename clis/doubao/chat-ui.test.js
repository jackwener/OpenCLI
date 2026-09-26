import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { chatStateScript, selectDoubaoMode } from './chat-ui.js';

function readState(html, setup = () => {}) {
    const dom = new JSDOM(html, { url: 'https://www.doubao.com/chat/', runScripts: 'outside-only' });
    dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
        return { x: 100, y: 100, width: 36, height: 36 };
    };
    dom.window.document.elementFromPoint = () => dom.window.document.querySelector('button#flow-end-msg-send');
    setup(dom.window.document);
    try { return dom.window.eval(chatStateScript); }
    finally { dom.window.close(); }
}

describe('Doubao chat snapshot', () => {
    it('uses the visible editor index and ignores a hidden textarea', () => {
        const state = readState('<textarea style="display:none">hidden</textarea><div contenteditable="true" role="textbox">Hello</div><button id="flow-end-msg-send"></button>');
        expect(state.inputCount).toBe(1);
        expect(state.inputIndex).toBe(1);
        expect(state.input).toBe('Hello');
        expect(state.sendReady).toBe(true);
    });
    it('rejects ambiguous composers and an obstructed send button', () => {
        const state = readState('<textarea></textarea><div contenteditable="true" role="textbox"></div><button id="flow-end-msg-send"></button><div id="overlay"></div>', document => {
            document.elementFromPoint = () => document.getElementById('overlay');
        });
        expect(state.inputCount).toBe(2);
        expect(state.inputIndex).toBe(-1);
        expect(state.sendReady).toBe(false);
    });
    it('does not extract homepage suggestions or sidebar titles as replies', () => {
        const state = readState('<nav>Old answer</nav><main><div class="md-box-root">Try asking this question</div></main>');
        expect(state.replies).toEqual([]);
    });
    it('extracts one answer body, message IDs, completion state and safe source links', () => {
        const state = readState(`
            <div data-message-id="user-1"><div class="bg-g-send-msg-bubble">Hello</div></div>
            <div data-reply-message="true"><div data-message-id="reply-1">
                <div class="flow-markdown-body"><div class="md-box-root">Answer</div></div>
                <a href="https://link.wtturl.cn/?target=https%3A%2F%2Fexample.com%2Fsource">Source</a>
                <a href="javascript:void(0)">Unsafe</a>
                <div data-foundation-type="receive-message-action-bar"></div>
            </div></div>`);
        expect(state.users).toEqual([{ id: 'user-1', text: 'Hello' }]);
        expect(state.replies).toEqual([{ id: 'reply-1', text: 'Answer', links: ['https://example.com/source'], done: true }]);
    });
    it('does not mark streaming content as complete even when the action bar exists', () => {
        const state = readState('<div data-reply-message="true" data-message-id="reply-1"><div class="md-box-root" data-streaming="true">Partial</div><div data-foundation-type="receive-message-action-bar"></div></div>');
        expect(state.generating).toBe(true);
        expect(state.replies[0].done).toBe(false);
    });
    it('detects visible verification dialogs in traditional Chinese but not prompt text', () => {
        expect(readState('<textarea>Explain 人機驗證</textarea>').challenge).toBe(false);
        expect(readState('<div role="dialog">請完成安全驗證</div>').challenge).toBe(true);
        expect(readState('<iframe src="https://example.com/captcha" style="display:none"></iframe>').challenge).toBe(false);
    });
    it('reads the menu label and expert badge without hardcoding a model version', () => {
        const state = readState('<div id="mode:trigger" aria-haspopup="menu"><button>豆包 快速</button></div><div role="menu" data-state="open"><div role="menuitem"><span>豆包 Future</span><span>專家</span></div></div>');
        expect(state.modeLabel).toBe('豆包 快速');
        expect(state.modeItems[0].label).toBe('豆包 Future');
        expect(state.modeItems[0].text).toContain('專家');
        expect(state.modeSelector).toBe('[id="mode:trigger"][aria-haspopup="menu"] button');
    });
    it('uses a native trigger directly when the trigger itself is a button', () => {
        const state = readState('<button id="mode:trigger" aria-haspopup="menu">豆包 快速</button>');
        expect(state.modeSelector).toBe('[id="mode:trigger"][aria-haspopup="menu"]');
    });
});

describe('Doubao mode selection', () => {
    afterEach(() => vi.restoreAllMocks());
    function pageForMode(options = {}) {
        let time = 1000;
        vi.spyOn(Date, 'now').mockImplementation(() => time);
        let open = false;
        let focused = false;
        let label = options.initial || '豆包 快速';
        const item = { index: 1, text: '豆包 Future 專家', label: '豆包 Future', disabled: !!options.disabled };
        const page = {
            evaluate: vi.fn(async () => ({ challenge: false, modeIndex: 3, modeSelector: '[id="mode:trigger"][aria-haspopup="menu"] button', modeLabel: label, modeItems: open ? [{ ...item, focused: focused && !options.lostFocus }] : [] })),
            click: vi.fn(async () => { open = true; }),
            focus: vi.fn(async () => { focused = true; }),
            pressKey: vi.fn(async () => { if (!options.noSwitch) label = item.label; open = false; }),
            wait: vi.fn(async seconds => { time += seconds * 1000; }),
        };
        return page;
    }
    it('leaves the current mode alone by default', async () => {
        const page = pageForMode();
        await expect(selectDoubaoMode(page, 'current')).resolves.toBe('豆包 快速');
        expect(page.click).not.toHaveBeenCalled();
    });
    it('selects expert by its badge and verifies the resulting trigger label', async () => {
        const page = pageForMode();
        await expect(selectDoubaoMode(page, 'expert')).resolves.toBe('豆包 Future');
        expect(page.click).toHaveBeenCalledExactlyOnceWith('[id="mode:trigger"][aria-haspopup="menu"] button');
        expect(page.focus).toHaveBeenCalledWith(expect.stringContaining('menuitem'), { nth: 1 });
        expect(page.pressKey).toHaveBeenCalledExactlyOnceWith('Enter');
    });
    it('rejects an unavailable mode before keyboard selection', async () => {
        const page = pageForMode({ disabled: true });
        await expect(selectDoubaoMode(page, 'expert')).rejects.toBeInstanceOf(CommandExecutionError);
        expect(page.pressKey).not.toHaveBeenCalled();
    });
    it('never presses Enter if the menu item lost focus', async () => {
        const page = pageForMode({ lostFocus: true });
        await expect(selectDoubaoMode(page, 'expert')).rejects.toThrow('menu changed');
        expect(page.pressKey).not.toHaveBeenCalled();
    });
    it('fails rather than silently keeping the wrong mode', async () => {
        const page = pageForMode({ noSwitch: true });
        await expect(selectDoubaoMode(page, 'expert')).rejects.toThrow('Could not confirm');
        expect(page.pressKey).toHaveBeenCalledTimes(1);
    });
});
