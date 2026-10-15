import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { sendGeminiMessage, readGeminiSnapshot } from './utils.js';

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
