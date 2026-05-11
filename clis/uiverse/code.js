import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  getPostDetails,
  getRawCode,
  extractExportCode,
  inferLanguage,
  getCodeLength,
} from './_shared.js';

cli({
  site: 'uiverse',
  name: 'code',
    access: 'read',
  description: 'Export Uiverse component code (HTML, CSS, React, or Vue)',
  domain: 'uiverse.io',
  strategy: Strategy.PUBLIC,
  browser: true,
  navigateBefore: 'https://uiverse.io',
  args: [
    { name: 'input', type: 'str', required: true, positional: true, help: 'Uiverse URL or author/slug identifier' },
    { name: 'target', type: 'str', required: true, choices: ['html', 'css', 'react', 'vue'], help: 'Code target to export' },
  ],
  columns: ['target', 'username', 'slug', 'language', 'length'],
  func: async (page, kwargs) => {
    const detail = await getPostDetails(page, kwargs.input);
    const target = String(kwargs.target).toLowerCase();
    let code = '';

    if (target === 'react' || target === 'vue') {
      code = await extractExportCode(page, target);
    } else {
      const payload = await getRawCode(page, detail.post.id);
      code = target === 'html' ? payload.html : payload.css;
    }

    return {
      target,
      username: detail.username,
      slug: detail.slug,
      url: detail.url,
      language: inferLanguage(target, detail.post),
      length: getCodeLength(code),
      code,
      postId: detail.post.id,
      type: detail.post.type,
      isTailwind: Boolean(detail.post.isTailwind),
    };
  },
});
