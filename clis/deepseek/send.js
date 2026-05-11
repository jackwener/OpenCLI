import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
    DEEPSEEK_DOMAIN,
    MESSAGE_SELECTOR,
    TEXTAREA_SELECTOR,
    parseDeepSeekConversationId,
} from './utils.js';

export const sendCommand = cli({
    site: 'deepseek',
    name: 'send',
    access: 'write',
    description: 'Send a prompt to a specific DeepSeek conversation by ID, without waiting for a response',
    domain: DEEPSEEK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'id', required: true, positional: true, help: 'Conversation ID (UUID) or full /a/chat/s/<id> URL' },
        { name: 'prompt', required: true, positional: true, help: 'Prompt to send' },
        { name: 'timeout', type: 'int', required: false, default: 60, help: 'Max seconds for the overall command (default: 60)' },
    ],
    columns: ['Status', 'InjectedText'],
    func: async (page, kwargs) => {
        const id = parseDeepSeekConversationId(kwargs.id);
        const prompt = kwargs.prompt;

        // Navigate directly to the target conversation. The framework runs
        // each browser command in an ephemeral per-command workspace (tab),
        // so there is no shared "current conversation" between commands; the
        // ID must be explicit. Skipping this navigation lands on the deepseek
        // root, where the click silently no-ops because React has not bound
        // the textarea on a freshly-opened tab.
        await page.goto(`https://chat.deepseek.com/a/chat/s/${id}`);
        await waitForTextareaReady(page);

        // Focus the textarea via DOM, then drive input through CDP
        // `Input.insertText`. This mirrors the doubao adapter (#1278) and is
        // the only reliable path for the React-controlled DeepSeek composer
        // on a freshly-opened tab: `execCommand('insertText')` plus a
        // synthesised input event leaves the controlled state desynced and
        // the resulting send click silently no-ops on the server side.
        const focusOk = await page.evaluate(`(() => {
            const box = document.querySelector('${TEXTAREA_SELECTOR}');
            if (!box) return false;
            box.focus();
            return document.activeElement === box;
        })()`);
        if (!focusOk) {
            throw new CommandExecutionError('Could not focus DeepSeek textarea before native input');
        }
        if (typeof page.nativeType !== 'function') {
            throw new CommandExecutionError(
                'Native CDP input is not available on this page object',
                'deepseek send relies on Input.insertText; ensure the daemon and extension are up to date.',
            );
        }
        await page.nativeType(prompt);
        await page.wait(0.6);

        // Submit + wait inside the same eval until the user bubble has
        // rendered AND remains stable past a 3s settle window. Returning
        // earlier lets the framework close the per-command workspace
        // mid-flight, aborting the in-flight chat-completion request before
        // the server has acknowledged it; the optimistic bubble then never
        // persists.
        const promptJson = JSON.stringify(prompt);
        const result = await page.evaluate(`(async () => {
            const TEXTAREA = '${TEXTAREA_SELECTOR}';
            const MESSAGE = '${MESSAGE_SELECTOR}';
            const expected = ${promptJson};
            const isUser = (m) => m.className.split(/\\s+/).length > 2;
            const box = document.querySelector(TEXTAREA);
            if (!box) return { ok: false, reason: 'textarea not found' };
            if ((box.value || '').trim() !== expected.trim()) {
                return { ok: false, reason: 'native input did not populate textarea (got ' + JSON.stringify(box.value) + ')' };
            }
            let container = box.parentElement;
            while (container && !container.querySelector('div[role="button"]')) {
                container = container.parentElement;
            }
            const btns = container ? container.querySelectorAll('div[role="button"]:not(.ds-toggle-button)') : [];
            const sendBtn = btns[btns.length - 1];
            if (!sendBtn || sendBtn.querySelectorAll('svg').length === 0) {
                return { ok: false, reason: 'send button not found' };
            }
            if (sendBtn.getAttribute('aria-disabled') !== 'false') {
                return { ok: false, reason: 'send button stayed disabled after native input' };
            }
            sendBtn.click();
            // Verify the prompt rendered as a user-class bubble that includes
            // the expected text. Counting bubbles is unreliable under DeepSeek
            // virtualization (the visible message list is windowed); a text
            // match on any user bubble is the authoritative signal.
            const matchesPrompt = (m) => isUser(m) && (m.innerText || '').trim().includes(expected);
            const findUserBubble = () => Array.from(document.querySelectorAll(MESSAGE)).reverse().find(matchesPrompt);
            let appeared = false;
            for (let i = 0; i < 20 && !appeared; i++) {
                await new Promise(r => setTimeout(r, 500));
                if (findUserBubble()) appeared = true;
            }
            if (!appeared) return { ok: false, reason: 'prompt never rendered as a user bubble within 10s' };
            // Settle: must still be present after 3s; an optimistic render
            // that gets rolled back fails this check.
            for (let i = 0; i < 3; i++) {
                await new Promise(r => setTimeout(r, 1000));
                if (!findUserBubble()) {
                    return { ok: false, reason: 'prompt rendered then disappeared during the 3s settle window' };
                }
            }
            return { ok: true };
        })()`).catch((err) => {
            const msg = String(err?.message || err);
            // SPA navigation after click can collapse the eval context; the
            // resulting "Promise was collected" only fires after the bubble
            // settle has already passed, so treat it as a successful submit.
            if (msg.includes('Promise was collected')) return { ok: true };
            throw err;
        });

        if (!result?.ok) {
            throw new CommandExecutionError(result?.reason || 'Failed to send message');
        }
        return [{ Status: 'Success', InjectedText: prompt }];
    },
});

/** Poll for the deepseek textarea to mount before driving any input. */
async function waitForTextareaReady(page) {
    const probe = `(() => !!document.querySelector('${TEXTAREA_SELECTOR}'))()`;
    for (let attempt = 0; attempt < 10; attempt++) {
        if (await page.evaluate(probe)) return;
        await page.wait(1);
    }
    throw new CommandExecutionError(
        'DeepSeek textarea did not mount within 10s; the conversation page may not have loaded',
    );
}
