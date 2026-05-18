/**
 * 12306 account summary for the logged-in user.
 *
 * Returns non-sensitive identity fields plus masked email / mobile.
 * Use `--include-sensitive` to surface unmasked values from 12306's
 * own response (12306 already masks the ID number server-side; this
 * adapter never decodes that mask).
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { isAuthLikePayload, maskEmail, maskMobile, maskChineseName, require12306Login, requireEvaluateObject } from './utils.js';

const ACCOUNT_INFO_URL = 'https://kyfw.12306.cn/otn/modifyUser/initQueryUserInfoApi';

cli({
    site: '12306',
    name: 'me',
    access: 'read',
    description: 'Show the logged-in 12306 account summary. Sensitive fields (real name, email, mobile, birth date) are masked by default; pass --include-sensitive to opt in.',
    domain: 'kyfw.12306.cn',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'include-sensitive', type: 'boolean', default: false, help: 'Reveal unmasked real name / email / mobile / birth date. The 12306 ID-number mask is server-side and never decoded.' },
    ],
    columns: ['username', 'real_name', 'email', 'mobile', 'birth_date', 'sex', 'country', 'user_type', 'member', 'active'],
    func: async (page, kwargs) => {
        if (!page) throw new CommandExecutionError('Browser session required for 12306 me');
        await page.goto('https://kyfw.12306.cn/otn/view/index.html');
        await require12306Login(page, AuthRequiredError);
        const json = requireEvaluateObject(await page.evaluate(`async () => {
      const r = await fetch(${JSON.stringify(ACCOUNT_INFO_URL)}, { credentials: 'include' });
      if (!r.ok) return { __http: r.status };
      try {
        return await r.json();
      } catch (err) {
        return { __parse: String(err && err.message || err) };
      }
    }`), 'account info');
        if (json?.__http) {
            if ([401, 403].includes(Number(json.__http))) {
                throw new AuthRequiredError('kyfw.12306.cn', '12306 account info requires a valid login session');
            }
            throw new CommandExecutionError(`12306 returned HTTP ${json.__http} for account info`);
        }
        if (json?.__parse) {
            throw new CommandExecutionError(`12306 account info returned non-JSON body: ${json.__parse}`);
        }
        if (isAuthLikePayload(json)) {
            throw new AuthRequiredError('kyfw.12306.cn', '12306 account info requires a valid login session');
        }
        if (json?.status !== true || !json?.data?.userDTO) {
            throw new CommandExecutionError('12306 account info payload missing userDTO');
        }
        const dto = json.data.userDTO;
        const loginDto = dto.loginUserDTO || {};
        const username = loginDto.user_name || loginDto.name || '';
        const realName = loginDto.real_name || loginDto.realname || '';
        const include = kwargs['include-sensitive'] === true;
        return [{
            username,
            real_name: include ? realName : maskChineseName(realName),
            email: include ? (dto.email || '') : maskEmail(dto.email || ''),
            mobile: include ? (dto.mobile_no || '') : maskMobile(dto.mobile_no || ''),
            birth_date: include ? (dto.born_date || '') : (dto.born_date || '').slice(0, 4),
            sex: dto.sex_code === 'M' ? '男' : (dto.sex_code === 'F' ? '女' : ''),
            country: dto.country_code || '',
            user_type: json.data.userTypeName || '',
            member: dto.flag_member === '1',
            active: dto.is_active === '1',
        }];
    },
});
