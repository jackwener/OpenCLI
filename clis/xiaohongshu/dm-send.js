/**
 * Xiaohongshu dm-send — type one message into the web-IM composer and press Enter.
 *
 * Flow:
 *   1. Open /chat/<conv-id>, fail fast when logged out
 *   2. Clear the composer, insert the text natively (CDP Input.insertText, with
 *      an execCommand fallback when the page has no native input channel)
 *   3. Press Enter as a full CDP key event (key code included, or the composer
 *      ignores it) and wait for the text to echo in the message list
 *
 * DMs are the most tightly policed surface on Xiaohongshu; keep sends few and
 * human-paced. Requires the main-site login.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError, CommandExecutionError } from '@jackwener/opencli/errors';
import { unwrapEvaluateResult } from './shared.js';
import {
    CLEAR_COMPOSER_JS,
    SELECTOR_TIMEOUT_S,
    assertConvId,
    assertMessageText,
    buildFallbackTypeJs,
    buildWaitForEchoJs,
    openChat,
} from './dm-helpers.js';

const TYPE_SETTLE_S = 0.4;
const ENTER_KEY = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };

/**
 * The IM composer sends on Enter only when the event carries a real key code,
 * so prefer a full CDP key event; `pressKey` (key name only) is the fallback.
 */
async function pressEnter(page) {
    if (typeof page.cdp === 'function') {
        await page.cdp('Input.dispatchKeyEvent', { type: 'keyDown', text: '\r', unmodifiedText: '\r', ...ENTER_KEY });
        await page.cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...ENTER_KEY });
        return;
    }
    await page.pressKey('Enter');
}

async function typeIntoComposer(page, text) {
    const cleared = unwrapEvaluateResult(await page.evaluate(CLEAR_COMPOSER_JS));
    if (cleared !== true) {
        throw new CommandExecutionError('xiaohongshu/dm-send: composer not found (selectors changed or chat not open)');
    }
    if (typeof page.nativeType === 'function') {
        await page.nativeType(text);
    } else {
        const typed = unwrapEvaluateResult(await page.evaluate(buildFallbackTypeJs(text)));
        if (typed !== true) throw new CommandExecutionError('xiaohongshu/dm-send: could not type into the composer');
    }
    await page.wait({ time: TYPE_SETTLE_S });
    await pressEnter(page);
}

cli({
    site: 'xiaohongshu',
    name: 'dm-send',
    access: 'write',
    description: '发送小红书私信 (web IM composer, verifies the echo)',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    browser: true,
    args: [
        { name: 'conv', required: true, positional: true, help: 'Conversation id from `xiaohongshu dm-list`' },
        { name: 'text', required: true, positional: true, help: 'Message text' },
    ],
    columns: ['status', 'conv', 'text'],
    func: async (page, kwargs) => {
        try {
            const convId = assertConvId(kwargs.conv);
            const text = assertMessageText(kwargs.text);
            await openChat(page, convId);
            await page.wait({ selector: '.xhs-im-input-bar-editor', timeout: SELECTOR_TIMEOUT_S });
            await typeIntoComposer(page, text);
            const echoed = unwrapEvaluateResult(await page.evaluate(buildWaitForEchoJs(text)));
            if (echoed !== true) {
                throw new CommandExecutionError(
                    'xiaohongshu/dm-send: the message did not appear in the conversation (blocked by the platform, or the composer changed)',
                );
            }
            return [{ status: 'sent', conv: convId, text }];
        } catch (err) {
            if (err instanceof CliError) throw err;
            throw new CommandExecutionError(`xiaohongshu/dm-send failed: ${err?.message ?? String(err)}`);
        }
    },
});

export const __test__ = { pressEnter, typeIntoComposer };
