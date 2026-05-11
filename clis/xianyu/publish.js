import * as fs from 'node:fs';
import * as path from 'node:path';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MAX_IMAGES = 9;
const CONDITION_CHOICES = ['全新', '几乎全新', '轻微使用', '明显使用', '老旧'];

function buildPublishUrl() {
    return 'https://www.goofish.com/publish';
}

async function getCurrentPageUrl(page) {
    if (page.getCurrentUrl) {
        try {
            const currentUrl = await page.getCurrentUrl();
            if (currentUrl) return currentUrl;
        } catch {
            // Best-effort URL is only used for operator diagnostics after submit.
        }
    }
    return buildPublishUrl();
}

function requireText(value, label) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (!text) {
        throw new ArgumentError(`xianyu publish ${label} cannot be empty`);
    }
    return text;
}

function parsePositivePrice(value, label) {
    if (value == null || String(value).trim() === '') {
        return null;
    }
    const text = String(value).trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
        throw new ArgumentError(`xianyu publish ${label} must be a positive price with at most 2 decimals`);
    }
    const price = Number(text);
    if (!Number.isFinite(price) || price <= 0) {
        throw new ArgumentError(`xianyu publish ${label} must be a positive price`);
    }
    return text;
}

function validateCondition(value) {
    const condition = requireText(value, 'condition');
    if (!CONDITION_CHOICES.includes(condition)) {
        throw new ArgumentError(`xianyu publish condition must be one of: ${CONDITION_CHOICES.join(', ')}`);
    }
    return condition;
}

function validateImagePaths(raw) {
    if (!raw) return [];
    const paths = String(raw).split(',').map((item) => item.trim()).filter(Boolean);
    if (paths.length === 0) return [];
    if (paths.length > MAX_IMAGES) {
        throw new ArgumentError(`xianyu publish images supports at most ${MAX_IMAGES} files`);
    }
    return paths.map((item) => {
        const absPath = path.resolve(item);
        const ext = path.extname(absPath).toLowerCase();
        if (!SUPPORTED_IMAGE_EXTENSIONS.has(ext)) {
            throw new ArgumentError(`Unsupported image format "${ext}". Supported: jpg, jpeg, png, webp`);
        }
        const stat = fs.statSync(absPath, { throwIfNoEntry: false });
        if (!stat || !stat.isFile()) {
            throw new ArgumentError(`Not a valid image file: ${absPath}`);
        }
        return absPath;
    });
}

function normalizePublishArgs(kwargs) {
    const price = parsePositivePrice(kwargs.price, 'price');
    if (price == null) {
        throw new ArgumentError('xianyu publish price cannot be empty');
    }
    const normalized = {};
    normalized.title = requireText(kwargs.title, 'title');
    normalized.description = requireText(kwargs.description, 'description');
    normalized.price = price;
    normalized.condition = validateCondition(kwargs.condition);
    normalized.category = requireText(kwargs.category, 'category');
    normalized.original_price = parsePositivePrice(kwargs.original_price, 'original_price');
    normalized.location = kwargs.location ? requireText(kwargs.location, 'location') : '';
    normalized.images = validateImagePaths(kwargs.images);
    return normalized;
}

// ===== 表单填充 evaluate scripts =====

