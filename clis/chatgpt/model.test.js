import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    navigateToProject: vi.fn(),
    selectChatGPTModel: vi.fn(),
}));

vi.mock('./utils.js', () => ({
    CHATGPT_DOMAIN: 'chatgpt.com',
    CHATGPT_MODEL_CHOICES: ['instant', 'medium', 'high', 'extra-high', 'pro', 'thinking'],
    navigateToProject: mocks.navigateToProject,
    selectChatGPTModel: mocks.selectChatGPTModel,
}));

const { modelCommand } = await import('./model.js');

beforeEach(() => {
    vi.restoreAllMocks();
    mocks.navigateToProject.mockReset().mockResolvedValue(undefined);
    mocks.selectChatGPTModel.mockReset().mockResolvedValue({ Status: 'Success', Model: 'High' });
});

describe('chatgpt model project routing', () => {
    it('opens a project before selecting the requested model', async () => {
        const page = {};

        await expect(modelCommand.func(page, { model: 'high', project: '12345678' }))
            .resolves.toEqual([{ Status: 'Success', Model: 'High' }]);

        expect(mocks.navigateToProject).toHaveBeenCalledWith(page, '12345678');
        expect(mocks.navigateToProject.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.selectChatGPTModel.mock.invocationCallOrder[0],
        );
        expect(mocks.selectChatGPTModel).toHaveBeenCalledWith(page, 'high');
    });
});
