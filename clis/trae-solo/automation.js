// TRAE SOLO Automation panel — workflows / scheduled tasks.
//
// The panel has 3 tabs:
//   .tab-u_Qz20    'Configured'      — currently configured automations (empty by default)
//   .tab-u_Qz20    'Run History'     — past runs
//   .tab-u_Qz20    'Task Template'   — pre-built templates (e.g. "Daily AI News Briefing")
//
// And 2 top-level create buttons:
//   .button-eTMLAq.secondary  'Create manually'
//   .button-eTMLAq.primary    'Create in chat'

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { switchToPanel } from './_actions.js';

async function switchToAutomationTab(page, tabName) {
    const nameJson = JSON.stringify(tabName);
    await page.evaluate(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const target = ${nameJson};
    const tab = Array.from(document.querySelectorAll('.tab-u_Qz20'))
      .find((t) => t.offsetParent && (t.textContent || '').trim() === target);
    if (!tab || tab.className.includes('tabActive')) return;
    const r = tab.getBoundingClientRect();
    const init = {
      bubbles: true, cancelable: true, button: 0, buttons: 1,
      clientX: Math.round(r.left + r.width / 2),
      clientY: Math.round(r.top + r.height / 2),
    };
    tab.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }));
    tab.dispatchEvent(new MouseEvent('mousedown', init));
    tab.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }));
    tab.dispatchEvent(new MouseEvent('mouseup', init));
    tab.dispatchEvent(new MouseEvent('click', init));
    await wait(700);
  })()`);
    await page.wait(0.3);
}

// -------- automation-list --------
cli({
    site: 'trae-solo',
    name: 'automation-list',
    access: 'read',
    description: 'List Trae SOLO Automation tab content. Default tab is "Configured"; pass --tab to switch.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'tab', required: false, default: 'configured', help: 'Tab to view: configured / run-history / task-template' },
        { name: 'limit', type: 'int', required: false, default: 50 },
    ],
    columns: ['Index', 'Title', 'Summary'],
    func: async (page, kwargs) => {
        await switchToPanel(page, 'Automation');
        const tab = String(kwargs.tab || 'configured').trim().toLowerCase();
        const tabLabel = {
            'configured': 'Configured',
            'run-history': 'Run History',
            'task-template': 'Task Template',
        }[tab];
        if (!tabLabel) throw new ArgumentError('tab must be configured / run-history / task-template');
        await switchToAutomationTab(page, tabLabel);

        const items = await page.evaluate(`(function() {
      // Each tab renders its content in a different container; pull all
      // direct text rows from the main panel area.
      const main = document.querySelector('.task-list-base-content') || document.querySelector('main') || document.body;
      // Templates use .templateCard-... or similar. Configured items have a different shape.
      const candidates = Array.from(main.querySelectorAll('[class*="templateCard"], [class*="taskCard"], [class*="card"], li, [role="listitem"]'))
        .filter((el) => el.offsetParent);
      const out = [];
      const seen = new Set();
      for (const el of candidates) {
        const t = (el.innerText || '').replace(/\\s+/g, ' ').trim();
        if (!t || t.length < 3 || seen.has(t)) continue;
        // Filter UI chrome (tabs / heading / 'Create manually' / etc.)
        if (/^(Configured|Run History|Task Template|Create manually|Create in chat|Automation|Create from a template)$/.test(t)) continue;
        seen.add(t);
        const lines = t.split('\\n');
        out.push({ title: lines[0].slice(0, 60), summary: (lines.slice(1).join(' ') || '').slice(0, 120) });
      }
      // If nothing matched, fall back to a quick text dump of the main panel.
      if (!out.length) {
        const fallback = (main.innerText || '').trim();
        if (fallback) out.push({ title: '(empty)', summary: fallback.slice(0, 300) });
      }
      return out;
    })()`);
        const limit = Number.isInteger(kwargs.limit) && kwargs.limit > 0 ? kwargs.limit : 50;
        const rows = (items || []).slice(0, limit);
        if (!rows.length) {
            throw new EmptyResultError('trae-solo automation-list', `No items in tab '${tabLabel}'.`);
        }
        return rows.map((r, i) => ({ Index: i + 1, Title: r.title, Summary: r.summary }));
    },
});
