import { ArgumentError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  MIDJOURNEY_IMAGINE_URL,
  displayPath,
  getMidjourneyAccount,
  isSettingsPanelVisible,
  parseReferenceArgument,
  uploadReferenceLibrary,
  validateLocalReferences,
  toggleSettingsPanel,
} from './utils.js';

cli({
  site: 'midjourney',
  name: 'describe',
  access: 'write',
  description: 'Upload one image and return Midjourney\'s four Describe prompt suggestions without generating images',
  example: 'opencli midjourney describe /path/reference.png -f json',
  domain: 'www.midjourney.com',
  strategy: Strategy.UI,
  browser: true,
  siteSession: 'persistent',
  navigateBefore: MIDJOURNEY_IMAGINE_URL,
  defaultWindowMode: 'background',
  args: [
    { name: 'image', positional: true, required: true, help: 'Local PNG, JPEG, WEBP, or GIF (10MB maximum)' },
    { name: 'timeout', type: 'int', default: 60, help: 'Maximum seconds to wait for four suggestions' },
  ],
  columns: ['rank', 'prompt', 'source', 'created_at'],
  func: async (page, kwargs) => {
    await getMidjourneyAccount(page);
    const refs = parseReferenceArgument(kwargs.image, 'image', { multiple: false });
    if (refs[0]?.kind !== 'local') throw new ArgumentError('describe currently requires a local image file');
    await validateLocalReferences(refs, 'image');
    const timeout = Number(kwargs.timeout ?? 60);
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 180) {
      throw new ArgumentError('--timeout must be an integer from 1 to 180');
    }

    if (await isSettingsPanelVisible(page)) await toggleSettingsPanel(page);

    const [sourceUrl] = await uploadReferenceLibrary(page, [refs[0].value]);
    const baselineGroups = await page.evaluate(() => {
      const visible = (node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const groups = [];
      const markers = [...document.querySelectorAll('div')]
        .filter((node) => node.children.length === 0 && node.textContent?.trim() === 'Describe' && visible(node));
      for (const marker of markers) {
        let root = marker.parentElement;
        for (let depth = 0; depth < 16 && root; depth += 1, root = root.parentElement) {
          const prompts = [...root.querySelectorAll('p')]
            .filter(visible)
            .map((node) => node.textContent?.trim().replace(/\s+/g, ' ') || '')
            .filter((text) => text.length >= 40 && /(?:^|\s)--ar\s+\d+(?:\.\d+)?:\d+(?:\.\d+)?(?:\s|$)/i.test(text));
          if (prompts.length >= 4) {
            groups.push(prompts.slice(0, 4));
            break;
          }
        }
      }
      return groups;
    });
    const menuMarked = await page.evaluate((url) => {
      const image = [...document.querySelectorAll('img[src]')].find((node) => node.src === url);
      let card = image;
      while (card && !String(card.className).includes('group/img')) card = card.parentElement;
      const button = card?.querySelector('button');
      if (!button) return false;
      button.setAttribute('data-opencli-describe-menu', '1');
      return true;
    }, sourceUrl);
    if (!menuMarked) {
      throw new CommandExecutionError('Could not open the uploaded image action menu for Describe');
    }
    await page.click('[data-opencli-describe-menu="1"]');
    await page.wait(0.4);
    const startedAt = new Date().toISOString();
    const clicked = await page.evaluate(() => {
      const button = [...document.querySelectorAll('button,[role="menuitem"]')]
        .find((node) => node.textContent?.trim() === 'Describe' && node.getBoundingClientRect().width > 0);
      if (!button) return false;
      button.click();
      return true;
    });
    if (!clicked) throw new CommandExecutionError('Midjourney did not expose a Describe action for the uploaded image');

    const deadline = Date.now() + timeout * 1000;
    let prompts = [];
    while (Date.now() < deadline) {
      const groups = await page.evaluate(() => {
        const visible = (node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const found = [];
        const markers = [...document.querySelectorAll('div')]
          .filter((node) => node.children.length === 0 && node.textContent?.trim() === 'Describe' && visible(node));
        for (const marker of markers) {
          let root = marker.parentElement;
          for (let depth = 0; depth < 16 && root; depth += 1, root = root.parentElement) {
            const rows = [...root.querySelectorAll('p')]
              .filter(visible)
              .map((node) => node.textContent?.trim().replace(/\s+/g, ' ') || '')
              .filter((text) => text.length >= 40 && /(?:^|\s)--ar\s+\d+(?:\.\d+)?:\d+(?:\.\d+)?(?:\s|$)/i.test(text));
            if (rows.length >= 4) {
              found.push(rows.slice(0, 4));
              break;
            }
          }
        }
        return found;
      });
      const baselineSignatures = new Set((baselineGroups || []).map((group) => JSON.stringify(group)));
      const newGroup = (groups || []).find((group) => !baselineSignatures.has(JSON.stringify(group)));
      if (newGroup) prompts = newGroup;
      else if (Array.isArray(groups) && groups.length > (baselineGroups?.length || 0)) prompts = groups[0];
      if (Array.isArray(prompts) && prompts.length === 4) break;
      await page.wait(1);
    }
    if (!Array.isArray(prompts) || prompts.length !== 4) {
      throw new TimeoutError('Midjourney Describe', timeout, 'Four visible prompt suggestions did not appear.');
    }
    return prompts.map((prompt, index) => ({
      rank: index + 1,
      prompt,
      source: displayPath(refs[0].value),
      created_at: startedAt,
    }));
  },
});
