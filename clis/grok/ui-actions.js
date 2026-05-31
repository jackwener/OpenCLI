// Sidebar + dialog actions on grok.com that aren't message-level.
//
//   incognito                       — switch the current tab into private mode
//                                     (Grok's "私密模式" / Incognito chat)
//   account                         — open the user dropdown and read account
//                                     info (email, plan, sign-out link)
//   search-conversations <query>    — open the sidebar search palette, type
//                                     the query, and return matched results
//   share [--conv <id>]             — click "Create share link" on the current
//                                     (or specified) conversation and return
//                                     the shareable URL from the resulting dialog
//
// These wrap UI affordances that PR #1798's mgmt commands didn't cover.

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';
import {
    GROK_DOMAIN,
    IS_VISIBLE_JS,
    ensureOnGrok,
    parseGrokSessionId,
} from './utils.js';

// Locale-independent + i18n fallback label sets.
const ACCOUNT_TRIGGER_LABELS = []; // identified by being the last <button> in the sidebar with id^="radix-" and a sibling <span> containing the email
const SEARCH_TRIGGER_LABELS = ['搜索', 'Search', '検索'];
const SHARE_BUTTON_LABELS = ['创建共享链接', 'Create share link', 'Share', '共有リンクを作成'];
const INCOGNITO_URL_HASH = '/c#private';

// -------- incognito --------
cli({
    site: 'grok',
    name: 'incognito',
    access: 'write',
    description: 'Switch the current tab into Grok\'s private chat mode (URL: /c#private). Conversations in incognito mode are not saved to history.',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: ['Status', 'Url'],
    func: async (page) => {
        await ensureOnGrok(page);
        const target = `https://${GROK_DOMAIN}${INCOGNITO_URL_HASH}`;
        await page.goto(target);
        await page.wait(1);
        const url = await page.evaluate('window.location.href');
        return [{ Status: 'navigated', Url: String(url || target) }];
    },
});

