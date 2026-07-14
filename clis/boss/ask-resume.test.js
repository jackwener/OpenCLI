/**
 * Tests for clis/boss/ask-resume.js
 *
 * Mock pattern follows clis/boss/search.test.js: mock page.evaluate to return
 * canned BOSS responses, then assert against the XHR scripts that bossFetch
 * generates.
 */
import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './ask-resume.js';
function createPageMock(responses) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockImplementation(async () => {
            const next = responses.shift();
            if (next === undefined)
                throw new Error('page.evaluate called more times than mocked');
            return next;
        }),
    };
}
describe('boss ask-resume', () => {
    const command = getRegistry().get('boss/ask-resume');
    const friend = {
        uid: 1234567,
        encryptUid: 'enc-uid-aaa',
        securityId: 'sec-aaa',
        encryptJobId: 'enc-job-bbb',
        name: '测试候选人',
    };
    function ok(zpData) {
        return { code: 0, zpData };
    }
    it('registers under the boss/ask-resume key', () => {
        expect(command).toBeDefined();
        expect(command?.site).toBe('boss');
        expect(command?.name).toBe('ask-resume');
        expect(command?.access).toBe('write');
    });
    it('issues an exchange/request POST with type=3 for the located friend', async () => {
        const page = createPageMock([
            // first bossFetch: friend list page 1
            ok({ friendList: [friend] }),
            // second bossFetch: the exchange/request POST itself
            ok({}),
        ]);
        const rows = await command.func(page, { uid: friend.encryptUid });
        // The XHR script for the POST is the LAST page.evaluate call.
        const postScript = page.evaluate.mock.calls.at(-1)[0];
        expect(postScript).toContain('"POST"');
        expect(postScript).toContain('https://www.zhipin.com/wapi/zpchat/exchange/request');
        expect(postScript).toContain('type=3');
        // Both schema conventions are present (defensive union).
        expect(postScript).toContain(`uniqueId=${friend.uid}`);
        expect(postScript).toContain(`uid=${friend.uid}`);
        expect(postScript).toContain(`gid=${friend.uid}`);
        expect(postScript).toContain(`securityId=${friend.securityId}`);
        // jobId falls back to friend.encryptJobId when not supplied.
        expect(postScript).toContain(`jobId=${friend.encryptJobId}`);
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toContain('简历请求已发送');
        expect(rows[0].detail).toContain(friend.name);
        expect(rows[0].detail).toContain(friend.encryptJobId);
    });
    it('uses the explicit --job-id when provided, overriding friend.encryptJobId', async () => {
        const page = createPageMock([
            ok({ friendList: [friend] }),
            ok({}),
        ]);
        await command.func(page, { uid: friend.encryptUid, 'job-id': 'enc-job-explicit' });
        const postScript = page.evaluate.mock.calls.at(-1)[0];
        expect(postScript).toContain('jobId=enc-job-explicit');
        expect(postScript).not.toContain(`jobId=${friend.encryptJobId}`);
    });
    it('falls back to greet list when the friend is not in chat list, then sends type=3', async () => {
        const page = createPageMock([
            // friend list empty
            ok({ friendList: [] }),
            // greet list (recommend) contains the friend
            ok({ friendList: [friend] }),
            // the POST
            ok({}),
        ]);
        const rows = await command.func(page, { uid: friend.encryptUid });
        const postScript = page.evaluate.mock.calls.at(-1)[0];
        expect(postScript).toContain('type=3');
        expect(rows[0].status).toContain('简历请求已发送');
    });
    it('throws a clear error when the candidate is not found anywhere', async () => {
        const page = createPageMock([
            // friend list empty
            ok({ friendList: [] }),
            // greet list also empty
            ok({ friendList: [] }),
        ]);
        await expect(command.func(page, { uid: 'unknown-uid' })).rejects.toThrow(/未找到该候选人/);
    });
});
