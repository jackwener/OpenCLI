// Deep-audit gap closers for Kimi (kimi.com).
//
// Discovered via direct DOM enumeration across mode pages (/slides, /docs,
// /deep-research, /agent, /settings, /chat/history) — these wrap buttons
// not covered by the initial chat/ui/storage commands:
//
//   sign-out               — click SignOut svg (in /settings page)
//   upgrade                — click Upgrade button (sidebar bottom)
//   dismiss-banner         — close the "Make a Review & Earn Credit" or
//                            "获取应用程序" banner
//   templates [--mode]     — list template cards on a mode page (PPT /docs/
//                            deep-research / agent — each shows curated
//                            example projects)
//   history-edit <chat-id> <new-title>  — click the per-row Edit button
//                            on /chat/history (each conv has an inline Edit)
//   user-rules             — read/write the rules from /settings (best-effort)

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';
import {
    KIMI_DOMAIN,
    KIMI_URL,
    IS_VISIBLE_JS,
    ensureOnKimi,
    parseChatId,
    clickBySvgNameScript,
} from './_utils.js';

const AUDIT_EXTRA_COLUMNS = ['Status', 'Index', 'Category', 'Title', 'ChatId', 'NewTitle'];

// -------- sign-out --------
cli({
    site: 'kimi',
    name: 'sign-out',
    access: 'write',
    description: 'Click SignOut on the Kimi /settings page. Navigates to /settings first if not already there. Requires --yes.',
    domain: KIMI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'yes', type: 'boolean', default: false, help: 'Actually sign out (default: dry-run)' },
    ],
    columns: AUDIT_EXTRA_COLUMNS,
    func: async (page, kwargs) => {
        const yes = kwargs?.yes === true || kwargs?.yes === 'true' || kwargs?.yes === '1';
        if (!yes) {
            return [{ Status: 'dry-run — pass --yes to actually sign out' }];
        }
        const url = await page.evaluate('window.location.href');
        if (!String(url || '').includes('/settings')) {
            await page.goto(`${KIMI_URL}settings`);
            await page.wait(1.5);
        }
        const res = await page.evaluate(clickBySvgNameScript('SignOut'));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'SignOut svg not found', '');
        await page.wait(1);
        return [{ Status: 'signed-out' }];
    },
});

// -------- upgrade --------
cli({
    site: 'kimi',
    name: 'upgrade',
    access: 'write',
    description: 'Click the "Upgrade" button (or 升级会员) in the Kimi sidebar — opens the membership/upgrade page or dialog.',
    domain: KIMI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: AUDIT_EXTRA_COLUMNS,
    func: async (page) => {
        await ensureOnKimi(page);
        const res = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const btns = Array.from(document.querySelectorAll('button, [role="button"], a')).filter(isVisible);
      const target = btns.find((b) => {
        const t = (b.innerText || b.textContent || '').trim();
        return /^Upgrade$|^升级|^会员计划|^开通会员/i.test(t) && t.length < 30;
      });
      if (!target) return { ok: false, reason: 'No Upgrade-style button visible.' };
      const r = target.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2 };
      target.dispatchEvent(new PointerEvent('pointerdown', opts));
      target.dispatchEvent(new MouseEvent('mousedown', opts));
      target.dispatchEvent(new PointerEvent('pointerup', opts));
      target.dispatchEvent(new MouseEvent('mouseup', opts));
      target.click();
      return { ok: true };
    })()`);
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'upgrade click failed', '');
        await page.wait(0.6);
        return [{ Status: 'clicked' }];
    },
});

// -------- dismiss-banner --------
cli({
    site: 'kimi',
    name: 'dismiss-banner',
    access: 'write',
    description: 'Close any visible sidebar banner (e.g., "Make a Review & Earn Credit", "获取应用程序") by clicking its Close svg.',
    domain: KIMI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: AUDIT_EXTRA_COLUMNS,
    func: async (page) => {
        await ensureOnKimi(page);
        const res = await page.evaluate(clickBySvgNameScript('Close', { last: false }));
        if (!res?.ok) {
            throw new EmptyResultError('kimi dismiss-banner', 'No Close svg visible — no banner to dismiss?');
        }
        return [{ Status: 'dismissed' }];
    },
});

// -------- templates --------
cli({
    site: 'kimi',
    name: 'templates',
    access: 'read',
    description: 'List template cards visible on a Kimi mode page (PPT/docs/deep-research/agent). Each mode shows curated example projects organized by category. Pass --mode to navigate first.',
    domain: KIMI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'mode', required: false, help: 'Navigate to mode first: ppt|docs|deep-research|agent|websites|sheets|agent-swarm|code' },
        { name: 'limit', type: 'int', required: false, default: 30 },
    ],
    columns: AUDIT_EXTRA_COLUMNS,
    func: async (page, kwargs) => {
        const mode = String(kwargs?.mode || '').trim().toLowerCase();
        const modeMap = {
            ppt: '/slides',
            docs: '/docs',
            'deep-research': '/deep-research',
            agent: '/agent',
            websites: '/websites',
            sheets: '/sheets',
            'agent-swarm': '/agent-swarm',
            code: '/code',
        };
        if (mode) {
            const target = modeMap[mode];
            if (!target) throw new ArgumentError('mode', `unknown mode "${mode}"`);
            await page.goto(`${KIMI_URL}${target.slice(1)}`);
            await page.wait(2);
        } else {
            await ensureOnKimi(page);
        }
        // Templates: visible <a> or [role=button] whose text follows the
        // pattern "category\n\ntitle" (e.g., "商业财经\n\n宁德时代财报分析").
        const cards = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const els = Array.from(document.querySelectorAll('a, [role="button"], button')).filter(isVisible);
      const out = [];
      for (const el of els) {
        const tx = (el.innerText || '').trim();
        // Match "category\\n\\ntitle" or "category\\ntitle" patterns
        const m = tx.match(/^([^\\n]+)\\n+(.+)$/);
        if (m && m[1].length < 30 && m[2].length < 100 && m[1] !== m[2]) {
          out.push({ category: m[1].trim(), title: m[2].trim() });
        }
      }
      // Dedupe by title
      const seen = new Set();
      return out.filter((c) => {
        if (seen.has(c.title)) return false;
        seen.add(c.title);
        return true;
      });
    })()`);
        if (!cards.length) {
            throw new EmptyResultError('kimi templates', 'No template cards visible. Are you on a mode page?');
        }
        const limit = Number.isInteger(kwargs?.limit) && kwargs.limit > 0 ? kwargs.limit : 30;
        return cards.slice(0, limit).map((c, i) => ({ Index: i + 1, Category: c.category, Title: c.title }));
    },
});

