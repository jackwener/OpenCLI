import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

export const DEFAULT_INBOX_LIMIT = 20;
export const MAX_INBOX_LIMIT = 100;
export const DEFAULT_MESSAGE_LIMIT = 50;
export const MAX_MESSAGE_LIMIT = 200;

export function normalizeLimit(value, defaultValue = DEFAULT_INBOX_LIMIT, maxValue = MAX_INBOX_LIMIT, label = 'limit') {
    const raw = String(value ?? '').trim();
    if (!raw) return defaultValue;
    if (!/^\d+$/.test(raw)) {
        throw new ArgumentError(`xianyu ${label} must be an integer between 1 and ${maxValue}`);
    }
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n < 1 || n > maxValue) {
        throw new ArgumentError(`xianyu ${label} must be an integer between 1 and ${maxValue}`);
    }
    return n;
}

export function normalizeRank(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return 0;
    if (!/^\d+$/.test(raw)) {
        throw new ArgumentError('xianyu rank must be a positive integer from xianyu inbox');
    }
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n < 1) {
        throw new ArgumentError('xianyu rank must be a positive integer from xianyu inbox');
    }
    return n;
}

export function requireText(value, label) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (!text) {
        throw new ArgumentError(`${label} cannot be empty`);
    }
    return text;
}

export function requireEvaluateObject(payload, label) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new CommandExecutionError(`Xianyu ${label} returned malformed browser payload`);
    }
    return payload;
}

export function requireClickResult(payload, label) {
    const result = requireEvaluateObject(payload, label);
    if (result.ok !== true) {
        throw new CommandExecutionError(`Xianyu ${label} failed: ${result.reason || 'unknown-reason'}`);
    }
    return result;
}

export function buildChatUrl(itemId, peerUserId) {
    return `https://www.goofish.com/im?itemId=${encodeURIComponent(itemId)}&peerUserId=${encodeURIComponent(peerUserId)}`;
}

export function buildInboxUrl() {
    return 'https://www.goofish.com/im';
}

export function buildClickInboxConversationEvaluate(index) {
    return `
    (() => {
      const rows = Array.from(document.querySelectorAll('#conv-list-scrollable [class*="conversation-item"], a[href*="/im"], a[href*="itemId="][href*="peerUserId="]'));
      const row = rows[${index}];
      if (!row) return { ok: false, reason: 'row-not-found' };
      row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
      row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      row.click();
      row.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      return { ok: true };
    })()
  `;
}

export function buildReadCurrentConversationUrlEvaluate() {
    return `
    (() => {
      const url = location.href || '';
      const params = new URL(url).searchParams;
      return {
        url,
        item_id: params.get('itemId') || '',
        peer_user_id: params.get('peerUserId') || '',
      };
    })()
  `;
}

