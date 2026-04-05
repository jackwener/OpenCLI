import { AuthRequiredError, SelectorError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { normalizeNumericId } from './utils.js';

function buildChatUrl(itemId: string, peerUserId: string): string {
  return `https://www.goofish.com/im?itemId=${encodeURIComponent(itemId)}&peerUserId=${encodeURIComponent(peerUserId)}`;
}

function buildExtractChatStateEvaluate(): string {
  return `
    (() => {
      const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const bodyText = document.body?.innerText || '';
      const requiresAuth = /请先登录|登录后/.test(bodyText);

      const textarea = document.querySelector('textarea');
      const sendButton = Array.from(document.querySelectorAll('button'))
        .find((btn) => clean(btn.textContent || '') === '发送');
      const topbar = document.querySelector('[class*="message-topbar"]');
      const itemCard = Array.from(document.querySelectorAll('a[href*="/item?id="]'))
        .find((el) => el.closest('main'));
      const itemTitleNode =
        document.querySelector('[class*="container"] [class*="title"]')
        || document.querySelector('[class*="item-main-info"] [class*="desc"]')
        || document.querySelector('[class*="headSkuInfo"]')
        || itemCard?.querySelector('[class*="title"]')
        || itemCard?.previousElementSibling?.querySelector?.('[class*="title"]');

      const messageRoot = document.querySelector('#message-list-scrollable');
      const visibleMessages = Array.from(
        (messageRoot || document).querySelectorAll('[class*="message"], [class*="msg"], [class*="bubble"]')
      ).map((el) => clean(el.textContent || ''))
        .filter(Boolean)
        .filter((text) => !['发送', '闲鱼号', '立即购买'].includes(text))
        .filter((text) => !/^消息\\d*\\+?$/.test(text))
        .slice(-20);

      return {
        requiresAuth,
        title: clean(document.title || ''),
        peer_name: clean(topbar?.querySelector('[class*="text1"]')?.textContent || ''),
        peer_masked_id: clean(topbar?.querySelector('[class*="text2"]')?.textContent || '').replace(/^\\(|\\)$/g, ''),
        item_title: clean(itemTitleNode?.textContent || ''),
        item_url: itemCard?.href || '',
        price: clean(itemCard?.querySelector('[class*="money"]')?.textContent || ''),
        location: clean(itemCard?.querySelector('[class*="delivery"] + [class*="delivery"], [class*="delivery"]:last-child')?.textContent || ''),
        can_input: Boolean(textarea && !textarea.disabled),
        can_send: Boolean(sendButton),
        visible_messages: visibleMessages,
      };
    })()
  `;
}

function buildSendMessageEvaluate(text: string): string {
  return `
    (() => {
      const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const textarea = document.querySelector('textarea');
      if (!textarea || textarea.disabled) {
        return { ok: false, reason: 'input-not-found' };
      }

      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (!setter) {
        return { ok: false, reason: 'textarea-setter-not-found' };
      }

      textarea.focus();
      setter.call(textarea, ${JSON.stringify(text)});
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));

      const sendButton = Array.from(document.querySelectorAll('button'))
        .find((btn) => clean(btn.textContent || '') === '发送');
      if (!sendButton) {
        return { ok: false, reason: 'send-button-not-found' };
      }

      sendButton.click();
      return { ok: true };
    })()
  `;
}

cli({
  site: 'xianyu',
  name: 'chat',
  description: '打开闲鱼聊一聊会话，并可选发送消息',
  domain: 'www.goofish.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  browser: true,
  args: [
    { name: 'item_id', required: true, positional: true, help: '闲鱼商品 item_id' },
    { name: 'user_id', required: true, positional: true, help: '聊一聊对方的 user_id / peerUserId' },
    { name: 'text', help: 'Message to send after opening the chat' },
  ],
  columns: ['status', 'peer_name', 'item_title', 'price', 'location', 'message'],
  func: async (page, kwargs) => {
    const itemId = normalizeNumericId(kwargs.item_id, 'item_id', '1038951278192');
    const userId = normalizeNumericId(kwargs.user_id, 'user_id', '3650092411');
    const url = buildChatUrl(itemId, userId);
    const text = String(kwargs.text || '').trim();

    await page.goto(url);
    await page.wait(2);

    const state = await page.evaluate(buildExtractChatStateEvaluate()) as {
      requiresAuth?: boolean;
      title?: string;
      peer_name?: string;
      peer_masked_id?: string;
      item_title?: string;
      item_url?: string;
      price?: string;
      location?: string;
      can_input?: boolean;
      can_send?: boolean;
      visible_messages?: string[];
    };

    if (state?.requiresAuth) {
      throw new AuthRequiredError('www.goofish.com', 'Xianyu chat requires a logged-in browser session');
    }

    if (!state?.can_input) {
      throw new SelectorError('闲鱼聊天输入框', '未找到可用的聊天输入框，请确认该会话页已正确加载');
    }

    if (!text) {
      return [{
        status: 'ready',
        peer_name: state.peer_name || '',
        item_title: state.item_title || '',
        price: state.price || '',
        location: state.location || '',
        message: (state.visible_messages || []).slice(-1)[0] || '',
        peer_user_id: userId,
        item_id: itemId,
        url,
        item_url: state.item_url || '',
      }];
    }

    const sent = await page.evaluate(buildSendMessageEvaluate(text)) as {
      ok?: boolean;
      reason?: string;
    };

    if (!sent?.ok) {
      throw new SelectorError('闲鱼发送按钮', `消息发送失败：${sent?.reason || 'unknown-reason'}`);
    }

    await page.wait(1);

    return [{
      status: 'sent',
      peer_name: state.peer_name || '',
      item_title: state.item_title || '',
      price: state.price || '',
      location: state.location || '',
      message: text,
      peer_user_id: userId,
      item_id: itemId,
      url,
      item_url: state.item_url || '',
    }];
  },
});

export const __test__ = {
  normalizeNumericId,
  buildChatUrl,
};