// -------- account --------
cli({
    site: 'grok',
    name: 'account',
    access: 'read',
    description: 'Read account info from the user dropdown in the Grok sidebar (email, displayed name, plan if shown, and the visible dropdown menu items).',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: ['Field', 'Value'],
    func: async (page) => {
        await ensureOnGrok(page);
        // Read the email + name from the sidebar (always visible — no click needed).
        const info = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      // The account trigger is the last visible <button id="radix-..."> in
      // the sidebar that has an inner <span> containing an "@" (the email).
      const candidates = Array.from(document.querySelectorAll('button[id^="radix-"]'))
        .filter((b) => isVisible(b))
        .filter((b) => Array.from(b.querySelectorAll('span')).some((s) => (s.textContent || '').includes('@')));
      const trigger = candidates[candidates.length - 1];
      if (!trigger) return null;
      const spans = Array.from(trigger.querySelectorAll('span')).map((s) => (s.textContent || '').trim()).filter(Boolean);
      const email = spans.find((s) => s.includes('@')) || '';
      const name = spans.find((s) => !s.includes('@')) || '';
      return { name, email, triggerVisible: true };
    })()`);
        if (!info) {
            throw new CommandExecutionError('Account trigger not visible in sidebar.', 'Are you signed in?');
        }
        // Optionally click to read full menu items.
        await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const candidates = Array.from(document.querySelectorAll('button[id^="radix-"]'))
        .filter((b) => isVisible(b))
        .filter((b) => Array.from(b.querySelectorAll('span')).some((s) => (s.textContent || '').includes('@')));
      const trigger = candidates[candidates.length - 1];
      if (!trigger) return;
      const r = trigger.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2 };
      trigger.dispatchEvent(new PointerEvent('pointerdown', opts));
      trigger.dispatchEvent(new MouseEvent('mousedown', opts));
      trigger.dispatchEvent(new PointerEvent('pointerup', opts));
      trigger.dispatchEvent(new MouseEvent('mouseup', opts));
      trigger.click();
    })()`);
        await page.wait(0.4);
        const menuItems = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const menus = Array.from(document.querySelectorAll('[role=menu]')).filter((n) => isVisible(n));
      if (!menus.length) return [];
      const menu = menus[menus.length - 1];
      return Array.from(menu.querySelectorAll('[role=menuitem]'))
        .map((it) => (it.innerText || '').trim().replace(/\\s+/g, ' '))
        .filter(Boolean);
    })()`);
        // Close menu to avoid leaving the user with an open dropdown.
        try { await page.keys('Escape'); } catch {}
        const rows = [
            { Field: 'Name', Value: info.name || '(unknown)' },
            { Field: 'Email', Value: info.email || '(unknown)' },
        ];
        menuItems.slice(0, 20).forEach((item, i) => {
            rows.push({ Field: `MenuItem[${i + 1}]`, Value: item });
        });
        return rows;
    },
});

// -------- search-conversations --------
cli({
    site: 'grok',
    name: 'search-conversations',
    access: 'read',
    description: 'Open the sidebar search palette, type a query, and return matched conversation titles + ids.',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search text' },
        { name: 'limit', type: 'int', required: false, default: 20 },
    ],
    columns: ['Index', 'Title', 'ConvId'],
    func: async (page, kwargs) => {
        const query = String(kwargs?.query || '').trim();
        if (!query) throw new ArgumentError('query', 'is required');
        await ensureOnGrok(page);

        const triggerJson = JSON.stringify(SEARCH_TRIGGER_LABELS);
        // Click the sidebar search button.
        const clickRes = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const labels = ${triggerJson};
      const all = Array.from(document.querySelectorAll('[role=button], button'))
        .filter((b) => isVisible(b));
      const trigger = all.find((b) => {
        const al = b.getAttribute('aria-label') || '';
        return labels.includes(al);
      });
      if (!trigger) return { ok: false, reason: 'Search trigger not visible.' };
      const r = trigger.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2 };
      trigger.dispatchEvent(new PointerEvent('pointerdown', opts));
      trigger.dispatchEvent(new MouseEvent('mousedown', opts));
      trigger.dispatchEvent(new PointerEvent('pointerup', opts));
      trigger.dispatchEvent(new MouseEvent('mouseup', opts));
      trigger.click();
      return { ok: true };
    })()`);
        if (!clickRes?.ok) {
            throw new CommandExecutionError(clickRes?.reason || 'Failed to open search', '');
        }
        await page.wait(0.5);

        // Type the query into the search input.
        const fillRes = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const inputs = Array.from(document.querySelectorAll('input[type=text], input[type=search], input:not([type])'))
        .filter((i) => isVisible(i));
      // Prefer the most recently mounted input (search palette opens on top).
      const input = inputs[inputs.length - 1];
      if (!input) return { ok: false, reason: 'No visible input after opening search.' };
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, ${JSON.stringify(query)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    })()`);
        if (!fillRes?.ok) {
            throw new CommandExecutionError(fillRes?.reason || 'Failed to type search query', '');
        }
        await page.wait(0.8);

        // Read results — search palette usually renders <a href="/c/<id>"> rows for matched convs.
        const results = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const anchors = Array.from(document.querySelectorAll('a[href^="/c/"]')).filter((a) => isVisible(a));
      const seen = new Set();
      return anchors.map((a) => {
        const m = a.getAttribute('href').match(/\\/c\\/([0-9a-f-]{8,})/);
        const id = m ? m[1] : '';
        if (!id || seen.has(id)) return null;
        seen.add(id);
        return { id, title: (a.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 200) };
      }).filter(Boolean);
    })()`);
        // Close palette.
        try { await page.keys('Escape'); } catch {}

        if (!results.length) {
            throw new EmptyResultError('grok search-conversations', `No conversations matched "${query}".`);
        }
        const limit = Number.isInteger(kwargs.limit) && kwargs.limit > 0 ? kwargs.limit : 20;
        return results.slice(0, limit).map((r, i) => ({
            Index: i + 1,
            Title: r.title || '(untitled)',
            ConvId: r.id,
        }));
    },
});

