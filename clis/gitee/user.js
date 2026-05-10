import { CliError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
const GITEE_BASE_URL = 'https://gitee.com';
const GITEE_USER_API = 'https://gitee.com/api/v5/users';
function normalizeText(value) {
    return value.replace(/\s+/g, ' ').trim();
}
function sanitizeUsername(value) {
    return value.trim().replace(/^@+/, '').replace(/^\/+|\/+$/g, '');
}
function asRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    return value;
}
function firstText(value) {
    if (typeof value === 'string')
        return normalizeText(value);
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    if (Array.isArray(value)) {
        for (const item of value) {
            const text = firstText(item);
            if (text)
                return text;
        }
    }
    return '';
}
function normalizeCount(value) {
    const raw = firstText(value);
    if (!raw)
        return '';
    const compact = raw.replace(/,/g, '');
    const match = compact.match(/\d+(?:[.]\d+)?(?:[kKmMwW]|\u4E07)?/);
    if (match)
        return match[0];
    return '';
}
function pickFirst(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim())
            return value.trim();
    }
    return '';
}
function apiGiteeIndex(user) {
    if (!user)
        return '';
    const keys = [
        'gitee_index',
        'giteeIndex',
        'index',
        'score',
        'contribution_score',
        'contributionScore',
        'contribution_index',
        'contributionIndex',
    ];
    for (const key of keys) {
        const value = normalizeCount(user[key]);
        if (value)
            return value;
    }
    return '';
}
cli({
    site: 'gitee',
    name: 'user',
    access: 'read',
    description: 'Show a Gitee user profile panel',
    domain: 'gitee.com',
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'username', positional: true, required: true, help: 'Gitee username' },
    ],
    columns: ['field', 'value'],
    func: async (page, args) => {
        const username = sanitizeUsername(String(args.username ?? ''));
        if (!username) {
            throw new CliError('INVALID_ARGUMENT', 'Username is required', 'Use: opencli gitee user <username>');
        }
        const profileUrl = `${GITEE_BASE_URL}/${encodeURIComponent(username)}`;
        await page.goto(profileUrl);
        await page.wait(2);
        const rawDomSnapshot = await page.evaluate(`
      (() => {
        const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
        const extractCount = (value) => {
          const text = normalize(value).replace(/,/g, '');
          if (!text) return '';
          const match = text.match(/\\d+(?:[.]\\d+)?(?:\\s*[kKmMwW\\u4E07])?/);
          return match ? match[0].replace(/\\s+/g, '') : '';
        };

        const title = normalize(document.title || '');
        const bodyText = normalize(document.body?.innerText || '');
        const notFound = /404|页面不存在|资源不存在|page not found/i.test(title + ' ' + bodyText);
        const blocked = /访问受限|没有访问权限|forbidden|denied/i.test(bodyText);

        const nicknameCandidates = Array.from(
          document.querySelectorAll('.users__personal-name h2 span[title], .users__personal-name h2 [title], .users__personal-name h2 span, .users__personal-name h2, h1'),
        );
        const nicknameNode = nicknameCandidates.find((node) => {
          const titleAttr = node && node.getAttribute ? node.getAttribute('title') : '';
          const text = normalize((titleAttr || node.textContent || '').replace(/\\(\\s*备注名\\s*\\)/g, ''));
          return !!text && !/备注名/.test(text);
        }) || null;
        const nicknameFromAttr = nicknameNode && nicknameNode.getAttribute ? nicknameNode.getAttribute('title') : '';
        const nickname = normalize((nicknameFromAttr || nicknameNode?.textContent || '').replace(/\\(\\s*备注名\\s*\\)/g, ''));

        let followers = extractCount(document.querySelector('#followers-number .social-count, #followers-number .follow-num')?.textContent || '');
        if (!followers) {
          const card = Array.from(document.querySelectorAll('.users__personal-socials .four.wide.column, .users__personal-socials [class*="column"]'))
            .find((el) => /followers/i.test(normalize(el.textContent || '')));
          if (card) followers = extractCount(card.textContent || '');
        }

        let publicRepos = '';
        const projectLink = Array.from(document.querySelectorAll('a[href]'))
          .find((el) => /\\/[^/?#]+\\/projects(?:$|[/?#])/i.test(el.getAttribute('href') || ''));
        if (projectLink) publicRepos = extractCount(projectLink.textContent || '');

        let giteeIndex = '';
        const indexNodes = Array.from(
          document.querySelectorAll('.users__personal-info *, .users__personal-container *, [class*="index" i], [id*="index" i], [class*="score" i], [id*="score" i]'),
        );
        for (const node of indexNodes) {
          const text = normalize(node.textContent || '');
          if (!/(码云指数|gitee\\s*index|gitee\\s*指数)/i.test(text)) continue;

          const direct = text.match(/(?:码云指数|gitee\\s*index|gitee\\s*指数)[:：]?\\s*(\\d+(?:[.]\\d+)?(?:\\s*[kKmMwW\\u4E07])?)/i);
          if (direct?.[1]) {
            giteeIndex = direct[1].replace(/\\s+/g, '');
            break;
          }

          const siblingText = normalize(node.nextElementSibling?.textContent || '');
          const parentText = normalize(node.parentElement?.textContent || '');
          const around = extractCount(siblingText + ' ' + parentText);
          if (around) {
            giteeIndex = around;
            break;
          }
        }

        return {
          notFound,
          blocked,
          nickname,
          followers,
          publicRepos,
          giteeIndex,
        };
      })()
    `);
        const domSnapshotRecord = asRecord(rawDomSnapshot);
        const domSnapshot = {
            notFound: domSnapshotRecord?.notFound === true,
            blocked: domSnapshotRecord?.blocked === true,
            nickname: firstText(domSnapshotRecord?.nickname),
            followers: normalizeCount(domSnapshotRecord?.followers),
            publicRepos: normalizeCount(domSnapshotRecord?.publicRepos),
            giteeIndex: normalizeCount(domSnapshotRecord?.giteeIndex),
        };
        if (domSnapshot.notFound) {
            throw new CliError('NOT_FOUND', `Gitee user "${username}" does not exist`, 'Check the username and retry: opencli gitee user <username>');
        }
        if (domSnapshot.blocked) {
            throw new CliError('FORBIDDEN', `Gitee user page "${username}" is not accessible`, 'The profile may be private/restricted, or the account may be unavailable');
        }
        const apiUrl = `${GITEE_USER_API}/${encodeURIComponent(username)}`;
        const apiResponse = await fetch(apiUrl, {
            headers: {
                Accept: 'application/json',
                'User-Agent': 'Mozilla/5.0',
                Referer: profileUrl,
            },
        });
        if (apiResponse.status === 404) {
            throw new CliError('NOT_FOUND', `Gitee user "${username}" does not exist`, 'Check the username and retry: opencli gitee user <username>');
        }
        if (!apiResponse.ok) {
            throw new CliError('REQUEST_FAILED', `Failed to read Gitee user profile API: ${apiResponse.status}`, 'Try again later or verify network access to gitee.com');
        }
        const apiUser = asRecord(await apiResponse.json());
        const nickname = pickFirst(domSnapshot.nickname, firstText(apiUser?.name), firstText(apiUser?.login), username);
        const followers = pickFirst(domSnapshot.followers, normalizeCount(apiUser?.followers), '-');
        const publicRepos = pickFirst(domSnapshot.publicRepos, normalizeCount(apiUser?.public_repos), '-');
        const giteeIndex = pickFirst(domSnapshot.giteeIndex, apiGiteeIndex(apiUser), '-');
        return [
            { field: 'Nickname', value: nickname },
            { field: 'Followers', value: followers },
            { field: 'Public Repositories', value: publicRepos },
            { field: 'Gitee Index', value: giteeIndex },
            { field: 'URL', value: profileUrl },
        ];
    },
});
