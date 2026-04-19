import { cli, Strategy } from '../../registry.js';
import { SelectorError } from '../../errors.js';
import type { IPage } from '../../types.js';

export const chatCommand = cli({
  site: 'cursor',
  name: 'chat',
  description: 'Open a new Cursor chat and send a prompt via CDP native key events',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'text', required: true, positional: true, help: 'Prompt to send' },
    { name: 'timeout', required: false, help: 'Max seconds to wait for response (default: 60)', default: '60' },
  ],
  columns: ['Role', 'Text'],
  func: async (page: IPage, kwargs: any) => {
    const text = kwargs.text as string;
    const timeout = parseInt(kwargs.timeout as string, 10) || 60;
    const isMac = process.platform === 'darwin';

    // Cmd+N 打开新对话
    await cdpKeyCombo(page, isMac ? 'Meta' : 'Control', 'n');
    await page.wait(2);

    // 查找输入框并注入文本
    const injected = await page.evaluate(
      `(function(text) {
        let editor = document.querySelector('.aislash-editor-input, [data-lexical-editor="true"], [contenteditable="true"]');
        if (!editor) return false;
        editor.focus();
        document.execCommand('selectAll');
        document.execCommand('delete');
        document.execCommand('insertText', false, text);
        return true;
      })(${JSON.stringify(text)})`
    );

    if (!injected) {
      throw new SelectorError('Cursor chat input element');
    }

    await page.wait(0.5);

    // 用 CDP 原生 Input.dispatchKeyEvent 发送 Enter（JS dispatchEvent 无法触发 Lexical 提交）
    await cdpPressEnter(page);
    await page.wait(3);

    // 轮询等待 AI 回复（新对话从 0 条消息开始）
    const pollInterval = 2;
    const maxPolls = Math.ceil(timeout / pollInterval);
    let response = '';

    for (let i = 0; i < maxPolls; i++) {
      await page.wait(pollInterval);
      const result = await page.evaluate(`
        (function() {
          const msgs = document.querySelectorAll('[data-message-role]');
          for (let j = msgs.length - 1; j >= 0; j--) {
            const role = msgs[j].getAttribute('data-message-role');
            if (role === 'ai' || role === 'assistant') {
              const root = msgs[j].querySelector('.markdown-root');
              const text = root ? root.innerText : msgs[j].innerText;
              return text ? text.trim() : null;
            }
          }
          return null;
        })()
      `);
      if (result) {
        response = result;
        break;
      }
    }

    if (!response) {
      return [
        { Role: 'User', Text: text },
        { Role: 'System', Text: `No response received within ${timeout}s. The AI may still be generating.` },
      ];
    }

    return [
      { Role: 'User', Text: text },
      { Role: 'Assistant', Text: response },
    ];
  },
});

function getBridge(page: IPage): any {
  return (page as any).bridge;
}

async function cdpPressEnter(page: IPage): Promise<void> {
  const bridge = getBridge(page);
  await bridge.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
  await bridge.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
}

async function cdpKeyCombo(page: IPage, modifier: string, key: string): Promise<void> {
  const bridge = getBridge(page);
  const modFlag = modifier === 'Meta' ? 4 : modifier === 'Control' ? 2 : modifier === 'Alt' ? 1 : 0;
  const modCode = modifier === 'Meta' ? 'MetaLeft' : modifier === 'Control' ? 'ControlLeft' : 'AltLeft';

  await bridge.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: modifier, code: modCode, modifiers: modFlag,
  });
  await bridge.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key, code: 'Key' + key.toUpperCase(),
    windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0),
    nativeVirtualKeyCode: key.toUpperCase().charCodeAt(0),
    modifiers: modFlag,
  });
  await bridge.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key, code: 'Key' + key.toUpperCase(),
    windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0),
    nativeVirtualKeyCode: key.toUpperCase().charCodeAt(0),
    modifiers: modFlag,
  });
  await bridge.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: modifier, code: modCode,
  });
}
