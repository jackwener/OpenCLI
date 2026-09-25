import { cli, Strategy } from '@jackwener/opencli/registry';
import fs from 'node:fs';
import path from 'node:path';
/**
 * 发布即刻动态（文本 / 图片 / 视频）
 *
 * 即刻首页 /following 顶部有内联发帖框（"分享你的想法..."）。
 * 纯文本：直接粘贴后发送。
 * 带媒体（--images，扩展名决定类型）：先拖放注入文件并等待七牛上传返回 key，
 * 再粘贴正文，最后校验「发送」按钮状态与 originalPosts/create 的服务端响应，
 * 避免“脚本报成功、帖子没发出去”的假成功。
 *
 * 即刻网页版支持视频动态；本命令接受 mp4/mov/m4v/webm（单条视频，不能与图片混排）。
 */
const SUPPORTED_EXTENSIONS = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.m4v': 'video/x-m4v',
    '.webm': 'video/webm',
};

cli({
    site: 'jike',
    name: 'create',
    access: 'write',
    description: '发布即刻动态',
    domain: 'web.okjike.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'text', type: 'string', required: true, positional: true, help: '动态正文内容' },
        { name: 'images', type: 'string', required: false, help: '媒体路径,逗号分隔 (jpg/png/gif/webp 图片，或 mp4/mov/m4v/webm 单个视频)' },
    ],
    columns: ['status', 'message'],
    func: async (page, kwargs) => {
        // 0. 解析图片路径
        let absPaths = [];
        if (kwargs.images) {
            absPaths = String(kwargs.images).split(',').map(s => s.trim()).filter(Boolean).map(p => path.resolve(p));
            for (const p of absPaths) {
                const ext = path.extname(p).toLowerCase();
                if (!SUPPORTED_EXTENSIONS[ext]) {
                    return [{ status: 'failed', message: `Unsupported media format "${ext}". Supported: jpg/jpeg/png/gif/webp (image) or mp4/mov/m4v/webm (video)` }];
                }
                if (!fs.existsSync(p)) {
                    return [{ status: 'failed', message: `Media file not found: ${p}` }];
                }
            }
        }
        // 1. 导航到首页（有内联发帖框）
        await page.goto('https://web.okjike.com');
        const initialReady = await waitForComposer(page);
        if (!initialReady.ok) {
            return [{ status: 'failed', message: initialReady.message }];
        }
        // 2. 上传图片（如果提供了）
        let imgWarn = "";
        let uploadedCount = 0;
        if (absPaths.length > 0) {
            const uploadResult = await uploadImages(page, absPaths);
            if (!uploadResult.ok) {
                console.warn(`[warn] jike image upload failed: ${uploadResult.error} — continuing with text only`);
                imgWarn = `（图片上传失败，已降级纯文本：${uploadResult.error}）`;
                // 清掉失败或仍在上传的图片，避免把残留预览当作纯文本降级。
                await page.goto('https://web.okjike.com');
                const reloadReady = await waitForComposer(page);
                if (!reloadReady.ok) {
                    return [{ status: 'failed', message: reloadReady.message + imgWarn }];
                }
            } else {
                uploadedCount = uploadResult.count;
            }
            await page.wait(1);
        }
        // 3. 在发帖框中输入文本
        const textReady = await waitForComposer(page);
        if (!textReady.ok) {
            return [{ status: 'failed', message: textReady.message + imgWarn }];
        }
        const textResult = await page.evaluate(`(async () => {
      try {
        const textToInsert = ${JSON.stringify(kwargs.text)};
        const form = document.querySelector('[class*="_postForm_"]');
        const editor = form
          ? form.querySelector('[contenteditable="true"]')
          : document.querySelector('[contenteditable="true"]');
        if (editor) {
          editor.focus();
          const dt = new DataTransfer();
          dt.setData('text/plain', textToInsert);
          editor.dispatchEvent(new ClipboardEvent('paste', {
            clipboardData: dt, bubbles: true, cancelable: true,
          }));
          await new Promise(r => setTimeout(r, 800));
          const inserted = editor.textContent || '';
          if (inserted.length > 0) {
            return { ok: true, message: 'contenteditable' };
          }
        }
        const textarea = form
          ? form.querySelector('textarea')
          : document.querySelector('textarea');
        if (textarea) {
          textarea.focus();
          const setter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype, 'value'
          )?.set;
          setter?.call(textarea, textToInsert);
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(r => setTimeout(r, 500));
          return { ok: true, message: 'textarea' };
        }
        return { ok: false, message: '未找到发帖输入框' };
      } catch (e) {
        return { ok: false, message: e.toString() };
      }
    })()`);
        // 二次检查 React/Lexical 更新后的按钮状态，不能只认 DOM 中有文字。
        const textState = await page.evaluate(`(async () => {
      await new Promise(r => setTimeout(r, 800));
      const form = document.querySelector('[class*="_postForm_"]') || document;
      const button = Array.from(form.querySelectorAll('button')).find(btn =>
        ['发送', '发布'].includes(btn.textContent?.trim()));
      return { enabled: button?.disabled === false };
    })()`);
        if (!textState.enabled) {
            return [{ status: 'failed', message: '文本注入后发送按钮仍禁用' + imgWarn }];
        }
        if (!textResult.ok) {
            return [{ status: 'failed', message: textResult.message + imgWarn }];
        }
        // 点击前清空捕获记录，只认本次 create 的真实响应，不以点击完成报成功。
        await page.installInterceptor('api.ruguoapp.com/1.0/originalPosts/create');
        await page.getInterceptedRequests();
        const submitResult = await page.evaluate(`(() => {
      const form = document.querySelector('[class*="_postForm_"]') || document;
      const editor = form.querySelector('[contenteditable="true"], textarea');
      const button = Array.from(form.querySelectorAll('button')).find(btn =>
        ['发送', '发布'].includes(btn.textContent?.trim()));
      const length = (editor?.value ?? editor?.textContent ?? '').length;
      if (!length || button?.disabled !== false) {
        return { ok: false, message: '提交前内容或按钮状态异常：编辑器长度=' + length
          + '，按钮禁用=' + (button?.disabled ?? '未找到') + '，网络观察=尚未提交' };
      }
      button.click();
      return { ok: true };
    })()`);
        if (submitResult.ok) {
            submitResult.ok = false;
            let response = null;
            const deadline = Date.now() + 30000;
            try {
                while (Date.now() < deadline) {
                    const responses = await page.getInterceptedRequests();
                    if (responses.length) {
                        response = responses[0];
                        break;
                    }
                    await page.wait(0.5);
                }
                // 服务端明确成功且给出帖子 ID 才算已发；同时核对图片实际入帖。
                if (response?.success === true && response.data?.id) {
                    submitResult.ok = true;
                    submitResult.message = '动态发布成功';
                    if (uploadedCount > 0 && response.data?.pictures?.length !== uploadedCount) {
                        imgWarn = '（图片上传失败：发布响应图片数量不符，预期 '
                            + uploadedCount + '，实际 ' + (response.data?.pictures?.length ?? 0) + '）';
                    }
                } else {
                    submitResult.message = '发布未确认：网络观察=' + JSON.stringify(response ?? '未捕获 create 响应');
                }
            } catch (e) {
                submitResult.message = '发布校验异常：网络观察=' + String(e);
            }
            if (!submitResult.ok) {
                const state = await page.evaluate(`(() => {
          const form = document.querySelector('[class*="_postForm_"]') || document;
          const editor = form.querySelector('[contenteditable="true"], textarea');
          const button = Array.from(form.querySelectorAll('button')).find(btn =>
            ['发送', '发布'].includes(btn.textContent?.trim()));
          return { editorLength: editor ? (editor.value ?? editor.textContent ?? '').length : null,
            disabled: button?.disabled ?? null };
        })()`);
                submitResult.message += '，编辑器长度=' + state.editorLength + '，按钮禁用=' + state.disabled;
            }
        }
        return [{
            status: submitResult.ok ? 'success' : 'failed',
            message: submitResult.message + imgWarn,
        }];
    },
});

