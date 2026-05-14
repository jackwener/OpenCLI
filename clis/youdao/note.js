import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

function buildExtractorJs() {
  var walkFn = (
    'function wt(n,t){' +
    'if(!n||typeof n!==\'object\')return;' +
    'if(Array.isArray(n)){for(var i=0;i<n.length;i++)wt(n[i],t);return;}' +
    'if(n[8]&&typeof n[8]===\'string\')t.push(n[8]);' +
    'var ks=Object.keys(n);' +
    'for(var i=0;i<ks.length;i++){var v=n[ks[i]];if(v&&typeof v===\'object\')wt(v,t);}' +
    '}'
  );
  return (
    '(function(){' + walkFn +
    'var re=document.querySelector("#root");' +
    'if(!re)return null;' +
    'var ir=re._reactRootContainer&&re._reactRootContainer._internalRoot;' +
    'if(!ir)return null;' +
    'function fs(n,d){' +
    'if(!n||d>20)return null;' +
    'var st=n.memoizedState;' +
    'if(st){' +
    'try{var s=JSON.stringify(st);if(s&&s.indexOf("storeState")!==-1){return JSON.parse(s).storeState;}}catch(e){}' +
    '}' +
    'var c=n.child;' +
    'while(c){var r=fs(c,d+1);if(r)return r;c=c.sibling;}' +
    'return null;' +
    '}' +
    'var store=fs(ir.current,0);' +
    'if(!store)return null;' +
    'var cd=store.content&&store.content.data;' +
    'var ai=store.aiSummary;' +
    'var rc=cd&&cd.content;' +
    'var ft="";' +
    'if(rc){try{var p=JSON.parse(rc);var tx=[];wt(p,tx);ft=tx.join("\\n");}catch(e){ft=rc;}}' +
    'var tl=(cd&&cd.tl)||"";' +
    'var asi="";var kws=[];' +
    'if(ai&&ai.aiSummary){' +
    'try{var ap=JSON.parse(ai.aiSummary);asi=ap.description||"";' +
    'if(ap.keywords){for(var i=0;i<ap.keywords.length;i++){var kw=ap.keywords[i];if(kw.title)kws.push((kw.emoji||"")+" "+kw.title);}}}' +
    'catch(e){}}' +
    'return{title:tl.trim(),content:ft||asi||"",keywords:kws.join(" | "),createTime:cd&&cd.ct||null,fileSize:cd&&cd.sz||null};' +
    '})()'
  );
}

var command = cli({
  site: 'youdao',
  name: 'note',
  access: 'read',
  description: 'Read a public shared Youdao Note',
  domain: 'share.note.youdao.com',
  strategy: Strategy.PUBLIC,
  browser: true,
  args: [
    { name: 'url', positional: true, required: true, help: 'Full share URL of the Youdao Note' },
  ],
  columns: ['title', 'content', 'keywords'],
  func: async function(page, kwargs) {
    var url = String(kwargs.url).trim();
    if (!url || (url.indexOf('note.youdao.com') === -1 && url.indexOf('note.youdao.cn') === -1)) {
      throw new CliError('INVALID_URL', 'Invalid Youdao Note URL', 'Provide a full share URL like https://share.note.youdao.com/ynoteshare/index.html?id=...');
    }
    await page.goto(url);
    try {
      await page.wait({ selector: '.file-name', timeout: 10 });
    } catch (_) {
      await page.wait(3).catch(function() {});
    }
    await page.wait(3).catch(function() {});
    var data = await page.evaluate(buildExtractorJs());
    if (!data || !data.title) {
      throw new CliError('NOT_FOUND', 'Could not extract note content', 'The page may have failed to load or the URL is invalid');
    }
    return [{
      title: data.title,
      content: data.content || '',
      keywords: data.keywords || '',
    }];
  },
});

export var __test__ = { command: command };
