import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { __test__ } from './chat.js';

async function runBrowserScript(html, script, { url = 'https://www.goofish.com/im', beforeEval } = {}) {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    beforeEval?.(dom.window);
    return dom.window.eval(script);
}

describe('xianyu chat helpers', () => {
    it('builds goofish im urls from ids', () => {
        expect(__test__.buildChatUrl('1038951278192', '3650092411')).toBe('https://www.goofish.com/im?itemId=1038951278192&peerUserId=3650092411');
    });
    it('normalizes numeric ids', () => {
        expect(__test__.normalizeNumericId('1038951278192', 'item_id', '1038951278192')).toBe('1038951278192');
        expect(__test__.normalizeNumericId(3650092411, 'user_id', '3650092411')).toBe('3650092411');
    });
    it('rejects non-numeric ids', () => {
        expect(() => __test__.normalizeNumericId('abc', 'item_id', '1038951278192')).toThrow();
        expect(() => __test__.normalizeNumericId('3650092411x', 'user_id', '3650092411')).toThrow();
    });

    it('detects send buttons with whitespace-split text in the in-browser state extractor', async () => {
        const state = await runBrowserScript(`
            <main>
              <textarea></textarea>
              <button>发 送</button>
              <div id="message-list-scrollable"><div class="bubble">你好</div></div>
            </main>
        `, __test__.buildExtractChatStateEvaluate());

        expect(state.can_input).toBe(true);
        expect(state.can_send).toBe(true);
        expect(state.visible_messages).toEqual(['你好']);
    });

    it('activates the textarea and waits for a whitespace-split send button before clicking it', async () => {
        let inputValue = '';
        let sendClicked = false;
        const result = await runBrowserScript(`
            <main>
              <textarea></textarea>
            </main>
        `, __test__.buildSendMessageEvaluate('还在吗？'), {
            beforeEval(window) {
                const textarea = window.document.querySelector('textarea');
                textarea.addEventListener('input', () => {
                    inputValue = textarea.value;
                });
                textarea.addEventListener('click', () => {
                    const button = window.document.createElement('button');
                    button.textContent = '发 送';
                    button.addEventListener('click', () => {
                        sendClicked = true;
                    });
                    window.document.body.append(button);
                });
            },
        });

        expect(result).toEqual({ ok: true });
        expect(inputValue).toBe('还在吗？');
        expect(sendClicked).toBe(true);
    });

    it('returns a typed failure reason when activation still does not reveal the send button', async () => {
        const result = await runBrowserScript('<textarea></textarea>', __test__.buildSendMessageEvaluate('ping'), {
            beforeEval(window) {
                window.setTimeout = (fn) => {
                    fn();
                    return 0;
                };
            },
        });

        expect(result).toEqual({ ok: false, reason: 'send-button-not-found' });
    });
});
