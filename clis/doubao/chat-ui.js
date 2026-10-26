import { CommandExecutionError } from '@jackwener/opencli/errors';

export const COMPOSER_SELECTOR = '[contenteditable="true"][role="textbox"],textarea';
export const SEND_SELECTOR = 'button#flow-end-msg-send';
const MODE_TRIGGER_SELECTOR = '[aria-haspopup="menu"]';
const MODE_ITEM_SELECTOR = '[role="menu"][data-state="open"] [role="menuitem"]';

// Read only the composer and actual message containers, never the sidebar or
// homepage suggestions. Keep DOM reads together so indices refer to one snapshot.
export const chatStateScript = `(() => {
    const visible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const text = (element) => (element?.innerText ?? element?.textContent ?? '').trim();
    const allInputs = [...document.querySelectorAll(${JSON.stringify(COMPOSER_SELECTOR)})];
    const inputs = allInputs.filter(visible);
    const input = inputs.length === 1 ? inputs[0] : null;
    const buttons = [...document.querySelectorAll(${JSON.stringify(SEND_SELECTOR)})];
    const sends = buttons.filter(visible);
    const send = sends.length === 1 ? sends[0] : null;
    const rect = send?.getBoundingClientRect();
    const point = rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, w: rect.width, h: rect.height } : null;
    const hit = point ? document.elementFromPoint(point.x, point.y) : null;
    const modeTriggers = [...document.querySelectorAll(${JSON.stringify(MODE_TRIGGER_SELECTOR)})];
    const triggers = modeTriggers.filter(element => visible(element) && /^豆包(?:\\s|$)/.test(text(element)) && text(element).length < 80);
    const trigger = triggers.length === 1 ? triggers[0] : null;
    const modeItems = [...document.querySelectorAll(${JSON.stringify(MODE_ITEM_SELECTOR)})];
    const items = modeItems.map((element, index) => ({
        index,
        text: text(element),
        label: text(element.querySelector('span')),
        disabled: element.hasAttribute('data-disabled') || element.getAttribute('aria-disabled') === 'true',
        visible: visible(element),
        focused: element === document.activeElement || element.contains(document.activeElement),
    })).filter(item => item.visible);
    const challenge = [...document.querySelectorAll('iframe[src*="captcha"],iframe[src*="verify"],[role="dialog"],[aria-modal="true"]')]
        .some(element => visible(element) && (element.tagName === 'IFRAME' || /验证码|驗證碼|人机验证|人機驗證|安全验证|安全驗證|滑动验证|滑動驗證/.test(text(element))));
    const users = [...document.querySelectorAll('[class*="bg-g-send-msg-bubble"]')].filter(visible).map(element => ({
        id: element.closest('[data-message-id]')?.getAttribute('data-message-id'),
        text: text(element),
    }));
    const replies = [...document.querySelectorAll('[data-reply-message="true"]')].filter(visible).map(element => {
        const bodies = [...element.querySelectorAll('.flow-markdown-body,.md-box-root')].filter(visible);
        const body = bodies.filter(node => !bodies.some(other => other !== node && other.contains(node))).map(text).filter(Boolean).join('\\n');
        const links = [...element.querySelectorAll('a[href]')].filter(visible).map(link => {
            try {
                const url = new URL(link.href);
                const target = url.hostname === 'link.wtturl.cn' ? url.searchParams.get('target') : null;
                const result = target ? new URL(target) : url;
                return /^https?:$/.test(result.protocol) ? result.href : '';
            } catch { return ''; }
        }).filter(Boolean);
        return {
            id: element.querySelector('[data-message-id]')?.getAttribute('data-message-id') || element.getAttribute('data-message-id'),
            text: body,
            links: [...new Set(links)],
            done: !!element.querySelector('[data-foundation-type="receive-message-action-bar"]') && !element.querySelector('[data-streaming="true"]'),
        };
    });
    return {
        url: location.href,
        inputCount: inputs.length,
        inputIndex: allInputs.indexOf(input),
        input: input ? (input.value ?? text(input)) : '',
        sendIndex: buttons.indexOf(send),
        sendReady: !!send && !send.disabled && send.getAttribute('aria-disabled') !== 'true' && !!hit && (send === hit || send.contains(hit)),
        point,
        modeLabel: text(trigger),
        modeIndex: modeTriggers.indexOf(trigger),
        modeSelector: trigger?.id ? '[id=' + JSON.stringify(trigger.id) + '][aria-haspopup="menu"]' + (trigger.tagName !== 'BUTTON' && trigger.querySelector('button') ? ' button' : '') : null,
        modeItems: items,
        challenge,
        generating: [...document.querySelectorAll('[data-streaming="true"]')].some(visible),
        users,
        replies,
    };
})()`;

export function checkVerification(state) {
    if (state.challenge) {
        throw new CommandExecutionError('Doubao requires human verification',
            'Complete verification in Chrome and inspect the conversation before retrying; no automatic resend was attempted.');
    }
}

export async function selectDoubaoMode(page, mode) {
    let state = await page.evaluate(chatStateScript);
    checkVerification(state);
    if (mode === 'current') return state.modeLabel;
    if (!state.modeSelector) {
        throw new CommandExecutionError('Could not find a unique Doubao mode selector', 'No prompt was sent. Check the mode menu in Chrome.');
    }
    // Target the native button inside the Radix trigger, using the observed ID.
    // The wrapper can otherwise be retargeted to a clickable ancestor.
    await page.click(state.modeSelector);
    const menuDeadline = Date.now() + 5000;
    while (Date.now() < menuDeadline) {
        state = await page.evaluate(chatStateScript);
        checkVerification(state);
        if (state.modeItems.length) break;
        await page.wait(0.1);
    }
    const matches = state.modeItems.filter(item => mode === 'fast'
        ? /^豆包\s*快速$/.test(item.text)
        : /专家|專家/.test(item.text));
    if (matches.length !== 1 || matches[0].disabled || !matches[0].label) {
        throw new CommandExecutionError(`Doubao ${mode} mode is unavailable or ambiguous`, 'No prompt was sent. Check the available modes for this account in Chrome.');
    }
    const item = matches[0];
    // Verify focus before Enter so it cannot submit the composer if the menu
    // disappeared during selection. No prompt has been inserted at this point.
    await page.focus(MODE_ITEM_SELECTOR, { nth: item.index });
    state = await page.evaluate(chatStateScript);
    const focused = state.modeItems.find(candidate => candidate.index === item.index);
    if (!focused?.focused || focused.text !== item.text) {
        throw new CommandExecutionError('Doubao mode menu changed before selection', 'No prompt was sent. Inspect the page before retrying.');
    }
    await page.pressKey('Enter');
    const selectionDeadline = Date.now() + 5000;
    while (Date.now() < selectionDeadline) {
        state = await page.evaluate(chatStateScript);
        checkVerification(state);
        if (!state.modeItems.length && state.modeLabel === item.label) return state.modeLabel;
        await page.wait(0.1);
    }
    throw new CommandExecutionError(`Could not confirm Doubao ${mode} mode`, 'No prompt was sent; the requested mode was not silently replaced.');
}
