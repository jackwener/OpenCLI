import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'jimeng',
    name: 'generate',
    description: '即梦AI 文生图 — 输入 prompt 生成图片',
    domain: 'jimeng.jianying.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'prompt', type: 'string', required: true, positional: true, help: '图片描述 prompt' },
        {
            name: 'model',
            type: 'string',
            default: 'high_aes_general_v50',
            help: '模型: high_aes_general_v50 (5.0 Lite), high_aes_general_v42 (4.6), high_aes_general_v40 (4.0)',
        },
        { name: 'wait', type: 'int', default: 40, help: '等待生成完成的秒数' },
    ],
    columns: ['status', 'prompt', 'image_count', 'image_urls'],
    pipeline: [
        { navigate: 'https://jimeng.jianying.com/ai-tool/generate?type=image&workspace=0' },
        { wait: 3 },
        { evaluate: `(async () => {
  const prompt = \${{ args.prompt | json }};
  const waitSec = \${{ args.wait }};
  
  // Step 1: Count existing images before generation
  const beforeImgs = document.querySelectorAll('img[src*="dreamina-sign"], img[src*="tb4s082cfz"]').length;
  
  // Step 2: Clear and set prompt
  const editors = document.querySelectorAll('[contenteditable="true"]');
  const editor = editors[0];
  if (!editor) return [{ status: 'failed', prompt: prompt, image_count: 0, image_urls: 'Editor not found' }];
  
  editor.focus();
  await new Promise(r => setTimeout(r, 200));
  document.execCommand('selectAll');
  await new Promise(r => setTimeout(r, 100));
  document.execCommand('delete');
  await new Promise(r => setTimeout(r, 200));
  document.execCommand('insertText', false, prompt);
  await new Promise(r => setTimeout(r, 500));
  
  // Step 3: Click generate
  const btn = document.querySelector('.lv-btn.lv-btn-primary[class*="circle"]');
  if (!btn) return [{ status: 'failed', prompt: prompt, image_count: 0, image_urls: 'Generate button not found' }];
  btn.click();
  
  // Step 4: Wait for new images to appear
  let newImgs = [];
  for (let i = 0; i < waitSec; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const allImgs = document.querySelectorAll('img[src*="dreamina-sign"], img[src*="tb4s082cfz"]');
    if (allImgs.length > beforeImgs) {
      // New images appeared — generation complete
      newImgs = Array.from(allImgs).slice(0, allImgs.length - beforeImgs);
      break;
    }
  }
  
  if (newImgs.length === 0) {
    return [{ status: 'timeout', prompt: prompt, image_count: 0, image_urls: 'Generation may still be in progress' }];
  }
  
  // Step 5: Extract image URLs (use thumbnail URLs which are accessible)
  const urls = newImgs.map(img => img.src);
  
  return [{ 
    status: 'success', 
    prompt: prompt.substring(0, 80), 
    image_count: urls.length, 
    image_urls: urls.join('\\n')
  }];
})()
` },
        { map: {
                status: '${{ item.status }}',
                prompt: '${{ item.prompt }}',
                image_count: '${{ item.image_count }}',
                image_urls: '${{ item.image_urls }}',
            } },
    ],
});
