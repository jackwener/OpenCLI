import { AuthRequiredError, selectorError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

function normalizeScreenName(value) {
    return String(value || '').trim().replace(/^\/+/, '').replace(/^@+/, '');
}

async function extractFollowersFromDOM(page) {
    const script = [
        "function() {",
        "var cells = document.querySelectorAll('[data-testid=\"UserCell\"]');",
        "var results = [];",
        "for (var i = 0; i < cells.length; i++) {",
        "  var cell = cells[i];",
        "  var lines = cell.innerText.split('\\n');",
        "  var name = lines[0] || '';",
        "  var screenName = '';",
        "  var bioParts = [];",
        "  for (var j = 0; j < lines.length; j++) {",
        "    var l = lines[j].trim();",
        "    if (!l) continue;",
        "    if (l.startsWith('@')) { screenName = l; continue; }",
        "    if (l === '关注' || l === '正在关注' || l === '已关注') continue;",
        "    bioParts.push(l);",
        "  }",
        "  if (screenName) {",
        "    results.push({",
        "      screen_name: screenName.replace('@', ''),",
        "      name: name,",
        "      bio: bioParts.join(' '),",
        "      followers: 0",
        "    });",
        "  }",
        "}",
        "return results;",
        "}"
    ].join('');
    return page.evaluate(script);
}

cli({
    site: 'twitter',
    name: 'followers',
    access: 'read',
    description: 'Get accounts following a Twitter/X user',
    domain: 'x.com',
    strategy: Strategy.INTERCEPT,
    browser: true,
    args: [
        { name: 'user', positional: true, type: 'string', required: false },
        { name: 'limit', type: 'int', default: 50 },
    ],
    columns: ['screen_name', 'name', 'bio', 'followers'],
    func: async (page, kwargs) => {
        let targetUser = kwargs.user;
        if (!targetUser) {
            await page.goto('https://x.com/home');
            await page.wait({ selector: '[data-testid="primaryColumn"]' });
            const href = await page.evaluate(`() => {
            const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
            return link ? link.getAttribute('href') : null;
        }`);
            if (!href) {
                throw new AuthRequiredError('x.com', 'Could not find logged-in user profile link. Are you logged in?');
            }
            targetUser = href.replace('/', '');
        }
        // 1. Navigate to profile page
        await page.goto(`https://x.com/${targetUser}`);
        await page.wait(3);
        // 2. Click the followers tab via SPA navigation
        const safeUser = JSON.stringify(targetUser);
        const clicked = await page.evaluate(`() => {
        const target = ${safeUser};
        const selectors = [
            'a[href="/' + target + '/followers"]',
            'a[href="/' + target + '/verified_followers"]',
        ];
        for (const sel of selectors) {
            const link = document.querySelector(sel);
            if (link) { link.click(); return true; }
        }
        return false;
    }`);
        if (!clicked) {
            throw selectorError('Twitter followers link', 'Twitter may have changed the layout.');
        }
        // 3. Wait for follower cells to appear
        await page.wait({ selector: '[data-testid="UserCell"]', timeout: 10000 });
        // 4. Collect followers from DOM, scroll to load more
        const limit = Number(kwargs.limit) || 50;
        const allFollowers = [];
        const seen = new Set();
        let sameCount = 0;
        while (allFollowers.length < limit && sameCount < 3) {
            const followers = await extractFollowersFromDOM(page);
            const newFollowers = followers.filter(f => !seen.has(f.screen_name));
            for (const f of newFollowers) {
                seen.add(f.screen_name);
                allFollowers.push(f);
            }
            if (newFollowers.length === 0) {
                sameCount++;
            } else {
                sameCount = 0;
            }
            if (allFollowers.length >= limit) break;
            await page.scroll('bottom');
            await page.wait(2);
        }
        if (allFollowers.length === 0) {
            throw new EmptyResultError('twitter followers', `No followers found for @${targetUser}`);
        }
        return allFollowers.slice(0, limit);
    }
});
