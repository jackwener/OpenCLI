import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
    YUANBAO_DOMAIN,
    authRequired,
    ensureYuanbaoPage,
    hasLoginGate,
    normalizeBooleanFlag,
    sendYuanbaoMessage,
    startNewYuanbaoChat,
} from './shared.js';

cli({
    site: 'yuanbao',
    name: 'send',
    access: 'write',
    description: 'Fire-and-forget: send a prompt to Yuanbao without waiting for the reply',
    domain: YUANBAO_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'prompt', positional: true, required: true, help: 'Prompt to send to Yuanbao' },
        { name: 'new', type: 'boolean', default: false, help: 'Start a new chat before sending' },
    ],
    columns: ['Status', 'Prompt'],
    func: async (page, kwargs) => {
        const prompt = String(kwargs.prompt || '').trim();
        if (!prompt) throw new ArgumentError('prompt', 'is required');
        const startFresh = normalizeBooleanFlag(kwargs.new, false);

        await ensureYuanbaoPage(page);
        if (await hasLoginGate(page)) {
            throw authRequired('Yuanbao opened a login gate before sending the prompt.');
        }
        if (startFresh) {
            const action = await startNewYuanbaoChat(page);
            if (action === 'blocked') {
                throw authRequired('Yuanbao opened a login gate while starting a new chat.');
            }
        }
        const send = await sendYuanbaoMessage(page, prompt);
        if (!send?.ok) {
            if (await hasLoginGate(page)) {
                throw authRequired('Yuanbao opened a login gate instead of accepting the prompt.');
            }
            throw new CommandExecutionError(
                send?.reason || 'Failed to send Yuanbao prompt',
                send?.detail
                    ? `Detail: ${send.detail}`
                    : 'Make sure the Yuanbao chat composer is visible and not in a disabled state.',
            );
        }
        return [{ Status: 'sent', Prompt: prompt }];
    },
});
