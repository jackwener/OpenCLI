import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const WRITE_ARGS = [
    { name: 'execute', type: 'bool', default: false, help: 'Execute a signed, approved operation; default is read-only preflight' },
    { name: 'request-id', help: 'UUID from preflight, required for execution and replay protection' },
    { name: 'approval', help: 'Operator-signed approval JSON file, required for execution' },
];
export const WRITE_COLUMNS = ['status', 'account_id', 'user_id', 'conversation_id', 'message_id', 'request_id', 'approval_payload'];
const ROOT = join(homedir(), '.opencli', 'social-writes');
const hash = value => createHash('sha256').update(value).digest('hex');

export function parseWriteOptions(args, needsText = false) {
    if (args.execute != null && typeof args.execute !== 'boolean') throw new ArgumentError('--execute must be boolean');
    if (args['request-id'] != null && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(args['request-id'])) throw new ArgumentError('--request-id must be a UUID');
    if (args.execute && (!args['request-id'] || !args.approval)) throw new ArgumentError('--execute requires --request-id and --approval');
    if (needsText && (typeof args.text !== 'string' || !args.text.trim() || args.text.length > 2000 || !args.text.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(args.text))) throw new ArgumentError('text must contain 1-2000 characters without control characters');
    return { execute: args.execute === true, requestId: args['request-id']?.toLowerCase() ?? randomUUID() };
}

export function approvalPayload({ site, action, accountId, userId, conversationId, revision, text = null }, requestId) {
    return { version: 1, site, action, account_id: accountId, user_id: userId, conversation_id: conversationId ?? null, revision, text, request_id: requestId };
}

export function checkApproval(envelope, expected, publicKey, now = Date.now()) {
    if (!envelope || typeof envelope.signature !== 'string' || !Number.isSafeInteger(envelope.expires_at)
        || envelope.expires_at <= now || envelope.expires_at > now + 600000 || !envelope.payload) throw new ArgumentError('Approval is missing, expired or valid for longer than ten minutes');
    // Canonical key order follows the preflight schema, not the JSON file order.
    const payload = Object.fromEntries(Object.keys(expected).map(key => [key, envelope.payload[key]]));
    if (Object.keys(envelope.payload).length !== Object.keys(expected).length || JSON.stringify(payload) !== JSON.stringify(expected)) throw new ArgumentError('Approval does not match the exact account, recipient, operation, context and text');
    try {
        const key = createPublicKey(publicKey);
        if (key.asymmetricKeyType !== 'ed25519' || !verify(null, Buffer.from(JSON.stringify({ payload, expires_at: envelope.expires_at })), key, Buffer.from(envelope.signature, 'base64'))) throw new Error('invalid signature');
    } catch { throw new ArgumentError('Approval signature is invalid; a trusted operator must approve this exact operation'); }
    return envelope.expires_at;
}

export function writeRow(plan, requestId, status, extra = {}) {
    return { status, account_id: plan.accountId, user_id: plan.userId, conversation_id: plan.conversationId ?? null,
        message_id: null, request_id: requestId, approval_payload: null, ...extra };
}

/** Approval is separate from platform actions. No boolean approved=true bypass. */
export async function runApprovedWrite(args, plan, perform, { root = ROOT } = {}) {
    const options = parseWriteOptions(args, plan.action === 'send');
    const payload = approvalPayload(plan, options.requestId);
    if (!options.execute) return [writeRow(plan, options.requestId, 'prepared', { approval_payload: payload })];
    let envelope, publicKey;
    try {
        envelope = JSON.parse(await readFile(args.approval, 'utf8'));
        publicKey = await readFile(join(root, 'approval-public.pem'), 'utf8');
    } catch { throw new ArgumentError('Cannot load approval or pinned approval-public.pem; configure an external operator signer first'); }
    const expiresAt = checkApproval(envelope, payload, publicKey);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const lockPath = join(root, `${hash(`${plan.site}:${plan.accountId}`)}.lock`);
    let lock;
    try { lock = await open(lockPath, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw new CommandExecutionError('Account write lock exists; reconcile the previous operation before retrying'); throw new CommandExecutionError('Unable to reserve the account write lock'); }
    const recordPath = join(root, `${options.requestId}.json`);
    let record;
    let reserved = false;
    try {
        try { record = await open(recordPath, 'wx', 0o600); }
        catch (error) { if (error.code === 'EEXIST') throw new ArgumentError('Request ID was already used; inspect its receipt, never resend automatically'); throw new CommandExecutionError('Unable to reserve the write request'); }
        reserved = true;
        const base = { site: plan.site, request_id: options.requestId, payload_hash: hash(JSON.stringify(payload)), status: 'unknown' };
        // Durable intent before mutation. Do not store text, cookies or chat history.
        await record.writeFile(JSON.stringify(base)); await record.sync(); await record.close(); record = null;
        let result;
        try {
            if (Date.now() >= expiresAt) throw new ArgumentError('Approval expired before execution');
            result = await perform(expiresAt);
            if (!result || !['sent', 'created', 'opened', 'followed', 'unfollowed', 'already-following', 'already-not-following', 'unknown'].includes(result.status)
                || (result.status === 'sent' && (typeof result.messageId !== 'string' || !result.messageId))) throw new CommandExecutionError('Malformed write receipt');
        } catch { result = { status: 'unknown' }; }
        // Persist the receipt before releasing the account. Unknown stays locked.
        const receipt = await open(recordPath, 'r+');
        try {
            await receipt.truncate(0);
            await receipt.writeFile(JSON.stringify({ ...base, ...result }));
            await receipt.sync();
        } finally { await receipt.close(); }
        if (result.status !== 'unknown') {
            await lock.close(); lock = null;
            await unlink(lockPath);
        }
        return [writeRow(plan, options.requestId, result.status, { conversation_id: result.conversationId ?? plan.conversationId ?? null, message_id: result.messageId ?? null })];
    } finally {
        if (record) await record.close();
        if (lock) {
            await lock.close();
            if (!reserved) await unlink(lockPath); // Replay rejection occurred before any possible mutation.
            // A reserved failed/unknown operation retains its account lock for reconciliation.
        }
    }
}

export async function readWriteReceipt(site, requestId, { root = ROOT } = {}) {
    const { requestId: id } = parseWriteOptions({ 'request-id': requestId });
    let data;
    try { data = JSON.parse(await readFile(join(root, `${id}.json`), 'utf8')); }
    catch (error) {
        if (error.code === 'ENOENT') throw new EmptyResultError(`${site} write-status`, 'No execution receipt exists for this request.');
        throw new CommandExecutionError('Execution receipt is unreadable; treat outcome as unknown and do not retry');
    }
    if (data.site !== site || data.request_id !== id || !/^[a-f0-9]{64}$/.test(data.payload_hash ?? '')
        || !['unknown', 'sent', 'created', 'opened', 'followed', 'unfollowed', 'already-following', 'already-not-following'].includes(data.status)) {
        throw new CommandExecutionError('Execution receipt identity or schema is invalid; do not retry');
    }
    return [{ request_id: id, status: data.status, conversation_id: data.conversationId ?? null, message_id: data.messageId ?? null, payload_hash: data.payload_hash }];
}