function buildFillFormEvaluate(data) {
    return `
    (() => {
      const clean = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();

      const filled = [];
      const missing = [];

      // 1. 填标题
      const titleInput = document.querySelector('input[id*="title"], input[placeholder*="标题"], textarea[id*="title"], [class*="titleInput"]');
      if (titleInput) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
          || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) {
          titleInput.focus();
          setter.call(titleInput, ${JSON.stringify(data.title)});
          titleInput.dispatchEvent(new Event('input', { bubbles: true }));
          titleInput.dispatchEvent(new Event('change', { bubbles: true }));
          filled.push('title');
        }
      }
      if (!filled.includes('title')) missing.push('title');

      // 2. 填描述
      const descInput = document.querySelector('textarea[id*="desc"], textarea[id*="description"], [class*="descInput"], [class*="description"]');
      if (descInput) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) {
          descInput.focus();
          setter.call(descInput, ${JSON.stringify(data.description)});
          descInput.dispatchEvent(new Event('input', { bubbles: true }));
          descInput.dispatchEvent(new Event('change', { bubbles: true }));
          filled.push('description');
        }
      }
      if (!filled.includes('description')) missing.push('description');

      // 3. 填价格
      const priceInput = document.querySelector('input[id*="price"], input[placeholder*="价"], input[class*="price"]');
      if (priceInput) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (setter) {
          priceInput.focus();
          setter.call(priceInput, ${JSON.stringify(String(data.price))});
          priceInput.dispatchEvent(new Event('input', { bubbles: true }));
          priceInput.dispatchEvent(new Event('change', { bubbles: true }));
          filled.push('price');
        }
      }
      if (!filled.includes('price')) missing.push('price');

      // 4. 填原价（可选）
      ${data.original_price ? `
      const originalPriceInput = document.querySelector('input[id*="original"], input[placeholder*="原价"], input[class*="original"]');
      if (originalPriceInput) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (setter) {
          originalPriceInput.focus();
          setter.call(originalPriceInput, ${JSON.stringify(String(data.original_price))});
          originalPriceInput.dispatchEvent(new Event('input', { bubbles: true }));
          originalPriceInput.dispatchEvent(new Event('change', { bubbles: true }));
          filled.push('original_price');
        }
      }
      ` : ''}

      // 5. 填地址（可选）
      ${data.location ? `
      const locationInput = document.querySelector('input[id*="location"], input[placeholder*="地"], input[class*="location"]');
      if (locationInput) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (setter) {
          locationInput.focus();
          setter.call(locationInput, ${JSON.stringify(data.location)});
          locationInput.dispatchEvent(new Event('input', { bubbles: true }));
          locationInput.dispatchEvent(new Event('change', { bubbles: true }));
          filled.push('location');
        }
      }
      ` : ''}

      // 6. 选择成色（点击对应按钮）
      if (${JSON.stringify(data.condition)}) {
        const condition = ${JSON.stringify(data.condition)};
        const conditionMap = {
          '全新': ['全新', '全新未使用', 'new'],
          '几乎全新': ['几乎全新', '几乎全新无瑕疵', 'like-new'],
          '轻微使用': ['轻微使用', '轻微使用痕迹'],
          '明显使用': ['明显使用', '有明显使用痕迹'],
          '老旧': ['老旧', '年代久远', '二手'],
        };
        const keywords = conditionMap[condition] || [condition];
        const allButtons = Array.from(document.querySelectorAll('button, [class*="tag"], [class*="condition"], [class*="level"], [role="button"]'));
        const matchBtn = allButtons.find((el) => {
          const text = clean(el.textContent || '');
          return keywords.some((kw) => text === kw || text.includes(kw));
        });
        if (matchBtn) {
          matchBtn.click();
          filled.push('condition');
        }
      }
      if (!filled.includes('condition')) missing.push('condition');

      return { ok: missing.length === 0, filled, missing };
    })()
  `;
}

function buildSelectCategoryEvaluate(categoryName) {
    return `
    (async () => {
      const clean = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();

      // 点击分类选择器
      const categoryTrigger = Array.from(document.querySelectorAll('button, [class*="trigger"], [class*="selector"], [role="button"]'))
        .find((el) => /分类|category|类目/.test(el.textContent || ''))
        || document.querySelector('[class*="category"], [class*="categorySelector"]');

      if (categoryTrigger) {
        categoryTrigger.click();
      } else {
        return { ok: false, reason: 'category-trigger-not-found' };
      }

      // 等待分类弹窗/面板出现
      const waitFor = async (predicate, timeoutMs = 5000) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (predicate()) return true;
          await new Promise((r) => setTimeout(r, 200));
        }
        return false;
      };

      // 在分类弹窗中搜索并点击
      const searchKeyword = ${JSON.stringify(categoryName)};
      const hasMatch = await waitFor(() => {
        const allNodes = Array.from(document.querySelectorAll('button, [class*="item"], [class*="node"], [role="option"]'));
        return allNodes.some((el) => clean(el.textContent || '').includes(searchKeyword));
      }, 5000);

      if (!hasMatch) {
        return { ok: false, reason: 'category-not-found' };
      }

      const allNodes = Array.from(document.querySelectorAll('button, [class*="item"], [class*="node"], [role="option"]'));
      const matchNode = allNodes.find((el) => clean(el.textContent || '').includes(searchKeyword));
      if (matchNode) {
        matchNode.click();
        return { ok: true };
      }
      return { ok: false, reason: 'category-match-failed' };
    })()
  `;
}

