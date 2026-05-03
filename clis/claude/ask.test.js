import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const {
    mockEnsureOnClaude,
    mockEnsureClaudeComposer,
    mockSelectModel,
    mockSetAdaptiveThinking,
    mockSendMessage,
    mockSendWithFile,
    mockGetBubbleCount,
    mockWaitForResponse,
    mockParseBoolFlag,
    mockRequireNonEmptyPrompt,
    mockRequirePositiveInt,
    mockWithRetry,
} = vi.hoisted(() => ({
    mockEnsureOnClaude: vi.fn(),
    mockEnsureClaudeComposer: vi.fn(),
    mockSelectModel: vi.fn(),
    mockSetAdaptiveThinking: vi.fn(),
    mockSendMessage: vi.fn(),
    mockSendWithFile: vi.fn(),
    mockGetBubbleCount: vi.fn(),
    mockWaitForResponse: vi.fn(),
    mockParseBoolFlag: vi.fn((v) => v === true || v === 'true'),
    mockRequireNonEmptyPrompt: vi.fn((v) => String(v ?? '')),
    mockRequirePositiveInt: vi.fn((v) => Number(v)),
    mockWithRetry: vi.fn(async (fn) => fn()),
}));

vi.mock('./utils.js', () => ({
    CLAUDE_DOMAIN: 'claude.ai',
    CLAUDE_URL: 'https://claude.ai/new',
    ensureOnClaude: mockEnsureOnClaude,
    ensureClaudeComposer: mockEnsureClaudeComposer,
    selectModel: mockSelectModel,
    setAdaptiveThinking: mockSetAdaptiveThinking,
    sendMessage: mockSendMessage,
    sendWithFile: mockSendWithFile,
    getBubbleCount: mockGetBubbleCount,
    waitForResponse: mockWaitForResponse,
    parseBoolFlag: mockParseBoolFlag,
    requireNonEmptyPrompt: mockRequireNonEmptyPrompt,
    requirePositiveInt: mockRequirePositiveInt,
    withRetry: mockWithRetry,
}));

import { askCommand } from './ask.js';

describe('claude ask basic flow', () => {
    const page = {
        wait: vi.fn().mockResolvedValue(undefined),
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue('https://claude.ai/new'),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        page.evaluate.mockResolvedValue('https://claude.ai/new');
        mockEnsureOnClaude.mockResolvedValue(false);
        mockEnsureClaudeComposer.mockResolvedValue({ isLoggedIn: true, hasComposer: true });
        mockSelectModel.mockResolvedValue({ ok: true, toggled: false });
        mockSetAdaptiveThinking.mockResolvedValue({ ok: true, toggled: false });
        mockSendMessage.mockResolvedValue({ ok: true });
        mockSendWithFile.mockResolvedValue({ ok: true });
        mockGetBubbleCount.mockResolvedValue(0);
        mockWaitForResponse.mockResolvedValue('hello there');
        mockRequireNonEmptyPrompt.mockImplementation((v) => String(v ?? ''));
        mockRequirePositiveInt.mockImplementation((v) => Number(v));
    });

    it('returns the assistant response on a fresh chat', async () => {
        const rows = await askCommand.func(page, {
            prompt: 'hi',
            timeout: 120,
            new: false,
            model: 'sonnet',
            think: false,
        });

        expect(rows).toEqual([{ response: 'hello there' }]);
        expect(mockSendMessage).toHaveBeenCalledWith(page, 'hi');
        expect(mockWaitForResponse).toHaveBeenCalledWith(page, 0, 'hi', 120000);
    });

    it('navigates to /new when --new is set', async () => {
        await askCommand.func(page, {
            prompt: 'hi',
            timeout: 120,
            new: true,
            model: 'sonnet',
            think: false,
        });

        expect(page.goto).toHaveBeenCalledWith('https://claude.ai/new');
        expect(mockEnsureOnClaude).not.toHaveBeenCalled();
    });

    it('throws EmptyResultError when waitForResponse yields nothing', async () => {
        mockWaitForResponse.mockResolvedValue(null);

        await expect(askCommand.func(page, {
            prompt: 'hi',
            timeout: 60,
            new: false,
            model: 'sonnet',
            think: false,
        })).rejects.toThrow(EmptyResultError);
    });

    it('throws CommandExecutionError when send fails', async () => {
        mockSendMessage.mockResolvedValue({ ok: false, reason: 'composer not found' });

        await expect(askCommand.func(page, {
            prompt: 'hi',
            timeout: 120,
            new: false,
            model: 'sonnet',
            think: false,
        })).rejects.toThrow(/composer not found/);
    });
});

describe('claude ask --model handling', () => {
    const page = {
        wait: vi.fn().mockResolvedValue(undefined),
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockEnsureOnClaude.mockResolvedValue(false);
        mockSetAdaptiveThinking.mockResolvedValue({ ok: true, toggled: false });
        mockSendMessage.mockResolvedValue({ ok: true });
        mockGetBubbleCount.mockResolvedValue(0);
        mockWaitForResponse.mockResolvedValue('reply');
    });

    it('rejects --model opus on free tier with usage-error guidance', async () => {
        page.evaluate.mockResolvedValue('https://claude.ai/new');
        mockSelectModel.mockResolvedValue({ ok: false, upgrade: true });

        await expect(askCommand.func(page, {
            prompt: 'hi',
            timeout: 120,
            new: false,
            model: 'opus',
            think: false,
        })).rejects.toMatchObject(new ArgumentError(
            'opus model requires a paid Claude plan.',
            'Pick --model sonnet or --model haiku, or upgrade your account.',
        ));
    });

    it('skips model selection inside an existing conversation', async () => {
        page.evaluate.mockResolvedValue('https://claude.ai/chat/abc-123');

        const rows = await askCommand.func(page, {
            prompt: 'continue',
            timeout: 120,
            new: false,
            model: 'sonnet',
            think: false,
        });

        expect(rows).toEqual([{ response: 'reply' }]);
        expect(mockSelectModel).not.toHaveBeenCalled();
    });

    it('fails fast when --model is explicit inside an existing conversation', async () => {
        page.evaluate.mockResolvedValue('https://claude.ai/chat/abc-123');

        await expect(askCommand.func(page, {
            prompt: 'continue',
            timeout: 120,
            new: false,
            model: 'opus',
            think: false,
            __opencliOptionSources: { model: 'cli' },
        })).rejects.toMatchObject(new ArgumentError(
            'Cannot switch to opus model inside an existing conversation.',
            'Re-run with --new to start a fresh chat before selecting a model.',
        ));

        expect(mockSelectModel).not.toHaveBeenCalled();
    });
});

