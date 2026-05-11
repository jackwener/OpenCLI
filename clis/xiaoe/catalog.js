// Xiaoe (小鹅通) catalog — list chapters + sections of a course / column
// page (`h5.xet.citv.cn`).
//
// Replaces the legacy `pipeline:[]` form. The in-browser extraction logic
// (Vue store walking + auto-scroll-to-load + Vue child traversal) is kept
// byte-for-byte — Xiaoe's pages are SPA-rendered and Vue's private API
// (`__vue__`, `$store`, `$children`, `chapter_box.__vue__`) is the only
// stable hook we have. JSDOM cannot reproduce the Vue runtime tree, so
// reorganising the IIFE without live verify would be silent-failure risk.
//
// What changes:
//   - `func` form + `Strategy.COOKIE` + `browser:true`.
//   - Typed errors: `ArgumentError` on missing url; `EmptyResultError`
//     when the IIFE yields zero rows (almost always means the cookie
//     expired or the URL is not a course page); `CommandExecutionError`
//     when `page.evaluate` rejects.
//   - Three pure helpers (`typeLabel`, `buildItemUrl`, `chapterUrlPath`)
//     are module-level exports and are embedded into the in-page IIFE
//     via `${fn.toString()}` so the live and the test path share one
//     source of truth.

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { requireXiaoePageUrl } from './content.js';

// resource_type → human label. 1=图文 2=直播 3=音频 4=视频 6=专栏 8=大专栏.
// Returns the raw `String(t)` when the type is unknown (e.g. xiaoe rolls
// out a new resource type) — never silently swallows it.
export function typeLabel(t) {
    const map = { 1: '图文', 2: '直播', 3: '音频', 4: '视频', 6: '专栏', 8: '大专栏' };
    return map[Number(t)] || String(t || '');
}

// Resolve a relative `jump_url` / `h5_url` / `url` against the page's
// origin. Returns '' when the item has no URL field at all.
export function buildItemUrl(item, origin) {
    const u = item.jump_url || item.h5_url || item.url || '';
    if (!u) return '';
    return u.startsWith('http') ? u : (origin + u);
}

// chapter_type → URL path for the section reader. Xiaoe routes chapter
// types to different player paths; returning `undefined` for unknown
// types lets the caller decide whether to emit `''` instead of guessing
// a bad URL.
export function chapterUrlPath(chType) {
    const map = { 1: '/v1/course/text/', 2: '/v2/course/alive/', 3: '/v1/course/audio/', 4: '/v1/course/video/' };
    return map[Number(chType)];
}

