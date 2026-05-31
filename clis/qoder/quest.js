// Quest (= conversation) lifecycle commands: new / send / ask.

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
    TimeoutError,
} from '@jackwener/opencli/errors';
import {
    buildQoderInjectTextScript,
    clickByTextScript,
    clickFirstScript,
    evaluateQoder,
    parsePositiveInt,
    QODER_MESSAGE_COUNT_JS,
    qoderResponseAfterScript,
} from './_utils.js';

async function waitForMessageCountGrowth(page, beforeCount, timeoutMs = 5000) {
    const attempts = Math.max(1, Math.ceil(timeoutMs / 500));
    for (let i = 0; i < attempts; i++) {
        await page.wait(0.5);
        const afterCount = await evaluateQoder(page, QODER_MESSAGE_COUNT_JS);
        if (Number(afterCount) > Number(beforeCount)) return afterCount;
    }
    return beforeCount;
}

// -------- new --------
cli({
    site: 'qoder',
    name: 'new',
    access: 'write',
    description: 'Start a new Qoder Quest (conversation). Clicks the "New Quest" button in the sidebar (or its ⌘N variant).',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status'],
    func: async (page) => {
        const res = await evaluateQoder(page, clickByTextScript(['New Quest']));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'New Quest button not found', '');
        await page.wait(0.5);
        return [{ Status: 'started' }];
    },
});

// -------- send --------
cli({
    site: 'qoder',
    name: 'send',
    access: 'write',
    description: 'Type text into the Qoder composer and click "Send message" (fire-and-forget).',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'text', positional: true, required: true, help: 'Text to send' },
    ],
    columns: ['Status', 'Length'],
    func: async (page, kwargs) => {
        const text = String(kwargs?.text || '').trim();
        if (!text) throw new ArgumentError('text is required');

        const beforeCount = await evaluateQoder(page, QODER_MESSAGE_COUNT_JS);
        const typeRes = await evaluateQoder(page, buildQoderInjectTextScript(text));
        if (!typeRes?.ok) throw new CommandExecutionError(typeRes?.reason || 'composer type failed', '');
        await page.wait(0.3);

        // Click Send message
        const sendRes = await evaluateQoder(page, clickFirstScript([
            'button[aria-label="Send message"]',
            'button[title="Send message"]',
        ]));
        if (!sendRes?.ok) {
            // Fallback: try clickByText.
            const textRes = await evaluateQoder(page, clickByTextScript(['Send message', 'Send', '发送']));
            if (!textRes?.ok) throw new CommandExecutionError('Send button not found', '');
        }
        const afterCount = await waitForMessageCountGrowth(page, beforeCount);
        if (Number(afterCount) <= Number(beforeCount)) {
            throw new CommandExecutionError('Qoder send did not create a new visible message row');
        }
        return [{ Status: 'sent', Length: String(text.length) }];
    },
});

// -------- ask --------
cli({
    site: 'qoder',
    name: 'ask',
    access: 'write',
    description: 'Send a prompt to Qoder and wait up to --timeout seconds for the reply (best-effort: polls for the chat turn count to grow + stabilize).',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'text', positional: true, required: true, help: 'Prompt text' },
        { name: 'timeout', type: 'int', required: false, default: 120, help: 'Max seconds to wait' },
    ],
    columns: ['Role', 'Text', 'WaitedSeconds'],
    func: async (page, kwargs) => {
        const text = String(kwargs?.text || '').trim();
        if (!text) throw new ArgumentError('text is required');
        const timeoutSec = parsePositiveInt(kwargs?.timeout, 120, '--timeout');

        // Type + send (mirror `send` logic)
        const sendBefore = await evaluateQoder(page, QODER_MESSAGE_COUNT_JS);
        const typeRes = await evaluateQoder(page, buildQoderInjectTextScript(text));
        if (!typeRes?.ok) throw new CommandExecutionError(typeRes?.reason || 'composer type failed', '');
        await page.wait(0.3);
        const sendRes = await evaluateQoder(page, clickFirstScript(['button[aria-label="Send message"]', 'button[title="Send message"]']));
        if (!sendRes?.ok) {
            const textRes = await evaluateQoder(page, clickByTextScript(['Send message', 'Send', '发送']));
            if (!textRes?.ok) throw new CommandExecutionError('Send button not found', '');
        }

        const startedAt = Date.now();
        const deadline = startedAt + timeoutSec * 1000;
        let lastCount = sendBefore;
        let stableTicks = 0;
        let response = null;
        while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 1500));
            const cur = await evaluateQoder(page, QODER_MESSAGE_COUNT_JS);
            if (cur !== lastCount) {
                lastCount = cur;
                stableTicks = 0;
            } else {
                stableTicks++;
            }
            // Consider stable after 6 idle ticks (≈9s no change) IF count grew at all.
            if (lastCount > sendBefore && stableTicks >= 6) {
                response = await evaluateQoder(page, qoderResponseAfterScript(sendBefore, text));
                if (response?.text) break;
            }
        }
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        if (!response?.text) {
            throw new TimeoutError('Qoder response', timeoutSec, 'Confirm Qoder sent the prompt and finished generating, then retry with a larger --timeout.');
        }
        return [
            { Role: 'User', Text: text, WaitedSeconds: String(elapsed) },
            { Role: response.role || 'Assistant', Text: String(response.text).slice(0, 1200), WaitedSeconds: String(elapsed) },
        ];
    },
});
