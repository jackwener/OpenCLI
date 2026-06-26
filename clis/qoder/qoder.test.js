import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './quest.js';
import './history.js';
import './read.js';
import './status.js';
import './ui.js';
import './composer.js';
import {
    buildQoderInjectTextScript,
    evaluateQoder,
    parsePositiveInt,
    unwrapEvaluateResult,
} from './_utils.js';

function makePage(evaluateResults = []) {
    const evaluate = vi.fn();
    for (const result of evaluateResults) evaluate.mockResolvedValueOnce(result);
    evaluate.mockResolvedValue(null);
    return {
        evaluate,
        wait: vi.fn().mockResolvedValue(undefined),
    };
}

function runBrowserScript(html, script) {
    const dom = new JSDOM(html, { url: 'vscode-file://qoder/agents-window.html', runScripts: 'outside-only' });
    dom.window.InputEvent = dom.window.Event;
    dom.window.document.execCommand = vi.fn((command, _showUi, value) => {
        const active = dom.window.document.activeElement;
        if (command === 'insertText' && active) active.textContent = value;
        return true;
    });
    Object.defineProperty(dom.window.HTMLElement.prototype, 'getBoundingClientRect', {
        configurable: true,
        value() {
            const y = this.id === 'main' ? 860 : 320;
            return { x: 0, y, width: 420, height: 32 };
        },
    });
    return { dom, result: dom.window.eval(script) };
}

describe('qoder registry', () => {
    it('registers the expected command surface with access metadata', () => {
        const registry = getRegistry();
        const expected = new Map([
            ['qoder/status', 'read'],
            ['qoder/history', 'read'],
            ['qoder/read', 'read'],
            ['qoder/search', 'read'],
            ['qoder/account', 'read'],
            ['qoder/credits', 'read'],
            ['qoder/more-actions', 'read'],
            ['qoder/new', 'write'],
            ['qoder/send', 'write'],
            ['qoder/ask', 'write'],
            ['qoder/sidebar-toggle', 'write'],
            ['qoder/open-panel', 'write'],
            ['qoder/settings', 'write'],
            ['qoder/knowledge', 'write'],
            ['qoder/marketplace', 'write'],
            ['qoder/view-all', 'write'],
            ['qoder/add-workspace', 'write'],
            ['qoder/prompt-enhance', 'write'],
            ['qoder/open-editor', 'write'],
        ]);
        for (const [name, access] of expected) {
            expect(registry.get(name)).toMatchObject({ access });
        }
    });
});

describe('qoder helpers', () => {
    it('unwraps Browser Bridge evaluate envelopes', async () => {
        expect(unwrapEvaluateResult({ session: { id: 's1' }, data: ['row'] })).toEqual(['row']);
        const page = makePage([{ session: { id: 's1' }, data: { ok: true } }]);
        await expect(evaluateQoder(page, 'script')).resolves.toEqual({ ok: true });
    });

    it('validates positive integer options explicitly', () => {
        expect(parsePositiveInt(undefined, 20, '--limit')).toBe(20);
        expect(parsePositiveInt('3', 20, '--limit')).toBe(3);
        expect(() => parsePositiveInt(0, 20, '--limit')).toThrow(ArgumentError);
        expect(() => parsePositiveInt('abc', 20, '--limit')).toThrow(ArgumentError);
    });

    it('injects into the high-confidence composer instead of arbitrary contenteditable panes', () => {
        const html = `
          <div class="cm-editor simple-editor">
            <div id="optional" contenteditable="true" role="textbox">Optional description</div>
          </div>
          <div class="qoder-composer input">
            <div id="main" contenteditable="true" role="textbox" aria-label="Message Qoder"></div>
          </div>
        `;
        const { dom, result } = runBrowserScript(html, buildQoderInjectTextScript('hello qoder'));
        expect(result).toMatchObject({ ok: true });
        expect(dom.window.document.querySelector('#main')?.textContent).toBe('hello qoder');
        expect(dom.window.document.querySelector('#optional')?.textContent).toBe('Optional description');
    });
});

describe('qoder send command', () => {
    const send = getRegistry().get('qoder/send');

    it('requires post-submit evidence before returning success', async () => {
        const page = makePage([1, { ok: true }, { ok: true }, 2]);
        await expect(send.func(page, { text: 'hello' })).resolves.toEqual([
            { Status: 'sent', Length: '5' },
        ]);
    });

    it('typed-fails when no composer can be selected', async () => {
        const page = makePage([1, { ok: false, reason: 'No high-confidence Qoder composer found.' }]);
        await expect(send.func(page, { text: 'hello' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('typed-fails when clicking send does not create a visible message row', async () => {
        const page = makePage([1, { ok: true }, { ok: true }, 1]);
        await expect(send.func(page, { text: 'hello' })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
