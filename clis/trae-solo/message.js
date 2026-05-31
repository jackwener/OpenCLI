// 3 commands for per-message interactions inside a TRAE SOLO chat view:
//   react <msg-idx> <good|bad>  — hover msg + click Good/Bad
//   retry [msg-idx]              — click Retry on a given (default: last) message
//   copy-message [msg-idx]       — click Copy All on a given (default: last) message
//
// Trae SOLO messages live in a Virtuoso virtualized list. Each visible
// message has a stable [data-item-index] attribute. The reaction buttons
// (.iconButton-Q3VY7z.tertiary-kDbrxb with aria-labels Good / Bad /
// Copy All / Retry) are mounted only while the message is hovered.

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

const SESSION_HINT = 'Make sure a chat task is open (not on the project list view).';

async function clickMessageAction(page, msgIdx, ariaLabel) {
    const idxJson = JSON.stringify(msgIdx == null ? null : Number(msgIdx));
    const labelJson = JSON.stringify(ariaLabel);
    return await page.evaluate(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const idx = ${idxJson};
    const label = ${labelJson};

    const msgs = Array.from(document.querySelectorAll('[data-item-index]')).filter((el) => el.offsetParent);
    if (!msgs.length) return { ok: false, reason: 'No messages visible.' };

    let target;
    if (idx == null) {
      target = msgs[msgs.length - 1];
    } else {
      // Match by data-item-index attribute value.
      target = msgs.find((m) => Number(m.getAttribute('data-item-index')) === idx) || msgs[idx] || null;
    }
    if (!target) return { ok: false, reason: 'Message index out of range.' };

    target.scrollIntoView({ block: 'center' });
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

    let btn = null;
    for (let attempt = 0; attempt < 18; attempt += 1) {
      await wait(80);
      // Reactions float OUTSIDE the message in absolute-positioned overlay;
      // search both the message subtree AND the whole document for a button
      // whose aria-label matches AND is near the message vertically.
      const r = target.getBoundingClientRect();
      const candidates = Array.from(document.querySelectorAll(\`button[aria-label="\${label}"]\`))
        .filter((b) => b.offsetParent);
      btn = candidates.find((b) => {
        const br = b.getBoundingClientRect();
        return Math.abs(br.top - r.top) < r.height + 40;
      }) || candidates[candidates.length - 1] || null;
      if (btn) break;
    }
    if (!btn) {
      return { ok: false, reason: 'Reaction button "' + label + '" did not mount near the message.' };
    }

    const br = btn.getBoundingClientRect();
    const init = {
      bubbles: true, cancelable: true, button: 0, buttons: 1,
      clientX: Math.round(br.left + br.width / 2),
      clientY: Math.round(br.top + br.height / 2),
    };
    Promise.resolve().then(() => {
      try {
        btn.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }));
        btn.dispatchEvent(new MouseEvent('mousedown', init));
        btn.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }));
        btn.dispatchEvent(new MouseEvent('mouseup', init));
        btn.dispatchEvent(new MouseEvent('click', init));
      } catch {}
    });
    return { ok: true, msg_idx: Number(target.getAttribute('data-item-index')) };
  })()`);
}

// -------- react --------
cli({
    site: 'trae-solo',
    name: 'react',
    access: 'write',
    description: 'React to a message with thumbs Good or Bad. Default targets the last message.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'reaction', positional: true, required: true, help: 'good or bad' },
        { name: 'msg', required: false, help: 'Target message index (from history). Omit for last.' },
    ],
    columns: ['Status', 'Msg', 'Reaction'],
    func: async (page, kwargs) => {
        const react = String(kwargs.reaction || '').trim().toLowerCase();
        if (!['good', 'bad'].includes(react)) {
            throw new ArgumentError('reaction must be "good" or "bad"');
        }
        const ariaLabel = react === 'good' ? 'Good' : 'Bad';
        const result = await clickMessageAction(page, kwargs.msg, ariaLabel);
        if (!result?.ok) {
            throw new CommandExecutionError(result?.reason || 'React failed.', SESSION_HINT);
        }
        return [{ Status: 'reacted', Msg: result.msg_idx, Reaction: react }];
    },
});

// -------- retry --------
cli({
    site: 'trae-solo',
    name: 'retry',
    access: 'write',
    description: 'Retry generating a response for a message. Default targets the last message.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'msg', required: false, help: 'Target message index. Omit for last.' },
    ],
    columns: ['Status', 'Msg'],
    func: async (page, kwargs) => {
        const result = await clickMessageAction(page, kwargs.msg, 'Retry');
        if (!result?.ok) {
            throw new CommandExecutionError(result?.reason || 'Retry failed.', SESSION_HINT);
        }
        return [{ Status: 'retry-triggered', Msg: result.msg_idx }];
    },
});

// -------- copy-message --------
cli({
    site: 'trae-solo',
    name: 'copy-message',
    access: 'write',
    description: 'Click Copy All on a message — puts its full text on the system clipboard.',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'msg', required: false, help: 'Target message index. Omit for last.' },
    ],
    columns: ['Status', 'Msg'],
    func: async (page, kwargs) => {
        const result = await clickMessageAction(page, kwargs.msg, 'Copy All');
        if (!result?.ok) {
            throw new CommandExecutionError(result?.reason || 'Copy failed.', SESSION_HINT);
        }
        return [{ Status: 'copied-to-clipboard', Msg: result.msg_idx }];
    },
});
