/**
 * Injected page-side network interceptor.
 *
 * Used when the session-level capture channel (CDP/extension) is unavailable.
 * It captures fetch/XHR response bodies while matching the CDP path's
 * truncation contract: bodies above the per-entry cap are stored as a string
 * prefix with `bodyTruncated: true` and `bodyFullSize` set.
 *
 * Keep this script dependency-free; it executes in the target page context.
 */
export const NETWORK_INTERCEPTOR_JS = `(function(){if(window.__opencli_net)return;window.__opencli_net=[];var M=200,B=1048576,F=window.fetch;function capture(url,method,status,text,ct){if(window.__opencli_net.length>=M)return;var full=text?text.length:0,trunc=full>B,stored=trunc?text.slice(0,B):text,body=null;if(stored){if(trunc){body=stored}else{try{body=JSON.parse(stored)}catch(e){body=stored}}}var e={url:url,method:method||'GET',status:status,size:full,ct:ct,body:body,timestamp:Date.now()};if(trunc){e.bodyTruncated=true;e.bodyFullSize=full}window.__opencli_net.push(e)}window.fetch=async function(){var r=await F.apply(this,arguments);try{var ct=r.headers.get('content-type')||'';if(ct.includes('json')||ct.includes('text')){var c=r.clone(),t=await c.text();capture(r.url||(arguments[0]&&arguments[0].url)||String(arguments[0]),(arguments[1]&&arguments[1].method)||'GET',r.status,t,ct)}}catch(e){}return r};var X=XMLHttpRequest.prototype,O=X.open,S=X.send;X.open=function(m,u){this._om=m;this._ou=u;return O.apply(this,arguments)};X.send=function(){var x=this;x.addEventListener('load',function(){try{var ct=x.getResponseHeader('content-type')||'';if(ct.includes('json')||ct.includes('text')){capture(x._ou,x._om||'GET',x.status,x.responseText||'',ct)}}catch(e){}});return S.apply(this,arguments)}})()`;
