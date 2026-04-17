import { cli, Strategy } from '@jackwener/opencli/registry';
import { readMessagesScript } from './utils.js';
export const readCommand = cli({
    site: 'doubao-app',
    name: 'read',
    description: 'Read chat history from Doubao desktop app',
    domain: 'doubao-app',
    strategy: Strategy.UI,
    browser: true,
    columns: ['Role', 'Text'],
    func: async (page) => {
        const messages = await page.evaluate(readMessagesScript());
        if (!messages || messages.length === 0) {
            return [{ Role: 'System', Text: 'No conversation found' }];
        }
        return messages.map((m) => ({ Role: m.role, Text: m.text }));
    },
});
