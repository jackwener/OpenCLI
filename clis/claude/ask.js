import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    CLAUDE_DOMAIN, CLAUDE_URL, COMPOSER_SELECTOR, MESSAGE_SELECTOR,
    ensureOnClaude, selectModel, setAdaptiveThinking,
    sendMessage, sendWithFile, getBubbleCount, waitForResponse, parseBoolFlag, withRetry,
    ensureClaudeComposer, requireNonEmptyPrompt, requirePositiveInt,
} from './utils.js';

export const askCommand = cli({
    site: 'claude',
    name: 'ask',
    access: 'write',
    description: 'Send a prompt to Claude and get the response',
    domain: CLAUDE_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    browserSession: { reuse: 'site' },
    navigateBefore: false,
    args: [
        { name: 'prompt', positional: true, required: true, help: 'Prompt to send' },
        { name: 'timeout', type: 'int', default: 120, help: 'Max seconds to wait for response' },
        { name: 'new', type: 'boolean', default: false, help: 'Start a new chat before sending' },
        { name: 'model', default: 'sonnet', choices: ['sonnet', 'opus', 'haiku'], help: 'Model to use: sonnet, opus, or haiku' },
        { name: 'think', type: 'boolean', default: false, help: 'Enable Adaptive thinking' },
        { name: 'file', help: 'Attach a file (image, PDF, text) with the prompt' },
    ],
    columns: ['response'],

    func: async (page, kwargs) => {
        const prompt = requireNonEmptyPrompt(kwargs.prompt, 'claude ask');
        const timeoutSeconds = requirePositiveInt(
            Number(kwargs.timeout ?? 120),
            'claude ask --timeout',
            'Example: opencli claude ask "hello" --timeout 120',
        );
        const timeoutMs = timeoutSeconds * 1000;
        const wantThink = parseBoolFlag(kwargs.think);

        if (parseBoolFlag(kwargs.new)) {
            await page.goto(CLAUDE_URL);
            try {
                await page.wait({ selector: COMPOSER_SELECTOR, timeout: 8 });
            } catch {
                // Composer didn't mount; ensureClaudeComposer below surfaces a typed error.
            }
        } else {
            const navigated = await ensureOnClaude(page);
            if (navigated) {
                // Workspace was recycled; try to resume the most recent
                // conversation instead of starting a new one.
                await page.evaluate(`(() => {
                    var link = document.querySelector('a[href*="/chat/"]');
                    if (link) link.click();
                })()`);
                // Wait for the resumed conversation to render messages, or
                // fall through if the link click had no effect (no recents).
                try {
                    await page.wait({ selector: MESSAGE_SELECTOR, timeout: 5 });
                } catch {
                    // No prior conversation; ensureClaudeComposer still requires composer below.
                }
            }
        }

        // ensureClaudeComposer reads composer presence directly via getPageState,
        // so the previous standalone 2 s settle is redundant.
        await withRetry(() => ensureClaudeComposer(page, 'Claude ask requires a visible composer on the current page.'));

        // Model selector is only available on the new-chat page, not inside
        // an existing conversation. Skip it when we resumed a prior thread.
        const currentUrl = await page.evaluate('window.location.href') || '';
        const inConversation = currentUrl.includes('/chat/');
        const modelExplicit = kwargs.__opencliOptionSources?.model === 'cli';

        const wantModel = kwargs.model || 'sonnet';
        if (inConversation && modelExplicit) {
            throw new ArgumentError(
                `Cannot switch to ${wantModel} model inside an existing conversation.`,
                'Re-run with --new to start a fresh chat before selecting a model.',
            );
        }

        if (!inConversation) {
            const modelResult = await withRetry(() => selectModel(page, wantModel));
            if (!modelResult?.ok) {
                if (modelResult?.upgrade) {
                    throw new ArgumentError(
                        `${wantModel} model requires a paid Claude plan.`,
                        'Pick --model sonnet or --model haiku, or upgrade your account.',
                    );
                }
                throw new CommandExecutionError(`Could not switch to ${wantModel} model`);
            }
            // Post-toggle settle dropped — the next CDP eval (setAdaptiveThinking) gives
            // React enough time to flush aria-checked updates between rountrips.
        }

        const thinkResult = await withRetry(() => setAdaptiveThinking(page, wantThink));
        if (!thinkResult?.ok && wantThink) {
            throw new CommandExecutionError('Could not enable Adaptive thinking');
        }
        // Post-toggle settle dropped — the next CDP eval (sendMessage / sendWithFile)
        // gives React enough time to flush aria-checked updates.

        if (kwargs.file) {
            const baseline = await withRetry(() => getBubbleCount(page));
            try {
                const fileResult = await sendWithFile(page, kwargs.file, prompt);
                if (fileResult && !fileResult.ok) {
                    throw new CommandExecutionError(fileResult.reason || 'Failed to attach file');
                }
            } catch (err) {
                // SPA navigates after send; "Promise was collected" means send succeeded
                if (!String(err?.message || err).includes('Promise was collected')) throw err;
            }
            // Pre-waitForResponse settle dropped — waitForResponse's first 3 s polling
            // tick covers the same window without an unconditional sleep.
            const result = await waitForResponse(page, baseline, prompt, timeoutMs);
            if (!result) {
                throw new EmptyResultError(
                    'claude ask',
                    `No Claude response appeared within ${timeoutSeconds}s. Re-run with a higher --timeout if the model is still generating.`,
                );
            }
            return [{ response: result }];
        }

        const baseline = await withRetry(() => getBubbleCount(page));
        const sendResult = await withRetry(() => sendMessage(page, prompt));
        if (!sendResult?.ok) {
            throw new CommandExecutionError(sendResult?.reason || 'Failed to send message');
        }

        const result = await waitForResponse(page, baseline, prompt, timeoutMs);
        if (!result) {
            throw new EmptyResultError(
                'claude ask',
                `No Claude response appeared within ${timeoutSeconds}s. Re-run with a higher --timeout if the model is still generating.`,
            );
        }
        return [{ response: result }];
    },
});
