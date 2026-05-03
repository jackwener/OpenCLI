import { AuthRequiredError, selectorError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { normalizeNumericId } from './utils.js';

function buildPublishUrl() {
    return 'https://www.goofish.com/publish';
}

// ===== 表单填充 evaluate scripts =====

function buildFillFormEvaluate(data) {
    return `
    (() => {
      const clean = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();

      const waitFor = async (predicate, timeoutMs = 10000) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (predicate()) return true;
          await new Promise((r) => setTimeout(r, 200));
        }
        return false;
      };

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
        }
      }

      // 2. 填描述
      const descInput = document.querySelector('textarea[id*="desc"], textarea[id*="description"], [class*="descInput"], [class*="description"]');
      if (descInput) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) {
          descInput.focus();
          setter.call(descInput, ${JSON.stringify(data.description)});
          descInput.dispatchEvent(new Event('input', { bubbles: true }));
          descInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      // 3. 填价格
      const priceInput = document.querySelector('input[id*="price"], input[placeholder*="价"], input[class*="price"]');
      if (priceInput) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (setter) {
          priceInput.focus();
          setter.call(priceInput, ${JSON.stringify(String(data.price))});
          priceInput.dispatchEvent(new Event('input', { bubbles: true }));
          priceInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

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
        }
      }

      return { ok: true, filled: ['title', 'description', 'price', 'original_price', 'location', 'condition'] };
    })()
  `;
}

function buildSelectCategoryEvaluate(categoryName) {
    return `
    (() => {
      const clean = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();

      // 点击分类选择器
      const categoryTrigger = Array.from(document.querySelectorAll('button, [class*="trigger"], [class*="selector"], [role="button"]'))
        .find((el) => /分类|category|类目/.test(el.textContent || ''))
        || document.querySelector('[class*="category"], [class*="categorySelector"]');

      if (categoryTrigger) {
        categoryTrigger.click();
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
      const selector = fileInput.id ? '#' + fileInput.id
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
        return { ok: true, success: true, item_id: match ? match[1] : '', url };
      }

      // 成功标志：页面出现"发布成功"
      if (/发布成功|上架成功|发布完成/.test(bodyText)) {
        const idMatch = url.match(/item\\?id=(\\d+)/) || bodyText.match(/id[：:]?\\s*(\\d{10,})/);
        return { ok: true, success: true, item_id: idMatch ? (idMatch[1] || idMatch[0]) : '', url };
      }

      // 失败标志
      if (/发布失败|上架失败|异常|错误/.test(bodyText)) {
        const errMatch = Array.from(document.querySelectorAll('[class*="error"], [class*="fail"]'))
          .map((el) => clean(el.textContent || ''))
          .filter(Boolean);
        return { ok: true, success: false, reason: errMatch.join(' | ') || 'publish-failed' };
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
        url,
        bodySnippet: bodyText.slice(0, 500),
      };
    })()
  `;
}

// ===== CLI definition =====

cli({
    site: 'xianyu',
    name: 'publish',
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
        // 1. 导航到发布页
        await page.goto(buildPublishUrl());
        await page.wait(3);

        // 2. 检查登录状态
        const initState = await page.evaluate(buildExtractPageStateEvaluate());
        if (initState?.requiresAuth) {
            throw new AuthRequiredError('www.goofish.com', '发布闲鱼需要先登录，请在 Chrome 中打开 goofish.com 并完成登录');
        }
        if (!initState?.hasPublishForm) {
            throw new selectorError('闲鱼发布表单', '未检测到发布表单，请确认已登录且页面正常加载');
        }

        // 3. 选择分类（先于其他字段，因为分类可能影响表单结构）
        await page.evaluate(buildSelectCategoryEvaluate(kwargs.category));
        await page.wait(1.5);

        // 4. 填充表单
        const fillData = {
            title: kwargs.title,
            description: kwargs.description,
            price: kwargs.price,
            condition: kwargs.condition,
            original_price: kwargs.original_price,
            location: kwargs.location,
        };
        await page.evaluate(buildFillFormEvaluate(fillData));
        await page.wait(1);

        // 5. 上传图片（如果有）
        const images = kwargs.images;
        if (images) {
            const paths = String(images).split(',').map((p) => p.trim()).filter(Boolean);
            if (paths.length > 0) {
                // 通过 CDP setFileInput 上传（支持本地路径）
                try {
                    await page.setFileInput(paths, 'input[type="file"]');
                    await page.wait(3); // 等待图片上传处理
                } catch (err) {
                    throw selectorError('图片上传', `图片上传失败：${err?.message || err}。请确保图片路径存在且可读。`);
                }
            }
        }

        // 6. 点击发布按钮
        const submitResult = await page.evaluate(buildSubmitEvaluate());
        if (!submitResult?.ok) {
            throw selectorError('发布按钮', `未能点击发布按钮：${submitResult?.reason || 'unknown'}`);
        }

        // 7. 等待发布结果（最多 15 秒轮询）
        await page.wait(2);
        let success = false;
        let itemId = '';
        let finalUrl = page.url();
        let message = '';
        let failReason = '';

        for (let i = 0; i < 10; i++) {
            await page.wait(1.5);
            const result = await page.evaluate(buildDetectSuccessEvaluate());
            finalUrl = page.url();

            if (result?.success) {
                success = true;
                itemId = String(result.item_id || '').replace(/\D/g, '');
                message = '发布成功';
                break;
            }

            if (result && typeof result.success === 'boolean' && !result.success) {
                success = false;
                failReason = result.reason || '发布失败';
                break;
            }
        }

        if (success) {
            return [{
                status: 'published',
                item_id: itemId,
                title: String(kwargs.title).slice(0, 50),
                price: `¥${kwargs.price}`,
                condition: kwargs.condition,
                url: finalUrl,
                message: '发布成功',
            }];
        } else {
            return [{
                status: 'failed',
                item_id: '',
                title: String(kwargs.title).slice(0, 50),
                price: `¥${kwargs.price}`,
                condition: kwargs.condition,
                url: finalUrl,
                message: failReason || '发布未成功，请手动检查页面状态',
            }];
        }
    },
});

export const __test__ = {
    normalizeNumericId,
    buildPublishUrl,
};