import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { evaluateIm, openPrivateMessages, parsePrivateTarget } from './im.js';
import { parsePublicSecUid, readPublicProfile } from './user-profile.js';
import { requireObject } from '../_shared/private-messages.js';

export function locateImApp() {
    const root = document.querySelector('#imSaasContainerId');
    let fiber = root?.[Object.keys(root).find(key => key.startsWith('__reactFiber'))];
    for (let depth = 0; fiber && depth < 60; depth += 1, fiber = fiber.return) {
        if (fiber.memoizedProps?.value?.imSdkService?.imSdkManager) return fiber.memoizedProps.value;
    }
    throw Error('IM provider unavailable');
}

export async function douyinWriteRuntime(args, locate) {
    if (!['probe', 'conversation-open', 'send'].includes(args.operation) || !/^[1-9]\d*$/.test(args.userId)) throw Error('Unsupported operation or recipient');
    if (location.origin !== 'https://www.douyin.com') throw Error('Unexpected origin');
    const sdk = locate().imSdkService.imSdkManager.getImSdkInstance();
    const actor = sdk?.ctx?.option?.userId;
    if (typeof actor !== 'string' || !/^[1-9]\d*$/.test(actor)) return { state: 'auth' };
    if (args.accountId && actor !== args.accountId) throw Error('Account changed');
    if (actor === args.userId) throw Error('Self-recipient is not supported');
    let conversation = sdk.getConversationList({ filter: c => c.type === 1 }).find(c => c.toParticipantUserId === args.userId);
    const validate = c => {
        if (!c || c.type !== 1 || c.toParticipantUserId !== args.userId || !/^0:1:\d+:\d+$/.test(c.id)
            || !c.id.split(':').slice(2).includes(actor) || !c.id.split(':').slice(2).includes(args.userId)) throw Error('Private identity mismatch');
        return c;
    };
    const revision = c => c ? String(c.lastMessageIndex) : 'absent';
    if (conversation) validate(conversation);
    if (args.operation === 'probe') {
        const position = revision(conversation);
        if (position !== 'absent' && !/^\d+$/.test(position)) throw Error('Invalid conversation position');
        return { state: 'ok', accountId: actor, userId: args.userId, conversationId: conversation?.id ?? null, revision: position };
    }
    const guard = () => {
        const liveSdk = locate().imSdkService.imSdkManager.getImSdkInstance();
        if (!Number.isSafeInteger(args.expiresAt) || Date.now() >= args.expiresAt || liveSdk !== sdk || sdk.ctx.option.userId !== actor || location.origin !== 'https://www.douyin.com') throw Error('Approval expired or account changed');
        if (conversation) validate(conversation);
    };
    guard();
    if (revision(conversation) !== args.revision || (conversation?.id ?? null) !== args.conversationId) throw Error('Conversation context changed');
    const existing = !!conversation;
    if (!conversation) {
        const result = await sdk.createConversation({ type: 1, participants: args.userId, inboxType: 0 });
        if (result?.success !== true || result.statusCode !== 0) return { state: 'ok', status: 'unknown' };
        conversation = validate(result.payload);
    }
    guard();
    // createConversation can return an older server conversation; do not claim novelty from a cache miss.
    if (args.operation === 'conversation-open') return { state: 'ok', status: 'opened', conversationId: conversation.id };
    // A cache miss can resolve to an older server conversation. Do not greet
    // against unseen history: obtain a fresh preflight/approval instead.
    if (!existing && String(conversation.lastMessageIndex) !== '0') throw Error('Created conversation contains unreviewed history');
    if (existing && revision(conversation) !== args.revision) throw Error('Latest message changed');
    if (String(conversation.lastMessageIndex) === '0') {
        // Zero can be a default model value. Verify accessible server history rather than assume empty.
        const history = await sdk.getMessagesByConversation({ conversation, cursor: '9223372036854775807', limit: 1 });
        guard();
        if (!history || !Array.isArray(history.messages) || history.messages.length || history.hasMore !== false) throw Error('Empty server history is not confirmed; review history before greeting');
    }
    const message = await sdk.createMessage({ conversation, type: 7, content: JSON.stringify({ aweType: 0, text: args.text }), clientId: args.requestId, insert: false });
    if (!message || message.clientId !== args.requestId || message.conversationId !== conversation.id || String(message.sender) !== actor
        || message.type !== 7 || message.conversationType !== 1 || message.content !== JSON.stringify({ aweType: 0, text: args.text })) throw Error('Created message identity or content changed');
    guard();
    if (revision(conversation) !== (existing ? args.revision : '0')) throw Error('Latest message changed before sending');
    const result = await sdk.sendMessage({ message }); // Never invoke the app's auto-retrying send manager.
    if (result?.success !== true || result.statusCode !== 0 || typeof message.serverId !== 'string' || !/^[1-9]\d*$/.test(message.serverId)) return { state: 'ok', status: 'unknown', conversationId: conversation.id };
    return { state: 'ok', status: 'sent', conversationId: conversation.id, messageId: message.serverId };
}

export function buildWriteScript(args) {
    return `(${douyinWriteRuntime.toString()})(${JSON.stringify(args)}, ${locateImApp.toString()})`;
}

export async function evaluateWrite(page, args) {
    let result;
    try { result = requireObject(await page.evaluate(buildWriteScript(args)), 'Douyin write'); }
    catch { throw new CommandExecutionError('Douyin private write context or operation failed'); }
    if (result.state === 'auth') throw new AuthRequiredError('www.douyin.com');
    if (result.state !== 'ok') throw new CommandExecutionError('Douyin write preflight or operation failed');
    return result;
}

export function parseWriteTarget(target) {
    return /^MS4w|^https:\/\//.test(String(target ?? '')) ? { secUid: parsePublicSecUid(target) } : { privateId: parsePrivateTarget(target) };
}

export async function preparePrivateWrite(page, target, action, text) {
    const parsed = parseWriteTarget(target);
    let userId;
    if (parsed.secUid) userId = (await readPublicProfile(page, parsed.secUid, 1)).user_id;
    await openPrivateMessages(page);
    try {
        const found = await evaluateIm(page, 'find', { target: userId ?? parsed.privateId });
        userId = found.chat.peerId;
    } catch (error) {
        if (!(error instanceof EmptyResultError) || (!userId && parsed.privateId.includes(':'))) throw error;
        userId ??= parsed.privateId;
    }
    const snapshot = await evaluateWrite(page, { operation: 'probe', userId });
    return { site: 'douyin', action, text: text ?? null, ...snapshot };
}
