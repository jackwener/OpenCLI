import { cli, Strategy } from '@jackwener/opencli/registry';
import { extractRoomSummary, gotoRoom, ensureRoomReady, requireText, wrapUiWriteError } from './utils.js';

function buildDanmakuScript(text) {
  return `
    (async () => {
      const danmakuText = ${JSON.stringify(text)};
      const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const isVisible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      const findInput = () => Array.from(document.querySelectorAll(
        '.ChatSend-txt[contenteditable="true"], [contenteditable="true"][maxlength="50"], [contenteditable="true"]'
      )).find(isVisible);
      const findSendButton = () => Array.from(document.querySelectorAll('button'))
        .find((el) => isVisible(el) && /ChatSend-button|发送/.test(String(el.className || '') + ' ' + clean(el.textContent)));

      const input = findInput();
      if (!input) {
        throw new Error('BUTTON_NOT_FOUND: danmaku input not found');
      }
      const button = findSendButton();
      if (!button) {
        throw new Error('BUTTON_NOT_FOUND: danmaku send button not found');
      }

      input.focus();
      input.textContent = '';
      document.execCommand('insertText', false, danmakuText);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: danmakuText }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(250);

      const currentText = clean(input.innerText || input.textContent || '');
      if (!currentText.includes(danmakuText)) {
        throw new Error('STATE_VERIFY_FAIL: danmaku text was not accepted by editor');
      }

      button.click();
      await sleep(1000);

      const bodyText = clean(document.body?.innerText || '');
      if (/登录后|请登录|立即登录/.test(bodyText)) {
        throw new Error('AUTH_REQUIRED: Douyu login is required');
      }
      if (/发送过快|频率|禁言|内容违规|敏感词/.test(bodyText)) {
        throw new Error('STATE_VERIFY_FAIL: Douyu rejected the danmaku, page says: ' + bodyText.slice(-120));
      }

      return { result: 'sent' };
    })()
  `;
}

export const command = cli({
  site: 'douyu',
  name: 'danmaku',
  aliases: ['send'],
  description: '向斗鱼直播间发送普通弹幕',
  access: 'write',
  example: 'opencli douyu danmaku 6979222 "hello" -f yaml',
  domain: 'www.douyu.com',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  args: [
    { name: 'room', required: true, positional: true, help: 'Douyu room id or room URL' },
    { name: 'text', required: true, positional: true, help: 'Danmaku text, max 50 chars' },
  ],
  columns: ['room', 'streamer', 'text', 'result', 'url'],
  func: async (page, kwargs) => sendDanmaku(page, kwargs.room, kwargs.text),
});

export async function sendDanmaku(page, room, value) {
  const text = requireText(value, 'danmaku text', 50);
  try {
    await gotoRoom(page, room);
    await ensureRoomReady(page);
    const action = await page.evaluate(buildDanmakuScript(text));
    const summary = await extractRoomSummary(page);
    return [{ room: summary.room, streamer: summary.streamer, text, result: action.result, url: summary.url }];
  } catch (error) {
    wrapUiWriteError(error, 'send Douyu danmaku');
  }
}

export const __test__ = { buildDanmakuScript };
