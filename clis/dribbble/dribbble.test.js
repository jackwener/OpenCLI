import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import {
    extractCollectionRows,
    extractMemberRows,
    extractProfileRow,
    extractServiceRows,
    extractShotDetailRow,
    extractShotRows,
    normalizeLimit,
    requireDesigner,
    requireShotTarget,
} from './utils.js';

const MODULES = [
    './auth.js',
    './collection.js',
    './designer.js',
    './member.js',
    './portfolio.js',
    './profile.js',
    './service.js',
    './shot-detail.js',
    './shot.js',
];

beforeAll(async () => {
    await Promise.all(MODULES.map((module) => import(module)));
});

function command(name) {
    return getRegistry().get(`dribbble/${name}`);
}

function runInDom(extractor, html, args = [], url = 'https://dribbble.com/') {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    const callArgs = args.map((arg) => JSON.stringify(arg)).join(', ');
    return dom.window.eval(`(${extractor.toString()})(${callArgs})`);
}

function pageFor(html, url) {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(async (source, ...args) => {
            if (typeof source === 'string') return dom.window.eval(source);
            const callArgs = args.map((arg) => JSON.stringify(arg)).join(', ');
            return dom.window.eval(`(${source.toString()})(${callArgs})`);
        }),
        getCookies: vi.fn().mockResolvedValue([{ name: '_dribbble_session', value: 'redacted' }]),
    };
}

