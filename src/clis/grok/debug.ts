import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

export const debugCommand = cli({
  site: 'grok',
  name: 'debug',
  description: 'Debug grok page structure',
  domain: 'grok.com',
  strategy: Strategy.COOKIE,
  browser: true,
  columns: ['data'],
  func: async (page: IPage, _kwargs: Record<string, any>) => {
    await page.goto('https://grok.com');
    await page.wait(3);

    // Get all button-like elements near textarea
    const debug = await page.evaluate(`(() => {
      const ta = document.querySelector('textarea');
      if (!ta) return { error: 'no textarea' };

      // Get parent containers
      let parent = ta.parentElement;
      const parents = [];
      for (let i = 0; i < 5 && parent; i++) {
        parents.push({
          tag: parent.tagName,
          class: parent.className?.substring(0, 80),
          childCount: parent.children.length,
        });
        parent = parent.parentElement;
      }

      // Find buttons in the form/container near textarea
      const form = ta.closest('form') || ta.closest('[class*="composer"]') || ta.closest('[class*="input"]') || ta.parentElement?.parentElement;
      const buttons = form ? [...form.querySelectorAll('button')].map(b => ({
        testid: b.getAttribute('data-testid'),
        type: b.type,
        disabled: b.disabled,
        text: (b.textContent || '').substring(0, 30),
        html: b.outerHTML.substring(0, 200),
        rect: b.getBoundingClientRect().toJSON(),
      })) : [];

      return { parents, buttons, formTag: form?.tagName, formClass: form?.className?.substring(0, 80) };
    })()`);

    return [{ data: JSON.stringify(debug, null, 2) }];
  },
});
