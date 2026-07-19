import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const { __test__ } = await import('./images.js');
const { command, extractGoogleImageRows, inspectGoogleImagesPage, normalizeImageRows } = __test__;

function createPageMock(evaluateResult = []) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        closeWindow: vi.fn().mockResolvedValue(undefined),
        newTab: vi.fn().mockResolvedValue('fresh-page'),
        setActivePage: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        scroll: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(evaluateResult),
    };
}

describe('google images', () => {
    it('registers as a browser-backed public Google command', () => {
        expect(command).toBeDefined();
        expect(command.site).toBe('google');
        expect(command.name).toBe('images');
        expect(command.access).toBe('read');
        expect(command.browser).toBe(true);
        expect(command.strategy).toBe('public');
        expect(command.columns).toEqual(['rank', 'title', 'imageUrl', 'thumbnailUrl', 'sourceUrl', 'source', 'width', 'height']);
        expect(command.args.find(arg => arg.name === 'resolve')).toMatchObject({
            type: 'bool',
            default: true,
        });
    });

    it('rejects empty query and invalid limits before navigation', async () => {
        const page = createPageMock();
        await expect(command.func(page, { keyword: ' ', limit: 5 })).rejects.toMatchObject({ code: 'ARGUMENT' });
        await expect(command.func(page, { keyword: 'opencli', limit: 0 })).rejects.toMatchObject({ code: 'ARGUMENT' });
        await expect(command.func(page, { keyword: 'opencli', limit: 101 })).rejects.toMatchObject({ code: 'ARGUMENT' });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('extracts image and source URLs from Google imgres links', async () => {
        const dom = new JSDOM(`
          <div id="rso">
            <a href="/imgres?imgurl=https%3A%2F%2Fcdn.example.com%2Fcat.jpg&imgrefurl=https%3A%2F%2Fexample.com%2Fcats">
              <img alt="A tabby cat" src="https://encrypted-tbn0.gstatic.com/images?q=tbn:abc" width="320" height="240">
            </a>
          </div>
        `, { url: 'https://www.google.com/search?tbm=isch&q=cats' });

        await expect(extractGoogleImageRows(5, false, dom.window.document)).resolves.toEqual([[
            'A tabby cat',
            'https://cdn.example.com/cat.jpg',
            'https://encrypted-tbn0.gstatic.com/images?q=tbn:abc',
            'https://example.com/cats',
            'example.com',
            320,
            240,
        ]]);
    });

    it('falls back to visible thumbnails for dynamic image layouts', async () => {
        const dom = new JSDOM(`
          <div id="islrg">
            <div data-lpage="https://example.org/post">
              <img alt="Mountain photo" src="https://encrypted-tbn0.gstatic.com/images?q=tbn:mountain" width="160" height="90">
            </div>
          </div>
        `, { url: 'https://www.google.com/search?tbm=isch&q=mountain' });

        await expect(extractGoogleImageRows(5, false, dom.window.document)).resolves.toEqual([[
            'Mountain photo',
            'https://encrypted-tbn0.gstatic.com/images?q=tbn:mountain',
            'https://encrypted-tbn0.gstatic.com/images?q=tbn:mountain',
            'https://example.org/post',
            'example.org',
            160,
            90,
        ]]);
    });

    it('extracts current udm=2 cards outside the legacy rso image grid', async () => {
        const dom = new JSDOM(`
          <div id="center_col">
            <a href="https://shop.example.com/blue-bottle">
              <div>
                <img alt="Blue Bottle product" data-src="https://encrypted-tbn0.gstatic.com/images?q=tbn:blue" width="206" height="274">
                <span>Blue Bottle product</span>
              </div>
            </a>
          </div>
        `, { url: 'https://www.google.com/search?q=blue-bottle&udm=2' });

        await expect(extractGoogleImageRows(5, false, dom.window.document)).resolves.toEqual([[
            'Blue Bottle product',
            'https://encrypted-tbn0.gstatic.com/images?q=tbn:blue',
            'https://encrypted-tbn0.gstatic.com/images?q=tbn:blue',
            'https://shop.example.com/blue-bottle',
            'shop.example.com',
            206,
            274,
        ]]);
    });

    it('finds source links beside current Google Images cards and skips small refinement chips', async () => {
        const dom = new JSDOM(`
          <div role="list">
            <a aria-label="Add Pink" href="/search?q=pink+cats&udm=2">
              <img alt="" src="https://encrypted-tbn0.gstatic.com/images?q=tbn:chip" width="46" height="46">
            </a>
          </div>
          <div id="rso">
            <div>
              <div>
                <a><img alt="10 Facts About Cats" src="https://encrypted-tbn0.gstatic.com/images?q=tbn:cat" width="320" height="214"></a>
                <a href="https://www.fourpawsusa.org/campaigns-topics/topics/companion-animals/10-facts-about-cats">
                  <div>10 Facts About Cats - FOUR PAWS in US</div>
                </a>
              </div>
            </div>
          </div>
        `, { url: 'https://www.google.com/search?tbm=isch&q=cats' });

        await expect(extractGoogleImageRows(5, false, dom.window.document)).resolves.toEqual([[
            '10 Facts About Cats',
            'https://encrypted-tbn0.gstatic.com/images?q=tbn:cat',
            'https://encrypted-tbn0.gstatic.com/images?q=tbn:cat',
            'https://www.fourpawsusa.org/campaigns-topics/topics/companion-animals/10-facts-about-cats',
            'fourpawsusa.org',
            320,
            214,
        ]]);
    });

    it('clicks preview cards to resolve the original imgurl when requested', async () => {
        const dom = new JSDOM(`
          <div id="rso">
            <div>
              <div>
                <div role="button">
                  <img alt="Original cat" src="https://encrypted-tbn0.gstatic.com/images?q=tbn:cat" width="320" height="214">
                </div>
                <a href="https://example.com/cats"><div>Original cat</div></a>
              </div>
            </div>
          </div>
        `, {
            url: 'https://www.google.com/search?tbm=isch&q=cats',
            pretendToBeVisual: true,
        });
        const button = dom.window.document.querySelector('[role="button"]');
        button.addEventListener('click', () => {
            const preview = dom.window.document.createElement('a');
            preview.href = '/imgres?imgurl=https%3A%2F%2Fcdn.example.com%2Foriginal-cat.jpg&imgrefurl=https%3A%2F%2Fexample.com%2Fcats&w=1920&h=1080';
            dom.window.document.body.appendChild(preview);
        });

        await expect(extractGoogleImageRows(1, true, dom.window.document)).resolves.toEqual([[
            'Original cat',
            'https://cdn.example.com/original-cat.jpg',
            'https://encrypted-tbn0.gstatic.com/images?q=tbn:cat',
            'https://example.com/cats',
            'example.com',
            1920,
            1080,
        ]]);
    });

    it('normalizes browser rows into command columns', async () => {
        const page = createPageMock({
            session: 'site:google',
            data: [[
                'A tabby cat',
                'https://cdn.example.com/cat.jpg',
                'https://encrypted-tbn0.gstatic.com/images?q=tbn:abc',
                'https://example.com/cats',
                'example.com',
                320,
                240,
            ]],
        });

        await expect(command.func(page, { keyword: 'cats', limit: 1 })).resolves.toEqual([{
            rank: 1,
            title: 'A tabby cat',
            imageUrl: 'https://cdn.example.com/cat.jpg',
            thumbnailUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:abc',
            sourceUrl: 'https://example.com/cats',
            source: 'example.com',
            width: 320,
            height: 240,
        }]);
        expect(page.goto.mock.calls[0][0]).toContain('num=20');
    });

    it('retries extraction while Google Images hydrates placeholder images', async () => {
        const page = createPageMock();
        page.evaluate
            .mockResolvedValueOnce({ session: 'site:google', data: [] })
            .mockResolvedValueOnce({
                session: 'site:google',
                data: [[
                    'A tabby cat',
                    'https://cdn.example.com/cat.jpg',
                    'https://encrypted-tbn0.gstatic.com/images?q=tbn:abc',
                    'https://example.com/cats',
                    'example.com',
                    320,
                    240,
                ]],
            });

        await expect(command.func(page, { keyword: 'cats', limit: 1, resolve: false })).resolves.toHaveLength(1);

        expect(page.evaluate).toHaveBeenCalledTimes(2);
        expect(page.scroll).toHaveBeenCalledWith('down', 900);
        expect(page.wait).toHaveBeenCalledWith(1);
    });

    it('drops the current tab lease and retries once when navigation is rejected', async () => {
        const page = createPageMock([[
            'A tabby cat',
            'https://cdn.example.com/cat.jpg',
            'https://encrypted-tbn0.gstatic.com/images?q=tbn:abc',
            'https://example.com/cats',
            'example.com',
            320,
            240,
        ]]);
        page.goto
            .mockRejectedValueOnce(new Error('Navigation rejected.'))
            .mockResolvedValueOnce(undefined);

        await expect(command.func(page, { keyword: 'cats', limit: 1, resolve: false })).resolves.toHaveLength(1);

        expect(page.goto).toHaveBeenCalledTimes(2);
        expect(page.closeWindow).toHaveBeenCalledTimes(1);
        expect(page.goto.mock.calls[1][0]).toContain('tbm=isch');
    });

    it('opens a fresh tab when Google Images navigation is repeatedly rejected', async () => {
        const page = createPageMock([[
            'A tabby cat',
            'https://cdn.example.com/cat.jpg',
            'https://encrypted-tbn0.gstatic.com/images?q=tbn:abc',
            'https://example.com/cats',
            'example.com',
            320,
            240,
        ]]);
        page.goto
            .mockRejectedValueOnce(new Error('Navigation rejected.'))
            .mockRejectedValueOnce(new Error('Navigation rejected.'));

        await expect(command.func(page, { keyword: 'cats', limit: 1, resolve: false })).resolves.toHaveLength(1);

        expect(page.goto).toHaveBeenCalledTimes(2);
        expect(page.closeWindow).toHaveBeenCalledTimes(1);
        expect(page.newTab).toHaveBeenCalledTimes(1);
        expect(page.newTab.mock.calls[0][0]).toContain('tbm=isch');
        expect(page.setActivePage).toHaveBeenCalledWith('fresh-page');
    });

    it('fails typed instead of silently returning empty rows', () => {
        expect(() => normalizeImageRows([], 'nothing', 5)).toThrow(expect.objectContaining({ code: 'EMPTY_RESULT' }));
        expect(() => normalizeImageRows([{ bad: true }], 'bad', 5)).toThrow(expect.objectContaining({ code: 'COMMAND_EXEC' }));
        expect(() => normalizeImageRows([[
            'Missing source',
            'https://cdn.example.com/cat.jpg',
            'https://encrypted-tbn0.gstatic.com/images?q=tbn:abc',
            '',
            '',
            320,
            240,
        ]], 'bad', 5)).toThrow(expect.objectContaining({ code: 'COMMAND_EXEC' }));
        expect(() => normalizeImageRows([[
            'Google internal source',
            'https://cdn.example.com/cat.jpg',
            'https://encrypted-tbn0.gstatic.com/images?q=tbn:abc',
            'https://www.google.com/search?q=cats',
            'google.com',
            320,
            240,
        ]], 'bad', 5)).toThrow(expect.objectContaining({ code: 'COMMAND_EXEC' }));
    });

    it('classifies Google interstitial and explicit no-result pages', () => {
        const captchaDom = new JSDOM(`
          <form action="/sorry/index">
            <div>Our systems have detected unusual traffic from your computer network.</div>
          </form>
        `, { url: 'https://www.google.com/search?tbm=isch&q=cats' });
        const emptyDom = new JSDOM('<div id="center_col">No results found for impossible-query.</div>', {
            url: 'https://www.google.com/search?tbm=isch&q=impossible-query',
        });

        expect(inspectGoogleImagesPage(captchaDom.window.document)).toMatchObject({
            captchaOrConsent: true,
            explicitNoResults: false,
        });
        expect(inspectGoogleImagesPage(emptyDom.window.document)).toMatchObject({
            captchaOrConsent: false,
            explicitNoResults: true,
        });
    });

    it('typed-fails no rows unless Google exposes an explicit no-results state', async () => {
        const page = createPageMock();
        page.evaluate = vi.fn()
            .mockResolvedValueOnce({ session: 'site:google', data: [] })
            .mockResolvedValueOnce({ session: 'site:google', data: [] })
            .mockResolvedValueOnce({ session: 'site:google', data: [] })
            .mockResolvedValueOnce({ session: 'site:google', data: [] })
            .mockResolvedValueOnce({ session: 'site:google', data: [] })
            .mockResolvedValueOnce({ session: 'site:google', data: [] })
            .mockResolvedValueOnce({
                session: 'site:google',
                data: {
                    hasResultRoot: true,
                    hasImageCandidates: true,
                    captchaOrConsent: false,
                    explicitNoResults: false,
                },
            });

        await expect(command.func(page, { keyword: 'cats', limit: 1, resolve: false }))
            .rejects.toThrow(expect.objectContaining({ code: 'COMMAND_EXEC' }));
    });

    it('preserves true no-results as EmptyResultError when explicit marker is visible', async () => {
        const page = createPageMock();
        page.evaluate = vi.fn()
            .mockResolvedValueOnce({ session: 'site:google', data: [] })
            .mockResolvedValueOnce({ session: 'site:google', data: [] })
            .mockResolvedValueOnce({ session: 'site:google', data: [] })
            .mockResolvedValueOnce({ session: 'site:google', data: [] })
            .mockResolvedValueOnce({ session: 'site:google', data: [] })
            .mockResolvedValueOnce({ session: 'site:google', data: [] })
            .mockResolvedValueOnce({
                session: 'site:google',
                data: {
                    hasResultRoot: true,
                    hasImageCandidates: false,
                    captchaOrConsent: false,
                    explicitNoResults: true,
                },
            });

        await expect(command.func(page, { keyword: 'impossible-query', limit: 1, resolve: false }))
            .rejects.toThrow(expect.objectContaining({ code: 'EMPTY_RESULT' }));
    });

    it('typed-fails CAPTCHA or consent pages instead of reporting empty image results', async () => {
        const page = createPageMock();
        page.evaluate = vi.fn()
            .mockResolvedValueOnce({ session: 'site:google', data: [] })
            .mockResolvedValueOnce({ session: 'site:google', data: [] })
            .mockResolvedValueOnce({ session: 'site:google', data: [] })
            .mockResolvedValueOnce({ session: 'site:google', data: [] })
            .mockResolvedValueOnce({ session: 'site:google', data: [] })
            .mockResolvedValueOnce({ session: 'site:google', data: [] })
            .mockResolvedValueOnce({
                session: 'site:google',
                data: {
                    hasResultRoot: false,
                    hasImageCandidates: false,
                    captchaOrConsent: true,
                    explicitNoResults: false,
                },
            });

        await expect(command.func(page, { keyword: 'cats', limit: 1, resolve: false }))
            .rejects.toThrow(expect.objectContaining({ code: 'COMMAND_EXEC' }));
    });
});
