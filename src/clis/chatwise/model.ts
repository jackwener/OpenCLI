import { cli, Strategy } from '../../registry.js';
import { SelectorError } from '../../errors.js';
import type { IPage } from '../../types.js';
import { chatwiseRequiredEnv } from './shared.js';

export const modelCommand = cli({
  site: 'chatwise',
  name: 'model',
  description: 'Get or switch the active AI model in ChatWise',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  requiredEnv: chatwiseRequiredEnv,
  args: [
    { name: 'model-name', required: false, positional: true, help: 'Model to switch to (e.g. gpt-4, claude-3)' },
  ],
  columns: ['Status', 'Model'],
  func: async (page: IPage, kwargs: any) => {
    const desiredModel = kwargs['model-name'] as string | undefined;

    if (!desiredModel) {
      // Read current model
      const currentModel = await page.evaluate(`
        (function() {
          // ChatWise is a multi-LLM client, it typically shows the model name in a dropdown or header
          const selectors = [
            '[class*="model"] span',
            '[class*="Model"] span',
            '[data-testid*="model"]',
            'button[class*="model"]',
            '[aria-label*="Model"]',
            '[aria-label*="model"]',
          ];
          
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
              const text = (el.textContent || el.getAttribute('title') || '').trim();
              if (text) return text;
            }
          }
          
          return 'Unknown or Not Found';
        })()
      `);

      return [{ Status: 'Active', Model: currentModel }];
    } else {
      // Try to switch model
      const opened = await page.evaluate(`
        (function(target) {
          const selectors = [
            '[class*="model"]',
            '[class*="Model"]',
            'button[class*="model"]',
          ];
          
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) { el.click(); return true; }
          }
          return false;
        })(${JSON.stringify(desiredModel)})
      `);
      if (!opened) throw new SelectorError('ChatWise model selector');

      await page.wait(0.5);

      // Find and click the target model in the dropdown
      const found = await page.evaluate(`
        (function(target) {
          const options = document.querySelectorAll('[role="option"], [role="menuitem"], [class*="dropdown-item"], li');
          for (const opt of options) {
            if ((opt.textContent || '').toLowerCase().includes(target.toLowerCase())) {
              opt.click();
              return true;
            }
          }
          return false;
        })(${JSON.stringify(desiredModel)})
      `);

      return [
        {
          Status: found ? 'Switched' : 'Dropdown opened but model not found',
          Model: desiredModel,
        },
      ];
    }
  },
});
