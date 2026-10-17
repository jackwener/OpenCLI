import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
    CHATGPT_DOMAIN,
    currentChatGPTUrl,
    ensureChatGPTComposer,
    ensureOnChatGPT,
    getChatGPTResponsePairCounts,
    getVisibleMessages,
    normalizeBooleanFlag,
    openChatGPTConversation,
    navigateToProject,
    parseChatGPTConversationId,
    sendChatGPTMessage,
    startNewChat,
    uploadChatGPTFiles,
    waitForChatGPTResponse,
} from './utils.js';

function parseFilePaths(value) {
    if (Array.isArray(value)) {
        return value.flatMap(item => parseFilePaths(item));
    }
    return String(value ?? '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

export const askFileCommand = cli({
    site: 'chatgpt',
    name: 'ask-file',
    access: 'write',
    description: 'Send a prompt to ChatGPT with attached local file(s) (images, documents, code) and return the assistant response',
    domain: CHATGPT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    defaultFormat: 'plain',
    args: [
        { name: 'prompt', positional: true, required: true, help: 'Prompt to send' },
        { name: 'file', required: true, help: 'Local file path(s) to attach, comma-separated (e.g. "screenshot.png,notes.txt")' },
        { name: 'timeout', type: 'int', default: 120, help: 'Max seconds to wait for response (default: 120)' },
        { name: 'new', type: 'boolean', default: false, help: 'Start a new chat before sending' },
        { name: 'conversation', valueRequired: true, help: 'Continue an existing ChatGPT conversation ID or /c/<id> URL' },
        { name: 'project', valueRequired: true, help: 'Start a new chat inside a ChatGPT project ID or /g/g-p-<id> URL' },
    ],
    columns: ['conversation_id', 'conversation_url', 'attachments', 'response'],
    func: async (page, kwargs) => {
        const prompt = String(kwargs.prompt || '').trim();
        if (!prompt) {
            throw new ArgumentError('chatgpt ask-file requires a non-empty prompt');
        }

        const filePaths = parseFilePaths(kwargs.file);
        if (!filePaths.length) {
            throw new ArgumentError(
                'chatgpt ask-file requires at least one file path via --file',
                'Example: opencli chatgpt ask-file "Describe this image" --file photo.png'
            );
        }

        const timeout = Number(kwargs.timeout ?? 120);
        if (!Number.isInteger(timeout) || timeout <= 0) {
            throw new ArgumentError('--timeout must be a positive integer (seconds)');
        }

        if (normalizeBooleanFlag(kwargs.new) && kwargs.conversation) {
            throw new ArgumentError('chatgpt ask-file cannot use --new and --conversation together');
        }
        if (kwargs.project && kwargs.conversation) {
            throw new ArgumentError('chatgpt ask-file cannot use --project and --conversation together');
        }

        if (kwargs.conversation) {
            await openChatGPTConversation(page, kwargs.conversation);
        } else if (kwargs.project) {
            await navigateToProject(page, kwargs.project);
        } else if (normalizeBooleanFlag(kwargs.new)) {
            await startNewChat(page);
        } else {
            await ensureOnChatGPT(page);
        }

        await ensureChatGPTComposer(page, 'ChatGPT ask-file requires an authenticated session with an active composer.');

        // 1. Upload files into composer
        let uploadResult;
        try {
            uploadResult = await uploadChatGPTFiles(page, filePaths);
        } catch (err) {
            throw new CommandExecutionError(
                `Failed to attach files: ${err instanceof Error ? err.message : String(err)}`
            );
        }
        if (!uploadResult?.ok) {
            throw new CommandExecutionError(uploadResult?.reason || 'Failed to attach files to ChatGPT composer');
        }

        // Baseline message count & pair counts
        const baselineMessages = await getVisibleMessages(page, { textOnly: true });
        const baselineCount = baselineMessages.length;
        const baselinePairCounts = getChatGPTResponsePairCounts(baselineMessages, prompt);

        // 2. Send prompt
        const sent = await sendChatGPTMessage(page, prompt);
        if (!sent) {
            throw new CommandExecutionError('Failed to send message to ChatGPT');
        }

        // 3. Wait for response with proactive UI error interception
        const responseText = await waitForChatGPTResponse(page, baselineCount, prompt, timeout, { baselinePairCounts });

        const currentUrl = await currentChatGPTUrl(page);
        const conversationId = parseChatGPTConversationId(currentUrl) || '';

        return [{
            conversation_id: conversationId,
            conversation_url: currentUrl,
            attachments: filePaths.length,
            response: responseText,
        }];
    },
});