/** 等内联发帖框实际渲染，固定延时或 DOM 稳定不代表编辑器已就绪。 */
async function waitForComposer(page, timeoutMs = 30000) {
    const startedAt = Date.now();
    while (true) {
        const state = await page.evaluate(`(() => {
      const form = document.querySelector('[class*="_postForm_"]');
      return {
        ready: !!form?.querySelector('[contenteditable="true"]'),
        url: location.href,
        bodyLength: document.body?.innerHTML.length ?? 0,
      };
    })()`);
        const elapsedMs = Date.now() - startedAt;
        if (state.ready) return { ok: true };
        if (elapsedMs >= timeoutMs) {
            return {
                ok: false,
                message: '等待发帖框就绪超时：URL=' + state.url
                    + '，bodyLength=' + state.bodyLength
                    + '，已等待秒数=' + (elapsedMs / 1000).toFixed(1),
            };
        }
        // 使用普通定时器，避免 page.wait 额外等待 DOM 稳定影响轮询间隔。
        await new Promise(resolve => setTimeout(resolve, Math.min(500, timeoutMs - elapsedMs)));
    }
}

/**
 * 拖放图片后等待七牛返回每张图片的 key，本地 blob 预览不代表上传完成。
 */
async function uploadImages(page, absPaths) {
    try {
        const images = absPaths.map((absPath) => {
            const base64 = fs.readFileSync(absPath).toString('base64');
            const ext = path.extname(absPath).toLowerCase();
            return { name: path.basename(absPath), mimeType: SUPPORTED_EXTENSIONS[ext], base64 };
        });
        // 本机 page.wait 不支持 xhr；内置捕获器在 fetch/XHR 响应正文解析完成后记录 JSON。
        // 拖放前安装并清空旧记录，逐张确认服务端 key，避免漏掉快请求或只等到第一张。
        await page.installInterceptor('upload.qiniup.com');
        await page.getInterceptedRequests();
        const dropped = await page.evaluate(`(() => {
      const root = document.querySelector('[class*="Dropzone-root"]')
        || document.querySelector('[class*="_postForm_"]');
      if (!root) return { ok: false, error: '未找到图片拖放区域' };
      const dt = new DataTransfer();
      for (const img of ${JSON.stringify(images)}) {
        const bytes = Uint8Array.from(atob(img.base64), c => c.charCodeAt(0));
        dt.items.add(new File([bytes], img.name, { type: img.mimeType }));
      }
      for (const type of ['dragenter', 'dragover', 'drop']) {
        root.dispatchEvent(new DragEvent(type, {
          bubbles: true, cancelable: true, dataTransfer: dt,
        }));
      }
      return { ok: true };
    })()`);
        if (!dropped.ok) return dropped;
        const keys = new Set();
        const deadline = Date.now() + 60000;
        while (Date.now() < deadline) {
            for (const response of await page.getInterceptedRequests()) {
                if (response?.error || typeof response?.key !== 'string' || !response.key) {
                    return { ok: false, error: '上传响应失败或缺少 key：' + JSON.stringify(response) };
                }
                keys.add(response.key);
            }
            if (keys.size === images.length) {
                // 让响应后的 React 状态更新完成，再执行文本粘贴；提交时仍会复核图片数。
                await page.wait({ time: 1 });
                return { ok: true, count: images.length };
            }
            await page.wait(0.5);
        }
        return { ok: false, error: '等待上传完成超时：已确认 ' + keys.size + '/' + images.length + ' 张图片的 key' };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
}
