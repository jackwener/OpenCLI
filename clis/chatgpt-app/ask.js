import { execSync } from 'node:child_process';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ConfigError } from '@jackwener/opencli/errors';
import { activateChatGPT, getVisibleChatMessages, selectModel, MODEL_CHOICES, isGenerating, sendPrompt } from './ax.js';
export const askCommand = cli({
    site: 'chatgpt-app',
    name: 'ask',
    description: 'Send a prompt and wait for the AI response (send + wait + read)',
    domain: 'localhost',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'text', required: true, positional: true, help: 'Prompt to send' },
        { name: 'model', required: false, help: 'Model/mode to use: auto, instant, thinking, 5.2-instant, 5.2-thinking', choices: MODEL_CHOICES },
        { name: 'timeout', required: false, help: 'Max seconds to wait for response (default: 30)', default: '30' },
    ],
    columns: ['Role', 'Text'],
    func: async (page, kwargs) => {
        if (process.platform !== 'darwin') {
            throw new ConfigError('ChatGPT Desktop integration requires macOS (osascript is not available on this platform)');
        }
        const text = kwargs.text;
        const model = kwargs.model;
        const timeout = parseInt(kwargs.timeout, 10) || 30;
        // Switch model before sending if requested
        if (model) {
            activateChatGPT();
            selectModel(model);
        }
        const messagesBefore = getVisibleChatMessages();
        // Send the message
        activateChatGPT();
        sendPrompt(text);
        // Wait for response: poll until ChatGPT stops generating ("Stop generating" button disappears),
        // then read the final response text.
        const pollInterval = 2;
        const maxPolls = Math.ceil(timeout / pollInterval);
        let response = '';
        let generationStarted = false;
        for (let i = 0; i < maxPolls; i++) {
            execSync(`sleep ${pollInterval}`);
            const generating = isGenerating();
            if (generating) {
                generationStarted = true;
                continue;
            }
            // Generation finished (or never started yet)
            if (!generationStarted && i < 3)
                continue; // give it a moment to start
            // Read final response
            activateChatGPT(0.3);
            const messagesNow = getVisibleChatMessages();
            if (messagesNow.length > messagesBefore.length) {
                const newMessages = messagesNow.slice(messagesBefore.length);
                const candidate = [...newMessages].reverse().find((message) => message !== text);
                if (candidate)
                    response = candidate;
            }
            break;
        }
        if (!response) {
            return [
                { Role: 'User', Text: text },
                { Role: 'System', Text: `No response within ${timeout}s. ChatGPT may still be generating.` },
            ];
        }
        return [
            { Role: 'User', Text: text },
            { Role: 'Assistant', Text: response },
        ];
    },
});
