import { cli, Strategy } from '@jackwener/opencli/registry';
import { SelectorError } from '@jackwener/opencli/errors';
export const sendCommand = cli({
    site: 'cursor',
    name: 'send',
    description: 'Send a prompt directly into Cursor Composer/Chat',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [{ name: 'text', required: true, positional: true, help: 'Text to send into Cursor' }],
    columns: ['Status', 'InjectedText'],
    func: async (page, kwargs) => {
        const textToInsert = kwargs.text;
        const injected = await page.evaluate(`(function(text) {
        // Find the Lexical editor input for Composer or Chat
        let composer = document.querySelector('.aislash-editor-input, [data-lexical-editor="true"], [contenteditable="true"]');
        
        if (!composer) {
            return false;
        }

        composer.focus();
        document.execCommand('insertText', false, text);
        return true;
      })(${JSON.stringify(textToInsert)})`);
        if (!injected) {
            throw new SelectorError('Cursor Composer input element');
        }
        // Submit the command. In Cursor, Enter usually submits the chat.
        await page.wait(0.5);
        await page.pressKey('Enter');
        await page.wait(1);
        return [
            {
                Status: 'Success',
                InjectedText: textToInsert,
            },
        ];
    },
});
