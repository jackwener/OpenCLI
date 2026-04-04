import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

export const modelCommand = cli({
  site: 'codex',
  name: 'model',
  description: 'Get or switch the currently active AI model in Codex Desktop',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'model-name', required: false, positional: true, help: 'The ID of the model to switch to (e.g. gpt-4)' }
  ],
  columns: ['Status', 'Model'],
  func: async (page: IPage, kwargs: any) => {
    const desiredModel = kwargs['model-name'] as string | undefined;

    if (!desiredModel) {
      // Just read the current model. We traverse iframes/webviews if needed.
      const currentModel = await page.evaluate(`
        (function() {
          // Look for any typical model switcher selectors in the DOM
          let m = document.querySelector('[title*="Model"], [aria-label*="Model"], .model-selector, [class*="ModelPicker"]');
          
          if (!m && document.querySelector('webview, iframe')) {
              // Not directly in main DOM, might be in a webview, but Playwright evaluate doesn't cross origin boundaries easily without frames[].
              return 'Unknown (Likely inside a WebView, please focus the Chat tab)';
          }
          return m ? (m.textContent || m.getAttribute('title') || m.getAttribute('aria-label')).trim() : 'Unknown or Not Found';
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
          const dropdown = document.querySelector('[title*="Model"], [aria-label*="Model"], .model-selector, [class*="ModelPicker"]');
          if (!dropdown) return 'Dropdown not found';
          
          dropdown.click();
          return 'Dropdown clicked. Generic interaction initiated.';
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
