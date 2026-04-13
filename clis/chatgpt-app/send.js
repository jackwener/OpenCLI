import { execSync, spawnSync } from 'node:child_process';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { getErrorMessage } from '@jackwener/opencli/errors';
import { activateChatGPT, selectModel, MODEL_CHOICES } from './ax.js';
export const sendCommand = cli({
    site: 'chatgpt-app',
    name: 'send',
    description: 'Send a message to the active ChatGPT Desktop App window',
    domain: 'localhost',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'text', required: true, positional: true, help: 'Message to send' },
        { name: 'model', required: false, help: 'Model/mode to use: auto, instant, thinking, 5.2-instant, 5.2-thinking', choices: MODEL_CHOICES },
    ],
    columns: ['Status'],
    func: async (page, kwargs) => {
        const text = kwargs.text;
        const model = kwargs.model;
        try {
            // Switch model before sending if requested
            if (model) {
                activateChatGPT();
                selectModel(model);
            }
            // Backup current clipboard content
            let clipBackup = '';
            try {
                clipBackup = execSync('pbpaste', { encoding: 'utf-8' });
            }
            catch { /* clipboard may be empty */ }
            // Copy text to clipboard
            spawnSync('pbcopy', { input: text });
            activateChatGPT();
            const cmd = "osascript " +
                "-e 'tell application \"System Events\"' " +
                "-e 'keystroke \"v\" using command down' " +
                "-e 'delay 0.2' " +
                "-e 'keystroke return' " +
                "-e 'end tell'";
            execSync(cmd);
            // Restore original clipboard content
            if (clipBackup) {
                spawnSync('pbcopy', { input: clipBackup });
            }
            return [{ Status: 'Success' }];
        }
        catch (err) {
            return [{ Status: "Error: " + getErrorMessage(err) }];
        }
    },
});
