import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError, EmptyResultError, selectorError } from '@jackwener/opencli/errors';
import { apiGet, resolveBvid } from './utils.js';
cli({
    site: 'bilibili',
    name: 'subtitle',
    access: 'read',
    description: '获取 Bilibili 视频的字幕',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'bvid', required: true, positional: true, help: 'Bilibili 视频 BV ID（如 BV1xx411c7mD），或视频 URL / b23.tv 短链' },
        { name: 'lang', required: false, help: '字幕语言代码 (如 zh-CN, en-US, ai-zh)，默认取第一个' },
    ],
    columns: ['index', 'from', 'to', 'content'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for bilibili subtitle');
        const bvid = await resolveBvid(kwargs.bvid);
        // 1. 先前往视频详情页 (建立有鉴权的 Session，且这里不需要加载完整个视频)
        await page.goto(`https://www.bilibili.com/video/${bvid}/`);
        // 2. 利用 __INITIAL_STATE__ 获取基础信息，拿 CID
        const cid = await page.evaluate(`(async () => {
      const state = window.__INITIAL_STATE__ || {};
      return state?.videoData?.cid;
    })()`);
        if (!cid) {
            throw selectorError('videoData.cid', '无法在页面中提取到当前视频的 CID，请检查页面是否正常加载。');
        }
        // 3. 在 Node 端使用 apiGet 获取带 Wbi 签名的字幕列表
        // 之前纯靠 evaluate 里的 fetch 会失败，因为 B 站 /wbi/ 开头的接口强校验 w_rid，未签名直接被风控返回 403 HTML
        const payload = await apiGet(page, '/x/player/wbi/v2', {
            params: { bvid, cid },
            signed: true, // 开启 wbi_sign 自动签名
        });
        if (payload.code !== 0) {
            throw new CommandExecutionError(`获取视频播放信息失败: ${payload.message} (${payload.code})`);
        }
        const needLoginSubtitle = payload.data?.need_login_subtitle === true;
        const subtitles = payload.data?.subtitle?.subtitles || [];
        if (subtitles.length === 0) {
            if (needLoginSubtitle) {
                throw new AuthRequiredError('bilibili.com', 'Bilibili subtitles are hidden behind login for this video. Please log in to bilibili.com in Chrome and retry.');
            }
            throw new EmptyResultError('bilibili subtitle', '此视频没有发现外挂或智能字幕。');
        }
        // 4. 选择目标字幕语言
        const target = kwargs.lang
            ? subtitles.find((s) => s.lan === kwargs.lang) || subtitles[0]
            : subtitles[0];
        const targetSubUrl = target.subtitle_url;
        if (!targetSubUrl || targetSubUrl === '') {
            throw new AuthRequiredError('bilibili.com', '[风控拦截/未登录] 获取到的 subtitle_url 为空！请确保 CLI 已成功登录且风控未封锁此账号。');
        }
        const finalUrl = targetSubUrl.startsWith('//') ? 'https:' + targetSubUrl : targetSubUrl;
        // 5. 解析并拉取 CDN 的 JSON 文件
        const fetchJs = `
      (async () => {
         const url = ${JSON.stringify(finalUrl)};
         const res = await fetch(url);
         const text = await res.text();
         
         if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
            return { error: 'HTML', text: text.substring(0, 100), url };
         }
         
         try {
             const subJson = JSON.parse(text);
             // B站真实返回格式是 { font_size: 0.4, font_color: "#FFFFFF", background_alpha: 0.5, background_color: "#9C27B0", Stroke: "none", type: "json" , body: [{from: 0, to: 0, content: ""}] }
             if (Array.isArray(subJson?.body)) return { success: true, data: subJson.body };
             if (Array.isArray(subJson)) return { success: true, data: subJson };
             return { error: 'UNKNOWN_JSON', data: subJson };
         } catch (e) {
             return { error: 'PARSE_FAILED', text: text.substring(0, 100) };
         }
      })()
    `;
        const items = await page.evaluate(fetchJs);
        if (items?.error) {
            throw new CommandExecutionError(`字幕获取失败: ${items.error}${items.text ? ' — ' + items.text : ''}`);
        }
        const finalItems = items?.data || [];
        if (!Array.isArray(finalItems)) {
            throw new CommandExecutionError('解析到的字幕列表对象不符合数组格式');
        }
        // 6. 数据映射
        return finalItems.map((item, idx) => ({
            index: idx + 1,
            from: Number(item.from || 0).toFixed(2) + 's',
            to: Number(item.to || 0).toFixed(2) + 's',
            content: item.content
        }));
    },
});
