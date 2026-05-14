import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

function decodeDdgUrl(href) {
  if (!href) return '';
  try {
    const url = new URL(href, 'https://duckduckgo.com');
    const uddg = url.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    return href;
  } catch {
    return href;
  }
}

function buildExtractFn(limit) {
  return 'function(doc){' +
    'var r=[];var seen={};var items=doc.querySelectorAll(".result");' +
    'for(var i=0;i<items.length;i++){' +
    'if(r.length>=' + limit + ')break;' +
    'var el=items[i];var te=el.querySelector(".result__a");' +
    'var se=el.querySelector(".result__snippet");' +
    'var ue=el.querySelector(".result__url");' +
    'var ie=el.querySelector(".result__icon__img");' +
    'if(!te)continue;' +
    'var t=(te.textContent||"").trim();' +
    'var h=te.getAttribute("href")||"";' +
    'var sn=se?(se.textContent||"").trim():"";' +
    'var du=ue?(ue.textContent||"").trim():"";' +
    'var ic=ie?(ie.getAttribute("src")||""):"";' +
    'var cls=el.className||"";var rt="web";' +
    'if(cls.indexOf("news-result")!==-1)rt="news";' +
    'else if(cls.indexOf("video-result")!==-1)rt="video";' +
    'else if(cls.indexOf("image-result")!==-1)rt="image";' +
    'if(!t||seen[t])continue;seen[t]=true;' +
    'r.push([t,h,sn,du,ic,rt]);' +
    '}return r;}';
}

function buildExtractorJs(limit) {
  return '(' + buildExtractFn(limit) + '(document))';
}

function buildPaginateJs(limit, keyword, offset, region) {
  var params = 'q=' + encodeURIComponent(keyword) + '&s=' + offset + '&v=l&o=json';
  if (region) params += '&kl=' + encodeURIComponent(region);
  return (
    'new Promise(function($r){' +
    'var x=new XMLHttpRequest();' +
    'x.open("POST","/html/",true);' +
    'x.setRequestHeader("Content-Type","application/x-www-form-urlencoded");' +
    'x.onload=function(){' +
    'try{var d=new DOMParser().parseFromString(x.responseText,"text/html");' +
    '$r(' + buildExtractFn(limit) + '(d));' +
    '}catch(e){$r([])}' +
    '};' +
    'x.onerror=function(){$r([])};' +
    'x.send("' + params + '");' +
    '})'
  );
}

const command = cli({
  site: 'duckduckgo',
  name: 'search',
  access: 'read',
  description: 'Search DuckDuckGo',
  domain: 'html.duckduckgo.com',
  strategy: Strategy.PUBLIC,
  browser: true,
  args: [
    { name: 'keyword', positional: true, required: true, help: 'Search query' },
    { name: 'limit', type: 'int', default: 10, help: 'Number of results per page (1-10). For multi-page, use --offset' },
    { name: 'offset', type: 'int', default: 0, help: 'Result offset for pagination (0, 10, 20...). Uses XHR POST internally' },
    { name: 'region', help: 'Region code (e.g. jp-jp, us-en, cn-zh). Default: all regions' },
    { name: 'time', help: 'Time range: d (day), w (week), m (month), y (year)' },
  ],
  columns: ['title', 'url', 'snippet', 'displayUrl', 'icon', 'resultType'],
  func: async (page, kwargs) => {
    const limit = Math.max(1, Math.min(Number(kwargs.limit) || 10, 10));
    const keyword = String(kwargs.keyword);
    const offset = Math.max(0, Number(kwargs.offset) || 0);
    let url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(keyword)}`;
    if (kwargs.region) url += `&kl=${encodeURIComponent(String(kwargs.region))}`;
    if (kwargs.time) url += `&df=${encodeURIComponent(String(kwargs.time))}`;
    await page.goto(url);
    try {
      await page.wait({ selector: '.result', timeout: 8 });
    } catch {
      await page.wait(3).catch(function() {});
    }
    var raw;
    if (offset === 0) {
      raw = await page.evaluate(buildExtractorJs(limit));
    } else {
      raw = await page.evaluate(buildPaginateJs(limit, keyword, offset, kwargs.region));
    }
    if (!raw || raw.length === 0) {
      throw new CliError('NOT_FOUND', 'No search results found', 'Try a different keyword');
    }
    return raw.map(function(r) {
      return {
        title: r[0],
        url: decodeDdgUrl(r[1]),
        snippet: r[2],
        displayUrl: r[3],
        icon: r[4],
        resultType: r[5],
      };
    });
  },
});

export const __test__ = { command };
