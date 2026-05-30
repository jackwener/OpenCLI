import { execSync } from 'node:child_process';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ConfigError, getErrorMessage } from '@jackwener/opencli/errors';
export const newCommand = cli({
    site: 'chatgpt-app',
    name: 'new',
    access: 'read',
    description: 'Open a new chat in ChatGPT Desktop App',
    domain: 'localhost',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'temp', type: 'boolean', default: false, help: 'Open a temporary chat with privacy protection' }
    ],
    columns: ['Status'],
    func: async (kwargs) => {
        if (process.platform !== 'darwin') {
            throw new ConfigError('ChatGPT Desktop integration requires macOS (osascript is not available on this platform)');
        }
        try {
            execSync("osascript -e 'tell application \"ChatGPT\" to activate'");
            execSync("osascript -e 'delay 0.5'");
            if (kwargs.temp) {
                const appleScript = [
                    'tell application "System Events"',
                    '  tell process "ChatGPT"',
                    '    try',
                    '      click menu item "新的临时聊天" of menu "文件" of menu bar 1',
                    '    on error',
                    '      try',
                    '        click menu item "新的臨時聊天" of menu "檔案" of menu bar 1',
                    '      on error',
                    '        try',
                    '          click menu item "New Temporary Chat" of menu "File" of menu bar 1',
                    '        on error',
                    '          error "Unable to locate Temporary Chat menu item. Ensure Accessibility permissions are granted and the language is supported."' ,
                    '        end try',
                    '      end try',
                    '    end try',
                    '  end tell',
                    'end tell'
                ].map(line => `-e '${line.replace(/'/g, "'\\''")}'`).join(' ');
                execSync(`osascript ${appleScript}`);
            } else {
                execSync("osascript -e 'tell application \"System Events\" to keystroke \"n\" using command down'");
            }
            return [{ Status: 'Success' }];
        }
        catch (err) {
            return [{ Status: "Error: " + getErrorMessage(err) }];
        }
    },
});
