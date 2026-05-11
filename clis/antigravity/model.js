import { cli, Strategy } from '@jackwener/opencli/registry';
export const modelCommand = cli({
    site: 'antigravity',
    name: 'model',
    access: 'read',
    description: 'Switch the active LLM model in Antigravity',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'name', help: 'Target model name (e.g. claude, gemini, o1)', required: true, positional: true }
    ],
    columns: ['Status'],
    func: async (page, kwargs) => {
        const targetName = kwargs.name.toLowerCase();
        await page.evaluate(`
      async () => {
        const targetModelName = ${JSON.stringify(targetName)};
        
        // 1. Locate the model selector dropdown trigger
        const trigger = document.querySelector('div[aria-haspopup="dialog"] > div[tabindex="0"]');
        if (!trigger) throw new Error('Could not find the model selector trigger in the UI');
        trigger.click();
        
        // 2. Wait a brief moment for React to mount the Portal/Dialog
        await new Promise(r => setTimeout(r, 200));
        
        // 3. Find the option spanning target text
        const spans = Array.from(document.querySelectorAll('[role="dialog"] span'));
        const target = spans.find(s => s.innerText.toLowerCase().includes(targetModelName));
        if (!target) {
          // If not found, click the trigger again to close it safely
          trigger.click();
          throw new Error('Model matching "' + targetModelName + '" was not found in the dropdown list.');
        }
        
        // 4. Click the closest parent that handles the row action
        const optionNode = target.closest('.cursor-pointer') || target;
        optionNode.click();
      }
    `);
        await page.wait(0.5);
        return [{ Status: `Model switched to: ${kwargs.name}` }];
    },
});
