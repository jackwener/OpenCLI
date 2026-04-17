import { execSync } from 'node:child_process';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, ConfigError, getErrorMessage } from '@jackwener/opencli/errors';
import { getVisibleChatMessages } from './ax.js';
export const readCommand = cli({
    site: 'chatgpt-app',
    name: 'read',
    description: 'Read the last visible message from the focused ChatGPT Desktop window',
    domain: 'localhost',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [],
    columns: ['Role', 'Text'],
    func: async (page) => {
        if (process.platform !== 'darwin') {
            throw new ConfigError('ChatGPT Desktop integration requires macOS (osascript is not available on this platform)');
        }
        try {
            execSync("osascript -e 'tell application \"ChatGPT\" to activate'");
            execSync("osascript -e 'delay 0.3'");
            const messages = getVisibleChatMessages();
            if (!messages.length) {
                return [{ Role: 'System', Text: 'No visible chat messages were found in the current ChatGPT window.' }];
            }
            return [{ Role: 'Assistant', Text: messages[messages.length - 1] }];
        }
        catch (err) {
            throw new CommandExecutionError("Failed to read from ChatGPT: " + getErrorMessage(err));
        }
    },
});
