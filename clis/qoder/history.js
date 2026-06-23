import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { evaluateQoder, IS_VISIBLE_JS, parsePositiveInt, requireArrayResult } from './_utils.js';

cli({
    site: 'qoder',
    name: 'history',
    access: 'read',
    description: 'List Quests visible in the Qoder sidebar. Returns title + visible metadata.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'limit', type: 'int', required: false, default: 50 },
    ],
    columns: ['Index', 'Title'],
    func: async (page, kwargs) => {
        const limit = parsePositiveInt(kwargs?.limit, 50, '--limit');
        const items = requireArrayResult(await evaluateQoder(page, `(() => {
      ${IS_VISIBLE_JS}
      // Qoder renders quests in the sidebar Quest List. They appear as
      // clickable rows; structure is iterative-discovery — find rows
      // that have either role=button or a click handler and contain a title.
      // We use the heuristic: any element under the sidebar (left panel)
      // whose textContent looks like a Quest title (< 100 chars, no menu indicator).
      const sidebars = Array.from(document.querySelectorAll('[class*="sidebar"i], [class*="quest-list"i], [class*="quest"i]')).filter(isVisible);
      const seen = new Set();
      const out = [];
      sidebars.forEach((sb) => {
        const rows = Array.from(sb.querySelectorAll('[role="button"], button, [class*="item"i]')).filter(isVisible);
        rows.forEach((r) => {
          const txt = (r.innerText || r.textContent || '').trim().replace(/\\s+/g, ' ');
          if (!txt || txt.length < 2 || txt.length > 200) return;
          // Skip menu items, headers, action buttons.
          if (/^(New Quest|Search|Settings|View all|Knowledge|Marketplace|Credits Usage|Pin|Add Workspace|Open Editor|More Actions|Open Panel|Collapse|leo|button)$/i.test(txt.trim())) return;
          if (txt.includes('⌘')) return;
          if (seen.has(txt)) return;
          seen.add(txt);
          out.push(txt);
        });
      });
      return out;
    })()`), 'qoder history');
        if (!items.length) {
            throw new EmptyResultError('qoder history', 'No quests visible. Try widening the sidebar or selecting a workspace.');
        }
        return items.slice(0, limit).map((t, i) => ({ Index: i + 1, Title: t }));
    },
});
