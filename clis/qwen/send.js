import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
    QIANWEN_DOMAIN,
    authRequired,
    dismissLoginModal,
    ensureOnQianwen,
    hasLoginGate,
    normalizeBooleanFlag,
    sendMessage,
    setFeatureToggle,
    startNewChat,
} from './utils.js';

cli({
    site: 'qwen',
    name: 'send',
    access: 'write',
    description: 'Fire-and-forget: send a prompt to Qianwen without waiting for the reply',
    domain: QIANWEN_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    browserSession: { reuse: 'site' },
    navigateBefore: false,
    args: [
        { name: 'prompt', required: true, positional: true, help: 'Prompt to send to Qianwen' },
        { name: 'new', type: 'boolean', default: false, help: 'Start a new chat before sending' },
        { name: 'think', type: 'boolean', default: false, help: 'Enable 深度思考 (DeepThink)' },
        { name: 'research', type: 'boolean', default: false, help: 'Enable 深度研究 (DeepResearch)' },
    ],
    columns: ['Status', 'Prompt'],
    func: async (page, kwargs) => {
        const prompt = String(kwargs.prompt || '').trim();
        if (!prompt) throw new ArgumentError('prompt is required');
        const startFresh = normalizeBooleanFlag(kwargs.new, false);
        const useThink = normalizeBooleanFlag(kwargs.think, false);
        const useResearch = normalizeBooleanFlag(kwargs.research, false);

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
        return [{ Status: 'sent', Prompt: prompt }];
    },
});
