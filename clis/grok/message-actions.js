// Per-message actions on the LAST assistant bubble in the current Grok chat.
//
//   regenerate     — click the Regenerate button (re-runs the last prompt)
//   copy-message   — read the last assistant message text (the same content
//                    the in-UI Copy button puts on the clipboard)
//   react <kind>   — click Like or Dislike on the last assistant message
//
// Selectors mirror utils.js style (data-testid + locale-independent aria-label
// with i18n fallback list). Grok marks each bubble with
// `[data-testid="assistant-message"]`; action buttons have stable aria-labels
// like "Regenerate" / "复制" / "Like" / "Dislike".

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
    bubbleHtmlToMarkdown,
    parseGrokSessionId,
} from './utils.js';

// If --conv was passed, navigate to that conversation page first and wait
// for at least one message bubble to mount. Otherwise just call ensureOnGrok
// and trust the current tab's URL.
async function maybeNavigateConv(page, convArg) {
    if (!convArg) {
        await ensureOnGrok(page);
        return;
    }
    const sessionId = parseGrokSessionId(convArg);
    await page.goto(`https://grok.com/c/${sessionId}`);
    await page.wait(2);
    // Poll up to 20s for messages to load (mirrors detail.js logic).
    for (let i = 0; i < 20; i++) {
        const has = await page.evaluate(
            `document.querySelectorAll('[data-testid="assistant-message"]').length > 0`,
        );
        if (has) return;
        await page.wait(1);
    }
    throw new EmptyResultError(
        'grok message-action',
        `No messages loaded for conversation ${sessionId} within 20s.`,
    );
}

// Locale-independent label sets for each action — data-testid first, then
// the visible aria-label across en/zh/ja.
const REGENERATE_LABELS = ['Regenerate', '重新生成', '再生成'];
const COPY_LABELS = ['Copy', '复制', 'コピー'];
const LIKE_LABELS = ['Like', '点赞', 'いいね'];
const DISLIKE_LABELS = ['Dislike', '踩', '低く評価'];

// Build a page.evaluate string that finds the last visible assistant bubble
// and clicks an action button by aria-label match. Returns
// `{ ok, reason }` from inside the page.
function clickLastAssistantActionScript(labels) {
    const labelJson = JSON.stringify(labels);
    return `(() => {
    ${IS_VISIBLE_JS}
    const labels = ${labelJson};
    const bubbles = Array.from(document.querySelectorAll('[data-testid="assistant-message"]'))
      .filter((n) => isVisible(n));
    if (!bubbles.length) return { ok: false, reason: 'No visible assistant message.' };
    const last = bubbles[bubbles.length - 1];
    // Action buttons can be inside the bubble OR in an adjacent toolbar row
    // (Grok renders them in a sibling div). Search the bubble's nearest
    // common ancestor for the matching button.
    let container = last;
    for (let i = 0; i < 5; i++) {
      if (!container.parentElement) break;
      container = container.parentElement;
    }
    const buttons = Array.from(container.querySelectorAll('button'));
    let target = null;
    for (const lab of labels) {
      target = buttons.find((b) => {
        const al = b.getAttribute('aria-label') || '';
        return al === lab || al.startsWith(lab + ' ');
      });
      if (target) break;
    }
    if (!target) return { ok: false, reason: 'Action button not found (labels: ' + labels.join(', ') + ').' };
    // Use a real click via pointer events to satisfy radix-style menus.
    const rect = target.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, clientX: rect.x + rect.width/2, clientY: rect.y + rect.height/2 };
    target.dispatchEvent(new PointerEvent('pointerdown', opts));
    target.dispatchEvent(new MouseEvent('mousedown', opts));
    target.dispatchEvent(new PointerEvent('pointerup', opts));
    target.dispatchEvent(new MouseEvent('mouseup', opts));
    target.click();
    return { ok: true };
  })()`;
}

// ---------------- regenerate ----------------
cli({
    site: 'grok',
    name: 'regenerate',
    access: 'write',
    description: 'Click Regenerate on the last assistant message. Pass --conv <id> to target a specific conversation (otherwise operates on the current tab).',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'conv', required: false, help: 'Conversation id or URL (navigates there before acting)' },
    ],
    columns: ['Status', 'Action'],
    func: async (page, kwargs) => {
        await maybeNavigateConv(page, kwargs?.conv);
        const res = await page.evaluate(clickLastAssistantActionScript(REGENERATE_LABELS));
        if (!res?.ok) {
            throw new CommandExecutionError(res?.reason || 'Regenerate failed', '');
        }
        return [{ Status: 'clicked', Action: 'regenerate' }];
    },
});

// ---------------- copy-message ----------------
cli({
    site: 'grok',
    name: 'copy-message',
    access: 'read',
    description: 'Return the text of the last assistant message. Pass --conv <id> to target a specific conversation. Use --markdown for formatted output.',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'conv', required: false, help: 'Conversation id or URL (navigates there before reading)' },
        { name: 'markdown', type: 'boolean', default: false, help: 'Format as markdown (preserves headings/lists/code)' },
        { name: 'click-button', type: 'boolean', default: false, help: 'Also click the in-UI Copy button (writes to system clipboard)' },
    ],
    columns: ['Field', 'Value'],
    func: async (page, kwargs) => {
        await maybeNavigateConv(page, kwargs?.conv);
        const last = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const bubbles = Array.from(document.querySelectorAll('[data-testid="assistant-message"]'))
        .filter((n) => isVisible(n));
      if (!bubbles.length) return null;
      const node = bubbles[bubbles.length - 1];
      return { text: node.innerText, html: node.innerHTML };
    })()`);
        if (!last) {
            throw new CommandExecutionError('No visible assistant message in current Grok conversation.', '');
        }
        const wantMd = kwargs?.markdown === true || kwargs?.markdown === 'true';
        const wantClick = kwargs?.['click-button'] === true || kwargs?.['click-button'] === 'true';

        if (wantClick) {
            await page.evaluate(clickLastAssistantActionScript(COPY_LABELS));
        }
        const text = wantMd && last.html
            ? (bubbleHtmlToMarkdown(last.html) || last.text)
            : last.text;
        return [
            { Field: 'Length', Value: String((text || '').length) + ' chars' },
            { Field: 'Format', Value: wantMd ? 'markdown' : 'plain' },
            { Field: 'ClipboardClicked', Value: wantClick ? 'yes' : 'no' },
            { Field: 'Text', Value: text || '' },
        ];
    },
});

// ---------------- react (like / dislike) ----------------
cli({
    site: 'grok',
    name: 'react',
    access: 'write',
    description: 'Like or dislike the last assistant message. Pass --conv <id> to target a specific conversation.',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'kind', positional: true, required: true, help: 'Reaction: like or dislike' },
        { name: 'conv', required: false, help: 'Conversation id or URL (navigates there before reacting)' },
    ],
    columns: ['Status', 'Reaction'],
    func: async (page, kwargs) => {
        const kind = String(kwargs.kind || '').trim().toLowerCase();
        if (kind !== 'like' && kind !== 'dislike') {
            throw new ArgumentError('kind', 'must be "like" or "dislike"');
        }
        await maybeNavigateConv(page, kwargs?.conv);
        const labels = kind === 'like' ? LIKE_LABELS : DISLIKE_LABELS;
        const res = await page.evaluate(clickLastAssistantActionScript(labels));
        if (!res?.ok) {
            throw new CommandExecutionError(res?.reason || `${kind} failed`, '');
        }
        return [{ Status: 'clicked', Reaction: kind }];
    },
});
