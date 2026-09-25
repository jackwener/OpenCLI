import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError, CommandExecutionError, EXIT_CODES, TimeoutError } from '@jackwener/opencli/errors';
import {
    DEEPSEEK_DOMAIN, ensureOnDeepSeek, ensureFreshConversation, selectModel, setFeature,
    sendMessage, sendWithFile, getBubbleCount, waitForResponse, parseBoolFlag, withRetry,
    pickResumeUrl, TEXTAREA_SELECTOR,
} from './utils.js';

const restoredConversationError = (reason) => new CommandExecutionError(
    `DeepSeek restored the previous conversation, so --new could not start a fresh thread (${reason})`,
    'Retry, or open chat.deepseek.com and start a new chat manually before re-running.',
);

export const askCommand = cli({
    site: 'deepseek',
    name: 'ask',
    access: 'write',
    description: 'Send a prompt to DeepSeek and get the response',
    domain: DEEPSEEK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
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
        const wantNew = parseBoolFlag(kwargs.new);
        const wantModel = kwargs.model || 'instant';

        if ((wantModel === 'vision' || wantModel === 'expert') && wantSearch) {
            throw new CliError(
                'ARGUMENT',
                `DeepSeek ${wantModel} mode does not support --search.`,
                'Run without --search, or use --model instant for web search.',
                EXIT_CODES.USAGE_ERROR,
            );
        }

        if (wantNew) {
            const fresh = await ensureFreshConversation(page);
            if (!fresh.ok && fresh.reason !== 'composer-missing') {
                // DeepSeek auto-restored the previous thread and the escape
                // failed. Sending now would append to the old conversation —
                // the exact silent-corruption --new exists to prevent. The
                // reason distinguishes a restore race from a missing sidebar
                // control (i.e. a DeepSeek UI change).
                throw restoredConversationError(fresh.reason);
            }
            // composer-missing → fall through so downstream selectModel/
            // sendMessage surface the failure with a typed error — the same
            // logged-out behavior --new had before the freshness guard,
            // kept unchanged on purpose.
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
                try {
                    await page.wait({ selector: TEXTAREA_SELECTOR, timeout: 5 });
                } catch {
                    // Conversation page may still be loading; subsequent steps
                    // will retry or report.
                }
            }
        }

        // Model selector is only available on the new-chat page, not inside
        // an existing conversation. Skip it when we resumed a prior thread.
        const currentUrl = await page.evaluate('window.location.href') || '';
        const inConversation = currentUrl.includes('/a/chat/s/');
        const modelExplicit = kwargs.__opencliOptionSources?.model === 'cli';

        // Early exit so a restore detected here fails before the model/feature
        // toggles run (and before the misleading model-switch usage error
        // below). Not redundant with the empty-baseline guard before the
        // send: a restore flips the URL before its old messages render, so
        // this check catches "on a thread, bubbles still 0" while the
        // baseline catches "bubbles rendered, URL snapshot stale". Each
        // covers a window the other misses — neither can be demoted to a
        // hint.
        if (wantNew && inConversation) {
            throw restoredConversationError('conversation-restored');
        }

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
            // The 0.5 s settle previously here was redundant: each subsequent
            // step (setFeature, sendMessage) issues a fresh CDP eval, giving
            // React more than enough time to flush the toggle's state update.
        }

        const thinkResult = await withRetry(() => setFeature(page, 'DeepThink', wantThink));
        if (!thinkResult?.ok && wantThink) {
            throw new CommandExecutionError('Could not enable DeepThink');
        }

        // Only instant mode has the Search toggle in the DeepSeek UI.
        let searchResult;
        if (wantModel !== 'vision' && wantModel !== 'expert') {
            searchResult = await withRetry(() => setFeature(page, 'Search', wantSearch));
            if (!searchResult?.ok && wantSearch) {
                throw new CommandExecutionError('Could not enable Search');
            }
        }

        // No settle wait after toggles: the next CDP eval below already gives
        // React time to flush the aria-checked state.

        // --new must send into an empty conversation. The URL checks above are
        // racy snapshots (the SPA can restore the old thread at any point up
        // to here), but a restored thread always carries its old messages, so
        // a zero bubble baseline right before the send is a timing-independent
        // test of the same invariant. Rests on one live-verified fact
        // (2026-08): a fresh chat page renders zero .ds-message elements. If
        // DeepSeek ever ships welcome bubbles, every --new fails loudly here
        // — never silently. The remaining exposure is the gap between this
        // check and the actual send click (upload-sized on the --file path);
        // it is irreducible without an atomic in-page check-and-send, and
        // restores are empirically a load-time behavior, long past by now.
        const baseline = await withRetry(() => getBubbleCount(page));
        if (wantNew && baseline > 0) {
            throw restoredConversationError('conversation-restored');
        }

        if (kwargs.file) {
            try {
                const fileResult = await sendWithFile(page, kwargs.file, prompt);
                if (fileResult && !fileResult.ok) {
                    throw new CommandExecutionError(fileResult.reason || 'Failed to attach file');
                }
            } catch (err) {
                // SPA navigates after send; "Promise was collected" means send succeeded
                if (!String(err?.message || err).includes('Promise was collected')) throw err;
            }
            // waitForResponse polls every 3 s for new bubbles, so the previous
            // 3 s settle here was a redundant sleep on top of the first poll.
            const result = await waitForResponse(page, baseline, prompt, timeoutMs, wantThink);
            if (!result) {
                throw new TimeoutError('deepseek ask', kwargs.timeout, 'No DeepSeek reply observed before timeout. Retry with --timeout increased.');
            }
            if (wantThink && typeof result === 'object' && result.response !== undefined) {
                return [result];
            }
            return [{ response: result }];
        }

        const sendResult = await withRetry(() => sendMessage(page, prompt));
        if (!sendResult?.ok) {
            throw new CommandExecutionError(sendResult?.reason || 'Failed to send message');
        }

        const result = await waitForResponse(page, baseline, prompt, timeoutMs, wantThink);
        if (!result) {
            throw new TimeoutError('deepseek ask', kwargs.timeout, 'No DeepSeek reply observed before timeout. Retry with --timeout increased.');
        }

        if (wantThink && typeof result === 'object' && result.response !== undefined) {
            return [result];
        }
        return [{ response: result }];
    },
});
