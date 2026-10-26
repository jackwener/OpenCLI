import { cli, Strategy } from '@jackwener/opencli/registry';

/**
 * Generate an image in the Jimeng web app.
 *
 * The prompt goes in through a native InputEvent instead of
 * `document.execCommand`, and completion is detected from image `src` changes
 * instead of counting `<img>` nodes: the result feed is virtualized, so the
 * image count can stay flat while the rendered src values rotate (#2421).
 */
export async function generateJimengImage(input) {
    const doc = input.document;
    const sleep = input.sleep;
    const now = input.now;
    const makeInputEvent = input.makeInputEvent;
    const prompt = String(input.prompt || '');
    const waitSec = Number(input.waitSec) > 0 ? Number(input.waitSec) : 40;
    const IMAGE_SELECTOR = 'img[src*="dreamina-sign"], img[src*="tb4s082cfz"]';
    const GENERATING_TEXT = /生成中|正在生成|generating/i;

    const collectImages = () => Array.from(doc.querySelectorAll(IMAGE_SELECTOR));
    const imageSources = () => collectImages().map((img) => img.src).filter(Boolean);
    const generateButton = () => doc.querySelector('.lv-btn.lv-btn-primary[class*="circle"]');
    const bodyText = () => {
        if (!doc.body) return '';
        return doc.body.innerText || doc.body.textContent || '';
    };
    const isGenerating = () => {
        const button = generateButton();
        if (button && GENERATING_TEXT.test(button.textContent || '')) return true;
        return GENERATING_TEXT.test(bodyText());
    };

    const beforeSources = new Set(imageSources());
    const editors = doc.querySelectorAll('[contenteditable="true"]');
    const editor = editors[0];
    if (!editor) {
        return [{ status: 'failed', prompt: prompt, image_count: 0, image_urls: 'Editor not found' }];
    }

    editor.focus();
    await sleep(200);
    editor.textContent = prompt;
    editor.dispatchEvent(makeInputEvent({
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: prompt,
    }));
    await sleep(500);

    const button = generateButton();
    if (!button) {
        return [{ status: 'failed', prompt: prompt, image_count: 0, image_urls: 'Generate button not found' }];
    }
    button.click();

    // State machine: wait for the 生成中 indicator to appear and clear. A
    // changed image src also counts as completion so a fast generation that
    // never surfaces the indicator is still detected.
    const deadline = now() + waitSec * 1000;
    let started = false;
    while (now() < deadline) {
        await sleep(500);
        const generating = isGenerating();
        const changed = imageSources().some((src) => !beforeSources.has(src));
        if (generating) {
            started = true;
            continue;
        }
        if (started || changed) break;
    }

    // The feed may hydrate the generated image one frame after the indicator
    // clears; keep a short bounded window before declaring a timeout.
    let fresh = imageSources().filter((src) => !beforeSources.has(src));
    const settleDeadline = now() + 3000;
    while (fresh.length === 0 && now() < settleDeadline) {
        await sleep(250);
        fresh = imageSources().filter((src) => !beforeSources.has(src));
    }

    if (fresh.length === 0) {
        return [{ status: 'timeout', prompt: prompt.substring(0, 80), image_count: 0, image_urls: 'Generation may still be in progress' }];
    }
    return [{
        status: 'success',
        prompt: prompt.substring(0, 80),
        image_count: fresh.length,
        image_urls: fresh.join('\n'),
    }];
}

export const __test__ = { generateJimengImage };

cli({
    site: 'jimeng',
    name: 'generate',
    access: 'write',
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
  const generateJimengImage = ${generateJimengImage.toString()};
  return generateJimengImage({
    document,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    makeInputEvent: (init) => new InputEvent('input', init),
    prompt: \${{ args.prompt | json }},
    waitSec: \${{ args.wait }},
  });
})()` },
        { map: {
                status: '${{ item.status }}',
                prompt: '${{ item.prompt }}',
                image_count: '${{ item.image_count }}',
                image_urls: '${{ item.image_urls }}',
            } },
    ],
});
