import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import { isKimiUrl, parseChatId } from './_utils.js';
import './chat.js';
import './ui.js';
import './storage.js';
import './audit-extras.js';
import './usage.js';

function makePage(evaluateResults = []) {
    const queue = [...evaluateResults];
    return {
        evaluate: vi.fn(async () => (queue.length ? queue.shift() : null)),
        goto: vi.fn(async () => {}),
        wait: vi.fn(async () => {}),
    };
}

describe('kimi adapter registration', () => {
    it('registers read/write command access by maximum side effect', () => {
        const expected = {
            status: 'read',
            history: 'read',
            detail: 'read',
            read: 'read',
            send: 'write',
            ask: 'write',
            new: 'write',
            'copy-message': 'write',
            regenerate: 'write',
            react: 'write',
            share: 'write',
            model: 'write',
            'history-rename': 'write',
            'sign-out': 'write',
            usage: 'read',
        };
        for (const [name, access] of Object.entries(expected)) {
            const cmd = getRegistry().get(`kimi/${name}`);
            expect(cmd, `kimi/${name}`).toBeDefined();
            expect(cmd.access).toBe(access);
            expect(cmd.domain).toBe('kimi.com');
            expect(cmd.siteSession).toBe('persistent');
        }
    });
});

describe('kimi usage command', () => {
    const usageCommand = getRegistry().get('kimi/usage');

    it('returns Kimi Code console usage cards as a single read row', async () => {
        const page = makePage([{
            '本周用量': ['12.5%', '3 天后重置'],
            '频限明细': ['45%', '1 小时后重置'],
            '我的权益': ['Kimi Pro', '会员权益'],
            '模型权限': ['K2.6', '高级模型消耗 2x'],
        }]);

        await expect(usageCommand.func(page)).resolves.toEqual([{
            weeklyUsagePct: 12.5,
            weeklyResetIn: '3 天后重置',
            rateLimitPct: 45,
            rateLimitResetIn: '1 小时后重置',
            membershipName: 'Kimi Pro',
            membershipTier: '会员权益',
            modelPermission: 'K2.6',
            modelCost: '高级模型消耗 2x',
        }]);
        expect(page.goto).toHaveBeenCalledWith('https://www.kimi.com/code/console');
    });

    it('typed-fails when the usage console exposes no dashboard cards', async () => {
        const page = makePage([{}]);

        await expect(usageCommand.func(page)).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('typed-fails malformed usage payloads instead of returning null success rows', async () => {
        await expect(usageCommand.func(makePage([[]]))).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(usageCommand.func(makePage([{
            '本周用量': ['12%'],
            '频限明细': ['45%'],
            '我的权益': ['Kimi Pro'],
        }]))).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(usageCommand.func(makePage([{
            '本周用量': ['not a percent'],
            '频限明细': ['45%'],
            '我的权益': ['Kimi Pro'],
            '模型权限': ['K2.6'],
        }]))).rejects.toBeInstanceOf(CommandExecutionError);
    });
});

describe('kimi chat id parsing', () => {
    it('accepts bare ids and exact Kimi chat URLs only', () => {
        expect(parseChatId('1234abcd')).toBe('1234abcd');
        expect(parseChatId('/chat/1234ABCD?x=1')).toBe('1234abcd');
        expect(parseChatId('/chat/1234ABCD')).toBe('1234abcd');
        expect(parseChatId('https://www.kimi.com/chat/1234ABCD?x=1#top')).toBe('1234abcd');
        expect(parseChatId('http://www.kimi.com/chat/1234abcd')).toBe('');
        expect(parseChatId('https://kimi.com.evil/chat/1234abcd')).toBe('');
        expect(parseChatId('https://evil.example/chat/1234abcd')).toBe('');
        expect(parseChatId('https://www.kimi.com/chat/1234abcd/extra')).toBe('');
    });
});

describe('kimi target boundary', () => {
    it('accepts only https kimi hosts as the current app target', () => {
        expect(isKimiUrl('https://kimi.com/')).toBe(true);
        expect(isKimiUrl('https://www.kimi.com/chat/1234abcd')).toBe(true);
        expect(isKimiUrl('http://www.kimi.com/')).toBe(false);
        expect(isKimiUrl('https://kimi.com.evil/chat/1234abcd')).toBe(false);
        expect(isKimiUrl('https://evil.example/?next=https://kimi.com/chat/1234abcd')).toBe(false);
    });
});

describe('kimi write postconditions', () => {
    let sendCommand;
    let askCommand;
    let modelCommand;

    beforeAll(() => {
        sendCommand = getRegistry().get('kimi/send');
        askCommand = getRegistry().get('kimi/ask');
        modelCommand = getRegistry().get('kimi/model');
    });

    it('send fails closed when clicking Send does not create a matching user turn', async () => {
        const page = makePage([
            'https://www.kimi.com/',
            0,
            { ok: true },
            { ok: true },
            false,
            false,
            false,
        ]);
        let now = 1_000;
        const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
            now += 1_000;
            return now;
        });
        try {
            await expect(sendCommand.func(page, { text: 'ping' }))
                .rejects.toBeInstanceOf(CommandExecutionError);
        } finally {
            nowSpy.mockRestore();
        }
    });

    it('ask throws typed timeout instead of returning a timeout success row', async () => {
        const page = makePage([
            'https://www.kimi.com/',
            [],
            'https://www.kimi.com/',
            0,
            { ok: true },
            { ok: true },
            true,
            [],
            [],
        ]);
        let now = 1_000;
        const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
            now += 2_000;
            return now;
        });
        try {
            await expect(askCommand.func(page, { text: 'ping', timeout: 1 }))
                .rejects.toBeInstanceOf(TimeoutError);
        } finally {
            nowSpy.mockRestore();
        }
    });

    it('model rejects ambiguous partial names before clicking an option', async () => {
        const page = makePage([
            'https://www.kimi.com/',
            'K2.6',
            undefined,
            ['K2.6 思考', 'K2.6 快速'],
        ]);
        await expect(modelCommand.func(page, { set: 'K2.6' }))
            .rejects.toBeInstanceOf(ArgumentError);
    });
});
