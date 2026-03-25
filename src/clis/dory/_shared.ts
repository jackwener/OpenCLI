/**
 * Shared utilities for the Dory adapter.
 */
import type { IPage } from '../../types.js';

/**
 * Resolve a connection name or ID to a connection ID.
 * Fetches all connections and matches by name (case-insensitive).
 * Falls back to returning the input as-is if no name match is found
 * (treats it as a raw ID).
 */
export async function resolveConnectionId(page: IPage, nameOrId: string): Promise<string> {
  const resolved = await page.evaluate(`
    (async function(nameOrId) {
      try {
        const res = await fetch('/api/connection', { credentials: 'include' });
        if (!res.ok) return nameOrId;
        const json = await res.json();
        const list = json.data ?? json ?? [];
        const lower = nameOrId.toLowerCase();
        const match = list.find(function(item) {
          const c = item.connection ?? item;
          return (c.name ?? '').toLowerCase() === lower;
        });
        if (match) {
          const c = match.connection ?? match;
          return c.id;
        }
      } catch (_) {}
      return nameOrId;
    })(${JSON.stringify(nameOrId)})
  `);
  return resolved as string;
}

/**
 * Ensure the browser is on a Dory chatbot page.
 *
 * Priority:
 *  1. If `connectionId` is given, navigate to /[org]/[connectionId]/chatbot
 *     (org is extracted from the current URL, or falls back to a click on any chatbot link).
 *  2. If already on a /chatbot route, do nothing.
 *  3. If on another Dory route, extract org + connectionId from the URL and navigate.
 *
 * Waits up to `waitSec` seconds for the chat textarea to appear.
 */
export async function ensureChatbotPage(page: IPage, connectionId?: string, waitSec = 5): Promise<void> {
  const navResult = await page.evaluate(`
    (function() {
      const path = window.location.pathname;
      if (path.includes('/chatbot')) return { already: true, path: path };
      const parts = path.split('/').filter(Boolean);
      return {
        already: false,
        org: parts.length >= 1 ? parts[0] : null,
        connectionId: parts.length >= 2 ? parts[1] : null,
      };
    })()
  `);

  if (!connectionId && navResult.already) return;

  const org: string | null = navResult.org;
  const resolvedConn = connectionId ?? navResult.connectionId;

  if (org && resolvedConn) {
    const target = `http://localhost:3000/${org}/${resolvedConn}/chatbot`;
    const currentUrl = await page.evaluate(`window.location.href`);
    // Only navigate if not already on the exact chatbot page for this connection
    if (!String(currentUrl).includes(`/${resolvedConn}/chatbot`)) {
      await page.goto(target);
    }
  } else {
    // Fallback: click the first chatbot nav link on the page
    await page.evaluate(`
      (function() {
        const link = Array.from(document.querySelectorAll('a[href*="chatbot"], a[href*="chat"]'))[0];
        if (link) link.click();
      })()
    `);
  }

  // Wait for textarea to become available
  for (let i = 0; i < waitSec * 2; i++) {
    await page.wait(0.5);
    const found = await page.evaluate(`!!document.querySelector('textarea[name="message"]')`);
    if (found) return;
  }
}

/**
 * Inject text into the Dory chat textarea using the React native setter.
 * Returns true on success.
 */
export async function injectChatText(page: IPage, text: string): Promise<boolean> {
  return page.evaluate(`
    (function(text) {
      const textarea = document.querySelector('textarea[name="message"]') || document.querySelector('textarea');
      if (!textarea) return false;
      textarea.focus();
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      nativeSetter.call(textarea, text);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })(${JSON.stringify(text)})
  `);
}
