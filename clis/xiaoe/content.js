import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'xiaoe',
    name: 'content',
    access: 'read',
    description: '提取小鹅通图文页面内容为文本',
    domain: 'h5.xet.citv.cn',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'url', required: true, positional: true, help: '页面 URL' },
    ],
    columns: ['title', 'content_length', 'image_count'],
    pipeline: [
        { navigate: '${{ args.url }}' },
        { wait: 6 },
        { evaluate: `(() => {
  var selectors = ['.rich-text-wrap','.content-wrap','.article-content','.text-content',
    '.course-detail','.detail-content','[class*="richtext"]','[class*="rich-text"]','.ql-editor'];
  var content = '';
  for (var i = 0; i < selectors.length; i++) {
    var el = document.querySelector(selectors[i]);
    if (el && el.innerText.trim().length > 50) { content = el.innerText.trim(); break; }
  }
  if (!content) content = (document.querySelector('main') || document.querySelector('#app') || document.body).innerText.trim();

  var images = [];
  document.querySelectorAll('img').forEach(function(img) {
    if (img.src && !img.src.startsWith('data:') && img.src.includes('xiaoe')) images.push(img.src);
  });
  return [{
    title: document.title,
    content: content,
    content_length: content.length,
    image_count: images.length,
    images: JSON.stringify(images.slice(0, 20)),
  }];
})()
` },
    ],
});