export function buildExtractInboxEvaluate(limit) {
    return `
    (() => {
      const clean = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const bodyText = document.body?.innerText || '';
      const requiresAuth = /请先登录|登录后|璇峰厛鐧诲綍|鐧诲綍鍚?/.test(bodyText);
      const blocked = /验证码|安全验证|异常访问|楠岃瘉鐮亅瀹夊叏楠岃瘉|寮傚父璁块棶/.test(bodyText);

      const absoluteUrl = (url) => {
        try {
          return new URL(url, location.href).href;
        } catch {
          return '';
        }
      };

      const readId = (url, key) => {
        try {
          return new URL(url, location.href).searchParams.get(key) || '';
        } catch {
          const match = String(url || '').match(new RegExp('[?&]' + key + '=(\\\\d+)'));
          return match ? match[1] : '';
        }
      };

      const pick = (root, selectors) => {
        for (const selector of selectors) {
          const node = root.querySelector(selector);
          const text = clean(node?.getAttribute?.('title') || node?.textContent || '');
          if (text) return text;
        }
        return '';
      };

      const leafTexts = (root) => Array.from(root.querySelectorAll('div, span'))
        .filter((node) => !Array.from(node.children || []).some((child) => ['DIV', 'SPAN'].includes(child.tagName)))
        .map((node) => clean(node.textContent || ''))
        .filter(Boolean);

      const looksLikeTime = (text) => /^(刚刚|\\d+分钟前|\\d+小时前|\\d+天前|昨天|前天|\\d{1,2}:\\d{2}|\\d{4}-\\d{1,2}-\\d{1,2})$/.test(text);

      const links = Array.from(document.querySelectorAll('a[href*="/im"], a[href*="itemId="][href*="peerUserId="]'));
      const seen = new Set();
      const items = [];
      for (const link of links) {
        const href = link.href || link.getAttribute('href') || '';
        const itemId = readId(href, 'itemId');
        const peerUserId = readId(href, 'peerUserId');
        if (!itemId || !peerUserId) continue;
        const key = itemId + ':' + peerUserId;
        if (seen.has(key)) continue;
        seen.add(key);

        const root = link.closest('[class*="conversation"], [class*="session"], [class*="contact"], [class*="chat"], li, [role="listitem"]') || link;
        const peerName = pick(root, ['[class*="name"]', '[class*="nick"]', '[class*="user"]', '[class*="text1"]']);
        const itemTitle = pick(root, ['[class*="title"]', '[class*="item"] [class*="desc"]', '[class*="desc"]']);
        const price = pick(root, ['[class*="money"]', '[class*="price"]']);
        const lastMessage = pick(root, ['[class*="message"]', '[class*="msg"]', '[class*="content"]', '[class*="summary"]']);
        const rootText = clean(root.textContent || '');
        const unreadText = pick(root, ['[class*="badge"]', '[class*="unread"]', '[class*="red"]']);
        const unreadCount = Number.parseInt(unreadText.replace(/\\D/g, ''), 10) || (unreadText ? 1 : 0);

        items.push({
          row_index: items.length,
          peer_name: peerName,
          peer_user_id: peerUserId,
          item_id: itemId,
          item_title: itemTitle,
          price,
          last_message: lastMessage || rootText,
          unread: unreadCount > 0 || /unread|未读/.test(String(root.className || '') + ' ' + rootText),
          unread_count: unreadCount,
          url: absoluteUrl(href),
        });
        if (items.length >= ${limit}) break;
      }

      if (!items.length) {
        const rows = Array.from(document.querySelectorAll('#conv-list-scrollable [class*="conversation-item"]')).slice(0, ${limit});
        for (const row of rows) {
          const texts = leafTexts(row)
            .filter((text) => !/^\\d+$/.test(text) || row.querySelector('sup[title="' + text.replace(/"/g, '\\"') + '"]') == null);
          const time = [...texts].reverse().find(looksLikeTime) || '';
          const unreadTitle = clean(row.querySelector('sup')?.getAttribute('title') || row.querySelector('[class*="badge"], [class*="unread"]')?.textContent || '');
          const unreadCount = Number.parseInt(unreadTitle.replace(/\\D/g, ''), 10) || (unreadTitle ? 1 : 0);
          const peerName = texts.find((text) => text !== time && text !== unreadTitle && !/^\\[.*\\]$/.test(text)) || '';
          const lastMessage = texts.find((text) => text !== peerName && text !== time && text !== unreadTitle) || '';
          if (!peerName && !lastMessage) continue;
          items.push({
            row_index: items.length,
            peer_name: peerName,
            peer_user_id: '',
            item_id: '',
            item_title: '',
            price: '',
            last_message: lastMessage,
            unread: unreadCount > 0,
            unread_count: unreadCount,
            url: '',
            time,
          });
          if (items.length >= ${limit}) break;
        }
      }

      return { requiresAuth, blocked, empty: !items.length, items };
    })()
  `;
}