describe('claude ask --think', () => {
    const page = {
        wait: vi.fn().mockResolvedValue(undefined),
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue('https://claude.ai/new'),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockEnsureOnClaude.mockResolvedValue(false);
        mockSelectModel.mockResolvedValue({ ok: true, toggled: false });
        mockSendMessage.mockResolvedValue({ ok: true });
        mockGetBubbleCount.mockResolvedValue(0);
        mockWaitForResponse.mockResolvedValue('reply');
    });

    it('toggles Adaptive thinking when --think is set', async () => {
        mockSetAdaptiveThinking.mockResolvedValue({ ok: true, toggled: true });

        await askCommand.func(page, {
            prompt: 'reason carefully',
            timeout: 120,
            new: false,
            model: 'sonnet',
            think: true,
        });

        expect(mockSetAdaptiveThinking).toHaveBeenCalledWith(page, true);
    });

    it('throws when --think requested but toggle fails', async () => {
        mockSetAdaptiveThinking.mockResolvedValue({ ok: false });

        await expect(askCommand.func(page, {
            prompt: 'reason carefully',
            timeout: 120,
            new: false,
            model: 'sonnet',
            think: true,
        })).rejects.toThrow(/Adaptive thinking/);
    });

    it('does not throw when --think is false and toggle returns ok=false', async () => {
        mockSetAdaptiveThinking.mockResolvedValue({ ok: false });

        await expect(askCommand.func(page, {
            prompt: 'hi',
            timeout: 120,
            new: false,
            model: 'sonnet',
            think: false,
        })).resolves.toEqual([{ response: 'reply' }]);
    });

    it('fails fast when prompt validation rejects an empty prompt', async () => {
        mockRequireNonEmptyPrompt.mockImplementation(() => {
            throw new ArgumentError('claude ask prompt cannot be empty');
        });

        await expect(askCommand.func(page, {
            prompt: '',
            timeout: 120,
            new: false,
            model: 'sonnet',
            think: false,
        })).rejects.toThrow(ArgumentError);
    });

    it('fails fast when timeout validation rejects a non-positive value', async () => {
        mockRequirePositiveInt.mockImplementation(() => {
            throw new ArgumentError('claude ask --timeout must be a positive integer');
        });

        await expect(askCommand.func(page, {
            prompt: 'hi',
            timeout: 0,
            new: false,
            model: 'sonnet',
            think: false,
        })).rejects.toThrow(ArgumentError);
    });
});

describe('claude ask --file', () => {
    const page = {
        wait: vi.fn().mockResolvedValue(undefined),
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue('https://claude.ai/new'),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockEnsureOnClaude.mockResolvedValue(false);
        mockSelectModel.mockResolvedValue({ ok: true, toggled: false });
        mockSetAdaptiveThinking.mockResolvedValue({ ok: true, toggled: false });
        mockSendWithFile.mockResolvedValue({ ok: true });
        mockGetBubbleCount.mockResolvedValue(3);
        mockWaitForResponse.mockResolvedValue('the image shows a cat');
        mockEnsureClaudeComposer.mockResolvedValue({ isLoggedIn: true, hasComposer: true });
        mockRequireNonEmptyPrompt.mockImplementation((v) => String(v ?? ''));
        mockRequirePositiveInt.mockImplementation((v) => Number(v));
    });

    it('routes through sendWithFile and captures baseline before sending', async () => {
        const rows = await askCommand.func(page, {
            prompt: 'describe this',
            timeout: 120,
            new: false,
            model: 'sonnet',
            think: false,
            file: '/tmp/cat.png',
        });

        expect(rows).toEqual([{ response: 'the image shows a cat' }]);
        expect(mockGetBubbleCount).toHaveBeenCalledTimes(1);
        expect(mockSendWithFile).toHaveBeenCalledWith(page, '/tmp/cat.png', 'describe this');
        expect(mockSendMessage).not.toHaveBeenCalled();
        expect(mockWaitForResponse).toHaveBeenCalledWith(page, 3, 'describe this', 120000);
    });

    it('surfaces file upload failure as CommandExecutionError', async () => {
        mockSendWithFile.mockResolvedValue({ ok: false, reason: 'file preview did not appear' });

        await expect(askCommand.func(page, {
            prompt: 'describe this',
            timeout: 120,
            new: false,
            model: 'sonnet',
            think: false,
            file: '/tmp/cat.png',
        })).rejects.toThrow(/file preview did not appear/);
    });

    it('absorbs "Promise was collected" SPA navigation error after send', async () => {
        mockSendWithFile.mockRejectedValue(new Error('Promise was collected'));

        const rows = await askCommand.func(page, {
            prompt: 'describe this',
            timeout: 120,
            new: false,
            model: 'sonnet',
            think: false,
            file: '/tmp/cat.png',
        });

        expect(rows).toEqual([{ response: 'the image shows a cat' }]);
    });
});