function buildFindFileInputSelectorEvaluate() {
    return `
    (() => {
      // 找图片上传相关的 file input
      const fileInput = document.querySelector('input[type="file"]');
      if (!fileInput) return { ok: false, reason: 'no-file-input' };

      // 获取 selector 来唯一标识这个 input
      const escapeAttr = (value) => String(value).replace(/["\\\\]/g, '\\\\$&');
      const selector = fileInput.id ? '[id="' + escapeAttr(fileInput.id) + '"]'
        : fileInput.name ? '[name="' + fileInput.name + '"]'
        : fileInput.className ? 'input.' + fileInput.className.split(' ').join('.')
        : 'input[type="file"]';

      return { ok: true, selector, hasMultiple: fileInput.multiple };
    })()
  `;
}

function buildSubmitEvaluate() {
    return `
    (() => {
      const clean = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();

      // 找发布按钮
      const submitBtn = Array.from(document.querySelectorAll('button'))
        .find((btn) => {
          const text = clean(btn.textContent || '');
          return /发布|提交|上架|确认/.test(text) && !/取消/.test(text);
        })
        || document.querySelector('[class*="publish"], [class*="submit"], [class*="confirm"]');

      if (!submitBtn || submitBtn.disabled) {
        return { ok: false, reason: 'submit-button-not-found-or-disabled' };
      }

      submitBtn.click();
      return { ok: true };
    })()
  `;
}

function buildDetectSuccessEvaluate() {
    return `
    (() => {
      const clean = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const bodyText = document.body?.innerText || '';
      const url = window.location.href || '';

      // 成功标志：URL 变为商品详情页
      if (/item\\?id=\\d+/.test(url)) {
        const match = url.match(/item\\?id=(\\d+)/);
        return { status: 'published', item_id: match ? match[1] : '', url, message: '发布成功' };
      }

      // 成功标志：页面出现"发布成功"
      if (/发布成功|上架成功|发布完成/.test(bodyText)) {
        const idMatch = url.match(/item\\?id=(\\d+)/) || bodyText.match(/id[：:]?\\s*(\\d{10,})/);
        return { status: 'published', item_id: idMatch ? (idMatch[1] || idMatch[0]) : '', url, message: '发布成功' };
      }

      // 失败标志
      const errMatch = Array.from(document.querySelectorAll('[class*="error"], [class*="fail"]'))
        .map((el) => clean(el.textContent || ''))
        .filter(Boolean);
      if (errMatch.length || /发布失败|上架失败|异常|错误|违规/.test(bodyText)) {
        return { status: 'failed', message: errMatch.join(' | ') || 'publish-failed' };
      }

      return { ok: false, reason: 'unknown-state' };
    })()
  `;
}

function buildExtractPageStateEvaluate() {
    return `
    (() => {
      const clean = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const bodyText = document.body?.innerText || '';
      const url = window.location.href || '';

      const requiresAuth = /请先登录|登录后/.test(bodyText);
      const hasPublishForm = /发布闲置|发布宝贝|闲置描述|标题|价格|成色|分类/.test(bodyText);
      const hasCategorySelect = /选择分类|选择类目|分类选择/.test(bodyText);
      const hasImageUpload = /上传图片|添加图片|photo|图片/.test(bodyText);

      // 找各字段
      const titleInput = !!document.querySelector('input[id*="title"], input[placeholder*="标题"], textarea[id*="title"]');
      const descInput = !!document.querySelector('textarea[id*="desc"], textarea[id*="description"]');
      const priceInput = !!document.querySelector('input[id*="price"], input[placeholder*="价"]');
      const conditionSelect = !!document.querySelector('[class*="condition"], [class*="level"], button[class*="tag"]');
      const submitBtn = Array.from(document.querySelectorAll('button'))
        .find((btn) => /发布|提交|上架/.test(clean(btn.textContent || '')));

      return {
        requiresAuth,
        hasPublishForm,
        hasCategorySelect,
        hasImageUpload,
        titleInput,
        descInput,
        priceInput,
        conditionSelect,
        submitBtn: !!submitBtn,
        pageUrl: url,
        bodySnippet: bodyText.slice(0, 500),
      };
    })()
    `;
}

// ===== CLI definition =====