describe('dribbble command contracts', () => {
    it('registers the complete public read surface with UI strategy', () => {
        const uiCommands = ['collection', 'designer', 'member', 'portfolio', 'profile', 'service', 'shot-detail', 'shot'];
        for (const name of uiCommands) {
            expect(command(name)).toMatchObject({ site: 'dribbble', name, browser: true, strategy: 'ui', access: 'read' });
        }
        expect(command('whoami')).toMatchObject({ strategy: 'cookie', access: 'read' });
        expect(command('login')).toMatchObject({ strategy: 'cookie', access: 'write' });
    });

    it('validates limits, profile slugs, and shot ids without silent coercion', () => {
        expect(normalizeLimit(undefined, 20, 30)).toBe(20);
        expect(() => normalizeLimit('2.5', 20, 30)).toThrow(/positive integer/);
        expect(() => normalizeLimit(31, 20, 30)).toThrow(/<= 30/);
        expect(requireDesigner('halo-lab_2')).toBe('halo-lab_2');
        expect(() => requireDesigner('../account')).toThrow(/username or profile slug/);
        expect(requireShotTarget('27679566')).toBe('27679566');
        expect(requireShotTarget('https://dribbble.com/shots/27679566-Example')).toBe('27679566');
        expect(() => requireShotTarget('https://example.com/shots/1')).toThrow(/dribbble\.com/);
    });

    it('recognizes a logged-in account when the sign-out form has an absolute action URL', async () => {
        const page = pageFor(`
          <a href="/vin-jake" title="Open profile"><img alt="vin jake"></a>
          <form action="https://dribbble.com/session"><input name="_method" value="delete"></form>
        `, 'https://dribbble.com/');

        await expect(command('whoami').func(page, {})).resolves.toEqual({
            logged_in: true,
            site: 'dribbble',
            username: 'vin-jake',
            profile_url: 'https://dribbble.com/vin-jake',
        });
    });

    it('requires authentication before opening the personalized following search', async () => {
        const page = pageFor('<main id="content"></main>', 'https://dribbble.com/');
        page.getCookies.mockResolvedValue([]);

        await expect(command('shot').func(page, {
            query: 'mobile', sort: 'following', limit: 2,
        })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
        expect(page.goto).not.toHaveBeenCalled();
    });
});

describe('dribbble production DOM extractors', () => {
    it('extracts canonical shot rows from the live semantic card shape', () => {
        const payload = runInDom(extractShotRows, `
          <main id="content">
            <li id="screenshot-25381404" data-thumbnail-id="25381404">
              <img alt="Banking Mobile App" src="https://cdn.example/shot.png">
              <a class="shot-thumbnail-link" href="/shots/25381404-Banking-Mobile-App"></a>
              <div class="shot-title">Banking Mobile App</div>
              <div class="user-information"><a href="/ronasit">Ronas IT</a></div>
              <span data-shot-like-count>1.1k</span>
              <span class="js-shot-views-count">660k</span>
            </li>
          </main>
        `, [5], 'https://dribbble.com/search/shots/popular?q=mobile');

        expect(payload.rows).toEqual([{
            rank: 1,
            id: '25381404',
            title: 'Banking Mobile App',
            designer: 'Ronas IT',
            likes: 1100,
            views: 660000,
            imageUrl: 'https://cdn.example/shot.png',
            url: 'https://dribbble.com/shots/25381404-Banking-Mobile-App',
        }]);
    });

    it('skips explicit promoted cards and keeps canonical absolute shot URLs', async () => {
        const page = pageFor(`
          <main id="content">
            <li id="screenshot-ad" data-thumbnail-id="ad">
              <a href="https://sponsor.example/campaign">Sponsored design</a>
              <a href="/advertise">Advertise</a>
            </li>
            <li id="screenshot-27611165" data-thumbnail-id="27611165">
              <img alt="Cabin seat map" src="https://cdn.example/shot.png">
              <a href="https://dribbble.com/shots/27611165-Pick-Your-Seat">View shot</a>
              <a href="/shots/27611165-Pick-Your-Seat/bucketings/new">Save shot</a>
              <div class="user-information"><a href="/mondaysys">Mondaysys</a></div>
            </li>
          </main>
        `, 'https://dribbble.com/search/shots/popular?q=mobile');

        await expect(command('shot').func(page, {
            query: 'mobile', sort: 'popular', limit: 1,
        })).resolves.toEqual([expect.objectContaining({
            rank: 1,
            id: '27611165',
            title: 'Cabin seat map',
            url: 'https://dribbble.com/shots/27611165-Pick-Your-Seat',
        })]);
    });

    it('extracts the exact profile heading and rich about fields without badge text', () => {
        const payload = runInDom(extractProfileRow, `
          <div class="profile-masthead" data-profile-masthead-container>
            <div class="masthead-profile-name"><h1>HALO LAB</h1><span>Dribbble Select agencies are vetted</span></div>
            <h2>Design & Tech Agency</h2>
            <span>54,361 followers</span><span>541 following</span><span>14,660 likes</span>
            <img src="https://cdn.example/avatar.png">
          </div>
          <main>
            <section><h2>Biography</h2><p>First paragraph.</p><p>Second paragraph.</p></section>
            <section><h2>Languages</h2><ul><li>English</li><li>French</li></ul></section>
            <section><h2>Skills</h2><a href="/skills/product%20design">product design</a></section>
            <section><h2>Social</h2><a href="https://github.com/halo-lab">GitHub</a></section>
            <p>New York City, NY</p><p>Member since Dec 2013</p><p>Available for new projects</p>
            <a href="https://halo-lab.com">Website</a>
          </main>
        `, ['halolab'], 'https://dribbble.com/halolab/about');

        expect(payload.row).toMatchObject({
            username: 'halolab',
            name: 'HALO LAB',
            intro: 'Design & Tech Agency',
            biography: 'First paragraph.\n\nSecond paragraph.',
            followersCount: 54361,
            followingCount: 541,
            likesCount: 14660,
            availableForWork: true,
            location: 'New York City, NY',
            memberSince: 'Dec 2013',
            skills: ['product design'],
            languages: ['English', 'French'],
            socialLinks: ['https://github.com/halo-lab'],
            website: 'https://halo-lab.com/',
            url: 'https://dribbble.com/halolab',
        });
    });

    it('classifies a missing profile as empty instead of returning the 404 heading as a name', async () => {
        const page = pageFor('<main><h1>Whoops, that page is gone.</h1></main>', 'https://dribbble.com/missing/about');
        await expect(command('profile').func(page, { designer: 'missing' })).rejects.toMatchObject({ code: 'EMPTY_RESULT' });
    });

    it('ignores the visual separator and extracts the real service duration', () => {
        const payload = runInDom(extractServiceRows, `
          <main id="content">
            <article class="service-card" role="article">
              <button data-remote-route-url="/services/31160-Brand-Strategy" aria-label="View service: Brand Strategy">
                <img src="https://cdn.example/service.png">
                <div class="service-card__content"><div class="display-flex gap-8">
                  <span>From $25,000</span><span>|</span><span>10 weeks</span>
                </div></div>
                <h3 class="service-card__title">Brand Strategy</h3>
                <p class="service-card__description">A durable brand package.</p>
                <span>Quick Hire</span>
              </button>
            </article>
          </main>
        `, ['halolab'], 'https://dribbble.com/halolab/services');

        expect(payload.rows[0]).toMatchObject({
            id: '31160',
            priceText: 'From $25,000',
            duration: '10 weeks',
            quickHire: true,
        });
    });

    it('filters the complete service page before applying the requested limit', async () => {
        const page = pageFor(`
          <main id="content">
            <article class="service-card" role="article">
              <button data-remote-route-url="/services/1-Logo"><h3 class="service-card__title">Logo</h3></button>
            </article>
            <article class="service-card" role="article">
              <button data-remote-route-url="/services/2-Identity"><h3 class="service-card__title">Identity System</h3></button>
            </article>
          </main>
        `, 'https://dribbble.com/halolab/services');

        await expect(command('service').func(page, {
            designer: 'halolab', query: 'identity', limit: 1,
        })).resolves.toMatchObject([{ id: '2', title: 'Identity System', rank: 1 }]);
    });

    it('fills a portfolio card without an author label from the requested profile', async () => {
        const page = pageFor(`
          <main id="content">
            <li id="screenshot-27679566" data-thumbnail-id="27679566">
              <img alt="PooPrints" src="https://cdn.example/shot.png">
              <a href="/shots/27679566-PooPrints"></a>
            </li>
          </main>
        `, 'https://dribbble.com/halolab/shots');

        await expect(command('portfolio').func(page, {
            designer: 'halolab', type: 'work', limit: 1,
        })).resolves.toMatchObject([{ id: '27679566', designer: 'halolab' }]);
    });

    it('does not misattribute a liked shot to the profile that liked it', async () => {
        const page = pageFor(`
          <main id="content">
            <li id="screenshot-27679566" data-thumbnail-id="27679566">
              <img alt="PooPrints" src="https://cdn.example/shot.png">
              <a href="/shots/27679566-PooPrints"></a>
            </li>
          </main>
        `, 'https://dribbble.com/halolab/likes');

        await expect(command('portfolio').func(page, {
            designer: 'halolab', type: 'likes', limit: 1,
        })).resolves.toMatchObject([{ id: '27679566', designer: '' }]);
    });

    it('classifies a shot 404 before requiring the normal result root', () => {
        expect(runInDom(extractShotRows, '<h1>Whoops, that page is gone.</h1>', [5],
            'https://dribbble.com/shots/999999999')).toMatchObject({ ok: true, empty: true });
    });

    it('distinguishes an explicit empty shot page from shot-card selector drift', async () => {
        const emptyPage = pageFor(`
          <body id="search-results">
            <div id="wrap"><div class="no-results">No results found</div></div>
            <main id="content"></main>
          </body>
        `,
            'https://dribbble.com/search/shots/popular?q=missing');
        await expect(command('shot').func(emptyPage, {
            query: 'missing', sort: 'popular', limit: 1,
        })).rejects.toMatchObject({ code: 'EMPTY_RESULT' });

        const driftPage = pageFor('<main id="content"></main>',
            'https://dribbble.com/search/shots/popular?q=mobile');
        await expect(command('shot').func(driftPage, {
            query: 'mobile', sort: 'popular', limit: 1,
        })).rejects.toMatchObject({ code: 'COMMAND_EXEC' });

        const unrelatedMarkerPage = pageFor(`
          <div class="no-results">Unrelated component</div><main id="content"></main>
        `, 'https://dribbble.com/search/shots/popular?q=mobile');
        await expect(command('shot').func(unrelatedMarkerPage, {
            query: 'mobile', sort: 'popular', limit: 1,
        })).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    });

    it('distinguishes completed empty designer results from card selector drift', async () => {
        const emptyPage = pageFor(`
          <div class="designer-search-results">
            <drb-infinite-scroll data-designer-search-infinite-scroll disabled></drb-infinite-scroll>
          </div>
        `, 'https://dribbble.com/hire?keywords=missing');
        await expect(command('designer').func(emptyPage, {
            query: 'missing', limit: 1,
        })).rejects.toMatchObject({ code: 'EMPTY_RESULT' });

        const driftPage = pageFor('<div class="designer-search-results"></div>',
            'https://dribbble.com/hire?keywords=product');
        await expect(command('designer').func(driftPage, {
            query: 'product', limit: 1,
        })).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    });

    it('distinguishes empty profile tabs from service and collection selector drift', async () => {
        const emptyService = pageFor(`
          <li class="services active empty"><a href="/vin-jake/services">Services</a></li>
          <main id="content"></main>
        `, 'https://dribbble.com/vin-jake/services');
        await expect(command('service').func(emptyService, {
            designer: 'vin-jake', query: '', limit: 1,
        })).rejects.toMatchObject({ code: 'EMPTY_RESULT' });

        const driftService = pageFor('<main id="content"></main>', 'https://dribbble.com/halolab/services');
        await expect(command('service').func(driftService, {
            designer: 'halolab', query: '', limit: 1,
        })).rejects.toMatchObject({ code: 'COMMAND_EXEC' });

        const emptyCollection = pageFor(`
          <li class="collections active empty"><a href="/vin-jake/collections">Collections</a></li>
          <main></main>
        `, 'https://dribbble.com/vin-jake/collections');
        await expect(command('collection').func(emptyCollection, {
            designer: 'vin-jake', limit: 1,
        })).rejects.toMatchObject({ code: 'EMPTY_RESULT' });

        const driftCollection = pageFor('<main></main>', 'https://dribbble.com/halolab/collections');
        await expect(command('collection').func(driftCollection, {
            designer: 'halolab', limit: 1,
        })).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    });

    it('treats a missing team as empty but missing member cards as drift', async () => {
        const missingTeam = pageFor('<main>Whoops, that page is gone.</main>',
            'https://dribbble.com/missing/members');
        await expect(command('member').func(missingTeam, {
            designer: 'missing', limit: 1,
        })).rejects.toMatchObject({ code: 'EMPTY_RESULT' });

        const driftPage = pageFor('<main></main>', 'https://dribbble.com/halolab/members');
        await expect(command('member').func(driftPage, {
            designer: 'halolab', limit: 1,
        })).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    });

    it('extracts a member card once when its nested controls repeat follower links', async () => {
        const page = pageFor(`
          <main>
            <li class="scrolling-row js-designer" data-user-id="6234">
              <a class="user-avatar" href="/haloweb"><img alt="Halo UI/UX" src="https://cdn.example/avatar.png"></a>
              <a href="/haloweb">Halo UI/UX</a>
              <a href="/haloweb/followers">Follow</a>
              <ul><li><a href="/haloweb/followers">Follow</a></li></ul>
            </li>
          </main>
        `, 'https://dribbble.com/halolab/members');

        await expect(command('member').func(page, {
            designer: 'halolab', limit: 3,
        })).resolves.toEqual([expect.objectContaining({
            rank: 1,
            username: 'haloweb',
            name: 'Halo UI/UX',
            url: 'https://dribbble.com/haloweb',
        })]);
    });

    it('rejects malformed cards instead of silently dropping them as empty', async () => {
        const malformedShot = pageFor('<main id="content"><li id="screenshot-1"></li></main>',
            'https://dribbble.com/search/shots/popular?q=mobile');
        await expect(command('shot').func(malformedShot, {
            query: 'mobile', sort: 'popular', limit: 1,
        })).rejects.toMatchObject({ code: 'COMMAND_EXEC' });

        const malformedDesigner = pageFor(`
          <div class="designer-search-results"><article data-resume-user-card></article></div>
        `, 'https://dribbble.com/hire?keywords=product');
        await expect(command('designer').func(malformedDesigner, {
            query: 'product', limit: 1,
        })).rejects.toMatchObject({ code: 'COMMAND_EXEC' });

        const malformedService = pageFor(`
          <main id="content"><article class="service-card" role="article"></article></main>
        `, 'https://dribbble.com/halolab/services');
        await expect(command('service').func(malformedService, {
            designer: 'halolab', query: '', limit: 1,
        })).rejects.toMatchObject({ code: 'COMMAND_EXEC' });

        const malformedCollection = pageFor(`
          <main><a href="/halolab/collections/not-a-number">Collection</a></main>
        `, 'https://dribbble.com/halolab/collections');
        await expect(command('collection').func(malformedCollection, {
            designer: 'halolab', limit: 1,
        })).rejects.toMatchObject({ code: 'COMMAND_EXEC' });

        const malformedMember = pageFor(`
          <main><li data-user-id="6234"><a href="/haloweb/followers">Follow</a></li></main>
        `, 'https://dribbble.com/halolab/members');
        await expect(command('member').func(malformedMember, {
            designer: 'halolab', limit: 1,
        })).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    });

    it('extracts shot detail media, authors, and palette from the visible shot contract', () => {
        const payload = runInDom(extractShotDetailRow, `
          <meta property="og:image" content="https://cdn.example/cover.png">
          <main id="content" class="shot-container">
            <header class="shot-header"><h1 class="shot-header__title">PooPrints</h1></header>
            <header class="user-sticky-header">
              <div class="user-sticky-header__name"><span>
                <a href="/haloweb">Halo UI/UX</a> for <a href="/halolab">HALO LAB</a>
              </span></div>
              <button class="user-sticky-header__available">Available for work</button>
            </header>
            <section data-screenshot_id="27679566"></section>
            <div class="shot-description-container">Case study</div>
            <div class="shot-media-container"><img src="https://cdn.example/media.png"></div>
            <div class="shot-content"><a href="https://cdn.dribbble.com/userupload/full.png">Full size</a></div>
            <a href="/shots?color=E5DDCE">#E5DDCE</a>
          </main>
        `, ['27679566'], 'https://dribbble.com/shots/27679566-PooPrints');

        expect(payload.row).toMatchObject({
            id: '27679566',
            title: 'PooPrints',
            designer: 'Halo UI/UX',
            designerUrl: 'https://dribbble.com/haloweb',
            team: 'HALO LAB',
            description: 'Case study',
            imageUrl: 'https://cdn.example/cover.png',
            mediaUrls: ['https://cdn.example/media.png', 'https://cdn.dribbble.com/userupload/full.png'],
            colors: ['E5DDCE'],
            availableForWork: true,
        });
    });

    it('extracts collections and team members from public profile routes', () => {
        const collections = runInDom(extractCollectionRows, `
          <main><a href="/halolab/collections/7879510-Manufacturing">
            <h3>Manufacturing</h3><span>6 Shots • 1 Designer</span>
          </a></main>
        `, ['halolab', 5], 'https://dribbble.com/halolab/collections');
        expect(collections.rows[0]).toMatchObject({
            id: '7879510', title: 'Manufacturing', shotCount: 6, designerCount: 1,
        });

        const members = runInDom(extractMemberRows, `
          <main><ul><li data-user-id="6234">
            <a href="/haloweb"><img alt="Halo UI/UX" src="https://cdn.example/member.png">Halo UI/UX</a>
            <span class="user-location">San Francisco, CA</span>
            <a href="/haloweb/followers">Follow</a>
            <a href="/shots/1-One"></a><a href="/shots/2-Two"></a>
          </li></ul></main>
        `, ['halolab', 5], 'https://dribbble.com/halolab/members');
        expect(members.rows[0]).toMatchObject({
            username: 'haloweb', name: 'Halo UI/UX', location: 'San Francisco, CA',
            recentShotUrls: ['https://dribbble.com/shots/1-One', 'https://dribbble.com/shots/2-Two'],
        });
    });
});
