import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { apiGet, resolveBvid } from './utils.js';
cli({
    site: 'bilibili',
    name: 'subtitle',
    access: 'read',
    description: '获取 Bilibili 视频的字幕',
    domain: 'www.bilibili.com',
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
        // 1. 通过 view API 拿 cid。
        //    以前的实现走 page.goto(/video/<bvid>) + window.__INITIAL_STATE__.videoData.cid，
        //    bangumi 绑定的 bvid（番剧/纪录片/电影/综艺）页面 state 不在 videoData 而在 epList，
        //    导致 SELECTOR 错。view API 接受任何 bvid（UGC + PGC 都通），且不依赖 DOM 结构。
        let view;
        try {
            view = await apiGet(page, '/x/web-interface/view', { params: { bvid } });
        }
        catch (err) {
            throw new CommandExecutionError(`获取视频信息失败: ${err?.message || err}`);
        }
        if (view?.code !== 0) {
            throw new CommandExecutionError(`获取视频信息失败: ${view?.message ?? 'unknown'} (${view?.code})`);
        }
        const cid = view?.data?.cid;
        if (!cid) {
            throw new CommandExecutionError(`无法从 view API 拿到 cid (bvid=${bvid})`);
        }
        // 2. 用带 Wbi 签名的 player/v2 拿字幕列表（之前 evaluate 里 fetch 因为没签名会 403）
        let payload;
        try {
            payload = await apiGet(page, '/x/player/wbi/v2', {
                params: { bvid, cid },
                signed: true,
            });
        }
        catch (err) {
            throw new CommandExecutionError(`获取视频播放信息失败: ${err?.message || err}`);
        }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            throw new CommandExecutionError('获取到的视频播放信息对象不符合预期格式');
        }
        if (payload.code !== 0) {
            throw new CommandExecutionError(`获取视频播放信息失败: ${payload.message} (${payload.code})`);
        }
        const needLoginSubtitle = payload.data?.need_login_subtitle === true;
        const subtitles = payload.data?.subtitle?.subtitles;
        if (!Array.isArray(subtitles)) {
            throw new CommandExecutionError('获取到的字幕列表对象不符合数组格式');
        }
        if (subtitles.length === 0) {
            if (needLoginSubtitle) {
                throw new AuthRequiredError('bilibili.com', 'Bilibili subtitles are hidden behind login for this video. Please log in to bilibili.com in Chrome and retry.');
            }
            throw new EmptyResultError('bilibili subtitle', '此视频没有发现外挂或智能字幕。');
        }
        // 3. 选择目标字幕语言
        const target = kwargs.lang
            ? subtitles.find((s) => s.lan === kwargs.lang) || subtitles[0]
            : subtitles[0];
        if (!target || typeof target !== 'object' || !Object.hasOwn(target, 'subtitle_url')) {
            throw new CommandExecutionError('字幕条目缺少 subtitle_url 字段');
        }
        const targetSubUrl = typeof target.subtitle_url === 'string' ? target.subtitle_url.trim() : '';
        if (!targetSubUrl) {
            throw new AuthRequiredError('bilibili.com', '[风控拦截/未登录] 获取到的 subtitle_url 为空！请确保 CLI 已成功登录且风控未封锁此账号。');
        }
        const finalUrl = targetSubUrl.startsWith('//') ? 'https:' + targetSubUrl : targetSubUrl;
        if (!/^https?:\/\//i.test(finalUrl)) {
            throw new CommandExecutionError(`字幕 URL 非法: ${finalUrl}`);
        }
        // 4. 解析并拉取 CDN 的 JSON 文件
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
        let items;
        try {
            items = await page.evaluate(fetchJs);
        }
        catch (err) {
            throw new CommandExecutionError(`字幕获取失败: ${err?.message || err}`);
        }
        if (items?.error) {
            throw new CommandExecutionError(`字幕获取失败: ${items.error}${items.text ? ' — ' + items.text : ''}`);
        }
        if (!items || typeof items !== 'object' || items.success !== true) {
            throw new CommandExecutionError('字幕获取结果对象不符合预期格式');
        }
        const finalItems = items.data;
        if (!Array.isArray(finalItems)) {
            throw new CommandExecutionError('解析到的字幕列表对象不符合数组格式');
        }
        if (finalItems.length === 0) {
            throw new EmptyResultError('bilibili subtitle', '字幕文件中没有字幕片段。');
        }
        // 5. 数据映射
        return finalItems.map((item, idx) => {
            const from = Number(item?.from);
            const to = Number(item?.to);
            if (!item || typeof item !== 'object' || !Number.isFinite(from) || !Number.isFinite(to)) {
                throw new CommandExecutionError('字幕片段缺少有效 from/to 时间戳');
            }
            return {
                index: idx + 1,
                from: from.toFixed(2) + 's',
                to: to.toFixed(2) + 's',
                content: String(item.content ?? '')
            };
        });
    },
});
