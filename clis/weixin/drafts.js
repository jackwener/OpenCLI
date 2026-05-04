import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

const WEIXIN_DOMAIN = 'mp.weixin.qq.com';

export const draftsCommand = cli({
    site: 'weixin',
    name: 'drafts',
    access: 'read',
    description: '列出微信公众号草稿箱',
    domain: WEIXIN_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    timeoutSeconds: 60,
    args: [
        { name: 'limit', type: 'int', default: 10, help: '最多显示条数' },
    ],
    columns: ['Index', 'Title', 'Time'],

    func: async (page, kwargs) => {
        await page.goto('https://mp.weixin.qq.com/');
        await page.wait(3);
        const token = await page.evaluate(`(window.location.href.match(/token=(\\d+)/)||[])[1]`);
        if (!token) {
            throw new AuthRequiredError(WEIXIN_DOMAIN, '微信公众号草稿箱需要已登录的 mp.weixin.qq.com 会话');
        }

        await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?begin=0&count=${kwargs.limit}&type=77&action=list_card&token=${token}&lang=zh_CN`);
        await page.wait(4);

        const drafts = await page.evaluate(`(() => {
            var results = [];
            var idx = 0;

            var cards = document.querySelectorAll('.weui-desktop-card');
            for (var i = 0; i < cards.length; i++) {
                if (cards[i].className.includes('card_new')) continue;
                var titleEl = cards[i].querySelector('[class*=title]');
                var timeEl = cards[i].querySelector('[class*=tips]');
                var title = titleEl ? titleEl.textContent.trim() : '';
                var time = timeEl ? timeEl.textContent.trim().replace(/\\s+/g, ' ') : '';
                if (title) results.push({ Index: ++idx, Title: title, Time: time });
            }
            if (results.length > 0) return results;

            var rows = document.querySelectorAll('tr, [class*=appmsg_item], [class*=list_item]');
            rows.forEach(function(row) {
                var titleEl = row.querySelector('[class*=title] a, [class*=title], h4');
                var timeEl = row.querySelector('[class*=time], td:nth-child(2)');
                var title = titleEl ? titleEl.textContent.trim() : '';
                var time = timeEl ? timeEl.textContent.trim() : '';
                if (title && title !== '内容' && title.length < 80) {
                    results.push({ Index: ++idx, Title: title, Time: time });
                }
            });
            return results;
        })()`);

        if (!drafts || drafts.length === 0) {
            throw new EmptyResultError('weixin drafts', 'No structured drafts found in the current Weixin Official Account backend');
        }

        return drafts.slice(0, kwargs.limit);
    },
});
