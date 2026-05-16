import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './chatlist.js';

const BOSS_FRIEND = {
    name: '张三',
    jobName: '后端工程师',
    lastMessageInfo: { text: '你好' },
    lastTime: '2024-01-01 10:00',
    encryptUid: 'enc-boss-uid',
    securityId: 'boss-sec-id',
};

const GEEK_LABEL_FRIEND = {
    friendId: 12345,
    name: '李四',
    brandName: '字节跳动',
    jobName: '产品经理',
    bossTitle: 'HR',
    lastMsg: '感谢投递',
    updateTime: 1704067200000,
    encryptFriendId: 'enc-geek-uid',
};

const GEEK_ENRICHED = {
    friendId: 12345,
    uid: 99999,
    name: '李四',
    brandName: '字节跳动',
    jobName: '产品经理',
    bossTitle: 'HR总监',
    encryptUid: 'enc-geek-uid',
    securityId: 'geek-sec-id',
    lastMessageInfo: { showText: '感谢投递', msgTime: 1704067200000 },
    lastTime: '2024-01-01',
};

function createPageMock(evaluateImpl) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockImplementation(evaluateImpl),
    };
}

describe('boss chatlist', () => {
    const command = getRegistry().get('boss/chatlist');

    it('--side boss preserves existing behavior with 8-column output', async () => {
        const page = createPageMock(async (script) => {
            if (script.includes('getBossFriendListV2')) {
                return { code: 0, zpData: { friendList: [BOSS_FRIEND] } };
            }
            return {};
        });
        const rows = await command.func(page, { page: 1, limit: 20, 'job-id': '0', side: 'boss' });
        expect(page.goto).toHaveBeenCalledWith(expect.stringContaining('/web/chat/index'));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            name: '张三',
            company: '',
            job: '后端工程师',
            title: '',
            last_msg: '你好',
            uid: 'enc-boss-uid',
            security_id: 'boss-sec-id',
        });
    });

    it('--side geek maps enriched getGeekFriendList data into 8 columns', async () => {
        const page = createPageMock(async (script) => {
            if (script.includes('document.cookie')) return 'test-enc-sys-id';
            if (script.includes('geekFilterByLabel')) {
                return { code: 0, zpData: { friendList: [GEEK_LABEL_FRIEND] } };
            }
            if (script.includes('getGeekFriendList.json')) {
                return { code: 0, zpData: { result: [GEEK_ENRICHED] } };
            }
            return {};
        });
        const rows = await command.func(page, { page: 1, limit: 20, 'job-id': '0', side: 'geek' });
        expect(page.goto).toHaveBeenCalledWith(expect.stringContaining('/web/geek/chat'));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            name: '李四',
            company: '字节跳动',
            job: '产品经理',
            title: 'HR总监',
            uid: 'enc-geek-uid',
            security_id: 'geek-sec-id',
        });
    });

    it('--side geek falls back to label fields when enrichment has no match', async () => {
        const page = createPageMock(async (script) => {
            if (script.includes('document.cookie')) return 'test-enc-sys-id';
            if (script.includes('geekFilterByLabel')) {
                return { code: 0, zpData: { friendList: [GEEK_LABEL_FRIEND] } };
            }
            if (script.includes('getGeekFriendList.json')) {
                return { code: 0, zpData: { result: [] } };
            }
            return {};
        });
        const rows = await command.func(page, { page: 1, limit: 20, 'job-id': '0', side: 'geek' });
        expect(rows).toHaveLength(1);
        expect(rows[0].name).toBe('李四');
        expect(rows[0].company).toBe('字节跳动');
        expect(rows[0].security_id).toBe('');
    });

    it('rejects invalid --limit before navigating', async () => {
        const page = createPageMock(async () => ({}));
        await expect(
            command.func(page, { page: 1, limit: 0, 'job-id': '0', side: 'geek' })
        ).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('--side geek reports a true empty chat list as EmptyResultError', async () => {
        const page = createPageMock(async (script) => {
            if (script.includes('document.cookie')) return 'test-enc-sys-id';
            if (script.includes('geekFilterByLabel')) {
                return { code: 0, zpData: { friendList: [] } };
            }
            return {};
        });
        await expect(
            command.func(page, { page: 1, limit: 20, 'job-id': '0', side: 'geek' })
        ).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('treats malformed geek enrichment payload as CommandExecutionError', async () => {
        const page = createPageMock(async (script) => {
            if (script.includes('document.cookie')) return 'test-enc-sys-id';
            if (script.includes('geekFilterByLabel')) {
                return { code: 0, zpData: { friendList: [GEEK_LABEL_FRIEND] } };
            }
            if (script.includes('getGeekFriendList.json')) {
                return { code: 0, zpData: {} };
            }
            return {};
        });
        await expect(
            command.func(page, { page: 1, limit: 20, 'job-id': '0', side: 'geek' })
        ).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('treats null Boss API payload as CommandExecutionError', async () => {
        const page = createPageMock(async (script) => {
            if (script.includes('getBossFriendListV2')) return null;
            return {};
        });
        await expect(
            command.func(page, { page: 1, limit: 20, 'job-id': '0', side: 'boss' })
        ).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('maps expired Boss cookies to AuthRequiredError', async () => {
        const page = createPageMock(async (script) => {
            if (script.includes('getBossFriendListV2')) {
                return { code: 7, message: 'Cookie 已过期' };
            }
            return {};
        });
        await expect(
            command.func(page, { page: 1, limit: 20, 'job-id': '0', side: 'boss' })
        ).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('--side auto falls back to geek when recruiter returns code 24', async () => {
        const page = createPageMock(async (script) => {
            if (script.includes('getBossFriendListV2')) {
                return { code: 24, message: '请切换身份后再试' };
            }
            if (script.includes('document.cookie')) return 'test-enc-sys-id';
            if (script.includes('geekFilterByLabel')) {
                return { code: 0, zpData: { friendList: [GEEK_LABEL_FRIEND] } };
            }
            if (script.includes('getGeekFriendList.json')) {
                return { code: 0, zpData: { result: [GEEK_ENRICHED] } };
            }
            return {};
        });
        const rows = await command.func(page, { page: 1, limit: 20, 'job-id': '0', side: 'auto' });
        expect(rows).toHaveLength(1);
        expect(rows[0].company).toBe('字节跳动');
        expect(page.goto).toHaveBeenCalledWith(expect.stringContaining('/web/geek/chat'));
    });

    it('--side auto uses recruiter results when code 0 and does not call geek API', async () => {
        const page = createPageMock(async (script) => {
            if (script.includes('getBossFriendListV2')) {
                return { code: 0, zpData: { friendList: [BOSS_FRIEND] } };
            }
            return {};
        });
        const rows = await command.func(page, { page: 1, limit: 20, 'job-id': '0', side: 'auto' });
        expect(rows).toHaveLength(1);
        expect(rows[0].name).toBe('张三');
        const evaluateCalls = page.evaluate.mock.calls.map((c) => c[0]);
        expect(evaluateCalls.some((s) => s.includes('geekFilterByLabel'))).toBe(false);
    });

    it('registers --side as a choices-constrained arg defaulting to auto', () => {
        const sideArg = command.args.find((a) => a.name === 'side');
        expect(sideArg?.choices).toEqual(['auto', 'boss', 'geek']);
        expect(sideArg?.default).toBe('auto');
    });
});
