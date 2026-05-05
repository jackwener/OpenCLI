import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, TimeoutError } from '@jackwener/opencli/errors';
import {
    buildChatwiseInjectTextJs,
    buildChatwiseMessageCountJs,
    buildChatwiseResponseAfterJs,
    normalizeTimeout,
    scoreChatwiseComposerCandidate,
    selectBestChatwiseComposer,
} from './utils.js';
import { askCommand } from './ask.js';

function candidate(overrides = {}) {
    return {
        index: 0,
        hidden: false,
        role: 'textbox',
        classes: 'cm-content cm-lineWrapping',
        editorClasses: 'cm-editor',
        ariaLabel: '',
        placeholder: '',
        text: '',
        rect: { y: 0, h: 30 },
        ...overrides,
    };
}

function runBrowserScript(html, script) {
    const dom = new JSDOM(html, { url: 'app://chatwise.local/', runScripts: 'outside-only' });
    Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 400 });
    Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 32 });
    dom.window.HTMLElement.prototype.getClientRects = () => [{ length: 1 }];
    dom.window.document.execCommand = () => false;
    return { dom, result: dom.window.eval(script) };
}

function makePage(evaluateResults = []) {
    const evaluate = vi.fn();
    for (const result of evaluateResults) evaluate.mockResolvedValueOnce(result);
    evaluate.mockResolvedValue(null);
    return {
        evaluate,
        wait: vi.fn().mockResolvedValue(undefined),
        pressKey: vi.fn().mockResolvedValue(undefined),
    };
}

describe('chatwise composer selection', () => {
    it('prefers the main composer over auxiliary contenteditable editors', () => {
        const mainComposer = candidate({
            index: 0,
            placeholder: 'placeholder Enter a message here, press ⏎ to send',
            rect: { y: 860, h: 32 },
        });
        const optionalDescription = candidate({
            index: 1,
            placeholder: 'placeholder Optional description',
            editorClasses: 'cm-editor simple-editor',
            rect: { y: 400, h: 32 },
        });
        const userContext = candidate({
            index: 2,
            text: '# User Context Document',
            editorClasses: 'cm-editor simple-editor',
            rect: { y: 460, h: 1200 },
        });

        expect(scoreChatwiseComposerCandidate(mainComposer, 900)).toBeGreaterThan(
            scoreChatwiseComposerCandidate(optionalDescription, 900),
        );
        expect(scoreChatwiseComposerCandidate(mainComposer, 900)).toBeGreaterThan(
            scoreChatwiseComposerCandidate(userContext, 900),
        );

        expect(selectBestChatwiseComposer([
            optionalDescription,
            userContext,
            mainComposer,
        ], 900)?.index).toBe(0);
    });

    it('rejects hidden or low-confidence candidates instead of injecting into the wrong editor', () => {
        expect(selectBestChatwiseComposer([
            candidate({
                index: 0,
                hidden: true,
                placeholder: 'Enter a message here, press ⏎ to send',
                rect: { y: 860, h: 32 },
            }),
        ], 900)).toBeNull();

        expect(selectBestChatwiseComposer([
            candidate({
                index: 1,
                placeholder: 'Optional description',
                editorClasses: 'cm-editor simple-editor',
                rect: { y: 860, h: 32 },
            }),
            candidate({
                index: 2,
                text: '# User Context Document',
                editorClasses: 'cm-editor simple-editor',
                rect: { y: 870, h: 32 },
            }),
        ], 900)).toBeNull();
    });

    it('injects text into the scored main composer instead of the last contenteditable', () => {
        const html = `
          <div class="cm-editor simple-editor">
            <div class="cm-placeholder">Optional description</div>
            <div id="optional" contenteditable="true" role="textbox"></div>
          </div>
          <div class="cm-editor">
            <div class="cm-placeholder">Enter a message here, press ⏎ to send</div>
            <div id="main" class="cm-content" contenteditable="true" role="textbox"></div>
          </div>
          <div class="cm-editor simple-editor">
            <div id="context" contenteditable="true" role="textbox"># User Context Document</div>
          </div>
        `;

        const { dom, result } = runBrowserScript(html, buildChatwiseInjectTextJs('hello'));

        expect(result).toBe(true);
        expect(dom.window.document.querySelector('#main')?.textContent).toBe('hello');
        expect(dom.window.document.querySelector('#optional')?.textContent).toBe('');
        expect(dom.window.document.querySelector('#context')?.textContent).toBe('# User Context Document');
    });

    it('fails injection when only auxiliary editors are present', () => {
        const html = `
          <div class="cm-editor simple-editor">
            <div class="cm-placeholder">Optional description</div>
            <div id="optional" contenteditable="true" role="textbox"></div>
          </div>
          <div class="cm-editor simple-editor">
            <div id="context" contenteditable="true" role="textbox"># User Context Document</div>
          </div>
        `;

        const { dom, result } = runBrowserScript(html, buildChatwiseInjectTextJs('hello'));

        expect(result).toBe(false);
        expect(dom.window.document.querySelector('#optional')?.textContent).toBe('');
        expect(dom.window.document.querySelector('#context')?.textContent).toBe('# User Context Document');
    });

    it('reads only real message wrapper content after the previous count', () => {
        const html = `
          <div class="group/message">old message</div>
          <div class="timestamp">12:00</div>
          <div class="group/message">new assistant answer</div>
        `;

        expect(runBrowserScript(html, buildChatwiseMessageCountJs()).result).toBe(2);
        expect(runBrowserScript(html, buildChatwiseResponseAfterJs(1, 'user prompt')).result).toBe('new assistant answer');
    });

    it('does not treat the user prompt wrapper as an assistant response', () => {
        const html = `
          <div class="group/message">old message</div>
          <div class="group/message">user prompt</div>
        `;

        expect(runBrowserScript(html, buildChatwiseResponseAfterJs(1, 'user prompt')).result).toBeNull();
    });

    it('validates timeout explicitly', () => {
        expect(normalizeTimeout(undefined)).toBe(30);
        expect(() => normalizeTimeout('0')).toThrow(ArgumentError);
        expect(() => normalizeTimeout('301')).toThrow(ArgumentError);
    });

    it('fails fast when ask times out instead of returning a System success row', async () => {
        const page = makePage([
            1,
            true,
            null,
        ]);

        await expect(askCommand.func(page, { text: 'hello', timeout: 1 }))
            .rejects.toBeInstanceOf(TimeoutError);
    });
});