// -------- history-rename --------
cli({
    site: 'kimi',
    name: 'history-rename',
    access: 'write',
    description: 'Rename a chat from the /chat/history page (clicks the inline Edit svg next to a chat row, types the new title, and saves). Requires --yes.',
    domain: KIMI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'chat-id', positional: true, required: true, help: 'Chat id (UUID-like)' },
        { name: 'new-title', positional: true, required: true, help: 'New title' },
        { name: 'yes', type: 'boolean', default: false, help: 'Actually rename (default: dry-run)' },
    ],
    columns: AUDIT_EXTRA_COLUMNS,
    func: async (page, kwargs) => {
        const id = parseChatId(kwargs?.['chat-id']);
        const newTitle = String(kwargs?.['new-title'] || '').trim();
        if (!id) throw new ArgumentError('chat-id', 'is required');
        if (!newTitle) throw new ArgumentError('new-title', 'is required');
        const yes = kwargs?.yes === true || kwargs?.yes === 'true' || kwargs?.yes === '1';
        if (!yes) {
            return [{ Status: 'dry-run — pass --yes to rename', ChatId: id, NewTitle: newTitle }];
        }
        // Navigate to history page
        await page.goto(`${KIMI_URL}chat/history`);
        await page.wait(2);
        // Find the row with href containing the chat id, then click its Edit svg
        const clickRes = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const row = Array.from(document.querySelectorAll('a[href*="/chat/' + ${JSON.stringify(id)} + '"]')).find(isVisible);
      if (!row) return { ok: false, reason: 'Chat row not found in history.' };
      // The Edit svg is in a sibling or descendant.
      let container = row.parentElement || row;
      for (let i = 0; i < 4 && container.parentElement; i++) container = container.parentElement;
      const editSvg = container.querySelector('svg[name="Edit"]');
      if (!editSvg) return { ok: false, reason: 'Edit svg not found near chat row.' };
      let editBtn = editSvg;
      for (let i = 0; i < 5 && editBtn.parentElement; i++) { editBtn = editBtn.parentElement; if (editBtn.getAttribute('role') === 'button' || editBtn.tagName === 'BUTTON') break; }
      editBtn.click();
      return { ok: true };
    })()`);
        if (!clickRes?.ok) throw new CommandExecutionError(clickRes?.reason || 'Edit click failed', '');
        await page.wait(0.5);
        // Fill the inline input + submit via Enter
        const fillRes = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])')).filter(isVisible);
      const input = inputs[inputs.length - 1];
      if (!input) return { ok: false, reason: 'No input mounted after clicking Edit.' };
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(newTitle)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return { ok: true };
    })()`);
        if (!fillRes?.ok) throw new CommandExecutionError(fillRes?.reason || 'Rename input fill failed', '');
        await page.wait(1);
        const verified = await page.evaluate(`(() => {
      const row = Array.from(document.querySelectorAll('a[href*="/chat/' + ${JSON.stringify(id)} + '"]'))
        .find((el) => (el.innerText || el.textContent || '').includes(${JSON.stringify(newTitle)}));
      return !!row;
    })()`);
        if (!verified) {
            throw new CommandExecutionError(
                `Kimi history rename was not verified for chat ${id}`,
                'The edit input was submitted, but the history row did not show the requested title.',
            );
        }
        return [{ Status: 'renamed', ChatId: id, NewTitle: newTitle }];
    },
});
