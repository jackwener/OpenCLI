import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import {
    QIANWEN_DOMAIN,
    QIANWEN_URL,
    authRequired,
    bubbleHtmlToMarkdown,
    dismissLoginModal,
    ensureOnQianwen,
    getMessageBubbles,
    hasLoginGate,
    normalizeBooleanFlag,
    sendMessage,
    setFeatureToggle,
    startNewChat,
    waitForAnswer,
} from './utils.js';

cli({
    site: 'qwen',
    name: 'ask',
    access: 'write',
    description: 'Send a prompt to Qianwen and return the assistant reply',
    domain: QIANWEN_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    browserSession: { reuse: 'site' },
    navigateBefore: false,
    defaultFormat: 'plain',
    args: [
        { name: 'prompt', required: true, positional: true, help: 'Prompt to send to Qianwen' },
        { name: 'timeout', type: 'int', default: 120, help: 'Max seconds to wait for the response' },
        { name: 'new', type: 'boolean', default: false, help: 'Start a new chat before sending' },
        { name: 'think', type: 'boolean', default: false, help: 'Enable 深度思考 (DeepThink)' },
        { name: 'research', type: 'boolean', default: false, help: 'Enable 深度研究 (DeepResearch)' },
        { name: 'markdown', type: 'boolean', default: false, help: 'Emit assistant reply as markdown' },
    ],
    columns: ['Role', 'Text'],
    func: async (page, kwargs) => {
        const prompt = String(kwargs.prompt || '').trim();
        if (!prompt) throw new ArgumentError('prompt is required');
        const timeout = Number(kwargs.timeout ?? 120);
        if (!Number.isInteger(timeout) || timeout <= 0) {
            throw new ArgumentError('timeout must be a positive integer');
        }
        const startFresh = normalizeBooleanFlag(kwargs.new, false);
        const useThink = normalizeBooleanFlag(kwargs.think, false);
        const useResearch = normalizeBooleanFlag(kwargs.research, false);
        const wantMarkdown = normalizeBooleanFlag(kwargs.markdown, false);

        await ensureOnQianwen(page);
        await dismissLoginModal(page);

        if (startFresh) {
            await startNewChat(page);
            await dismissLoginModal(page);
        }

        if (useThink) await setFeatureToggle(page, 'think', true);
        if (useResearch) await setFeatureToggle(page, 'research', true);

        const send = await sendMessage(page, prompt);
        if (!send?.ok) {
            if (await hasLoginGate(page)) throw authRequired();
            throw new CommandExecutionError(send?.reason || 'Failed to send Qianwen prompt');
        }

        const result = await waitForAnswer(page, prompt, timeout);
        if (result.status === 'auth_required') throw authRequired();
        if (result.status === 'timeout') {
            throw new TimeoutError('qianwen ask', timeout, 'No Qianwen reply observed before timeout. Retry with --timeout increased.');
        }
        const assistant = result.assistant;
        if (!assistant) {
            throw new CommandExecutionError('No assistant reply found in Qianwen chat.');
        }
        const answer = wantMarkdown && assistant.html
            ? (bubbleHtmlToMarkdown(assistant.html) || assistant.text)
            : assistant.text;
        return [
            { Role: 'User', Text: prompt },
            { Role: 'Assistant', Text: answer },
        ];
    },
});
