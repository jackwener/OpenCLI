/**
 * Douyin draft — upload through the official creator page and save as draft.
 *
 * The previous API pipeline relied on an old pre-upload endpoint that no longer
 * matches creator center's live upload flow. This command now drives the
 * official upload page directly so it stays aligned with the site.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import type { IPage } from '@jackwener/opencli/types';

const VISIBILITY_LABELS: Record<string, string> = {
  public: '公开',
  friends: '好友可见',
  private: '仅自己可见',
};

const DRAFT_UPLOAD_URL = 'https://creator.douyin.com/creator-micro/content/upload';
const COMPOSER_WAIT_ATTEMPTS = 120;
const COVER_INPUT_WAIT_ATTEMPTS = 20;
const COVER_READY_WAIT_ATTEMPTS = 20;

interface DraftComposerState {
  href: string;
  ready: boolean;
  bodyText: string;
}

interface DraftSaveResult {
  text: string;
  creationId: string;
}

interface DraftResumeState {
  href: string;
  bodyText: string;
}

/**
 * Best-effort dismissal for coach marks and upload tips that can block clicks.
 */
async function dismissKnownModals(page: IPage): Promise<void> {
  await page.evaluate(`() => {
    const targets = ['我知道了', '知道了', '关闭'];
    for (const text of targets) {
      const btn = Array.from(document.querySelectorAll('button,[role="button"]'))
        .find((el) => (el.textContent || '').trim() === text);
      if (btn instanceof HTMLElement) btn.click();
    }
  }`);
}

/**
 * Wait until Douyin finishes uploading and lands on the post-video composer.
 */
async function waitForDraftComposer(page: IPage): Promise<void> {
  let lastState: DraftComposerState = {
    href: '',
    ready: false,
    bodyText: '',
  };

  for (let attempt = 0; attempt < COMPOSER_WAIT_ATTEMPTS; attempt += 1) {
    lastState = (await page.evaluate(`() => ({
      href: location.href,
      ready: !!Array.from(document.querySelectorAll('input')).find(
        (el) => (el.placeholder || '').includes('填写作品标题')
      ) && !!Array.from(document.querySelectorAll('button')).find(
        (el) => (el.textContent || '').includes('暂存离开')
      ),
      bodyText: document.body?.innerText || ''
    })`)) as DraftComposerState;
    if (lastState.ready) return;
    await page.wait({ time: 0.5 });
  }

  throw new CommandExecutionError(
    '等待抖音草稿编辑页超时',
    `当前页面: ${lastState.href || 'unknown'}`,
  );
}

/**
 * Fill title, caption and visibility controls on the live composer page.
 */
async function fillDraftComposer(
  page: IPage,
  options: { title: string; caption: string; visibilityLabel: string },
): Promise<void> {
  const titleOk = (await page.evaluate(`() => {
    const titleInput = Array.from(document.querySelectorAll('input')).find(
      (el) => (el.placeholder || '').includes('填写作品标题')
    );
    if (!(titleInput instanceof HTMLInputElement)) return false;
    const propKey = Object.keys(titleInput).find((key) => key.startsWith('__reactProps$'));
    const props = propKey ? titleInput[propKey] : null;
    if (props?.onChange) {
      props.onChange({
        target: { value: ${JSON.stringify(options.title)} },
        currentTarget: { value: ${JSON.stringify(options.title)} },
      });
    } else {
      titleInput.focus();
      titleInput.value = ${JSON.stringify(options.title)};
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));
      titleInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (props?.onBlur) {
      props.onBlur({
        target: titleInput,
        currentTarget: titleInput,
        relatedTarget: null,
      });
    } else {
      titleInput.dispatchEvent(new Event('blur', { bubbles: true }));
    }
    return true;
  }`)) as boolean;
  if (!titleOk) {
    throw new CommandExecutionError(
      '填写抖音草稿表单失败: title-input-missing',
    );
  }

  if (options.caption) {
    const captionOk = (await page.evaluate(`() => {
      const editor = document.querySelector('[contenteditable="true"]');
      if (!(editor instanceof HTMLElement)) return false;
      editor.focus();
      editor.textContent = '';
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, ${JSON.stringify(options.caption)});
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }`)) as boolean;
    if (!captionOk) {
      throw new CommandExecutionError(
        '填写抖音草稿表单失败: caption-editor-missing',
      );
    }
  }

  const visibilityOk = (await page.evaluate(`() => {
    const visibility = Array.from(document.querySelectorAll('label')).find(
      (el) => (el.textContent || '').includes(${JSON.stringify(options.visibilityLabel)})
    );
    if (!(visibility instanceof HTMLElement)) return false;
    visibility.click();
    return true;
  }`)) as boolean;
  if (!visibilityOk) {
    throw new CommandExecutionError(
      '填写抖音草稿表单失败: visibility-missing',
    );
  }
}

