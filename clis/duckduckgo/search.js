import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import {
  emptySearchResults,
  requireBoundedInteger,
  requireNonNegativeInteger,
  requireRows,
  requireSearchQuery,
  runBrowserStep,
  toHttpsUrl,
} from '../_shared/search-adapter.js';

function decodeDdgUrl(href) {
  if (!href) return '';
  try {
    const url = new URL(href, 'https://duckduckgo.com');
    const uddg = url.searchParams.get('uddg');
    return toHttpsUrl(uddg || href, 'https://duckduckgo.com');
  } catch {
    return '';
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
    'var cls=el.className||"";var rt="web";' +
    'if(cls.indexOf("result--ad")!==-1||cls.indexOf("result--ads")!==-1||cls.indexOf("badge--ad")!==-1)continue;' +
    'if(!te)continue;' +
    'var t=(te.textContent||"").trim();' +
    'var h=te.getAttribute("href")||"";' +
    'var sn=se?(se.textContent||"").trim():"";' +
    'var du=ue?(ue.textContent||"").trim():"";' +
    'var ic=ie?(ie.getAttribute("src")||""):"";' +
    'if(cls.indexOf("news-result")!==-1)rt="news";' +
    'else if(cls.indexOf("video-result")!==-1)rt="video";' +
    'else if(cls.indexOf("image-result")!==-1)rt="image";' +
    'if(!t||!h||seen[h])continue;seen[h]=true;' +
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
    '}catch(e){$r({error:"parse",message:String(e&&e.message||e)})}' +
    '};' +
    'x.onerror=function(){$r({error:"network"})};' +
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
  columns: ['rank', 'title', 'url', 'snippet', 'displayUrl', 'icon', 'resultType'],
  func: async (page, kwargs) => {
    const limit = requireBoundedInteger(kwargs.limit, 10, 1, 10, '--limit');
    const keyword = requireSearchQuery(kwargs.keyword);
    const offset = requireNonNegativeInteger(kwargs.offset, 0, '--offset');
    if (offset % 10 !== 0) {
      throw new ArgumentError('--offset must be a multiple of 10 for DuckDuckGo HTML pagination');
    }
    if (kwargs.time && !/^(d|w|m|y)$/.test(String(kwargs.time))) {
      throw new ArgumentError('--time must be one of d, w, m, or y');
    }
    let url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(keyword)}`;
    if (kwargs.region) url += `&kl=${encodeURIComponent(String(kwargs.region))}`;
    if (kwargs.time) url += `&df=${encodeURIComponent(String(kwargs.time))}`;
    await runBrowserStep('duckduckgo search navigation', () => page.goto(url));
    try {
      await page.wait({ selector: '.result', timeout: 8 });
    } catch {
      await page.wait(3).catch(function() {});
    }
    var raw;
    if (offset === 0) {
      raw = await runBrowserStep('duckduckgo search extraction', () => page.evaluate(buildExtractorJs(limit)));
    } else {
      raw = await runBrowserStep('duckduckgo search pagination extraction', () => page.evaluate(buildPaginateJs(limit, keyword, offset, kwargs.region)));
    }
    const rows = requireRows(raw, 'duckduckgo search');
    if (rows.length === 0) {
      throw emptySearchResults('DuckDuckGo', keyword);
    }
    return rows.map(function(r, index) {
      return {
        rank: index + 1 + offset,
        title: r[0],
        url: decodeDdgUrl(r[1]),
        snippet: r[2],
        displayUrl: r[3],
        icon: r[4],
        resultType: r[5],
      };
    }).filter((row) => row.url);
  },
});

export const __test__ = { command };
