// Chat lifecycle + per-message actions for Kimi.

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
    TimeoutError,
} from '@jackwener/opencli/errors';
import {
    KIMI_DOMAIN,
    KIMI_URL,
    IS_VISIBLE_JS,
    ensureOnKimi,
    parseChatId,
    clickBySvgNameScript,
} from './_utils.js';

const CHAT_COLUMNS = ['Field', 'Value', 'Status', 'Url', 'Index', 'Title', 'ChatId', 'Role', 'Text', 'Length', 'ClipboardClicked', 'Reaction', 'WaitedSeconds', 'ReplyPreview'];

// Helper: if --conv passed, navigate to that chat URL and wait briefly
// for messages to mount. Otherwise just ensure we're on kimi.com.
async function maybeNavigateConv(page, convArg) {
    if (!convArg) {
        await ensureOnKimi(page);
        return;
    }
    const id = parseChatId(convArg);
    if (!id) throw new ArgumentError('conv', 'must be a Kimi chat id or https://www.kimi.com/chat/<id> URL');
    // CRITICAL: Kimi's React app only triggers the messages fetch when the
    // URL has ?chat_enter_method=history (or other valid entry methods).
    // Plain /chat/<id> loads the conversation TITLE but leaves the message
    // container empty (clientHeight=0). Append the query param.
    await page.goto(`${KIMI_URL}chat/${id}?chat_enter_method=history`);
    await page.wait(2);
    // Poll up to 15s for .chat-content-list items to appear.
    for (let i = 0; i < 15; i++) {
        const ok = await page.evaluate(`(() => {
      const list = document.querySelector('.chat-content-list') || document.querySelector('.message-list');
      if (!list) return false;
      // Check for actual chat-content-item rows (the new container) OR any direct children (older container)
      return list.querySelectorAll('.chat-content-item, .segment').length > 0 || list.children.length > 0;
    })()`);
        if (ok) return;
        await page.wait(1);
    }
}

// -------- status --------
cli({
    site: 'kimi',
    name: 'status',
    access: 'read',
    description: 'Check Kimi page connection, login state, and current URL.',
    domain: KIMI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: CHAT_COLUMNS,
    func: async (page) => {
        await ensureOnKimi(page);
        const data = await page.evaluate(`(() => {
      // Kimi marks logged-in users via the user avatar at bottom-left.
      const avatar = document.querySelector('img[src*="avatar.moonshot.cn"]');
      const loggedIn = !!avatar;
      return {
        url: window.location.href,
        title: document.title,
        loggedIn,
        userLabel: loggedIn ? (avatar.alt || '') : '',
      };
    })()`);
        return [
            { Field: 'Status', Value: 'Connected' },
            { Field: 'Url', Value: data.url },
            { Field: 'Title', Value: data.title },
            { Field: 'LoggedIn', Value: data.loggedIn ? 'Yes' : 'No' },
            { Field: 'User', Value: data.userLabel || '(unknown)' },
        ];
    },
});

// -------- new --------
cli({
    site: 'kimi',
    name: 'new',
    access: 'write',
    description: 'Start a new Kimi chat (navigates to / with chat_enter_method=new_chat).',
    domain: KIMI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: CHAT_COLUMNS,
    func: async (page) => {
        await page.goto(`${KIMI_URL}?chat_enter_method=new_chat`);
        await page.wait(1);
        const url = await page.evaluate('window.location.href');
        return [{ Status: 'started', Url: String(url || '') }];
    },
});

