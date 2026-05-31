// Quest (= conversation) lifecycle commands: new / history / send / ask / read.

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';
import { IS_VISIBLE_JS, clickByTextScript, clickFirstScript } from './_utils.js';

// -------- new --------
cli({
    site: 'qoder',
    name: 'new',
    access: 'write',
    description: 'Start a new Qoder Quest (conversation). Clicks the "New Quest" button in the sidebar (or its ⌘N variant).',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status'],
    func: async (page) => {
        const res = await page.evaluate(clickByTextScript(['New Quest']));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'New Quest button not found', '');
        await page.wait(0.5);
        return [{ Status: 'started' }];
    },
});

// -------- history --------
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
        const items = await page.evaluate(`(() => {
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
    })()`);
        if (!items.length) {
            throw new EmptyResultError('qoder history', 'No quests visible. Try widening the sidebar or selecting a workspace.');
        }
        const limit = Number.isInteger(kwargs?.limit) && kwargs.limit > 0 ? kwargs.limit : 50;
        return items.slice(0, limit).map((t, i) => ({ Index: i + 1, Title: t }));
    },
});

// -------- send --------
cli({
    site: 'qoder',
    name: 'send',
    access: 'write',
    description: 'Type text into the Qoder composer and click "Send message" (fire-and-forget).',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'text', positional: true, required: true, help: 'Text to send' },
    ],
    columns: ['Status', 'Length'],
    func: async (page, kwargs) => {
        const text = String(kwargs?.text || '').trim();
        if (!text) throw new ArgumentError('text', 'is required');

        // Qoder composer is a contenteditable. Find it, focus, type.
        const typeRes = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      // Prefer ProseMirror/Lexical/contenteditable inside the composer area.
      const editors = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(isVisible);
      const editor = editors[editors.length - 1];
      if (!editor) return { ok: false, reason: 'No contenteditable composer found.' };
      editor.focus();
      // Use execCommand for ProseMirror/Lexical compatibility.
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, ${JSON.stringify(text)});
      return { ok: true };
    })()`);
        if (!typeRes?.ok) throw new CommandExecutionError(typeRes?.reason || 'composer type failed', '');
        await page.wait(0.3);

        // Click Send message
        const sendRes = await page.evaluate(clickFirstScript([
            'button[aria-label="Send message"]',
            'button[title="Send message"]',
        ]));
        if (!sendRes?.ok) {
            // Fallback: try clickByText.
            const textRes = await page.evaluate(clickByTextScript(['Send message', 'Send', '发送']));
            if (!textRes?.ok) throw new CommandExecutionError('Send button not found', '');
        }
        return [{ Status: 'sent', Length: String(text.length) }];
    },
});

// -------- read --------
cli({
    site: 'qoder',
    name: 'read',
    access: 'read',
    description: 'Read messages in the current Qoder Quest. Returns role + text for each visible turn.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'limit', type: 'int', required: false, default: 30 },
    ],
    columns: ['Index', 'Role', 'Text'],
    func: async (page, kwargs) => {
        const turns = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      // Qoder uses a chat area on the right; turns are usually marked with
      // a role-discriminating class or testid. We use a heuristic: any
      // element containing both .innerText and being inside the chat pane.
      const chatPanes = Array.from(document.querySelectorAll('[class*="chat"i], [class*="conversation"i], [class*="message"i]')).filter(isVisible);
      if (!chatPanes.length) return [];
      // Pick the largest one (likely the main chat scroller).
      const pane = chatPanes.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
      // Within the pane, find elements whose direct text is non-trivial.
      const candidates = Array.from(pane.querySelectorAll('div, article, [class*="message"i], [class*="turn"i], [class*="bubble"i]'))
        .filter(isVisible)
        .filter((el) => {
          const tx = (el.innerText || '').trim();
          return tx.length > 5 && tx.length < 4000 && el.children.length < 20;
        });
      const seen = new Set();
      return candidates.map((el) => {
        const tx = (el.innerText || '').trim().replace(/\\s+/g, ' ');
        if (seen.has(tx)) return null;
        seen.add(tx);
        const cls = (el.className || '').toString().toLowerCase();
        const role = /user|me-|right/.test(cls) ? 'User' : (/assistant|ai|bot|response/.test(cls) ? 'Assistant' : 'Turn');
        return { role, text: tx };
      }).filter(Boolean);
    })()`);
        if (!turns.length) {
            throw new EmptyResultError('qoder read', 'No chat turns detected. Open a quest first.');
        }
        const limit = Number.isInteger(kwargs?.limit) && kwargs.limit > 0 ? kwargs.limit : 30;
        return turns.slice(0, limit).map((t, i) => ({
            Index: i + 1,
            Role: t.role,
            Text: (t.text || '').slice(0, 1200),
        }));
    },
});

// -------- ask --------
cli({
    site: 'qoder',
    name: 'ask',
    access: 'write',
    description: 'Send a prompt to Qoder and wait up to --timeout seconds for the reply (best-effort: polls for the chat turn count to grow + stabilize).',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'text', positional: true, required: true, help: 'Prompt text' },
        { name: 'timeout', type: 'int', required: false, default: 120, help: 'Max seconds to wait' },
    ],
    columns: ['Status', 'Length', 'WaitedSeconds'],
    func: async (page, kwargs) => {
        const text = String(kwargs?.text || '').trim();
        if (!text) throw new ArgumentError('text', 'is required');
        const timeoutSec = Number.isInteger(kwargs?.timeout) && kwargs.timeout > 0 ? kwargs.timeout : 120;

        // Type + send (mirror `send` logic)
        await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const editors = Array.from(document.querySelectorAll('[contenteditable="true"]')).filter(isVisible);
      const editor = editors[editors.length - 1];
      if (editor) {
        editor.focus();
        document.execCommand('selectAll', false);
        document.execCommand('insertText', false, ${JSON.stringify(text)});
      }
    })()`);
        await page.wait(0.3);
        const sendBefore = await page.evaluate(`document.querySelectorAll('[class*="message"i], [class*="turn"i]').length`);
        await page.evaluate(clickFirstScript(['button[aria-label="Send message"]']));

        const startedAt = Date.now();
        const deadline = startedAt + timeoutSec * 1000;
        let lastCount = sendBefore;
        let stableTicks = 0;
        let lastChange = startedAt;
        while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 1500));
            const cur = await page.evaluate(`document.querySelectorAll('[class*="message"i], [class*="turn"i]').length`);
            if (cur !== lastCount) {
                lastCount = cur;
                lastChange = Date.now();
                stableTicks = 0;
            } else {
                stableTicks++;
            }
            // Consider stable after 6 idle ticks (≈9s no change) IF count grew at all.
            if (lastCount > sendBefore && stableTicks >= 6) break;
        }
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        return [{
            Status: lastCount > sendBefore ? 'reply-received' : 'timeout-or-no-reply',
            Length: String(text.length),
            WaitedSeconds: String(elapsed),
        }];
    },
});
