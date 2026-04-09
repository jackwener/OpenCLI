import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'xiaoe',
  name: 'courses',
  description: '列出已购小鹅通课程（含 URL 和店铺名）',
  domain: 'study.xiaoe-tech.com',
  strategy: Strategy.COOKIE,
  columns: ['title', 'shop', 'url'],
  pipeline: [
    { navigate: 'https://study.xiaoe-tech.com/' },
    { wait: 8 },
    { evaluate: `(async () => {
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

  // 构造课程 URL
  function buildUrl(entry) {
    if (entry.h5_url) return entry.h5_url;
    if (entry.url) return entry.url;
    if (entry.app_id && entry.resource_id) {
      var base = 'https://' + entry.app_id + '.h5.xet.citv.cn';
      if (entry.resource_type === 6) return base + '/v1/course/column/' + entry.resource_id + '?type=3';
      return base + '/p/course/ecourse/' + entry.resource_id;
    }
    return '';
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
      url: entry ? buildUrl(entry) : '',
    });
  }
  return results;
})()
` },
    { map: { title: '${{ item.title }}', shop: '${{ item.shop }}', url: '${{ item.url }}' } },
  ],
});
