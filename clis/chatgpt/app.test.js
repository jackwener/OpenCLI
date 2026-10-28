import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { parsePluginId } from './app.js';

describe('chatgpt app', () => {
    it('reads a plugin id from an id or a plugin URL', () => {
        expect(parsePluginId('plugin_asdk_app_6aab0d5ea0ec8191971d44fc125603e0')).toBe('plugin_asdk_app_6aab0d5ea0ec8191971d44fc125603e0');
        expect(parsePluginId('https://chatgpt.com/plugins/plugin_asdk_app_6aab0d5e?x=1')).toBe('plugin_asdk_app_6aab0d5e');
        expect(parsePluginId('Example Booking App')).toBe('');
    });

    it('refuses connect without a plugin id', async () => {
        const command = getRegistry().get('chatgpt/app');
        await expect(command.func({}, { app: 'Example Booking App', action: 'connect' })).rejects.toThrow(/plugin id/);
    });
});