/**
 * Switch the composer into custom-cover mode and expose the cover input with a
 * stable selector for CDP file injection.
 */
async function prepareCustomCoverInput(page: IPage): Promise<string> {
  let lastReason = 'cover-input-missing';
  const baselineCount = (await page.evaluate(
    `() => Array.from(document.querySelectorAll('input[type="file"]')).length`,
  )) as number;

  for (let attempt = 0; attempt < COVER_INPUT_WAIT_ATTEMPTS; attempt += 1) {
    const result = (await page.evaluate(`() => {
      const coverLabel = Array.from(document.querySelectorAll('label')).find(
        (el) => (el.textContent || '').includes('上传新封面')
      );
      if (coverLabel instanceof HTMLElement) {
        coverLabel.click();
      }

      const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
      const target = inputs
        .slice(${JSON.stringify(baselineCount)})
        .find((el) => el instanceof HTMLInputElement && !el.disabled);
      if (!(target instanceof HTMLInputElement)) {
        return { ok: false, reason: 'cover-input-pending' };
      }

      document
        .querySelectorAll('[data-opencli-cover-input="1"]')
        .forEach((el) => el.removeAttribute('data-opencli-cover-input'));
      target.setAttribute('data-opencli-cover-input', '1');
      return { ok: true, selector: '[data-opencli-cover-input="1"]' };
    }`)) as { ok?: boolean; reason?: string; selector?: string };

    if (result?.ok && result.selector) {
      return result.selector;
    }

    lastReason = result?.reason || lastReason;
    await page.wait({ time: 0.5 });
  }

  throw new CommandExecutionError(
    `准备抖音自定义封面输入框失败: ${lastReason}`,
  );
}

/**
 * Read the local quick-check panel text that reflects cover validation state.
 */
export function buildCoverCheckPanelTextJs(): string {
  return `() => {
    const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    const stateTexts = ['检测', '检测中', '封面检测中', '重新检测', '横/竖双封面缺失'];
    const marker = Array.from(document.querySelectorAll('div,span,p,button')).find(
      (el) => normalize(el.textContent) === '快速检测'
    );
    let root = marker?.parentElement || null;
    while (root && root !== document.body) {
      const descendants = Array.from(root.querySelectorAll('div,span,p,button'))
        .map((el) => normalize(el.textContent));
      const hasMarkerText = descendants.includes('快速检测');
      const hasStateText = descendants.some((text) => stateTexts.includes(text));
      if (hasMarkerText && hasStateText) {
        return normalize(root.textContent).slice(0, 400);
      }
      root = root.parentElement;
    }
    return '';
  }`;
}

async function getCoverCheckPanelText(page: IPage): Promise<string> {
  return ((await page.evaluate(buildCoverCheckPanelTextJs())) as string) || '';
}

/**
 * Wait for Douyin's cover-detection pipeline to expose a post-upload signal.
 * In the live creator page, custom cover upload first shows `封面检测中`, then
 * lands on a ready state such as `重新检测` or the warning copy for missing
 * horizontal/vertical covers.
 */
async function waitForCoverReady(
  page: IPage,
): Promise<void> {
  let lastPanelText = '';
  let sawBusy = false;

  for (let attempt = 0; attempt < COVER_READY_WAIT_ATTEMPTS; attempt += 1) {
    const panelText = await getCoverCheckPanelText(page);
    const busy = panelText.includes('检测中');
    const ready = (
      panelText.includes('重新检测')
      || panelText.includes('横/竖双封面缺失')
    );

    if (busy) {
      sawBusy = true;
    }
    if (sawBusy && ready && !busy) {
      return;
    }

    lastPanelText = panelText;
    await page.wait({ time: 0.5 });
  }

  throw new CommandExecutionError(
    '等待抖音封面处理完成超时',
    lastPanelText || 'unknown',
  );
}

/**
 * Click the draft button on the composer page and extract the current creation id.
 */
