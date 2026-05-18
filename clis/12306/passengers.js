/**
 * 12306 saved passenger list for the logged-in user.
 *
 * 12306 already masks ID numbers (`xxxx***********xxx`) and mobile
 * numbers (`138****xxxx`) server-side. This adapter further masks the
 * passenger's Chinese real name and birth date by default; pass
 * `--include-sensitive` to surface the unmasked-by-12306 fields.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { isAuthLikePayload, maskChineseName, require12306Login, requireEvaluateObject } from './utils.js';

const PASSENGER_QUERY_URL = 'https://kyfw.12306.cn/otn/passengers/query';
const MAX_PAGE_SIZE = 50;

function normalizeLimit(value, defaultValue, max) {
    if (value === undefined || value === null || value === '') return defaultValue;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) throw new ArgumentError(`limit must be a positive integer (1-${max})`);
    if (n > max) throw new ArgumentError(`limit must be <= ${max}`);
    return n;
}

cli({
    site: '12306',
    name: 'passengers',
    access: 'read',
    description: 'List the logged-in user\'s saved 12306 passengers. Sensitive fields are masked by default; pass --include-sensitive to opt in.',
    domain: 'kyfw.12306.cn',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 20, help: `Max passengers to return (1-${MAX_PAGE_SIZE})` },
        { name: 'include-sensitive', type: 'boolean', default: false, help: 'Reveal unmasked real names and birth dates. The 12306 ID-number / mobile masks are server-side and never decoded.' },
    ],
    columns: ['name', 'sex', 'born_year', 'id_type', 'id_no', 'mobile', 'passenger_type', 'country'],
    func: async (page, kwargs) => {
        if (!page) throw new CommandExecutionError('Browser session required for 12306 passengers');
        const limit = normalizeLimit(kwargs.limit, 20, MAX_PAGE_SIZE);
        const include = kwargs['include-sensitive'] === true;

        await page.goto('https://kyfw.12306.cn/otn/view/index.html');
        await require12306Login(page, AuthRequiredError);
        const json = requireEvaluateObject(await page.evaluate(`async () => {
      const body = "pageIndex=1&pageSize=${MAX_PAGE_SIZE}";
      const r = await fetch(${JSON.stringify(PASSENGER_QUERY_URL)}, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body, credentials: 'include',
      });
      if (!r.ok) return { __http: r.status };
      try {
        return await r.json();
      } catch (err) {
        return { __parse: String(err && err.message || err) };
      }
    }`), 'passengers');
        if (json?.__http) {
            if ([401, 403].includes(Number(json.__http))) {
                throw new AuthRequiredError('kyfw.12306.cn', '12306 passengers requires a valid login session');
            }
            throw new CommandExecutionError(`12306 returned HTTP ${json.__http} for passengers/query`);
        }
        if (json?.__parse) {
            throw new CommandExecutionError(`12306 passengers returned non-JSON body: ${json.__parse}`);
        }
        if (isAuthLikePayload(json)) {
            throw new AuthRequiredError('kyfw.12306.cn', '12306 passengers requires a valid login session');
        }
        if (json?.status !== true || !Array.isArray(json?.data?.datas)) {
            throw new CommandExecutionError('12306 passengers payload missing data.datas array');
        }
        const datas = json.data.datas;
        if (datas.length === 0) {
            throw new EmptyResultError('No saved passengers on this 12306 account');
        }
        return datas.slice(0, limit).map((p) => ({
            name: include ? (p.passenger_name || '') : maskChineseName(p.passenger_name || ''),
            sex: p.sex_name || '',
            born_year: (p.born_date || '').slice(0, 4),
            id_type: p.passenger_id_type_name || '',
            id_no: p.passenger_id_no || '',
            mobile: p.mobile_no || '',
            passenger_type: p.passenger_type_name || '',
            country: p.country_code || '',
        }));
    },
});

export const __test__ = { normalizeLimit };
