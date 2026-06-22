import { getRegistry } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { afterEach, describe, expect, it, vi } from 'vitest';
import './repos.js';

function loadCommand() {
    const cmd = getRegistry().get('github-trending/repos');
    if (!cmd?.func) throw new Error('github-trending/repos not found or has no func');
    return cmd;
}

function article({ repo, desc, lang, stars, forks, since }) {
    const langSpan = lang ? `<span itemprop="programmingLanguage">${lang}</span>` : '';
    const descP = desc == null ? '' : `<p class="col-9 color-fg-muted my-1 tmp-pr-4">\n      ${desc}\n    </p>`;
    return `<article class="Box-row">
      <h2 class="h3 lh-condensed">
        <a href="/${repo}" data-view-component="true" class="Link">
          <span class="text-normal">${repo.split('/')[0]} /</span>
          ${repo.split('/')[1]}</a>
      </h2>
      ${descP}
      <div class="f6 color-fg-muted mt-2">
        ${langSpan}
        <a href="/${repo}/stargazers" class="Link Link--muted d-inline-block"><svg></svg>\n        ${stars}</a>
        <a href="/${repo}/forks" class="Link Link--muted d-inline-block"><svg></svg>\n        ${forks}</a>
        <span class="d-inline-block float-sm-right"><svg></svg> ${since} stars today</span>
      </div>
    </article>`;
}

function pageHtml(articles) {
    return `<!DOCTYPE html><html><body><div class="Box">${articles.join('\n')}</div></body></html>`;
}

function mockHtmlOnce(html, { ok = true, status = 200 } = {}) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok,
        status,
        statusText: 'OK',
        text: vi.fn().mockResolvedValue(html),
    }));
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('github-trending/repos', () => {
    it('parses repos, stars, forks, language, description and url', async () => {
        const html = pageHtml([
            article({ repo: 'owner-a/repo-a', desc: 'Tools &amp; toys for the web', lang: 'Rust', stars: '1,234', forks: '56', since: '78' }),
            article({ repo: 'owner-b/repo-b', desc: null, lang: null, stars: '9', forks: '0', since: '3' }),
        ]);
        mockHtmlOnce(html);

        const rows = await loadCommand().func({ since: 'daily', language: '', limit: 25 });

        expect(rows).toEqual([
            { rank: 1, repo: 'owner-a/repo-a', description: 'Tools & toys for the web', language: 'Rust', stars: 1234, forks: 56, starsSince: 78, url: 'https://github.com/owner-a/repo-a' },
            { rank: 2, repo: 'owner-b/repo-b', description: '', language: null, stars: 9, forks: 0, starsSince: 3, url: 'https://github.com/owner-b/repo-b' },
        ]);
    });

    it('honors --limit by truncating the result set', async () => {
        const html = pageHtml([
            article({ repo: 'a/a', desc: 'a', lang: 'Go', stars: '1', forks: '1', since: '1' }),
            article({ repo: 'b/b', desc: 'b', lang: 'Go', stars: '2', forks: '2', since: '2' }),
            article({ repo: 'c/c', desc: 'c', lang: 'Go', stars: '3', forks: '3', since: '3' }),
        ]);
        mockHtmlOnce(html);

        const rows = await loadCommand().func({ since: 'daily', language: '', limit: 2 });
        expect(rows.map((r) => r.repo)).toEqual(['a/a', 'b/b']);
    });

    it('builds the language + since URL', async () => {
        const fetchFn = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: vi.fn().mockResolvedValue(pageHtml([
                article({ repo: 'x/y', desc: 'z', lang: 'Rust', stars: '1', forks: '1', since: '1' }),
            ])),
        });
        vi.stubGlobal('fetch', fetchFn);

        await loadCommand().func({ since: 'weekly', language: 'rust', limit: 25 });

        const calledUrl = String(fetchFn.mock.calls[0][0]);
        expect(calledUrl).toBe('https://github.com/trending/rust?since=weekly');
    });

    it('rejects an unknown --since', async () => {
        await expect(loadCommand().func({ since: 'yearly', language: '', limit: 25 }))
            .rejects.toThrow(/since/i);
    });

    it('rejects a non-positive --limit', async () => {
        await expect(loadCommand().func({ since: 'daily', language: '', limit: 0 }))
            .rejects.toThrow(/limit/i);
    });

    it('rejects --limit above 25', async () => {
        await expect(loadCommand().func({ since: 'daily', language: '', limit: 30 }))
            .rejects.toThrow(/limit/i);
    });

    it('throws EmptyResultError when no repositories are present', async () => {
        mockHtmlOnce('<main><h2>It looks like we don’t have any trending repositories for your choices.</h2></main>');
        await expect(loadCommand().func({ since: 'daily', language: '', limit: 25 }))
            .rejects.toThrow(EmptyResultError);
    });

    it('fails closed when GitHub row selectors drift without an explicit empty marker', async () => {
        mockHtmlOnce('<main><div class="Box">Trending repositories</div></main>');
        await expect(loadCommand().func({ since: 'daily', language: '', limit: 25 }))
            .rejects.toThrow(CommandExecutionError);
    });

    it('fails closed when a repository row has no repo identity', async () => {
        mockHtmlOnce(pageHtml([article({ repo: 'owner-a/repo-a', desc: 'x', lang: 'Rust', stars: '1', forks: '2', since: '3' })
            .replace('href="/owner-a/repo-a"', 'href="https://evil.example/owner-a/repo-a"')]));

        await expect(loadCommand().func({ since: 'daily', language: '', limit: 25 }))
            .rejects.toThrow(CommandExecutionError);
    });

    it('fails closed when stars, forks, or period stars stop parsing', async () => {
        const valid = article({ repo: 'owner-a/repo-a', desc: 'x', lang: 'Rust', stars: '1', forks: '2', since: '3' });

        mockHtmlOnce(pageHtml([valid.replace('1</a>', 'many</a>')]));
        await expect(loadCommand().func({ since: 'daily', language: '', limit: 25 }))
            .rejects.toThrow(CommandExecutionError);

        mockHtmlOnce(pageHtml([valid.replace('2</a>', 'some</a>')]));
        await expect(loadCommand().func({ since: 'daily', language: '', limit: 25 }))
            .rejects.toThrow(CommandExecutionError);

        mockHtmlOnce(pageHtml([valid.replace('3 stars today', 'several stars today')]));
        await expect(loadCommand().func({ since: 'daily', language: '', limit: 25 }))
            .rejects.toThrow(CommandExecutionError);
    });

    it('throws on a non-ok HTTP response', async () => {
        mockHtmlOnce('', { ok: false, status: 503 });
        await expect(loadCommand().func({ since: 'daily', language: '', limit: 25 }))
            .rejects.toThrow(/HTTP 503/);
    });
});
