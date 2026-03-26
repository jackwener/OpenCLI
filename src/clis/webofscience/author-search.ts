import { cli, Strategy } from '../../registry.js';
import { ArgumentError, EmptyResultError } from '../../errors.js';

function splitAuthorQuery(query: string): { firstName: string; lastName: string } {
  const normalized = query.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return { firstName: '', lastName: '' };
  }

  if (normalized.includes(',')) {
    const [lastName, ...rest] = normalized.split(',');
    return {
      lastName: lastName.trim(),
      firstName: rest.join(' ').trim(),
    };
  }

  const parts = normalized.split(' ').filter(Boolean);
  if (parts.length === 1) {
    return { firstName: '', lastName: parts[0] };
  }

  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts[parts.length - 1],
  };
}

cli({
  site: 'webofscience',
  name: 'author-search',
  description: 'Search Web of Science researcher profiles',
  domain: 'webofscience.clarivate.cn',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'query', positional: true, required: true, help: 'Researcher name or keyword' },
    { name: 'limit', type: 'int', default: 10, help: 'Max results' },
  ],
  columns: ['rank', 'name', 'details', 'url'],
  func: async (page, kwargs) => {
    const query = String(kwargs.query ?? '').trim();
    if (!query) {
      throw new ArgumentError('Search query is required');
    }
    const limit = Math.max(1, Math.min(50, Number(kwargs.limit ?? 10) || 10));
    const { firstName, lastName } = splitAuthorQuery(query);

    await page.goto('https://webofscience.clarivate.cn/wos/author/author-search', { settleMs: 4000 });
    await page.wait(2);

    await page.evaluate(`(() => {
      const queryParts = {
        firstName: ${JSON.stringify(firstName)},
        lastName: ${JSON.stringify(lastName)},
      };
      const isVisible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0;
      };
      const normalize = (text) => String(text || '').trim().toLowerCase();
      const inputs = Array.from(document.querySelectorAll('input[type="text"], input, textarea'))
        .filter((el) => !el.disabled && !el.readOnly && isVisible(el));
      const pickInput = (label) => inputs.find((el) => {
        const aria = normalize(el.getAttribute('aria-label'));
        const placeholder = normalize(el.getAttribute('placeholder'));
        return aria === label || placeholder === label;
      });
      const assign = (input, value) => {
        if (!input || !('value' in input)) return;
        input.focus();
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const lastNameInput = pickInput('last name') || inputs[0];
      const firstNameInput = pickInput('first name');
      if (!lastNameInput) throw new Error('Author search input not found');
      assign(lastNameInput, queryParts.lastName);
      if (queryParts.firstName) assign(firstNameInput, queryParts.firstName);
      const form = lastNameInput.closest('form') || firstNameInput?.closest('form');
      const submitButton = Array.from(document.querySelectorAll('button'))
        .find((button) => isVisible(button) && /search/i.test(String(button.textContent || '')));
      submitButton?.click?.();
      form?.requestSubmit?.();
      return true;
    })()`);

    await page.wait(8);

    const scraped = await page.evaluate(`(() => {
      const normalize = (text) => String(text || '').replace(/\\s+/g, ' ').trim();
      const links = Array.from(document.querySelectorAll('a[href*="/author/record/"]'));
      const seen = new Set();
      const results = [];
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        const absolute = href.startsWith('http') ? href : new URL(href, location.origin).toString();
        if (seen.has(absolute)) continue;
        seen.add(absolute);
        const card = link.closest('mat-card, article, li, [role="listitem"], .mat-mdc-card, .card, div');
        const name = normalize(link.textContent);
        const details = normalize(card?.textContent || '')
          .replace(name, '')
          .slice(0, 240);
        if (name) results.push({ name, details, url: absolute });
      }
      return results;
    })()`) as Array<{ name?: string; details?: string; url?: string }>;

    const rows = (Array.isArray(scraped) ? scraped : [])
      .slice(0, limit)
      .map((item, index) => ({
        rank: index + 1,
        name: item.name ?? '',
        details: item.details ?? '',
        url: item.url ?? '',
      }))
      .filter(item => item.name);

    if (!rows.length) {
      throw new EmptyResultError('webofscience author-search', 'Try a different researcher name or verify your Web of Science access in Chrome');
    }

    return rows;
  },
});
