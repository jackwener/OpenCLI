// Composer-area commands for Qoder.
//
//   prompt-enhance      — click "Prompt Enhance" (rewrites the current draft)
//   open-editor         — click "Open Editor" (open the chat draft in a full editor pane)

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { clickByTextScript, evaluateQoder } from './_utils.js';

// -------- prompt-enhance --------
cli({
    site: 'qoder',
    name: 'prompt-enhance',
    access: 'write',
    description: 'Click "Prompt Enhance" — Qoder rewrites the current composer draft for better LLM consumption.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status'],
    func: async (page) => {
        const res = await evaluateQoder(page, clickByTextScript(['Prompt Enhance']));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'Prompt Enhance button not found', '');
        await page.wait(0.5);
        return [{ Status: 'enhanced (check composer)' }];
    },
});

// -------- open-editor --------
cli({
    site: 'qoder',
    name: 'open-editor',
    access: 'write',
    description: 'Click "Open Editor" — opens the current draft in a full editor pane.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status'],
    func: async (page) => {
        const res = await evaluateQoder(page, clickByTextScript(['Open Editor']));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'Open Editor button not found', '');
        return [{ Status: 'clicked' }];
    },
});
