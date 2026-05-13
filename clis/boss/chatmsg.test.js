import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './chatmsg.js';

const BOSS_FRIEND = {
    uid: 12345,
    encryptUid: 'enc-boss-uid',
    securityId: 'boss-sec-id',
    name: '候选人甲',
};
const BOSS_MSGS = [
    { type: 1, text: 'Hello', from: { uid: 99999, name: 'HR' }, time: 1704067200000 },
    { type: 1, text: '感谢', from: { uid: 12345, name: '候选人甲' }, time: 1704067201000 },
];

const GEEK_FRIEND_LABEL = {
    friendId: 11111,
    encryptFriendId: 'enc-geek-uid',
    name: 'Boss张',
    brandName: '公司A',
};
const GEEK_FRIEND_ENRICHED = {
    friendId: 11111,
    uid: 67890,
    encryptUid: 'enc-geek-uid',
    securityId: 'geek-sec-id',
    name: 'Boss张',
};
const GEEK_MSGS = [
    { type: 1, text: '欢迎投递', received: true, time: 1704067200000, from: { uid: 67890, name: 'Boss张' } },
    { type: 1, text: '谢谢', received: true, time: 1704067201000, from: { uid: 99999, name: '我' } },
];

function createPageMock(evaluateImpl) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockImplementation(evaluateImpl),
    };
}

describe('boss chatmsg', () => {
    const command = getRegistry().get('boss/chatmsg');

    it('--side boss preserves existing behavior', async () => {
        const page = createPageMock(async (script) => {
            if (script.includes('getBossFriendListV2')) {
                return { code: 0, zpData: { friendList: [BOSS_FRIEND] } };
            }
            if (script.includes('boss/historyMsg')) {
                return { code: 0, zpData: { messages: BOSS_MSGS } };
            }
            return {};
        });
        const rows = await command.func(page, { uid: 'enc-boss-uid', page: 1, side: 'boss' });
        expect(page.goto).toHaveBeenCalledWith(expect.stringContaining('/web/chat/index'));
        expect(rows).toHaveLength(2);
        expect(rows[0].from).toBe('我');
        expect(rows[1].from).toBe('候选人甲');
    });

    it('--side geek calls historyMsg with bossId, securityId, page, c=20, src=0', async () => {
        const page = createPageMock(async (script) => {
            if (script.includes('document.cookie')) return 'test-enc-sys-id';
            if (script.includes('geekFilterByLabel')) {
                return { code: 0, zpData: { friendList: [GEEK_FRIEND_LABEL] } };
            }
            if (script.includes('getGeekFriendList.json')) {
                return { code: 0, zpData: { result: [GEEK_FRIEND_ENRICHED] } };
            }
            if (script.includes('geek/historyMsg')) {
                return { code: 0, zpData: { messages: GEEK_MSGS } };
            }
            return {};
        });
        await command.func(page, { uid: 'enc-geek-uid', page: 1, side: 'geek' });
        const historyScript = page.evaluate.mock.calls.find((c) => c[0].includes('geek/historyMsg'))?.[0];
        expect(historyScript).toBeDefined();
        expect(historyScript).toContain('bossId=67890');
        expect(historyScript).toContain('securityId=');
        expect(historyScript).toContain('page=1');
        expect(historyScript).toContain('c=20');
        expect(historyScript).toContain('src=0');
    });

    it('--side geek uses from.uid to determine direction, not received flag', async () => {
        // Both messages have received:true (mirrors real geek historyMsg API behaviour)
        // Direction is determined by whether m.from.uid matches the boss's uid (67890)
        const msgsAllReceived = [
            { type: 1, text: '欢迎投递', received: true, time: 1704067200000, from: { uid: 67890, name: 'Boss张' } },
            { type: 1, text: '谢谢', received: true, time: 1704067201000, from: { uid: 99999, name: '我' } },
        ];
        const page = createPageMock(async (script) => {
            if (script.includes('document.cookie')) return 'test-enc-sys-id';
            if (script.includes('geekFilterByLabel')) {
                return { code: 0, zpData: { friendList: [GEEK_FRIEND_LABEL] } };
            }
            if (script.includes('getGeekFriendList.json')) {
                return { code: 0, zpData: { result: [GEEK_FRIEND_ENRICHED] } };
            }
            if (script.includes('geek/historyMsg')) {
                return { code: 0, zpData: { messages: msgsAllReceived } };
            }
            return {};
        });
        const rows = await command.func(page, { uid: 'enc-geek-uid', page: 1, side: 'geek' });
        // from.uid=67890 matches friend.uid=67890 → boss sent it → '对方'
        expect(rows[0].from).toBe('对方');
        // from.uid=99999 does not match → geek sent it → '我'
        expect(rows[1].from).toBe('我');
    });

    it('non-text message body does not crash and produces truncated JSON', async () => {
        const nonTextMsg = { type: 99, received: true, time: 1704067200000, body: { action: 'resume_request', detail: 'X' } };
        const page = createPageMock(async (script) => {
            if (script.includes('document.cookie')) return 'test-enc-sys-id';
            if (script.includes('geekFilterByLabel')) {
                return { code: 0, zpData: { friendList: [GEEK_FRIEND_LABEL] } };
            }
            if (script.includes('getGeekFriendList.json')) {
                return { code: 0, zpData: { result: [GEEK_FRIEND_ENRICHED] } };
            }
            if (script.includes('geek/historyMsg')) {
                return { code: 0, zpData: { messages: [nonTextMsg] } };
            }
            return {};
        });
        const rows = await command.func(page, { uid: 'enc-geek-uid', page: 1, side: 'geek' });
        expect(rows).toHaveLength(1);
        expect(rows[0].text).toContain('resume_request');
    });

    it('--side auto falls back to geek when recruiter returns code 24', async () => {
        const page = createPageMock(async (script) => {
            if (script.includes('getBossFriendListV2')) {
                return { code: 24, message: '请切换身份后再试' };
            }
            if (script.includes('document.cookie')) return 'test-enc-sys-id';
            if (script.includes('geekFilterByLabel')) {
                return { code: 0, zpData: { friendList: [GEEK_FRIEND_LABEL] } };
            }
            if (script.includes('getGeekFriendList.json')) {
                return { code: 0, zpData: { result: [GEEK_FRIEND_ENRICHED] } };
            }
            if (script.includes('geek/historyMsg')) {
                return { code: 0, zpData: { messages: GEEK_MSGS } };
            }
            return {};
        });
        const rows = await command.func(page, { uid: 'enc-geek-uid', page: 1, side: 'auto' });
        expect(rows).toHaveLength(2);
        expect(rows[0].from).toBe('对方');
    });

    it('--side geek throws when uid is not found in geek chat list', async () => {
        const page = createPageMock(async (script) => {
            if (script.includes('document.cookie')) return 'test-enc-sys-id';
            if (script.includes('geekFilterByLabel')) {
                return { code: 0, zpData: { friendList: [] } };
            }
            return {};
        });
        await expect(
            command.func(page, { uid: 'unknown-uid', page: 1, side: 'geek' })
        ).rejects.toThrow('未找到该聊天（geek 侧）');
    });
});
