import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './ask.js';
import './send.js';
import './read.js';
import './history.js';
import './detail.js';
import './new.js';
import './status.js';
import './image.js';
import './model.js';
import './project-list.js';
import './project-file-add.js';

const tempDirs = [];

afterEach(() => {
    vi.restoreAllMocks();
    while (tempDirs.length) {
        fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
});

function createProjectUploadPageMock() {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        setFileInput: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn((script) => {
            const s = String(script);
            if (s.includes('isVisible') && s.includes('hasComposer') && s.includes('isLoggedIn')) {
                return Promise.resolve({ session: 'test', data: { url: 'https://chatgpt.com/g/g-p-12345678', title: 'Project', hasComposer: true, isLoggedIn: true, hasLoginGate: false } });
            }
            if (s.includes('expectedFileNames')) return Promise.resolve({ ok: true });
            if (s.includes('Add files')) return Promise.resolve(true);
            if (s.includes('role="dialog"')) return Promise.resolve(true);
            return Promise.resolve(undefined);
        }),
    };
}

describe('chatgpt browser command registration', () => {
    it('registers the baseline web chat commands with persistent site sessions', () => {
        const expectedAccess = {
            ask: 'write',
            send: 'write',
            read: 'read',
            history: 'read',
            detail: 'read',
            new: 'read',
            status: 'read',
            image: 'write',
            model: 'write',
            'project-list': 'read',
            'project-file-add': 'write',
        };

        for (const [name, access] of Object.entries(expectedAccess)) {
            const cmd = getRegistry().get(`chatgpt/${name}`);
            expect(cmd, `chatgpt/${name}`).toBeDefined();
            expect(cmd.site).toBe('chatgpt');
            expect(cmd.domain).toBe('chatgpt.com');
            expect(cmd.strategy).toBe('cookie');
            expect(cmd.browser).toBe(true);
            expect(cmd.siteSession).toBe('persistent');
            expect(cmd.navigateBefore).toBe(false);
            expect(cmd.access).toBe(access);
        }
    });

    it('keeps ask timeout as the runtime-visible integer timeout arg', () => {
        const ask = getRegistry().get('chatgpt/ask');
        expect(ask.args).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'timeout', type: 'int', default: 120 }),
            expect.objectContaining({ name: 'new', type: 'boolean', default: false }),
            expect.objectContaining({ name: 'conversation', valueRequired: true }),
            expect.objectContaining({ name: 'project', valueRequired: true }),
            expect.objectContaining({ name: 'wait', type: 'boolean', default: true }),
            expect.objectContaining({ name: 'deep-research', type: 'boolean', default: false }),
            expect.objectContaining({ name: 'web-search', type: 'boolean', default: false }),
        ]));
        expect(ask.columns).toEqual(['conversationId', 'conversationUrl', 'tool', 'response']);
    });

    it('registers send conversation and project routing options', () => {
        const send = getRegistry().get('chatgpt/send');
        expect(send.args).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'new', type: 'boolean', default: false }),
            expect.objectContaining({ name: 'conversation', valueRequired: true }),
            expect.objectContaining({ name: 'project', valueRequired: true }),
        ]));
    });

    it('rejects using project and conversation routing together', async () => {
        const ask = getRegistry().get('chatgpt/ask');
        const send = getRegistry().get('chatgpt/send');
        const page = {
            goto: () => {
                throw new Error('should not navigate');
            },
        };

        await expect(ask.func(page, { prompt: 'hello', project: '12345678', conversation: 'abcdefghi' }))
            .rejects.toMatchObject({ code: 'ARGUMENT' });
        await expect(send.func(page, { prompt: 'hello', project: '12345678', conversation: 'abcdefghi' }))
            .rejects.toMatchObject({ code: 'ARGUMENT' });
    });

    it('registers detail wait options and generation state columns', () => {
        const detail = getRegistry().get('chatgpt/detail');
        expect(detail.args).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'wait', type: 'boolean', default: false }),
            expect.objectContaining({ name: 'timeout', type: 'int', default: 120 }),
            expect.objectContaining({ name: 'stable', type: 'int', default: 6 }),
        ]));
        expect(detail.columns).toEqual(['Index', 'Role', 'Text', 'Generating', 'StableSeconds']);
    });

    it('registers project routing on chat-starting commands', () => {
        for (const name of ['new', 'image', 'model']) {
            const cmd = getRegistry().get(`chatgpt/${name}`);
            expect(cmd.args).toEqual(expect.arrayContaining([
                expect.objectContaining({ name: 'project', valueRequired: true }),
            ]));
        }
    });

    it('starts a new chat inside a project when new receives project routing', async () => {
        const cmd = getRegistry().get('chatgpt/new');
        const page = createProjectUploadPageMock();

        await expect(cmd.func(page, { project: '12345678' }))
            .resolves.toEqual([{ Status: 'New chat started' }]);
        expect(page.goto).toHaveBeenCalledWith('https://chatgpt.com/g/g-p-12345678', { settleMs: 2000 });
    });

    it('registers chatgpt model with web model choices', () => {
        const model = getRegistry().get('chatgpt/model');
        expect(model.args).toEqual(expect.arrayContaining([
            expect.objectContaining({
                name: 'model',
                positional: true,
                required: true,
                choices: ['instant', 'medium', 'high', 'extra-high', 'pro', 'thinking'],
            }),
            expect.objectContaining({ name: 'project', valueRequired: true }),
        ]));
        expect(model.columns).toEqual(['Status', 'Model']);
    });

    it('rejects off-domain conversation URLs before ask/send can navigate', async () => {
        const ask = getRegistry().get('chatgpt/ask');
        const send = getRegistry().get('chatgpt/send');
        const page = {
            goto: () => {
                throw new Error('should not navigate');
            },
        };

        await expect(ask.func(page, { prompt: 'hello', conversation: 'https://evil.test/c/abc_123-def' }))
            .rejects.toMatchObject({ code: 'ARGUMENT' });
        await expect(send.func(page, { prompt: 'hello', conversation: 'https://evil.test/c/abc_123-def' }))
            .rejects.toMatchObject({ code: 'ARGUMENT' });
    });

    it('does not expose command-level system proxy mutation for project-file-add', () => {
        const cmd = getRegistry().get('chatgpt/project-file-add');
        expect(cmd.args.map(arg => arg.name)).toEqual(['file', 'id']);
    });

    it('rejects empty project-file-add file input', async () => {
        const cmd = getRegistry().get('chatgpt/project-file-add');
        await expect(cmd.func(createProjectUploadPageMock(), { file: ' , ', id: '12345678' }))
            .rejects.toMatchObject({ code: 'ARGUMENT' });
    });

    it('maps successful project-file-add uploads to table rows', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-chatgpt-'));
        tempDirs.push(dir);
        const filePath = path.join(dir, 'report.pdf');
        fs.writeFileSync(filePath, 'fake-pdf');

        const cmd = getRegistry().get('chatgpt/project-file-add');
        await expect(cmd.func(createProjectUploadPageMock(), { file: filePath, id: '12345678' }))
            .resolves.toEqual([
                {
                    Status: '📄 uploaded to project knowledge',
                    File: filePath,
                },
            ]);
    });

    it('maps project-file-add local file validation failures to argument errors', async () => {
        const cmd = getRegistry().get('chatgpt/project-file-add');
        await expect(cmd.func(createProjectUploadPageMock(), { file: '/no/such/report.pdf', id: '12345678' }))
            .rejects.toMatchObject({
                code: 'ARGUMENT',
                message: expect.stringContaining('File not found'),
            });
    });
});