// -------- history --------
cli({
    site: 'kimi',
    name: 'history',
    access: 'read',
    description: 'List recent Kimi chats from the sidebar (with chat IDs extracted from href).',
    domain: KIMI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'limit', type: 'int', required: false, default: 30 },
    ],
    columns: CHAT_COLUMNS,
    func: async (page, kwargs) => {
        await ensureOnKimi(page);
        const items = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const anchors = Array.from(document.querySelectorAll('a[href*="/chat/"]')).filter(isVisible);
      const seen = new Set();
      const out = [];
      for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        const m = href.match(/\\/chat\\/([0-9a-f-]{8,})/i);
        if (!m) continue;
        const id = m[1].toLowerCase();
        if (id === 'history' || seen.has(id)) continue;
        seen.add(id);
        const title = (a.innerText || a.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 200);
        out.push({ id, title: title || '(untitled)' });
      }
      return out;
    })()`);
        if (!items.length) {
            throw new EmptyResultError('kimi history', 'No chats visible in sidebar. Are you logged in?');
        }
        const limit = Number.isInteger(kwargs?.limit) && kwargs.limit > 0 ? kwargs.limit : 30;
        return items.slice(0, limit).map((r, i) => ({ Index: i + 1, Title: r.title, ChatId: r.id }));
    },
});

// -------- detail --------
cli({
    site: 'kimi',
    name: 'detail',
    access: 'read',
    description: 'Open a Kimi chat by ID and return its visible messages.',
    domain: KIMI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Chat ID or full /chat/<id> URL' },
        { name: 'limit', type: 'int', required: false, default: 20 },
    ],
    columns: CHAT_COLUMNS,
    func: async (page, kwargs) => {
        const id = parseChatId(kwargs.id);
        if (!id) throw new ArgumentError('id', 'is required');
        // Same trick as maybeNavigateConv: include chat_enter_method=history
        // to actually trigger Kimi's messages fetch.
        await page.goto(`${KIMI_URL}chat/${id}?chat_enter_method=history`);
        for (let i = 0; i < 15; i++) {
            const ok = await page.evaluate(`(() => {
        const list = document.querySelector('.chat-content-list') || document.querySelector('.message-list');
        return !!list && list.querySelectorAll('.chat-content-item, .segment').length > 0;
      })()`);
            if (ok) break;
            await page.wait(1);
        }
        const turns = await readKimiTurns(page);
        if (!turns.length) {
            throw new EmptyResultError('kimi detail', `No messages found in /chat/${id}.`);
        }
        const limit = Number.isInteger(kwargs?.limit) && kwargs.limit > 0 ? kwargs.limit : 20;
        return turns.slice(0, limit).map((t, i) => ({ Index: i + 1, Role: t.role, Text: (t.text || '').slice(0, 1200) }));
    },
});

// -------- read --------
cli({
    site: 'kimi',
    name: 'read',
    access: 'read',
    description: 'Read messages in the current Kimi chat. Pass --conv <id> to navigate to a specific chat first.',
    domain: KIMI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'conv', required: false, help: 'Chat id or URL (navigates there before reading)' },
        { name: 'limit', type: 'int', required: false, default: 20 },
    ],
    columns: CHAT_COLUMNS,
    func: async (page, kwargs) => {
        await maybeNavigateConv(page, kwargs?.conv);
        const turns = await readKimiTurns(page);
        if (!turns.length) {
            throw new EmptyResultError('kimi read', 'No chat turns found on current page.');
        }
        const limit = Number.isInteger(kwargs?.limit) && kwargs.limit > 0 ? kwargs.limit : 20;
        return turns.slice(0, limit).map((t, i) => ({ Index: i + 1, Role: t.role, Text: (t.text || '').slice(0, 1200) }));
    },
});

// Helper for read / detail: extract turns from the current chat content list.
// Kimi renders messages in `.chat-content-list` as `.chat-content-item`
// children — each gets a `chat-content-item-user` or `chat-content-item-assistant`
// modifier class (also mirrored on the inner `.segment-user` / `.segment-assistant`).
async function readKimiTurns(page) {
    return await page.evaluate(`(() => {
    ${IS_VISIBLE_JS}
    // Prefer .chat-content-list (the actual messages container); fall back
    // to .message-list (older Kimi UI) and .chat-detail-content (parent).
    const box = document.querySelector('.chat-content-list') || document.querySelector('.message-list') || document.querySelector('.chat-detail-content');
    if (!box) return [];
    // Find every chat-content-item or segment row.
    const rows = Array.from(box.querySelectorAll('.chat-content-item, .segment')).filter(isVisible);
    const turns = [];
    const seen = new Set();
    for (const row of rows) {
      const tx = (row.innerText || row.textContent || '').trim().replace(/\\s+/g, ' ');
      if (!tx || tx.length < 2) continue;
      if (seen.has(tx)) continue;
      const cls = (row.className || '').toString().toLowerCase();
      let role = 'Turn';
      if (/chat-content-item-user|segment-user|user|sent-by-user|me-/i.test(cls)) role = 'User';
      else if (/chat-content-item-assistant|segment-assistant|assistant|ai-|kimi-|response/i.test(cls)) role = 'Assistant';
      else if (row.querySelector('svg[name="Copy"], svg[name="Refresh"], svg[name="Like"]')) role = 'Assistant';
      else role = 'User';
      seen.add(tx);
      turns.push({ role, text: tx });
    }
    return turns;
  })()`);
}

async function sendKimiMessage(page, text) {
    const prompt = String(text || '').trim();
    if (!prompt) throw new ArgumentError('text', 'is required');
    await ensureOnKimi(page);
    const beforeUsers = await page.evaluate(`(() => {
      return Array.from(document.querySelectorAll('.chat-content-list .chat-content-item, .message-list > *, .segment'))
        .filter((row) => /user|sent-by-user|me-/i.test(String(row.className || ''))).length;
    })()`);
    const typeRes = await page.evaluate(`(() => {
      ${IS_VISIBLE_JS}
      const editor = document.querySelector('[contenteditable="true"][role="textbox"]');
      if (!editor || !isVisible(editor)) return { ok: false, reason: 'Kimi composer not visible.' };
      editor.focus();
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, ${JSON.stringify(prompt)});
      return { ok: true };
    })()`);
    if (!typeRes?.ok) throw new CommandExecutionError(typeRes?.reason || 'composer type failed', '');
    await page.wait(0.3);
    const sendRes = await page.evaluate(clickBySvgNameScript('Send'));
    if (!sendRes?.ok) throw new CommandExecutionError(sendRes?.reason || 'Send button click failed', '');

    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
        const verified = await page.evaluate(`(() => {
      const normalize = (value) => String(value || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
      const prompt = normalize(${JSON.stringify(prompt)});
      const before = Number(${JSON.stringify(beforeUsers)}) || 0;
      const rows = Array.from(document.querySelectorAll('.chat-content-list .chat-content-item, .message-list > *, .segment'))
        .filter((row) => /user|sent-by-user|me-/i.test(String(row.className || '')));
      return rows.slice(before).some((row) => normalize(row.innerText || row.textContent).includes(prompt));
    })()`);
        if (verified) return { prompt };
        await page.wait(0.2);
    }
    throw new CommandExecutionError(
        'Kimi message submission was not verified',
        'The prompt was injected and Send was clicked, but no new user turn containing that prompt appeared.',
    );
}

// -------- send --------
cli({
    site: 'kimi',
    name: 'send',
    access: 'write',
    description: 'Send a message in the current Kimi chat (fire-and-forget; does not wait for reply).',
    domain: KIMI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'text', positional: true, required: true, help: 'Message text' },
    ],
    columns: CHAT_COLUMNS,
    func: async (page, kwargs) => {
        const result = await sendKimiMessage(page, kwargs?.text);
        return [{ Status: 'sent', Length: String(result.prompt.length) }];
    },
});

// -------- copy-message --------
cli({
    site: 'kimi',
    name: 'copy-message',
    access: 'write',
    description: 'Return the text of the last assistant message. Pass --conv <id> to navigate to a specific chat first.',
    domain: KIMI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'conv', required: false, help: 'Chat id or URL (navigates there before reading)' },
        { name: 'click-button', type: 'boolean', default: false, help: 'Also click in-UI Copy button (writes to clipboard)' },
    ],
    columns: CHAT_COLUMNS,
    func: async (page, kwargs) => {
        await maybeNavigateConv(page, kwargs?.conv);
        const turns = await readKimiTurns(page);
        const assistantTurns = turns.filter((t) => t.role === 'Assistant');
        if (!assistantTurns.length) {
            throw new EmptyResultError('kimi copy-message', 'No assistant message visible.');
        }
        const last = assistantTurns[assistantTurns.length - 1];
        if (kwargs?.['click-button'] === true || kwargs?.['click-button'] === 'true') {
            const clickRes = await page.evaluate(clickBySvgNameScript('Copy'));
            if (!clickRes?.ok) throw new CommandExecutionError(clickRes?.reason || 'Copy button not visible', '');
        }
        return [
            { Field: 'Length', Value: String((last.text || '').length) + ' chars' },
            { Field: 'ClipboardClicked', Value: (kwargs?.['click-button'] === true || kwargs?.['click-button'] === 'true') ? 'yes' : 'no' },
            { Field: 'Text', Value: last.text || '' },
        ];
    },
});

// -------- regenerate --------
cli({
    site: 'kimi',
    name: 'regenerate',
    access: 'write',
    description: 'Click Refresh (Kimi\'s regenerate button) on the last assistant message. Pass --conv <id> to target a specific chat.',
    domain: KIMI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'conv', required: false, help: 'Chat id or URL' },
    ],
    columns: CHAT_COLUMNS,
    func: async (page, kwargs) => {
        await maybeNavigateConv(page, kwargs?.conv);
        const res = await page.evaluate(clickBySvgNameScript('Refresh'));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'Refresh button not visible', '');
        return [{ Status: 'regenerated' }];
    },
});

// -------- react --------
cli({
    site: 'kimi',
    name: 'react',
    access: 'write',
    description: 'Like or dislike the last assistant message. Pass --conv <id> to target a specific chat.',
    domain: KIMI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'kind', positional: true, required: true, help: 'like or dislike' },
        { name: 'conv', required: false, help: 'Chat id or URL' },
    ],
    columns: CHAT_COLUMNS,
    func: async (page, kwargs) => {
        const kind = String(kwargs?.kind || '').trim().toLowerCase();
        if (kind !== 'like' && kind !== 'dislike') throw new ArgumentError('kind', 'must be "like" or "dislike"');
        await maybeNavigateConv(page, kwargs?.conv);
        const svgName = kind === 'like' ? 'Like' : 'Dislike';
        const res = await page.evaluate(clickBySvgNameScript(svgName));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || `${kind} button not visible`, '');
        return [{ Status: 'clicked', Reaction: kind }];
    },
});

// -------- share --------
cli({
    site: 'kimi',
    name: 'share',
    access: 'write',
    description: 'Click Share on the last assistant message (opens Kimi\'s share dialog). Pass --conv <id> to target a specific chat.',
    domain: KIMI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'conv', required: false, help: 'Chat id or URL' },
    ],
    columns: CHAT_COLUMNS,
    func: async (page, kwargs) => {
        await maybeNavigateConv(page, kwargs?.conv);
        const res = await page.evaluate(clickBySvgNameScript('Share_a'));
        if (!res?.ok) throw new CommandExecutionError(res?.reason || 'Share button not visible', '');
        await page.wait(1);
        return [{ Status: 'share dialog opened' }];
    },
});

// -------- ask --------
cli({
    site: 'kimi',
    name: 'ask',
    access: 'write',
    description: 'Send a message and wait up to --timeout seconds for the assistant reply (best-effort: polls for turn count to grow + stabilize).',
    domain: KIMI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'text', positional: true, required: true, help: 'Prompt text' },
        { name: 'timeout', type: 'int', required: false, default: 120 },
    ],
    columns: CHAT_COLUMNS,
    func: async (page, kwargs) => {
        const text = String(kwargs?.text || '').trim();
        if (!text) throw new ArgumentError('text', 'is required');
        const timeoutSec = Number.isInteger(kwargs?.timeout) && kwargs.timeout > 0 ? kwargs.timeout : 120;
        await ensureOnKimi(page);
        const baselineAssistant = (await readKimiTurns(page)).filter((t) => t.role === 'Assistant').length;
        await sendKimiMessage(page, text);
        const startedAt = Date.now();
        const deadline = startedAt + timeoutSec * 1000;
        let latestText = '';
        let stable = 0;
        while (Date.now() < deadline) {
            await page.wait(1.5);
            const turns = await readKimiTurns(page).catch(() => []);
            const assistantTurns = turns.filter((t) => t.role === 'Assistant');
            if (assistantTurns.length <= baselineAssistant) continue;
            const next = assistantTurns[assistantTurns.length - 1]?.text || '';
            if (next && next === latestText) {
                stable++;
            } else {
                latestText = next;
                stable = 0;
            }
            if (latestText && stable >= 2) break;
        }
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        if (!latestText) {
            throw new TimeoutError('kimi ask', timeoutSec, 'No new Kimi assistant reply was visible before the timeout.');
        }
        return [{
            Status: 'reply-received',
            Length: String(text.length),
            WaitedSeconds: String(elapsed),
            ReplyPreview: latestText.slice(0, 300),
        }];
    },
});
