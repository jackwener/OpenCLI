import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const SIDE_CHANNEL_ID = '__opencli_side_channel__';

cli({
  site: 'qwen-studio',
  name: 'ask',
  description: 'Send a message to Qwen AI and get the response (chat.qwen.ai)',
  access: 'write',
  example: 'opencli qwen-studio ask --message "What is 2+2?" --model qwen3.7-plus',
  domain: 'chat.qwen.ai',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'message', type: 'string', required: true, help: 'The message to send to Qwen AI' },
    { name: 'model', type: 'string', default: 'qwen3.7-plus', help: 'Model to use: qwen3.7-plus (default), qwen3.7-max, qwen3.6-plus, qwen3.5-plus' },
  ],
  columns: ['question', 'answer', 'model', 'chatId'],
  func: async (page, args) => {
    const message = String(args.message ?? '').trim();
    if (!message) throw new ArgumentError('message is required');
    if (message.length > 8000) throw new ArgumentError('message too long (max 8000 chars)');

    const model = String(args.model ?? 'qwen3.7-plus');

    await page.goto('https://chat.qwen.ai/');

    // Helper: run main-world code, return result via DOM side-channel
    const runMainWorld = async (code) => {
      // Reset side channel
      await page.evaluate((id) => {
        let el = document.getElementById(id);
        if (!el) { el = document.createElement('div'); el.id = id; el.style.display = 'none'; document.body.appendChild(el); }
        el.textContent = '';
        el.dataset.value = '';
      }, SIDE_CHANNEL_ID);

      // Inject main-world script that writes to side channel
      await page.evaluate((c, id) => {
        const s = document.createElement('script');
        s.textContent = `try { var __r = (function(){${c}})(); document.getElementById('${id}').dataset.value = JSON.stringify(__r); } catch(e) { document.getElementById('${id}').dataset.value = JSON.stringify({ ok:false, reason:'scriptErr: ' + e.message }); }`;
        document.head.appendChild(s);
        s.remove();
      }, code, SIDE_CHANNEL_ID);

      // Read result from side channel
      const raw = await page.evaluate((id) => document.getElementById(id)?.dataset?.value, SIDE_CHANNEL_ID);
      try { return JSON.parse(raw); } catch { return { ok: false, reason: 'parseErr', raw }; }
    };

    // Wait for hydration
    let hydrated = false;
    for (let i = 0; i < 30; i++) {
      hydrated = await page.evaluate(() => {
        const ta = document.querySelector('textarea[placeholder*="幫助"]') || document.querySelector('textarea');
        return ta && ta.offsetParent !== null;
      }).catch(() => false);
      if (hydrated) break;
      await page.wait(1);
    }
    if (!hydrated) {
      const url = await page.evaluate(() => window.location.href).catch(() => 'unknown');
      throw new CommandExecutionError(`Qwen Studio SPA did not hydrate within 30s. URL: ${url}`);
    }

    // STEP 1: Type message — set value + dispatch input + call React onChange directly
    const typed = await runMainWorld(`
      var t = document.querySelector('textarea[placeholder*="幫助"]') || document.querySelector('textarea');
      if (!t) return { ok: false, reason: 'no textarea' };
      t.focus();
      var propsKey = Object.keys(t).find(k => k.startsWith('__reactProps'));
      if (!propsKey) return { ok: false, reason: 'no reactProps' };
      var props = t[propsKey];
      if (!props || !props.onChange) return { ok: false, reason: 'no onChange' };
      var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      nativeSetter.call(t, ${JSON.stringify(message)});
      t.dispatchEvent(new Event('input', { bubbles: true }));
      try {
        props.onChange({ target: t, currentTarget: t, type: 'change', bubbles: true });
      } catch (e) {
        return { ok: false, reason: 'onChange err: ' + e.message, after: t.value };
      }
      return { ok: true, val: t.value };
    `);
    if (!typed?.ok) throw new CommandExecutionError(`Type failed: ${typed?.reason || 'unknown'} after=${typed?.after}`);

    // STEP 2: Wait for send button (replaces voice-input when React state has text)
    let sendReady = false;
    let btnInfo = null;
    for (let i = 0; i < 10; i++) {
      btnInfo = await page.evaluate(() => {
        const ta = document.querySelector('textarea');
        if (!ta) return null;
        const btn = ta.parentElement?.querySelector('button.send-button')
          || Array.from(document.querySelectorAll('button')).find(b =>
            b.className && b.className.includes && b.className.includes('send-button') && b.offsetParent !== null
          );
        if (!btn) return null;
        const propsKey = Object.keys(btn).find(k => k.startsWith('__reactProps'));
        return { hasOnClick: !!(propsKey && btn[propsKey]?.onClick) };
      }).catch(() => null);
      if (btnInfo) { sendReady = true; break; }
      await page.wait(1);
    }
    if (!sendReady) throw new CommandExecutionError('Send button did not appear after typing (React state may not have updated)');

    // STEP 3: Click send via main-world React onClick
    const clicked = await runMainWorld(`
      var ta = document.querySelector('textarea');
      var btn = ta && ta.parentElement && ta.parentElement.querySelector('button.send-button');
      if (!btn) {
        btn = Array.from(document.querySelectorAll('button')).find(b =>
          b.className && b.className.includes && b.className.includes('send-button') && b.offsetParent !== null
        );
      }
      if (!btn) return { ok: false, reason: 'no send button' };
      var propsKey = Object.keys(btn).find(k => k.startsWith('__reactProps'));
      var props = propsKey ? btn[propsKey] : null;
      if (props && props.onClick) {
        try { props.onClick({ target: btn, currentTarget: btn, type: 'click', preventDefault: function(){}, stopPropagation: function(){} }); }
        catch (e) { return { ok: false, reason: 'onClick err: ' + e.message }; }
        return { ok: true, method: 'onClick-direct' };
      }
      btn.click();
      return { ok: true, method: 'native-click' };
    `);
    if (!clicked?.ok) throw new CommandExecutionError(`Click failed: ${clicked?.reason}`);

    // Poll URL for the real chat UUID; "/c/new-chat" is a brief draft placeholder
    let chatId = null;
    for (let i = 0; i < 30; i++) {
      const url = await page.evaluate(() => window.location.href).catch(() => '');
      const match = url.match(/\/c\/([^/]+)/);
      const candidate = match ? match[1] : null;
      if (candidate && candidate !== 'new-chat') { chatId = candidate; break; }
      await page.wait(1);
    }
    if (!chatId) throw new CommandExecutionError('URL did not change to /c/{UUID} after send (timeout)');

    // STEP 5: Poll chat detail API for assistant response
    for (let i = 0; i < 30; i++) {
      await page.wait(2);
      const result = await page.evaluate((cid) => {
        return new Promise((resolve) => {
          fetch('https://chat.qwen.ai/api/v2/chats/' + cid + '/')
            .then(r => r.json())
            .then(j => {
              const msgs = j?.data?.chat?.history?.messages;
              if (!msgs) { resolve({ ok: false, code: j?.data?.code, details: j?.data?.details }); return; }
              for (const id of Object.keys(msgs)) {
                const m = msgs[id];
                if (m.role === 'assistant' && m.content_list) {
                  const parts = m.content_list.filter(c => c.phase === 'answer').map(c => c.content).join('');
                  if (parts) { resolve({ ok: true, answer: parts }); return; }
                }
              }
              resolve({ ok: false, code: 'NO_ANSWER_YET', count: Object.keys(msgs).length });
            })
            .catch(e => resolve({ ok: false, code: 'FETCH_ERR', error: e.message }));
        });
      }, chatId);
      if (result?.ok) return { answer: result.answer.trim(), chatId };
      if (i === 0 && result?.code === 'Not_Found') {
        throw new CommandExecutionError(`Chat ${chatId} not found (auto-deleted). React state may not have updated.`);
      }
    }
    throw new CommandExecutionError(`No assistant response received within 60s for chat ${chatId}`);
  },
});