export const publishCommand = cli({
    site: 'xianyu',
    name: 'publish',
    access: 'write',
    description: '发布闲鱼宝贝（需先在浏览器中登录闲鱼）',
    domain: 'www.goofish.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    browser: true,
    args: [
        { name: 'title', required: true, positional: true, help: '商品标题' },
        { name: 'description', required: true, positional: true, help: '商品描述/详情' },
        { name: 'price', required: true, positional: true, type: 'float', help: '出售价格（元）' },
        { name: 'condition', required: true, positional: true, help: '成色：全新 / 几乎全新 / 轻微使用 / 明显使用 / 老旧' },
        { name: 'category', required: true, positional: true, help: '商品分类关键词（如：手机、衣服、图书）' },
        { name: 'original_price', type: 'float', help: '原价（选填，用于显示折扣）' },
        { name: 'location', help: '所在地区（选填，如：杭州）' },
        { name: 'images', help: '本地图片路径，多张用逗号分隔（选填，如：/tmp/a.jpg,/tmp/b.jpg）' },
    ],
    columns: ['status', 'item_id', 'title', 'price', 'condition', 'url', 'message'],
    func: async (page, kwargs) => {
        const data = normalizePublishArgs(kwargs);
        // 1. 导航到发布页
        await page.goto(buildPublishUrl());
        await page.wait(3);

        // 2. 检查登录状态
        const initState = await page.evaluate(buildExtractPageStateEvaluate());
        if (initState?.requiresAuth) {
            throw new AuthRequiredError('www.goofish.com', '发布闲鱼需要先登录，请在 Chrome 中打开 goofish.com 并完成登录');
        }
        if (!initState?.hasPublishForm) {
            throw new CommandExecutionError('Xianyu publish form was not detected', 'Confirm goofish.com is logged in and the publish page finished loading.');
        }

        // 3. 选择分类（先于其他字段，因为分类可能影响表单结构）
        const categoryResult = await page.evaluate(buildSelectCategoryEvaluate(data.category));
        if (!categoryResult?.ok) {
            throw new CommandExecutionError(`Xianyu category selection failed: ${categoryResult?.reason || 'unknown-reason'}`);
        }
        await page.wait(1.5);

        // 4. 填充表单
        const fillResult = await page.evaluate(buildFillFormEvaluate(data));
        if (!fillResult?.ok) {
            const missing = Array.isArray(fillResult?.missing) ? fillResult.missing.join(', ') : 'unknown';
            throw new CommandExecutionError(`Xianyu publish form fill failed; missing fields: ${missing}`);
        }
        await page.wait(1);

        // 5. 上传图片（如果有）
        if (data.images.length > 0) {
            if (!page.setFileInput) {
                throw new CommandExecutionError('Xianyu publish requires Browser Bridge file upload support', 'Use a browser mode that supports setFileInput.');
            }
            const fileInput = await page.evaluate(buildFindFileInputSelectorEvaluate());
            if (!fileInput?.ok) {
                throw new CommandExecutionError(`Xianyu image upload input was not found: ${fileInput?.reason || 'unknown-reason'}`);
            }
            try {
                await page.setFileInput(data.images, fileInput.selector || 'input[type="file"]');
                await page.wait(3); // 等待图片上传处理
            } catch (err) {
                throw new CommandExecutionError(`Xianyu image upload failed: ${err?.message || err}`);
            }
        }

        // 6. 点击发布按钮
        const submitResult = await page.evaluate(buildSubmitEvaluate());
        if (!submitResult?.ok) {
            throw new CommandExecutionError(`Xianyu publish submit failed: ${submitResult?.reason || 'unknown-reason'}`);
        }

        // 7. 等待发布结果（最多 15 秒轮询）
        await page.wait(2);
        let itemId = '';
        let finalUrl = await getCurrentPageUrl(page);
        let failReason = '';

        for (let i = 0; i < 10; i++) {
            await page.wait(1.5);
            const result = await page.evaluate(buildDetectSuccessEvaluate());
            finalUrl = await getCurrentPageUrl(page);

            if (result?.status === 'published') {
                itemId = String(result.item_id || '').replace(/\D/g, '');
                return [{
                    status: 'published',
                    item_id: itemId,
                    title: data.title.slice(0, 50),
                    price: `¥${data.price}`,
                    condition: data.condition,
                    url: result.url || finalUrl,
                    message: '发布成功',
                }];
            }

            if (result?.status === 'failed') {
                failReason = result.message || '发布失败';
                break;
            }
        }

        throw new CommandExecutionError(failReason || 'Xianyu publish result was not confirmed before timeout', `Open ${finalUrl} and verify whether the listing was published.`);
    },
});

export const __test__ = {
    CONDITION_CHOICES,
    MAX_IMAGES,
    validateImagePaths,
    normalizePublishArgs,
    buildPublishUrl,
    getCurrentPageUrl,
    buildFillFormEvaluate,
    buildSelectCategoryEvaluate,
    buildFindFileInputSelectorEvaluate,
    buildDetectSuccessEvaluate,
};
