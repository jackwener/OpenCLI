import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  getPostDetails,
  getRawCode,
  locatePreviewElement,
  getDefaultOutputPath,
  saveBase64File,
} from './_shared.js';

cli({
  site: 'uiverse',
  name: 'preview',
  description: 'Capture a screenshot of the Uiverse preview element',
  domain: 'uiverse.io',
  strategy: Strategy.PUBLIC,
  browser: true,
  args: [
    { name: 'input', type: 'str', required: true, positional: true, help: 'Uiverse URL or author/slug identifier' },
    { name: 'output', type: 'str', required: false, help: 'Output image path (defaults to a temp file)' },
    { name: 'padding', type: 'int', required: false, default: 8, help: 'Extra padding around the captured preview in pixels' },
  ],
  columns: ['username', 'slug', 'width', 'height', 'output'],
  func: async (page, kwargs) => {
    const detail = await getPostDetails(page, kwargs.input);
    const payload = await getRawCode(page, detail.post.id);

    const located = await locatePreviewElement(page, payload.html);
    const rect = located.best.rect;
    const padding = Math.max(0, Number(kwargs.padding ?? 8));
    const clip = {
      x: Math.max(0, rect.x - padding),
      y: Math.max(0, rect.y - padding),
      width: Math.max(1, rect.width + padding * 2),
      height: Math.max(1, rect.height + padding * 2),
      scale: 1,
    };

    const shot = await page.cdp('Page.captureScreenshot', {
      format: 'png',
      clip,
      captureBeyondViewport: false,
    });
    const base64 = typeof shot === 'string' ? shot : shot?.data;
    if (!base64) {
      throw new Error('CDP screenshot failed: no image data was returned.');
    }

    const outputPath = kwargs.output || getDefaultOutputPath({
      username: detail.username,
      slug: detail.slug,
      suffix: 'preview',
      extension: 'png',
    });
    const savedPath = await saveBase64File(base64, outputPath);

    return {
      username: detail.username,
      slug: detail.slug,
      url: detail.url,
      output: savedPath,
      width: Math.round(clip.width),
      height: Math.round(clip.height),
      x: Math.round(clip.x),
      y: Math.round(clip.y),
      selectorSource: located.best.source,
      matchedTag: located.best.tag,
      matchedClassName: located.best.className,
      postId: detail.post.id,
    };
  },
});
