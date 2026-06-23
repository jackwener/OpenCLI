import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { apiGet, resolveBvid, parsePageArg, selectVideoPart } from './utils.js';

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CommandExecutionError(`${label} returned a malformed payload`);
  }
  return value;
}

function unwrapBrowserResult(value) {
  if (value && typeof value === 'object' && typeof value.session === 'string' && Object.hasOwn(value, 'data')) {
    return value.data;
  }
  return value;
}

function readOptionalFlag(value, label) {
  if (value == null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  throw new CommandExecutionError(`${label} returned a malformed flag`);
}

function readOptionalString(value, label) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  throw new CommandExecutionError(`${label} returned a malformed string`);
}

cli({
  site: 'bilibili',
  name: 'video',
    access: 'read',
  description: 'Get Bilibili video metadata (title, author, duration, stats, etc.)',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'bvid', required: true, positional: true, help: 'BV ID, video URL, or b23.tv short link' },
    { name: 'page', required: false, help: '分P 选集序号（从 1 开始）。多 P 视频指定某一集，title/cid 返回该集；缺省取整集默认（P1）' },
  ],
  columns: ['field', 'value'],
  func: async (page, kwargs) => {
    if (!page) {
      throw new CommandExecutionError('Browser session required for bilibili video');
    }

    // 选集序号（--page）：缺省 null = 不下钻分P，保持整集（P1）旧行为。
    const selectedPage = parsePageArg(kwargs.page);

    // Resolve BV ID from three advertised input forms:
    //   1. Bare "BV..." id
    //   2. Full bilibili.com/video/<BV>... URL (with or without query string / www / m.)
    //   3. b23.tv short link (delegated to resolveBvid)
    // resolveBvid() alone handles (1) and (3) but not (2), so we pre-extract
    // from bilibili URLs before falling through.
    const input = String(kwargs.bvid ?? '').trim();
    const bilibiliUrlMatch = input.match(/bilibili\.com\/(?:video|bangumi\/play)\/(BV[A-Za-z0-9]+)/i);
    const bvid = bilibiliUrlMatch ? bilibiliUrlMatch[1] : await resolveBvid(input);

    // Navigate to video page first so subsequent api call shares a primed session.
    await page.goto(`https://www.bilibili.com/video/${bvid}/`);

    const payload = unwrapBrowserResult(await apiGet(page, '/x/web-interface/view', {
      params: { bvid },
    }));
    requireObject(payload, 'Bilibili view API');
    if (payload.code !== 0) {
      throw new CommandExecutionError(`Bilibili view API failed: ${payload.message} (${payload.code})`);
    }

    const d = requireObject(payload.data, 'Bilibili view API data');
    const stat = d.stat || {};
    const owner = d.owner || {};

    // 付费/会员标记：view API 的 rights 位 + 充电专属字段本来就在响应里，
    // 透出给下游在下载/截屏前判断"拿不到视频流"。
    //   rights.pay=1                  → 付费 OGV（大会员专享/单点付费番剧、影视；实测会员番剧单集 pay=1）
    //   rights.ugc_pay=1 / arc_pay=1  → UGC 单点付费 / 付费合集
    //   is_upower_exclusive=true      → 充电专属视频
    // redirect_url 非空（指向 /bangumi/play/ep<id>）= OGV 内容，细分可再查 pgc season API。
    const rights = requireObject(d.rights, 'Bilibili view API data.rights');
    const rightsPay = readOptionalFlag(rights.pay, 'Bilibili rights.pay');
    const rightsUgcPay = readOptionalFlag(rights.ugc_pay, 'Bilibili rights.ugc_pay');
    const rightsArcPay = readOptionalFlag(rights.arc_pay, 'Bilibili rights.arc_pay');
    const upowerExclusive = readOptionalFlag(d.is_upower_exclusive, 'Bilibili is_upower_exclusive');
    const paymentType = rightsPay
      ? 'vip'
      : (rightsUgcPay || rightsArcPay)
        ? 'ugc_pay'
        : upowerExclusive
          ? 'upower'
          : '';
    const payPreview = readOptionalFlag(rights.ugc_pay_preview, 'Bilibili rights.ugc_pay_preview')
      || readOptionalFlag(d.is_upower_preview, 'Bilibili is_upower_preview');
    const redirectUrl = readOptionalString(d.redirect_url, 'Bilibili redirect_url');

    const pubDate = d.pubdate ? new Date(d.pubdate * 1000).toISOString().slice(0, 16).replace('T', ' ') : '';

    // 选集下钻：--page 给定时从 data.pages 取该集，title 用分集标题（part），
    // 越界由 selectVideoPart 抛结构化错。缺省保持整集 title = d.title（旧行为不变）。
    let title = d.title ?? '';
    let partCid = '';
    let partDur = d.duration || 0;
    if (selectedPage != null) {
      const part = selectVideoPart(d, selectedPage);
      partCid = String(part.cid ?? '');
      const partTitle = typeof part.part === 'string' ? part.part.trim() : '';
      title = partTitle || `${d.title ?? ''} P${selectedPage}`;
      // 分集时长（pages[].duration）比整集 d.duration 更贴合该集；缺则回退整集。
      if (Number.isFinite(Number(part.duration)) && Number(part.duration) > 0) {
        partDur = Number(part.duration);
      }
    }

    const dur = partDur || 0;
    const mm = Math.floor(dur / 60);
    const ss = dur % 60;

    const rows = [
      { field: 'bvid',         value: d.bvid ?? '' },
      { field: 'aid',          value: String(d.aid ?? '') },
      { field: 'title',        value: title },
      { field: 'author',       value: owner.name ? `${owner.name} (mid: ${owner.mid})` : '' },
      { field: 'category',     value: d.tname_v2 || d.tname || '' },
      { field: 'publish_time', value: pubDate },
      { field: 'duration',     value: dur ? `${mm}m${ss}s (${dur}s)` : '' },
      { field: 'view',         value: String(stat.view ?? '') },
      { field: 'danmaku',      value: String(stat.danmaku ?? '') },
      { field: 'reply',        value: String(stat.reply ?? '') },
      { field: 'like',         value: String(stat.like ?? '') },
      { field: 'coin',         value: String(stat.coin ?? '') },
      { field: 'favorite',     value: String(stat.favorite ?? '') },
      { field: 'share',        value: String(stat.share ?? '') },
      { field: 'parts',        value: String(d.videos ?? 1) },
      { field: 'thumbnail',    value: d.pic ?? '' },
      { field: 'description',  value: d.desc ?? '' },
      { field: 'requires_payment', value: String(!!paymentType) },
      { field: 'payment_type',     value: paymentType },
      // 可试看（ugc_pay_preview / 充电预览）：有预览流但拿不到完整正片
      { field: 'pay_preview',      value: String(payPreview) },
      { field: 'redirect_url',     value: redirectUrl },
    ];

    // --page 时透出分集专属字段：page（选集序号）、cid（该集弹幕/字幕轴 id）、
    // series_title（整集标题，给下游做"分集标题为空"兜底）。缺省不加，保持旧输出。
    if (selectedPage != null) {
      rows.push({ field: 'page',         value: String(selectedPage) });
      rows.push({ field: 'cid',          value: partCid });
      rows.push({ field: 'series_title', value: d.title ?? '' });
    }

    return rows;
  },
});
