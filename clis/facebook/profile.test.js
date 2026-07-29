import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@jackwener/opencli/registry';
import './profile.js';

function runExtract(html, username = 'zuck') {
    const dom = new JSDOM(html, { url: `https://www.facebook.com/${username}` });
    const command = getRegistry().get('facebook/profile');
    const script = command.pipeline.find((step) => step.evaluate).evaluate
        .replace('${{ args.username | json }}', JSON.stringify(username));
    return Function('window', 'document', `return ${script};`)(dom.window, dom.window.document);
}

describe('facebook profile', () => {
    it('keeps the existing profile row contract', () => {
        const command = getRegistry().get('facebook/profile');
        expect(command).toBeDefined();
        expect(command.columns).toEqual(['name', 'username', 'friends', 'followers', 'url']);
    });

    it('extracts the display name from the current profile-avatar header (#2195)', () => {
        const rows = runExtract(`
          <nav><a href="/friends/">Friends chrome</a></nav>
          <main role="main">
            <a aria-label="View cover photo" href="/photo/1">
              <img role="img" aria-label="View cover photo">
            </a>
            <a aria-label="Mark Zuckerberg" href="/zuck/videos/123">
              <svg role="img" aria-label="Mark Zuckerberg"></svg>
            </a>
            <div role="button">Mark Zuckerberg</div>
            <a href="/zuck/followers/"><strong>1.2M</strong> followers</a>
            <a href="/zuck/friends">1,234 friends</a>
          </main>
        `);

        expect(rows).toEqual([{
            name: 'Mark Zuckerberg',
            username: 'zuck',
            friends: '1,234 friends',
            followers: '1.2M followers',
            url: 'https://www.facebook.com/zuck',
        }]);
    });

    it('prefers an h1 when Facebook still renders the legacy header', () => {
        const rows = runExtract(`
          <main role="main">
            <h1>Legacy Profile Name</h1>
            <a aria-label="Avatar Name" href="/legacy/photos/1">
              <img role="img" aria-label="Avatar Name">
            </a>
          </main>
        `, 'legacy');

        expect(rows[0]).toMatchObject({
            name: 'Legacy Profile Name',
            username: 'legacy',
            friends: '-',
            followers: '-',
        });
    });

    it('does not take a display name or friends label from global page chrome', () => {
        const rows = runExtract(`
          <nav>
            <a aria-label="Wrong Name" href="/zuck/videos/123">
              <svg role="img" aria-label="Wrong Name"></svg>
            </a>
            <a href="/friends/">Friends</a>
          </nav>
          <main role="main"></main>
        `);

        expect(rows[0]).toMatchObject({
            name: '',
            friends: '-',
            followers: '-',
        });
    });
});
