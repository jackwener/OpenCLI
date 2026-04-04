import { cli, Strategy } from '../../src/registry.js';
import type { IPage } from '../../src/types.js';

export const modelCommand = cli({
  site: 'cursor',
  name: 'model',
  description: 'Get or switch the currently active AI model in Cursor',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'model-name', required: false, positional: true, help: 'The ID of the model to switch to (e.g. claude-3.5-sonnet)' }
  ],
  columns: ['Status', 'Model'],
  func: async (page: IPage, kwargs: any) => {
    const desiredModel = kwargs['model-name'] as string | undefined;

    if (!desiredModel) {
      // Just read the current model
      const currentModel = await page.evaluate(`
        (function() {
          const m = document.querySelector('.composer-unified-dropdown-model span, [class*="unifiedmodeldropdown"] span');
          return m ? m.textContent.trim() : 'Unknown or Not Found';
        })()
      `);
      
      return [
        {
          Status: 'Active',
          Model: currentModel,
        },
      ];
    } else {
      // Try to switch model (click dropdown, type/select model)
      const success = await page.evaluate(`
        (function(targetModel) {
          const dropdown = document.querySelector('.composer-unified-dropdown-model, [class*="unifiedmodeldropdown"]');
          if (!dropdown) return 'Dropdown not found';
          
          dropdown.click();
          // After clicking, the DOM usually spawns a popup list.
          // Because it's hard to predict exactly how the list renders, 
          // a simple scriptable approach is just to click it, and hope we can select it via UI.
          // In many React apps, clicking it opens a menu, and clicking the item works.
          return 'Dropdown opened. Automated switching is not fully generic. Please implement precise list navigation depending on DOM.';
        })(${JSON.stringify(desiredModel)})
      `);
      
      return [
        {
          Status: success,
          Model: desiredModel,
        },
      ];
    }
  },
});
