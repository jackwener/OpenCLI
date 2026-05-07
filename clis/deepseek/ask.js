import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError, CommandExecutionError, EXIT_CODES } from '@jackwener/opencli/errors';
import {
    DEEPSEEK_DOMAIN, DEEPSEEK_URL, ensureOnDeepSeek, selectModel, setFeature,
    sendMessage, sendWithFile, getBubbleCount, waitForResponse, parseBoolFlag, withRetry,
    pickResumeUrl,
} from './utils.js';

export const askCommand = cli({
    site: 'deepseek',
    name: 'ask',
    access: 'write',
    description: 'Send a prompt to DeepSeek and get the response',
    domain: DEEPSEEK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'prompt', positional: true, required: true, help: 'Prompt to send' },
        { name: 'timeout', type: 'int', default: 120, help: 'Max seconds to wait for response' },
        { name: 'new', type: 'boolean', default: false, help: 'Start a new chat before sending' },
        { name: 'model', default: 'instant', choices: ['instant', 'expert', 'vision'], help: 'Model to use: instant, expert, or vision' },
        { name: 'think', type: 'boolean', default: false, help: 'Enable DeepThink mode' },
        { name: 'search', type: 'boolean', default: false, help: 'Enable web search' },
        { name: 'file', help: 'Attach a file (PDF, image, text) with the prompt' },
    ],
    // columns omitted: derived from row keys so non-think output shows only 'response'

    func: async (page, kwargs) => {
        const prompt = kwargs.prompt;
        const timeoutMs = (kwargs.timeout || 120) * 1000;
        const wantThink = parseBoolFlag(kwargs.think);
        const wantSearch = parseBoolFlag(kwargs.search);

        if (parseBoolFlag(kwargs.new)) {
            await page.goto(DEEPSEEK_URL);
            await page.wait(3);
        } else {
            const navigated = await ensureOnDeepSeek(page);
            if (navigated) {
                // Pinned conversations sit in their own DOM section and are
                // skipped so the resume never lands on a topped chat.
                const resumeUrl = await pickResumeUrl(page);
                if (!resumeUrl) {
                    throw new CommandExecutionError(
                        'Workspace was recycled but no prior conversation could be loaded',
                        'Pass --new to start a fresh chat, or wait for the sidebar to populate before retrying.',
                    );
                }
                await page.goto(resumeUrl);
                await page.wait(2);
            }
        }

        await page.wait(2);

        // Model selector is only available on the new-chat page, not inside
        // an existing conversation. Skip it when we resumed a prior thread.
        const currentUrl = await page.evaluate('window.location.href') || '';
        const inConversation = currentUrl.includes('/a/chat/s/');
        const modelExplicit = kwargs.__opencliOptionSources?.model === 'cli';

        const wantModel = kwargs.model || 'instant';
        if (inConversation && modelExplicit) {
            throw new CliError(
                'ARGUMENT',
                `Cannot switch to ${wantModel} model inside an existing conversation.`,
                'Re-run with --new to start a fresh chat before selecting a model.',
                EXIT_CODES.USAGE_ERROR,
            );
        }

        if (!inConversation) {
            const modelResult = await withRetry(() => selectModel(page, wantModel));
            if (!modelResult?.ok) {
                throw new CommandExecutionError(`Could not switch to ${wantModel} model`);
            }
            if (modelResult?.toggled) await page.wait(0.5);
        }

        const thinkResult = await withRetry(() => setFeature(page, 'DeepThink', wantThink));
        if (!thinkResult?.ok && wantThink) {
            throw new CommandExecutionError('Could not enable DeepThink');
        }

        if (wantModel === 'vision' && wantSearch) {
            throw new CliError(
                'ARGUMENT',
                'DeepSeek vision mode does not support --search.',
                'Run without --search, or use --model instant/expert for web search.',
                EXIT_CODES.USAGE_ERROR,
            );
        }

        // Vision mode does not have the search toggle.
        let searchResult;
        if (wantModel !== 'vision') {
            searchResult = await withRetry(() => setFeature(page, 'Search', wantSearch));
            if (!searchResult?.ok && wantSearch) {
                throw new CommandExecutionError('Could not enable Search');
            }
        }

        if (thinkResult?.toggled || searchResult?.toggled) await page.wait(0.5);

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
            await page.wait(3);
            const result = await waitForResponse(page, baseline, prompt, timeoutMs, wantThink);
            if (!result) {
                return [{ response: `[NO RESPONSE] No reply within ${kwargs.timeout}s.` }];
            }
            if (wantThink && typeof result === 'object' && result.response !== undefined) {
                return [result];
            }
            return [{ response: result }];
        }

        const baseline = await withRetry(() => getBubbleCount(page));
        const sendResult = await withRetry(() => sendMessage(page, prompt));
        if (!sendResult?.ok) {
            throw new CommandExecutionError(sendResult?.reason || 'Failed to send message');
        }

        const result = await waitForResponse(page, baseline, prompt, timeoutMs, wantThink);
        if (!result) {
            return [{ response: `[NO RESPONSE] No reply within ${kwargs.timeout}s.` }];
        }

        if (wantThink && typeof result === 'object' && result.response !== undefined) {
            return [result];
        }
        return [{ response: result }];
    },
});
