import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'xiaoe',
    name: 'catalog',
    description: '小鹅通课程目录（支持普通课程、专栏、大专栏）',
    domain: 'h5.xet.citv.cn',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'url', required: true, positional: true, help: '课程页面 URL' },
    ],
    columns: ['ch', 'chapter', 'no', 'title', 'type', 'resource_id', 'status'],
    pipeline: [
        { navigate: '${{ args.url }}' },
        { wait: 8 },
        { evaluate: `(async () => {
  var el = document.querySelector('#app');
  var store = (el && el.__vue__) ? el.__vue__.$store : null;
  if (!store) return [];
  var coreInfo = store.state.coreInfo || {};
  var resourceType = coreInfo.resource_type || 0;
  var origin = window.location.origin;
  var courseName = coreInfo.resource_name || '';

  function typeLabel(t) {
    return {1:'图文',2:'直播',3:'音频',4:'视频',6:'专栏',8:'大专栏'}[Number(t)] || String(t||'');
  }
  function buildUrl(item) {
    var u = item.jump_url || item.h5_url || item.url || '';
    return (u && !u.startsWith('http')) ? origin + u : u;
  }
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
              ch: 1, chapter: courseName, no: j + 1,
              title: item.resource_title || item.title || item.chapter_title || '',
              type: typeLabel(item.resource_type || item.chapter_type),
              resource_id: item.resource_id,
              url: buildUrl(item),
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
      var urlPath = {1:'/v1/course/text/',2:'/v2/course/alive/',3:'/v1/course/audio/',4:'/v1/course/video/'}[Number(chType)];
      result.push({
        ch: cj + 1, chapter: chTitle, no: ck + 1,
        title: child.chapter_title || child.resource_title || '',
        type: typeLabel(chType),
        resource_id: resId,
        url: urlPath ? origin + urlPath + resId + '?type=2' : '',
        status: child.is_finish === 1 ? '已完成' : (child.learn_progress > 0 ? child.learn_progress + '%' : '未学'),
      });
    }
  }
  return result;
})()
` },
        { map: {
                ch: '${{ item.ch }}',
                chapter: '${{ item.chapter }}',
                no: '${{ item.no }}',
                title: '${{ item.title }}',
                type: '${{ item.type }}',
                resource_id: '${{ item.resource_id }}',
                url: '${{ item.url }}',
                status: '${{ item.status }}',
            } },
    ],
});
