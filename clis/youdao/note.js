import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

function buildExtractorJs() {
  return `
(function() {
  var title = (document.querySelector('.file-name') || {}).textContent || '';
  var summary = (document.querySelector('.ynote-share-template-pc-header-summary') || {}).textContent || '';
  var keywordEls = document.querySelectorAll('.ynote-share-template-pc-header-keyword');
  var keywords = [];
  for (var i = 0; i < keywordEls.length; i++) {
    var txt = (keywordEls[i].textContent || '').trim();
    if (txt) keywords.push(txt);
  }
  var aiMark = (document.querySelector('.ynote-share-template-pc-header-ai-mark') || {}).textContent || '';
  return {
    title: (title || '').trim(),
    content: (summary || '').trim(),
    keywords: keywords,
    aiGenerated: aiMark.indexOf('AI') !== -1 || aiMark.indexOf('生成') !== -1,
  };
})()`;
}

const command = cli({
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
  func: async (page, kwargs) => {
    var url = String(kwargs.url).trim();
    if (!url || (url.indexOf('note.youdao.com') === -1 && url.indexOf('note.youdao.cn') === -1)) {
      throw new CliError('INVALID_URL', 'Invalid Youdao Note URL', 'Provide a full share URL like https://share.note.youdao.com/ynoteshare/index.html?id=...');
    }
    await page.goto(url);
    try {
      await page.wait({ selector: '.file-name', timeout: 10 });
    } catch {
      await page.wait(3).catch(function() {});
    }
    try {
      await page.wait(3);
    } catch {}
    var data = await page.evaluate(buildExtractorJs());
    if (!data || !data.title) {
      throw new CliError('NOT_FOUND', 'Could not extract note content', 'The page may have failed to load or the URL is invalid');
    }
    return [{
      title: data.title,
      content: data.content || '',
      keywords: (data.keywords || []).join(' | '),
    }];
  },
});

export const __test__ = { command };
