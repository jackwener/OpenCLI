import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import { DOUBAO_DOMAIN, DOUBAO_CHAT_URL } from './utils.js';
import { chatStateScript, checkVerification, COMPOSER_SELECTOR, SEND_SELECTOR, selectDoubaoMode } from './chat-ui.js';

const normalizeInput = value => value.replace(/\r\n?/g, '\n').trim();
const normalizeMessage = value => value.replace(/\s+/g, '');

export async function askDoubao(page, kwargs) {
    const text = kwargs.text;
    const timeout = kwargs.timeout ?? 120;
    const mode = kwargs.mode ?? 'current';
    if (typeof text !== 'string' || !text.trim()) throw new ArgumentError('Prompt must not be empty');
    if (!Number.isInteger(timeout) || timeout < 1) throw new ArgumentError('--timeout must be a positive integer (seconds)');
    if (!['current', 'fast', 'expert'].includes(mode)) throw new ArgumentError('--mode must be current, fast, or expert');

    let state = await page.evaluate(chatStateScript);
    checkVerification(state);
    // Check before navigation as well: reloading must not discard an unsent draft.
    if (state.input?.trim()) throw new CommandExecutionError('Doubao has an unsent draft', 'The draft was left untouched. Send or clear it before retrying.');
    if (state.generating) throw new CommandExecutionError('Doubao is still generating a response', 'Wait for it to finish before sending another prompt.');
    const url = /^https:\/\/www\.doubao\.com\/chat(?:\/|$)/.test(state.url) ? state.url : DOUBAO_CHAT_URL;
    // Pin native input and DOM evaluation to the leased page. Do not adopt an
    // unrelated user tab when a fresh site session initially resolves to blank.
    await page.goto(url, { waitUntil: 'load', settleMs: 1500 });
    const composerDeadline = Date.now() + 8000;
    while (Date.now() < composerDeadline) {
        state = await page.evaluate(chatStateScript);
        checkVerification(state);
        if (state.inputCount === 1) break;
        await page.wait(0.2);
    }
    if (state.inputCount !== 1) throw new CommandExecutionError('Could not find a unique visible Doubao composer', 'Check login and use --window foreground.');
    if (state.input.trim()) throw new CommandExecutionError('Doubao has an unsent draft', 'The draft was left untouched. Send or clear it before retrying.');
    if (state.generating) throw new CommandExecutionError('Doubao is still generating a response');
    const modeLabel = await selectDoubaoMode(page, mode);
    state = await page.evaluate(chatStateScript);
    checkVerification(state);
    if (state.inputCount !== 1 || state.input.trim()) throw new CommandExecutionError('Doubao composer changed while selecting the mode', 'No prompt was inserted. Inspect the page before retrying.');
    if (state.generating) throw new CommandExecutionError('Doubao started generating while selecting the mode', 'No prompt was inserted. Wait for it to finish.');
    const oldUsers = new Set(state.users.map(user => user.id).filter(Boolean));
    const oldReplies = new Set(state.replies.map(reply => reply.id).filter(Boolean));
    await page.typeText(COMPOSER_SELECTOR, text, { nth: state.inputIndex });

    let previousPoint = null;
    let stableSince = 0;
    let ready = false;
    const sendDeadline = Date.now() + 4000;
    while (Date.now() < sendDeadline) {
        state = await page.evaluate(chatStateScript);
        checkVerification(state);
        if (state.generating) throw new CommandExecutionError('Doubao started generating before submission', 'No send was attempted. Inspect the draft before retrying.');
        if (state.inputCount !== 1 || normalizeInput(state.input) !== normalizeInput(text)) {
            throw new CommandExecutionError('Doubao composer text does not match the prompt', 'No send was attempted. Inspect the draft before retrying.');
        }
        if (modeLabel && state.modeLabel !== modeLabel) throw new CommandExecutionError('Doubao mode changed before submission', 'No send was attempted. Inspect the mode and draft before retrying.');
        const point = state.sendReady ? state.point : null;
        const same = point && previousPoint && ['x', 'y', 'w', 'h'].every(key => Math.abs(point[key] - previousPoint[key]) < 1);
        if (!same) stableSince = point ? Date.now() : 0;
        previousPoint = point;
        if (stableSince && Date.now() - stableSince >= 300) { ready = true; break; }
        await page.wait(0.1);
    }
    if (!ready) throw new CommandExecutionError('Doubao send button is not stable and unobstructed', 'The draft was preserved; no send was attempted.');
    await page.click(SEND_SELECTOR, { nth: state.sendIndex });
    const submittedAt = Date.now();
    const deadline = submittedAt + timeout * 1000;
    let accepted = false;
    let lastReply = '';
    let replyStableSince = 0;
    while (Date.now() < deadline) {
        await page.wait(0.5);
        state = await page.evaluate(chatStateScript);
        checkVerification(state);
        accepted ||= state.users.some(user => user.id && !oldUsers.has(user.id) && normalizeMessage(user.text) === normalizeMessage(text));
        const reply = state.replies.filter(candidate => candidate.id && !oldReplies.has(candidate.id)).at(-1);
        if (accepted && reply?.done && reply.text && !state.generating) {
            const signature = JSON.stringify([reply.id, reply.text, reply.links]);
            if (signature !== lastReply) { lastReply = signature; replyStableSince = Date.now(); }
            else if (Date.now() - replyStableSince >= 1500) {
                const links = reply.links.filter(link => !reply.text.includes(link));
                const response = reply.text + (links.length ? '\n\nSources:\n' + links.join('\n') : '');
                return [{ Role: 'User', Text: text }, { Role: 'Assistant', Text: response }];
            }
        } else { lastReply = ''; replyStableSince = 0; }
        if (!accepted && Date.now() - submittedAt >= 12000) {
            throw new CommandExecutionError('Doubao submission was not confirmed', 'No automatic resend was attempted. Inspect the conversation and draft before retrying.');
        }
    }
    throw new TimeoutError(accepted ? 'Doubao completed response' : 'Doubao submission confirmation', timeout,
        accepted ? 'The prompt was submitted. Inspect the conversation before retrying to avoid a duplicate.' : 'Submission was not confirmed. Inspect the conversation and draft before retrying.');
}

export const askCommand = cli({
    site: 'doubao',
    name: 'ask',
    access: 'write',
    description: 'Send a prompt in the selected Doubao mode and wait for a completed response',
    domain: DOUBAO_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    defaultWindowMode: 'foreground',
    args: [
        { name: 'text', required: true, positional: true, help: 'Prompt to send' },
        { name: 'timeout', type: 'int', default: 120, help: 'Max seconds to wait for the response (default: 120)' },
        { name: 'mode', default: 'current', choices: ['current', 'fast', 'expert'], help: 'Keep the current mode, or select fast/expert through the page menu' },
    ],
    columns: ['Role', 'Text'],
    func: askDoubao,
});