// -------- share --------
cli({
    site: 'grok',
    name: 'share',
    access: 'write',
    description: 'Create a shareable link for the current (or --conv specified) conversation. Clicks the "Create share link" button and returns the URL surfaced by the resulting dialog.',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'conv', required: false, help: 'Conversation id or URL (navigates there before clicking Share)' },
    ],
    columns: ['Field', 'Value'],
    func: async (page, kwargs) => {
        const convArg = kwargs?.conv ? String(kwargs.conv).trim() : '';
        if (convArg) {
            const sessionId = parseGrokSessionId(convArg);
            await page.goto(`https://grok.com/c/${sessionId}`);
            await page.wait(2);
        } else {
            await ensureOnGrok(page);
        }

        const labelJson = JSON.stringify(SHARE_BUTTON_LABELS);
        // Click the share button.
        const clickRes = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const labels = ${labelJson};
      const btns = Array.from(document.querySelectorAll('button')).filter((b) => isVisible(b));
      // Prefer the one OUTSIDE any assistant-message bubble (header-level share),
      // because per-message bubbles also have a share button.
      const isInsideBubble = (b) => {
        let p = b.parentElement;
        while (p) {
          if (p.getAttribute && p.getAttribute('data-testid') === 'assistant-message') return true;
          p = p.parentElement;
        }
        return false;
      };
      let target = btns.find((b) => labels.includes(b.getAttribute('aria-label') || '') && !isInsideBubble(b));
      if (!target) target = btns.find((b) => labels.includes(b.getAttribute('aria-label') || ''));
      if (!target) return { ok: false, reason: 'Share button not visible.' };
      const r = target.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2 };
      target.dispatchEvent(new PointerEvent('pointerdown', opts));
      target.dispatchEvent(new MouseEvent('mousedown', opts));
      target.dispatchEvent(new PointerEvent('pointerup', opts));
      target.dispatchEvent(new MouseEvent('mouseup', opts));
      target.click();
      return { ok: true };
    })()`);
        if (!clickRes?.ok) {
            throw new CommandExecutionError(clickRes?.reason || 'Failed to click Share', '');
        }
        // Wait for the dialog to mount and populate the link.
        await page.wait(2);

        // Read the share URL from the dialog. Dialogs use [role=dialog]; the
        // share link itself is usually surfaced as a readonly <input> or an
        // <a href="https://grok.com/share/..."> inside the dialog.
        const link = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const dialogs = Array.from(document.querySelectorAll('[role=dialog]')).filter((n) => isVisible(n));
      if (!dialogs.length) return null;
      const dlg = dialogs[dialogs.length - 1];
      // 1) read-only input
      const input = Array.from(dlg.querySelectorAll('input')).find((i) => /grok\\.com\\/share\\//i.test(i.value || ''));
      if (input) return { kind: 'input', url: input.value };
      // 2) anchor
      const a = Array.from(dlg.querySelectorAll('a[href*="grok.com/share/"]'))[0];
      if (a) return { kind: 'anchor', url: a.href };
      // 3) any element whose text contains the share URL
      const txt = (dlg.innerText || '').match(/https:\\/\\/grok\\.com\\/share\\/[A-Za-z0-9-]+/);
      if (txt) return { kind: 'text', url: txt[0] };
      return null;
    })()`);
        // Close the dialog.
        try { await page.keys('Escape'); } catch {}

        if (!link) {
            throw new CommandExecutionError(
                'Share dialog opened but no grok.com/share/ URL was found.',
                'The dialog may require an additional confirmation click that this command does not yet handle.',
            );
        }
        return [
            { Field: 'Status', Value: 'created' },
            { Field: 'Source', Value: link.kind },
            { Field: 'Url', Value: link.url },
        ];
    },
});
