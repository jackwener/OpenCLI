import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { approvalPayload, checkApproval, parseWriteOptions, readWriteReceipt, runApprovedWrite, WRITE_COLUMNS } from './social-write.js';
const keys = generateKeyPairSync('ed25519');
const pub = keys.publicKey.export({ type: 'spki', format: 'pem' });
const plan = { site: 'douyin', action: 'send', accountId: '100', userId: '200', conversationId: '0:1:100:200', revision: '10', text: 'Synthetic approved text' };
const roots = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
function envelope(payload, expires_at = Date.now() + 60000) {
    return { payload, expires_at, signature: sign(null, Buffer.from(JSON.stringify({ payload, expires_at })), keys.privateKey).toString('base64') };
}
async function fixture(p = plan) {
    const root = await mkdtemp(join(tmpdir(), 'opencli-social-write-')); roots.push(root);
    const id = randomUUID();
    const approved = envelope(approvalPayload(p, id));
    const path = join(root, 'approval.json');
    await writeFile(path, JSON.stringify(approved)); await writeFile(join(root, 'approval-public.pem'), pub);
    return { root, args: { execute: true, text: p.text, 'request-id': id, approval: path }, approved, id };
}

describe('signed exact-operation approvals', () => {
    it('rejects flag-only authorization and invalid text before browser work', () => {
        expect(() => parseWriteOptions({ execute: true, approved: true, text: 'Synthetic' }, true)).toThrow('--approval');
        for (const text of ['', ' ', 'a'.repeat(2001), '\u0000', '\ud800']) expect(() => parseWriteOptions({ text }, true)).toThrow('text');
    });
    it('verifies the exact canonical payload and expiry', () => {
        const expected = approvalPayload(plan, randomUUID());
        expect(checkApproval(envelope(expected), expected, pub)).toBeGreaterThan(Date.now());
        expect(() => checkApproval(envelope(expected, Date.now() - 1), expected, pub)).toThrow('expired');
        expect(() => checkApproval(envelope(expected, Date.now() + 700000), expected, pub)).toThrow('ten minutes');
    });
    it.each(['account_id', 'user_id', 'conversation_id', 'revision', 'text', 'action', 'request_id', 'site'])('rejects approval substitution for %s', key => {
        const expected = approvalPayload(plan, randomUUID());
        expect(() => checkApproval(envelope({ ...expected, [key]: 'different' }), expected, pub)).toThrow('does not match');
    });
    it('rejects a forged signature and extra payload fields', () => {
        const expected = approvalPayload(plan, randomUUID());
        expect(() => checkApproval({ ...envelope(expected), signature: 'Zm9yZ2Vk' }, expected, pub)).toThrow('signature');
        expect(() => checkApproval(envelope({ ...expected, approved: true }), expected, pub)).toThrow('does not match');
    });
});

describe('durable write intents and replay protection', () => {
    it('preflights without invoking mutation or requiring a private key', async () => {
        const perform = vi.fn();
        const [row] = await runApprovedWrite({ text: plan.text }, plan, perform);
        expect(Object.keys(row)).toEqual(WRITE_COLUMNS);
        expect(row.status).toBe('prepared'); expect(row.approval_payload.text).toBe(plan.text); expect(perform).not.toHaveBeenCalled();
    });
    it('persists intent before invoking exactly one mutation and forwards approval deadline', async () => {
        const f = await fixture();
        const perform = vi.fn(async deadline => {
            expect(deadline).toBe(f.approved.expires_at);
            const intent = JSON.parse(await readFile(join(f.root, `${f.id}.json`), 'utf8'));
            expect(intent.status).toBe('unknown'); expect(intent).not.toHaveProperty('text');
            return { status: 'sent', conversationId: plan.conversationId, messageId: '900' };
        });
        expect((await runApprovedWrite(f.args, plan, perform, f))[0]).toMatchObject({ status: 'sent', message_id: '900' });
        expect(perform).toHaveBeenCalledTimes(1);
        expect((await readWriteReceipt('douyin', f.id, f))[0].status).toBe('sent');
        expect((await readdir(f.root)).some(name => name.endsWith('.lock'))).toBe(false);
        await expect(runApprovedWrite(f.args, plan, perform, f)).rejects.toThrow('already used');
        expect(perform).toHaveBeenCalledTimes(1);
        expect((await readdir(f.root)).some(name => name.endsWith('.lock'))).toBe(false);
    });
    it('keeps unknown outcomes locked, including errors after a possible remote mutation', async () => {
        const f = await fixture(); const perform = vi.fn().mockRejectedValue(new Error('Synthetic timeout'));
        expect((await runApprovedWrite(f.args, plan, perform, f))[0].status).toBe('unknown');
        expect((await readWriteReceipt('douyin', f.id, f))[0].status).toBe('unknown');
        await expect(runApprovedWrite(f.args, plan, perform, f)).rejects.toThrow('lock exists');
        expect(perform).toHaveBeenCalledTimes(1);
    });
    it('does not treat a missing server message ID as sent', async () => {
        const f = await fixture();
        expect((await runApprovedWrite(f.args, plan, async () => ({ status: 'sent' }), f))[0].status).toBe('unknown');
    });
    it('blocks concurrent operations on the same account', async () => {
        const f = await fixture(); let finish; let started;
        const entered = new Promise(resolve => { started = resolve; });
        const first = runApprovedWrite(f.args, plan, async () => { started(); await new Promise(resolve => { finish = resolve; }); return { status: 'sent', messageId: '900' }; }, f);
        await entered;
        await expect(runApprovedWrite(f.args, plan, vi.fn(), f)).rejects.toThrow('lock exists');
        finish(); await first;
    });
    it('checks receipt site/identity, absence and malformed JSON explicitly', async () => {
        const f = await fixture();
        await expect(readWriteReceipt('douyin', f.id, f)).rejects.toMatchObject({ code: 'EMPTY_RESULT' });
        await runApprovedWrite(f.args, plan, async () => ({ status: 'sent', messageId: '900' }), f);
        await expect(readWriteReceipt('xiaohongshu', f.id, f)).rejects.toThrow('identity');
        await writeFile(join(f.root, `${f.id}.json`), '{broken');
        await expect(readWriteReceipt('douyin', f.id, f)).rejects.toThrow('unreadable');
    });
});