export function buildExtractChatStateEvaluate(limit = DEFAULT_MESSAGE_LIMIT) {
    return `
    (() => {
      const clean = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const bodyText = document.body?.innerText || '';
      const requiresAuth = /请先登录|登录后|璇峰厛鐧诲綍|鐧诲綍鍚?/.test(bodyText);

      const textarea = document.querySelector('textarea');
      const normalizeBtn = (s) => String(s || '').replace(/\\s+/g, '').trim();
      const sendButton = Array.from(document.querySelectorAll('button'))
        .find((btn) => /^(发送|鍙戦€?)$/.test(normalizeBtn(btn.textContent || '')));
      const topbar = document.querySelector('[class*="message-topbar"]');
      const itemCard = Array.from(document.querySelectorAll('a[href*="/item?id="]'))
        .find((el) => el.closest('main')) || document.querySelector('a[href*="/item?id="]');
      const itemTitleNode =
        document.querySelector('[class*="container"] [class*="title"]')
        || document.querySelector('[class*="item-main-info"] [class*="desc"]')
        || document.querySelector('[class*="headSkuInfo"]')
        || itemCard?.querySelector('[class*="title"]')
        || itemCard?.previousElementSibling?.querySelector?.('[class*="title"]');

      const messageRoot = document.querySelector('#message-list-scrollable') || document.querySelector('[class*="message-list"]');
      let visibleMessages = Array.from((messageRoot || document).querySelectorAll('[class*="message-row"]'))
        .map((row) => {
          const textNode = row.querySelector('[class*="message-text"]');
          return clean(textNode?.textContent || '');
        })
        .filter(Boolean);

      if (!visibleMessages.length) {
        visibleMessages = Array.from(
          (messageRoot || document).querySelectorAll('[class*="message"], [class*="msg"], [class*="bubble"]')
        ).map((el) => clean(el.textContent || ''));
      }

      visibleMessages = visibleMessages
        .filter(Boolean)
        .filter((text) => !['发送', '闲鱼号', '立即购买', '鍙戦€?', '闂查奔鍙?', '绔嬪嵆璐拱'].includes(text))
        .filter((text) => !/^消息\\d*\\+?$/.test(text) && !/^娑堟伅\\d*\\+?$/.test(text))
        .slice(-${limit});

      return {
        requiresAuth,
        title: clean(document.title || ''),
        peer_name: clean(topbar?.querySelector('[class*="text1"]')?.textContent || ''),
        peer_masked_id: clean(topbar?.querySelector('[class*="text2"]')?.textContent || '').replace(/^\\(|\\)$/g, ''),
        item_title: clean(itemTitleNode?.textContent || ''),
        item_url: itemCard?.href || '',
        price: clean(itemCard?.querySelector('[class*="money"], [class*="price"]')?.textContent || ''),
        location: clean(itemCard?.querySelector('[class*="delivery"] + [class*="delivery"], [class*="delivery"]:last-child')?.textContent || ''),
        can_input: Boolean(textarea && !textarea.disabled),
        can_send: Boolean(sendButton),
        visible_messages: visibleMessages,
        messages: visibleMessages.map((text, index) => ({ index: index + 1, text })),
      };
    })()
  `;
}

export function buildSendMessageEvaluate(text) {
    return `
    (async () => {
      const clean = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const readMessages = () => {
        const messageRoot = document.querySelector('#message-list-scrollable') || document.querySelector('[class*="message-list"]');
        let messages = Array.from((messageRoot || document).querySelectorAll('[class*="message-row"]'))
          .map((row) => clean(row.querySelector('[class*="message-text"]')?.textContent || ''))
          .filter(Boolean);
        if (!messages.length) {
          messages = Array.from(
            (messageRoot || document).querySelectorAll('[class*="message"], [class*="msg"], [class*="bubble"]')
          ).map((el) => clean(el.textContent || '')).filter(Boolean);
        }
        return messages
          .filter((item) => !['发送', '闲鱼号', '立即购买', '鍙戦€?', '闂查奔鍙?', '绔嬪嵆璐拱'].includes(item))
          .filter((item) => !/^消息\\d*\\+?$/.test(item) && !/^娑堟伅\\d*\\+?$/.test(item));
      };

      const textarea = document.querySelector('textarea');
      if (!textarea || textarea.disabled) {
        return { ok: false, reason: 'input-not-found' };
      }

      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (!setter) {
        return { ok: false, reason: 'textarea-setter-not-found' };
      }

      const beforeMessages = readMessages();
      textarea.click();
      textarea.focus();
      setter.call(textarea, ${JSON.stringify(text)});
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));

      const normalizeBtn = (s) => String(s || '').replace(/\\s+/g, '').trim();
      let sendButton = null;
      for (let i = 0; i < 30; i++) {
        sendButton = Array.from(document.querySelectorAll('button'))
          .find((btn) => /^(发送|鍙戦€?)$/.test(normalizeBtn(btn.textContent || '')));
        if (sendButton) break;
        await new Promise(r => setTimeout(r, 100));
      }
      if (!sendButton) {
        return { ok: false, reason: 'send-button-not-found' };
      }

      sendButton.click();
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 100));
        const afterMessages = readMessages();
        if (afterMessages.length > beforeMessages.length && afterMessages.at(-1) === ${JSON.stringify(text)}) {
          return { ok: true };
        }
      }
      return { ok: false, reason: 'send-postcondition-timeout' };
    })()
  `;
}
