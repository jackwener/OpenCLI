import { cli, Strategy } from '@jackwener/opencli/registry';
import { ConfigError } from '@jackwener/opencli/errors';
import { activateChatGPT, selectModel, MODEL_CHOICES } from './ax.js';
export const modelCommand = cli({
    site: 'chatgpt-app',
    name: 'model',
    access: 'read',
    description: 'Switch ChatGPT Desktop model/mode (auto, instant, thinking, 5.2-instant, 5.2-thinking)',
    domain: 'localhost',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'model', required: true, positional: true, help: 'Model to switch to', choices: MODEL_CHOICES },
    ],
    columns: ['Status', 'Model'],
    func: async (kwargs) => {
        if (process.platform !== 'darwin') {
            throw new ConfigError('ChatGPT Desktop integration requires macOS');
        }
        const model = kwargs.model;
        activateChatGPT();
        const result = selectModel(model);
        return [{ Status: 'Success', Model: result }];
    },
});
