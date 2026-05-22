import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
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

    it('rejects empty uid before navigating', async () => {
        const page = createPageMock(async () => ({}));
        await expect(
            command.func(page, { uid: ' ', page: 1, side: 'geek' })
        ).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('rejects invalid --page before navigating', async () => {
        const page = createPageMock(async () => ({}));
        await expect(
            command.func(page, { uid: 'enc-geek-uid', page: 0, side: 'geek' })
        ).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

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
        ).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('--side boss maps expired cookies to AuthRequiredError', async () => {
        const page = createPageMock(async (script) => {
            if (script.includes('getBossFriendListV2')) {
                return { code: 7, message: 'Cookie 已过期' };
            }
            return {};
        });
        await expect(
            command.func(page, { uid: 'enc-boss-uid', page: 1, side: 'boss' })
        ).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('--side boss treats missing history list as parser drift', async () => {
        const page = createPageMock(async (script) => {
            if (script.includes('getBossFriendListV2')) {
                return { code: 0, zpData: { friendList: [BOSS_FRIEND] } };
            }
            if (script.includes('boss/historyMsg')) {
                return { code: 0, zpData: {} };
            }
            return {};
        });
        await expect(
            command.func(page, { uid: 'enc-boss-uid', page: 1, side: 'boss' })
        ).rejects.toBeInstanceOf(CommandExecutionError);
    });

    describe('--raw mode (JD card exposure)', () => {
        // Long content (>200 chars) sits inside body.jobDesc, not body.content,
        // so the compact-mode short-circuit (m.body?.content) does not catch it
        // and the JSON.stringify(...).slice(0, 120) truncation branch is exercised.
        const JD_CARD_URL = 'https://www.zhipin.com/job_detail/abc-xyz-jobid-123.html?lid=test';
        const JD_CARD_CONTENT = '岗位职责：负责后端架构设计与核心服务开发，包括但不限于高并发、分布式系统、数据库优化、消息队列、缓存方案、监控告警、容灾备份等关键基础设施建设。任职要求：5年以上后端开发经验，精通 Java/Go，有大型互联网公司经验者优先，熟悉云原生技术栈（K8s/Docker/Service Mesh），具备良好的沟通协作能力，能承担技术攻坚任务，并在团队中起到技术引领作用。';
        const JD_CARD_FIXTURE = {
            type: 99,
            received: true,
            time: 1704067200000,
            securityId: 'jd-sec-id-xyz',
            from: { uid: 67890, name: 'Boss张' },
            body: {
                jobDesc: {
                    title: '高级后端工程师',
                    company: '某互联网公司',
                    salary: '40-60K·15薪',
                    city: '北京',
                    content: JD_CARD_CONTENT,
                    jobId: 'abc-xyz-jobid-123',
                    url: JD_CARD_URL,
                },
            },
        };

        function buildJdPageMock(msg) {
            return createPageMock(async (script) => {
                if (script.includes('document.cookie')) return 'test-enc-sys-id';
                if (script.includes('geekFilterByLabel')) {
                    return { code: 0, zpData: { friendList: [GEEK_FRIEND_LABEL] } };
                }
                if (script.includes('getGeekFriendList.json')) {
                    return { code: 0, zpData: { result: [GEEK_FRIEND_ENRICHED] } };
                }
                if (script.includes('geek/historyMsg')) {
                    return { code: 0, zpData: { messages: [msg] } };
                }
                return {};
            });
        }

        it('--raw exposes full JD card url (no truncation)', async () => {
            const page = buildJdPageMock(JD_CARD_FIXTURE);
            const rows = await command.func(page, { uid: 'enc-geek-uid', page: 1, side: 'geek', raw: true });
            expect(rows).toHaveLength(1);
            expect(rows[0].body).toBeDefined();
            expect(rows[0].body.jobDesc.url).toBe(JD_CARD_URL);
            expect(rows[0].security_id).toBe('jd-sec-id-xyz');
        });

        it('--raw preserves long JD content (>120 chars)', async () => {
            const page = buildJdPageMock(JD_CARD_FIXTURE);
            const rows = await command.func(page, { uid: 'enc-geek-uid', page: 1, side: 'geek', raw: true });
            expect(rows[0].body.jobDesc.content).toBe(JD_CARD_CONTENT);
            expect(rows[0].body.jobDesc.content.length).toBeGreaterThan(120);
        });

        it('compact mode (no --raw) still truncates JD card body to <=120 chars and omits body/security_id', async () => {
            const page = buildJdPageMock(JD_CARD_FIXTURE);
            const rows = await command.func(page, { uid: 'enc-geek-uid', page: 1, side: 'geek' });
            expect(rows).toHaveLength(1);
            expect(rows[0].text.length).toBeLessThanOrEqual(120);
            expect(rows[0]).not.toHaveProperty('body');
            expect(rows[0]).not.toHaveProperty('security_id');
            // And the full URL is NOT present in the truncated text — this is the regression #13 documents.
            expect(rows[0].text).not.toContain(JD_CARD_URL);
        });
    });

    it('--side geek reports an empty history as EmptyResultError', async () => {
        const page = createPageMock(async (script) => {
            if (script.includes('document.cookie')) return 'test-enc-sys-id';
            if (script.includes('geekFilterByLabel')) {
                return { code: 0, zpData: { friendList: [GEEK_FRIEND_LABEL] } };
            }
            if (script.includes('getGeekFriendList.json')) {
                return { code: 0, zpData: { result: [GEEK_FRIEND_ENRICHED] } };
            }
            if (script.includes('geek/historyMsg')) {
                return { code: 0, zpData: { messages: [] } };
            }
            return {};
        });
        await expect(
            command.func(page, { uid: 'enc-geek-uid', page: 1, side: 'geek' })
        ).rejects.toBeInstanceOf(EmptyResultError);
    });
});
