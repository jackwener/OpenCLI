import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { getOnesBaseUrl, onesFetchInPage } from './common.js';
cli({
    site: 'ones',
    name: 'login',
    description: 'ONES Project API — login via Chrome Bridge (POST auth/login); stderr prints export hints for ONES_USER_ID / TOKEN',
    domain: 'ones.cn',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        {
            name: 'email',
            type: 'str',
            required: false,
            help: 'Account email (or set ONES_EMAIL)',
        },
        {
            name: 'phone',
            type: 'str',
            required: false,
            help: 'Account phone (or set ONES_PHONE); ignored if email is set',
        },
        {
            name: 'password',
            type: 'str',
            required: false,
            help: 'Password (or set ONES_PASSWORD)',
        },
    ],
    columns: ['uuid', 'name', 'email', 'token_preview'],
    func: async (page, kwargs) => {
        const email = kwargs.email?.trim() || process.env.ONES_EMAIL?.trim();
        const phone = kwargs.phone?.trim() || process.env.ONES_PHONE?.trim();
        const password = kwargs.password || process.env.ONES_PASSWORD || '';
        if (!password) {
            throw new CliError('CONFIG', 'Password required', 'Pass --password or set ONES_PASSWORD for non-interactive use.');
        }
        if (!email && !phone) {
            throw new CliError('CONFIG', 'email or phone required', 'Pass --email or --phone (or set ONES_EMAIL / ONES_PHONE).');
        }
        getOnesBaseUrl();
        const bodyObj = { password };
        if (email)
            bodyObj.email = email;
        else
            bodyObj.phone = phone;
        const parsed = (await onesFetchInPage(page, 'auth/login', {
            method: 'POST',
            body: JSON.stringify(bodyObj),
            auth: false,
        }));
        const user = parsed.user;
        if (!user?.uuid || !user?.token) {
            throw new CliError('FETCH_ERROR', 'ONES login response missing user.uuid or user.token', 'Your server build may differ from documented Project API.');
        }
        const uuid = String(user.uuid);
        const token = String(user.token);
        const name = String(user.name ?? '');
        const em = String(user.email ?? '');
        const base = getOnesBaseUrl();
        console.error([
            '',
            '后续请求会优先使用当前 Chrome 会话 Cookie；若接口仍要求 Header，可 export：',
            `  export ONES_BASE_URL=${JSON.stringify(base)}`,
            `  export ONES_USER_ID=${JSON.stringify(uuid)}`,
            `  export ONES_AUTH_TOKEN=${JSON.stringify(token)}`,
            '',
        ].join('\n'));
        return [
            {
                uuid,
                name,
                email: em,
                token_preview: token.length > 12 ? `${token.slice(0, 6)}…${token.slice(-4)}` : '***',
            },
        ];
    },
});
