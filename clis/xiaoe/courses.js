// Xiaoe (小鹅通) purchased-courses list — pulls "已购内容" tab cards from
// `study.xiaoe-tech.com`.
//
// Replaces the legacy `pipeline:[]` form. The in-page extraction logic
// (Vue `__vue__.$parent` walk to match a card title back to the original
// purchase entry) is kept byte-for-byte — Xiaoe's purchase list is not
// exposed as a public JSON endpoint, and Vue's private runtime tree is
// the only stable hook. JSDOM cannot reproduce the Vue runtime, so
// rewriting the IIFE without live verify would be silent-failure risk.
//
// What changes:
//   - `func` form + `Strategy.COOKIE` + `browser:true`.
//   - Typed errors: `EmptyResultError` when zero card rows are found
//     (almost always means the cookie expired); `CommandExecutionError`
//     when `page.evaluate` rejects.
//   - One pure helper (`buildCourseUrl`) is extracted as a module-level
//     export; the in-page IIFE embeds it via `${fn.toString()}` so the
//     live and test paths share one source of truth. The helper covers
//     the three URL fallbacks the legacy code had inline:
//       1. `entry.h5_url` if present
//       2. `entry.url` if present
//       3. otherwise build from `app_id` + `resource_id` + `resource_type`
//          (column course `resource_type === 6` gets the `/v1/course/column/`
//          path, everything else gets `/p/course/ecourse/`)

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

// Pure: derive the canonical course URL for a single purchase entry.
// Returns '' when `entry` is missing the fields we'd need to construct
// any of the three forms — never makes up a partial URL.
export function buildCourseUrl(entry) {
    if (!entry) return '';
    if (entry.h5_url) return entry.h5_url;
    if (entry.url) return entry.url;
    if (entry.app_id && entry.resource_id) {
        const base = 'https://' + entry.app_id + '.h5.xet.citv.cn';
        if (entry.resource_type === 6) {
            return base + '/v1/course/column/' + entry.resource_id + '?type=3';
        }
        return base + '/p/course/ecourse/' + entry.resource_id;
    }
    return '';
}

export function buildCoursesScript() {
    return `(async () => {
  ${buildCourseUrl.toString()}
  // 切换到「内容」tab
  var tabs = document.querySelectorAll('span, div');
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].children.length === 0 && tabs[i].textContent.trim() === '内容') {
      tabs[i].click();
      break;
    }
  }
  await new Promise(function(r) { setTimeout(r, 2000); });

  // 匹配课程卡片标题与 Vue 数据
  function matchEntry(title, vm, depth) {
    if (!vm || depth > 5) return null;
    var d = vm.$data || {};
    for (var k in d) {
      if (!Array.isArray(d[k])) continue;
      for (var j = 0; j < d[k].length; j++) {
        var e = d[k][j];
        if (!e || typeof e !== 'object') continue;
        var t = e.title || e.resource_name || '';
        if (t && title.includes(t.substring(0, 10))) return e;
      }
    }
    return vm.$parent ? matchEntry(title, vm.$parent, depth + 1) : null;
  }

  var cards = document.querySelectorAll('.course-card-list');
  var results = [];
  for (var c = 0; c < cards.length; c++) {
    var titleEl = cards[c].querySelector('.card-title-box');
    var title = titleEl ? titleEl.textContent.trim() : '';
    if (!title) continue;
    var entry = matchEntry(title, cards[c].__vue__, 0);
    results.push({
      title: title,
      shop: entry ? (entry.shop_name || entry.app_name || '') : '',
      url: entry ? buildCourseUrl(entry) : '',
    });
  }
  return results;
})()`;
}

async function getXiaoeCourses(page) {
    let rows;
    try {
        await page.goto('https://study.xiaoe-tech.com/', { waitUntil: 'load', settleMs: 8000 });
        rows = await page.evaluate(buildCoursesScript());
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new CommandExecutionError(
            `Failed to list xiaoe courses: ${message}`,
            'page may not have rendered or auth may be required',
        );
    }
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new EmptyResultError(
            'xiaoe/courses',
            'No purchased courses found — login session may have expired or the "内容" tab has no items',
        );
    }
    return rows;
}

export const coursesCommand = cli({
    site: 'xiaoe',
    name: 'courses',
    access: 'read',
    description: '列出已购小鹅通课程（含 URL 和店铺名）',
    domain: 'study.xiaoe-tech.com',
    strategy: Strategy.COOKIE,
    browser: true,
    columns: ['title', 'shop', 'url'],
    func: getXiaoeCourses,
});

export const __test__ = {
    buildCoursesScript,
};
