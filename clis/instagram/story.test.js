import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import * as privatePublish from './_shared/private-publish.js';
import './story.js';
import { createPageMock } from '../test-utils.js';
const tempDirs = [];
function createTempFile(name, bytes = Buffer.from('story-media')) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-instagram-story-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, bytes);
    return filePath;
}
afterAll(() => {
    for (const dir of tempDirs) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
describe('instagram story registration', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });
    it('registers the story command with a required-value media arg', () => {
        const cmd = getRegistry().get('instagram/story');
        expect(cmd).toBeDefined();
        expect(cmd?.browser).toBe(true);
        expect(cmd?.args.some((arg) => arg.name === 'media' && !arg.required && arg.valueRequired)).toBe(true);
        expect(cmd?.args.some((arg) => arg.name === 'content')).toBe(false);
    });
    it('rejects missing --media before browser work', async () => {
        const page = createPageMock();
        const cmd = getRegistry().get('instagram/story');
        await expect(cmd.func(page, {})).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });
    it('rejects multiple media inputs for a single story', async () => {
        const first = createTempFile('one.jpg');
        const second = createTempFile('two.mp4');
        const page = createPageMock();
        const cmd = getRegistry().get('instagram/story');
        await expect(cmd.func(page, { media: `${first},${second}` })).rejects.toThrow('single media');
        expect(page.goto).not.toHaveBeenCalled();
    });
    it('rejects unsupported story formats', async () => {
        const filePath = createTempFile('story.mov');
        const page = createPageMock();
        const cmd = getRegistry().get('instagram/story');
        await expect(cmd.func(page, { media: filePath })).rejects.toThrow('Unsupported story media format');
        expect(page.goto).not.toHaveBeenCalled();
    });
    it('publishes a single image story through the private route', async () => {
        const imagePath = createTempFile('story.jpg');
        const page = createPageMock([
            { appId: '936619743392459', csrfToken: '', instagramAjax: 'ajax' },
            { ok: true, username: 'tsezi_ray' },
        ], {
            getCookies: vi.fn().mockResolvedValue([{ name: 'ds_user_id', value: '123', domain: 'instagram.com' }]),
        });
        const cmd = getRegistry().get('instagram/story');
        vi.spyOn(privatePublish, 'resolveInstagramPrivatePublishConfig').mockResolvedValue({
            apiContext: {
                asbdId: '359341',
                csrfToken: 'csrf-token',
                igAppId: '936619743392459',
                igWwwClaim: 'claim',
                instagramAjax: 'ajax',
                webSessionId: 'session',
            },
            jazoest: '22047',
        });
        vi.spyOn(privatePublish, 'publishStoryViaPrivateApi').mockResolvedValue({
            mediaPk: '1234567890',
            uploadId: '1234567890',
        });
        const result = await cmd.func(page, { media: imagePath });
        expect(privatePublish.publishStoryViaPrivateApi).toHaveBeenCalledWith(expect.objectContaining({
            page,
            mediaItem: { type: 'image', filePath: imagePath },
            content: '',
        }));
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: 'Single story shared successfully',
                url: 'https://www.instagram.com/stories/tsezi_ray/1234567890/',
            },
        ]);
    });
    it('publishes a single video story through the private route', async () => {
        const videoPath = createTempFile('story.mp4');
        const page = createPageMock([
            { appId: '936619743392459', csrfToken: '', instagramAjax: 'ajax' },
            { ok: true, username: 'tsezi_ray' },
        ], {
            getCookies: vi.fn().mockResolvedValue([{ name: 'ds_user_id', value: '123', domain: 'instagram.com' }]),
        });
        const cmd = getRegistry().get('instagram/story');
        vi.spyOn(privatePublish, 'resolveInstagramPrivatePublishConfig').mockResolvedValue({
            apiContext: {
                asbdId: '359341',
                csrfToken: 'csrf-token',
                igAppId: '936619743392459',
                igWwwClaim: 'claim',
                instagramAjax: 'ajax',
                webSessionId: 'session',
            },
            jazoest: '22047',
        });
        vi.spyOn(privatePublish, 'publishStoryViaPrivateApi').mockResolvedValue({
            mediaPk: '9988776655',
            uploadId: '9988776655',
        });
        const result = await cmd.func(page, { media: videoPath });
        expect(privatePublish.publishStoryViaPrivateApi).toHaveBeenCalledWith(expect.objectContaining({
            page,
            mediaItem: { type: 'video', filePath: videoPath },
            content: '',
        }));
        expect(result).toEqual([
            {
                status: '✅ Posted',
                detail: 'Single video story shared successfully',
                url: 'https://www.instagram.com/stories/tsezi_ray/9988776655/',
            },
        ]);
    });
});