export function buildCatalogScript() {
    return `(async () => {
  ${typeLabel.toString()}
  ${buildItemUrl.toString()}
  ${chapterUrlPath.toString()}
  var el = document.querySelector('#app');
  var store = (el && el.__vue__) ? el.__vue__.$store : null;
  if (!store) return [];
  var coreInfo = store.state.coreInfo || {};
  var resourceType = coreInfo.resource_type || 0;
  var origin = window.location.origin;
  var courseName = coreInfo.resource_name || '';

  function clickTab(name) {
    var tabs = document.querySelectorAll('span, div');
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].children.length === 0 && tabs[i].textContent.trim() === name) {
        tabs[i].click(); return;
      }
    }
  }

  clickTab('目录');
  await new Promise(function(r) { setTimeout(r, 2000); });

  function getScrollTargets() {
    return document.querySelectorAll('.scroll-view, .list-wrap, .scroller, #app');
  }
  function getMaxScrollHeight(scrollers) {
    var maxHeight = document.body.scrollHeight;
    for (var i = 0; i < scrollers.length; i++) {
      if (scrollers[i].scrollHeight > maxHeight) maxHeight = scrollers[i].scrollHeight;
    }
    return maxHeight;
  }

  // 模拟滚动以实现动态加载
  var prevMaxScrollHeight = 0;
  for (var sc = 0; sc < 20; sc++) {
    window.scrollTo(0, 999999);
    var scrollers = getScrollTargets();
    for(var si = 0; si < scrollers.length; si++) {
      if(scrollers[si].scrollHeight > scrollers[si].clientHeight) scrollers[si].scrollTop = scrollers[si].scrollHeight;
    }
    await new Promise(function(r) { setTimeout(r, 800); });

    // 点击可能存在的下拉/加载更多
    var moreTabs = document.querySelectorAll('span, div, p');
    for (var bi = 0; bi < moreTabs.length; bi++) {
      var t = moreTabs[bi].textContent.trim();
      if ((t === '点击加载更多' || t === '展开更多' || t === '加载更多') && moreTabs[bi].clientHeight > 0) {
        try { moreTabs[bi].click(); } catch(e){}
      }
    }

    var maxScrollHeight = getMaxScrollHeight(getScrollTargets());
    if (sc > 3 && maxScrollHeight === prevMaxScrollHeight) break;
    prevMaxScrollHeight = maxScrollHeight;
  }
  await new Promise(function(r) { setTimeout(r, 1000); });

  // ===== 专栏 / 大专栏 =====
  if (resourceType === 6 || resourceType === 8) {
    await new Promise(function(r) { setTimeout(r, 1000); });
    var listData = [];
    var walkList = function(vm, depth) {
      if (!vm || depth > 6 || listData.length > 0) return;
      var d = vm.$data || {};
      var keys = ['columnList', 'SingleItemList', 'chapterChildren'];
      for (var ki = 0; ki < keys.length; ki++) {
        var arr = d[keys[ki]];
        if (arr && Array.isArray(arr) && arr.length > 0 && arr[0].resource_id) {
          for (var j = 0; j < arr.length; j++) {
            var item = arr[j];
            if (!item.resource_id || !/^[pvlai]_/.test(item.resource_id)) continue;
            listData.push({
              ch: 1,
              chapter: courseName,
              no: j + 1,
              title: item.resource_title || item.title || item.chapter_title || '',
              type: typeLabel(item.resource_type || item.chapter_type),
              resource_id: item.resource_id,
              url: buildItemUrl(item, origin),
              status: item.finished_state === 1 ? '已完成' : (item.resource_count ? item.resource_count + '节' : ''),
            });
          }
          return;
        }
      }
      if (vm.$children) {
        for (var c = 0; c < vm.$children.length; c++) walkList(vm.$children[c], depth + 1);
      }
    };
    walkList(el.__vue__, 0);
    return listData;
  }

  // ===== 普通课程 =====
  var chapters = document.querySelectorAll('.chapter_box');
  for (var ci = 0; ci < chapters.length; ci++) {
    var vue = chapters[ci].__vue__;
    if (vue && typeof vue.getSecitonList === 'function' && (!vue.isShowSecitonsList || !vue.chapterChildren.length)) {
      if (vue.isShowSecitonsList) vue.isShowSecitonsList = false;
      try { vue.getSecitonList(); } catch(e) {}
      await new Promise(function(r) { setTimeout(r, 1500); });
    }
  }
  await new Promise(function(r) { setTimeout(r, 3000); });

  var result = [];
  chapters = document.querySelectorAll('.chapter_box');
  for (var cj = 0; cj < chapters.length; cj++) {
    var v = chapters[cj].__vue__;
    if (!v) continue;
    var chTitle = (v.chapterItem && v.chapterItem.chapter_title) || '';
    var children = v.chapterChildren || [];
    for (var ck = 0; ck < children.length; ck++) {
      var child = children[ck];
      var resId = child.resource_id || child.chapter_id || '';
      var chType = child.chapter_type || child.resource_type || 0;
      var urlPath = chapterUrlPath(chType);
      result.push({
        ch: cj + 1,
        chapter: chTitle,
        no: ck + 1,
        title: child.chapter_title || child.resource_title || '',
        type: typeLabel(chType),
        resource_id: resId,
        url: urlPath ? origin + urlPath + resId + '?type=2' : '',
        status: child.is_finish === 1 ? '已完成' : (child.learn_progress > 0 ? child.learn_progress + '%' : '未学'),
      });
    }
  }
  return result;
})()`;
}

async function getXiaoeCatalog(page, args) {
    const url = requireXiaoePageUrl(args.url, 'catalog');
    let rows;
    try {
        await page.goto(url, { waitUntil: 'load', settleMs: 8000 });
        rows = await page.evaluate(buildCatalogScript());
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new CommandExecutionError(
            `Failed to read xiaoe catalog: ${message}`,
            'page may not have rendered or auth may be required',
        );
    }
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new EmptyResultError(
            'xiaoe/catalog',
            'No catalog rows extracted — the URL may not be a course page or the login session has expired',
        );
    }
    return rows;
}

export const catalogCommand = cli({
    site: 'xiaoe',
    name: 'catalog',
    access: 'read',
    description: '小鹅通课程目录（支持普通课程、专栏、大专栏）',
    domain: 'h5.xet.citv.cn',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'url', required: true, positional: true, help: '课程页面 URL' },
    ],
    columns: ['ch', 'chapter', 'no', 'title', 'type', 'resource_id', 'url', 'status'],
    func: getXiaoeCatalog,
});

export const __test__ = {
    buildCatalogScript,
};
