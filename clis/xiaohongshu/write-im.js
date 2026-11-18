import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { parsePrivateUserId } from './im.js';
import { requireObject } from '../_shared/private-messages.js';

export async function xhsWriteRuntime(args) {
    if (!['probe', 'conversation-open', 'send'].includes(args.operation) || !/^[a-f0-9]{24}$/.test(args.userId)) throw Error('Unsupported operation or recipient');
    const getContext = () => {
        if (location.origin !== 'https://www.xiaohongshu.com' || location.pathname !== '/chat') throw Error('Unexpected chat page');
        const pinia = document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia;
        const me = pinia?._s.get('user')?.userInfo;
        if (!me || me.guest || typeof me.userId !== 'string' || !/^[a-f0-9]{24}$/.test(me.userId)) return null;
        if (args.accountId && me.userId !== args.accountId) throw Error('Account changed');
        if (me.userId === args.userId) throw Error('Self-recipient is not supported');
        return { actor: me.userId, chats: pinia._s.get('chatData'), messages: pinia._s.get('messageData') };
    };
    let context = getContext();
    if (!context) return { state: 'auth' };
    const response = await context.chats.fetchChatInfo(args.userId);
    if (!response?.data?.[args.userId]) throw Error('Private user metadata unavailable');
    context = getContext();
    if (!context) return { state: 'auth' };
    const chat = context.chats.getChatModel(args.userId);
    if (!chat || chat.chatId !== args.userId || chat.chatType !== 2 || !Number.isSafeInteger(chat.maxStoreId) || chat.maxStoreId < 0 || chat.isBlocked) throw Error('Private target unavailable or identity mismatch');
    const revision = String(chat.maxStoreId);
    if (args.operation === 'probe') return { state: 'ok', accountId: context.actor, userId: args.userId, conversationId: args.userId, revision };
    const guard = () => {
        const current = getContext();
        if (!current || current.actor !== context.actor || !Number.isSafeInteger(args.expiresAt) || Date.now() >= args.expiresAt) throw Error('Account changed or approval expired');
        if (String(current.chats.getChatModel(args.userId)?.maxStoreId) !== args.revision) throw Error('Latest message changed');
        return current;
    };
    if (revision !== args.revision || args.conversationId !== args.userId) throw Error('Reviewed context changed');
    guard();
    const rows = [...document.querySelectorAll('.xhs-im-conv-item')].filter(e => e.getAttribute('data-conv-id') === args.userId);
    if (rows.length !== 1) throw Error('Private row missing or ambiguous');
    rows[0].click(); // Native selection can mark read; never performed by preflight.
    let editor;
    for (let attempt = 0; attempt < 20; attempt += 1) {
        guard();
        const active = document.querySelectorAll('.xhs-im-conv-item--active');
        editor = document.querySelector('.xhs-im-view__main .xhs-im-input-bar-editor[contenteditable=true]');
        if (active.length === 1 && active[0].getAttribute('data-conv-id') === args.userId && editor && editor.getBoundingClientRect().width > 0) break;
        editor = null;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!editor) throw Error('Verified private composer unavailable');
    if (args.operation === 'conversation-open') return { state: 'ok', status: 'opened', conversationId: args.userId };
    if (editor.textContent || editor.querySelector('img')) throw Error('Refusing to overwrite an existing draft');
    const oldIds = new Set(context.messages.getMessageList(args.userId).map(m => m.uuid));
    guard();
    editor.textContent = args.text;
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: args.text }));
    editor.focus();
    guard();
    const active = document.querySelectorAll('.xhs-im-conv-item--active');
    if (active.length !== 1 || active[0].getAttribute('data-conv-id') !== args.userId || document.activeElement !== editor || editor.textContent !== args.text) throw Error('Composer identity or text changed');
    // Observed native handleEditorKeydown: Enter without Shift calls handleSend.
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const current = getContext();
        if (!current || current.actor !== context.actor) return { state: 'ok', status: 'unknown' };
        const candidates = current.messages.getMessageList(args.userId).filter(m => !oldIds.has(m.uuid) && m.senderId === context.actor && m.chatId === args.userId && !m.isGroupChat
            && m.contentType === 1 && m.getParsedContent?.()?.text === args.text);
        if (candidates.length > 1) return { state: 'ok', status: 'unknown' };
        const message = candidates[0];
        if (message && Number.isSafeInteger(message.storeId) && message.storeId > Number(args.revision)
            && typeof message.messageId === 'string' && message.messageId && message.messageId !== message.uuid) {
            return { state: 'ok', status: 'sent', conversationId: args.userId, messageId: message.messageId };
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    return { state: 'ok', status: 'unknown', conversationId: args.userId };
}

export function validateSendArgs(args) {
    parsePrivateUserId(args.target);
    if (typeof args.text !== 'string' || args.text.length > 1000 || args.text !== args.text.trim() || args.text.includes('\r')) throw new ArgumentError('Xiaohongshu text must be verbatim, at most 1000 characters, without boundary whitespace or CR line endings');
}

export function buildWriteScript(args) {
    return `(${xhsWriteRuntime.toString()})(${JSON.stringify(args)})`;
}

export async function evaluateWrite(page, args) {
    let result;
    try { result = requireObject(await page.evaluate(buildWriteScript(args)), 'Xiaohongshu write'); }
    catch { throw new CommandExecutionError('Xiaohongshu private write context or operation failed'); }
    if (result.state === 'auth') throw new AuthRequiredError('www.xiaohongshu.com');
    if (result.state !== 'ok') throw new CommandExecutionError('Xiaohongshu private write failed');
    return result;
}

export async function preparePrivateWrite(page, target, action, text) {
    const userId = parsePrivateUserId(target);
    await page.goto('https://www.xiaohongshu.com/chat');
    let snapshot;
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const ready = await page.evaluate(`Boolean(document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('messageData'))`);
        if (ready === true) { snapshot = await evaluateWrite(page, { operation: 'probe', userId }); break; }
        await page.wait(0.5);
    }
    if (!snapshot) throw new CommandExecutionError('Xiaohongshu private write runtime did not initialize');
    return { site: 'xiaohongshu', action, text: text ?? null, ...snapshot };
}
