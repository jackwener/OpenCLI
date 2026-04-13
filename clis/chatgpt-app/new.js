import { execSync } from 'node:child_process';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ConfigError, getErrorMessage } from '@jackwener/opencli/errors';
export const newCommand = cli({
    site: 'chatgpt-app',
    name: 'new',
    description: 'Open a new chat in ChatGPT Desktop App',
    domain: 'localhost',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [],
    columns: ['Status'],
    func: async (page) => {
        if (process.platform !== 'darwin') {
            throw new ConfigError('ChatGPT Desktop integration requires macOS (osascript is not available on this platform)');
        }
        try {
            execSync("osascript -e 'tell application \"ChatGPT\" to activate'");
            execSync("osascript -e 'delay 0.5'");
            execSync("osascript -e 'tell application \"System Events\" to keystroke \"n\" using command down'");
            return [{ Status: 'Success' }];
        }
        catch (err) {
            return [{ Status: "Error: " + getErrorMessage(err) }];
        }
    },
});
