import { describe, expect, it, vi } from 'vitest';
import { AuthRequiredError } from '@jackwener/opencli/errors';
import { newCommand } from './new.js';
function createNewPageMock(overrides = {}) {
    const currentUrl = overrides.currentUrl ?? 'https://yuanbao.tencent.com/';
    const triggerAction = overrides.triggerAction ?? 'clicked';
    const hasLoginGate = overrides.hasLoginGate ?? false;
    const composerText = overrides.composerText ?? '';
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockImplementation(async (script) => {
            if (script === 'window.location.href')
                return currentUrl;
            if (script.includes('微信扫码登录'))
                return hasLoginGate;
            if (script.includes('.ql-editor, [contenteditable="true"]'))
                return composerText;
            if (script.includes('const trigger = Array.from(document.querySelectorAll'))
                return triggerAction;
            throw new Error(`Unexpected evaluate script in test: ${script.slice(0, 80)}`);
        }),
    };
}
describe('yuanbao new command', () => {
    it('throws AuthRequiredError when Yuanbao shows a login gate', async () => {
        const page = createNewPageMock({ hasLoginGate: true });
        await expect(newCommand.func(page, {})).rejects.toBeInstanceOf(AuthRequiredError);
    });
});