async function clickSaveDraft(page: IPage): Promise<DraftSaveResult> {
  const result = (await page.evaluate(`() => {
    const extractCreationId = () => {
      const titleInput = Array.from(document.querySelectorAll('input')).find(
        (el) => (el.placeholder || '').includes('填写作品标题')
      );
      if (!(titleInput instanceof HTMLInputElement)) return '';

      const fiberKey = Object.keys(titleInput).find((key) => key.startsWith('__reactFiber$'));
      let fiber = fiberKey ? titleInput[fiberKey] : null;
      while (fiber) {
        const props = fiber.memoizedProps;
        if (typeof props?.creation_id === 'string' && props.creation_id) {
          return props.creation_id;
        }
        fiber = fiber.return;
      }
      return '';
    };

    const btn = Array.from(document.querySelectorAll('button')).find(
      (el) => (el.textContent || '').includes('暂存离开')
    );
    if (!(btn instanceof HTMLButtonElement)) {
      return { ok: false, reason: 'draft-button-missing' };
    }
    const creationId = extractCreationId();
    const propKey = Object.keys(btn).find((key) => key.startsWith('__reactProps$'));
    const props = propKey ? btn[propKey] : null;
    if (props?.onClick) {
      props.onClick({
        preventDefault() {},
        stopPropagation() {},
        nativeEvent: null,
        target: btn,
        currentTarget: btn,
      });
    } else {
      btn.click();
    }
    return {
      ok: true,
      text: (btn.textContent || '').trim(),
      creationId,
    };
  }`)) as { ok?: boolean; reason?: string; text?: string; creationId?: string };

  if (!result?.ok) {
    throw new CommandExecutionError(
      `点击草稿按钮失败: ${result?.reason || 'unknown'}`,
    );
  }
  if (!result.creationId) {
    throw new CommandExecutionError(
      '点击草稿按钮失败: creation-id-missing',
    );
  }

  return {
    text: result.text || '暂存离开',
    creationId: result.creationId,
  };
}

/**
 * Wait until creator center shows the resumable-draft prompt after saving.
 */
async function waitForDraftResult(
  page: IPage,
  creationId: string,
): Promise<string> {
  let lastState: DraftResumeState = { href: '', bodyText: '' };
  for (let attempt = 0; attempt < 20; attempt += 1) {
    lastState = (await page.evaluate(`() => ({
      href: location.href,
      bodyText: document.body?.innerText || ''
    })`)) as { href: string; bodyText: string };

    if (
      lastState.href.includes('/creator-micro/content/upload')
      && /继续编辑/.test(lastState.bodyText)
    ) {
      return creationId;
    }

    await page.wait({ time: 1 });
  }

  throw new CommandExecutionError(
    '未检测到抖音草稿恢复提示',
    `当前页面: ${lastState.href || 'unknown'}`,
  );
}

cli({
  site: 'douyin',
  name: 'draft',
  description: '上传视频并保存为草稿',
  domain: 'creator.douyin.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    { name: 'video', required: true, positional: true, help: '视频文件路径' },
    { name: 'title', required: true, help: '视频标题（≤30字）' },
    { name: 'caption', default: '', help: '正文内容（≤1000字，支持 #话题）' },
    { name: 'cover', default: '', help: '封面图片路径' },
    { name: 'visibility', default: 'public', choices: ['public', 'friends', 'private'] },
  ],
  columns: ['status', 'draft_id'],
  func: async (page: IPage, kwargs) => {
    const videoPath = path.resolve(kwargs.video as string);
    if (!fs.existsSync(videoPath)) {
      throw new ArgumentError(`视频文件不存在: ${videoPath}`);
    }
    const ext = path.extname(videoPath).toLowerCase();
    if (!['.mp4', '.mov', '.avi', '.webm'].includes(ext)) {
      throw new ArgumentError(`不支持的视频格式: ${ext}（支持 mp4/mov/avi/webm）`);
    }

    const title = kwargs.title as string;
    if (title.length > 30) {
      throw new ArgumentError('标题不能超过 30 字');
    }

    const caption = (kwargs.caption as string) || '';
    if (caption.length > 1000) {
      throw new ArgumentError('正文不能超过 1000 字');
    }

    const coverPath = kwargs.cover as string;
    if (coverPath) {
      if (!fs.existsSync(path.resolve(coverPath))) {
        throw new ArgumentError(`封面文件不存在: ${path.resolve(coverPath)}`);
      }
    }

    if (!page.setFileInput) {
      throw new CommandExecutionError(
        '当前浏览器适配器不支持文件注入',
        '请使用 Browser Bridge 或支持 setFileInput 的浏览器模式',
      );
    }

    const visibilityLabel = VISIBILITY_LABELS[kwargs.visibility as string] ?? VISIBILITY_LABELS.public;

    await page.goto(DRAFT_UPLOAD_URL);
    await page.wait({ selector: 'input[type="file"]', timeout: 20 });
    await dismissKnownModals(page);
    await page.setFileInput([videoPath], 'input[type="file"]');
    await waitForDraftComposer(page);
    await dismissKnownModals(page);
    if (coverPath) {
      const coverSelector = await prepareCustomCoverInput(page);
      await page.setFileInput([path.resolve(coverPath)], coverSelector);
      await waitForCoverReady(page);
    }
    await fillDraftComposer(page, { title, caption, visibilityLabel });
    await page.wait({ time: 1 });
    const saveResult = await clickSaveDraft(page);

    const draftId = await waitForDraftResult(page, saveResult.creationId);

    return [
      {
        status: '✅ 草稿已保存，可在创作中心继续编辑',
        draft_id: draftId,
      },
    ];
  },
});
