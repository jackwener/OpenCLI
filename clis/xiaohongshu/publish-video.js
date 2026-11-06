/**
 * Xiaohongshu 视频笔记 publisher — creator center UI automation.
 *
 * Topics are only accepted when the resulting topic chip text equals the
 * requested name; wrong auto-suggestions are removed and retried with
 * ArrowDown, and a topic that never matches aborts the publish instead of
 * silently attaching a different one. Shared field filling, upload, submit
 * and verification live in publish-helpers.js.
 *
 * Usage:
 *   opencli xiaohongshu publish-video --title "标题(20字内)" "正文内容" \
 *     --video /path/to/video.mp4 \
 *     [--cover /path/to/cover-3x4.png] \
 *     [--topics 中式梦核,梦核,怀旧] \
 *     [--draft]
 */

import * as path from 'node:path';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    BODY_SELECTORS,
    TITLE_SELECTORS,
    clickByText,
    fillField,
    invokePublishAction,
    unwrapBrowserResult,
    uploadFiles,
    validateMediaFile,
    waitForVideoReady,
    verifyPublishSuccess,
} from './publish-helpers.js';

const PUBLISH_VIDEO_URL = 'https://creator.xiaohongshu.com/publish/publish?from=menu_left&target=video';
const MAX_TITLE_LEN = 20;
const VIDEO_MAX_BYTES = 300 * 1024 * 1024;
const COVER_MAX_BYTES = 20 * 1024 * 1024;
const VIDEO_ACCEPTED_MIMES = ['video/mp4', 'video/quicktime'];
const COVER_ACCEPTED_MIMES = ['image/jpeg', 'image/png'];

/** Discover the video-accepting file input on the publish page. */
async function videoInputSelector(page) {
    return unwrapBrowserResult(await page.evaluate(`
      (() => {
        const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
        const byAccept = inputs.find((inp) => {
          const acc = (inp.getAttribute('accept') || '').toLowerCase();
          return acc.includes('video') || acc.includes('.mp4') || acc.includes('.mov');
        });
        if (byAccept) {
          byAccept.setAttribute('data-opencli-video-input', '1');
          return 'input[data-opencli-video-input="1"]';
        }
        return inputs.length ? 'input[type="file"]' : null;
      })()
    `));
}

/**
 * Upload a custom cover image. Every stage is a postcondition: a requested
 * cover that cannot be applied aborts the publish instead of degrading to the
 * auto-generated frame.
 */
async function uploadCustomCover(page, coverPath) {
    const opened = (await clickByText(page, '编辑封面', 3_000)).ok
        || (await clickByText(page, '设置封面', 3_000)).ok
        || (await clickByText(page, '修改封面', 3_000)).ok;
    if (!opened) throw new CommandExecutionError('Cover editor could not be opened (编辑封面 not found).');
    await page.wait({ time: 1.5 });

    const uploadClicked = (await clickByText(page, '上传封面', 3_000)).ok
        || (await clickByText(page, '本地上传', 3_000)).ok
        || (await clickByText(page, '上传图片', 3_000)).ok;
    if (!uploadClicked) throw new CommandExecutionError('Cover upload entry (上传封面) not found.');
    await page.wait({ time: 2 });

    const imgSel = unwrapBrowserResult(await page.evaluate(`
      (() => {
        const explicit = document.querySelector('input[aria-label="上传封面图片"]');
        if (explicit) {
          explicit.setAttribute('data-opencli-cover', '1');
          return 'input[data-opencli-cover="1"]';
        }
        const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
        // Only an input that explicitly accepts images (or is labeled for the
        // cover) qualifies; a generic fallback could target the video input.
        const target = inputs.find((el) => {
          const accept = String(el.getAttribute('accept') || '').toLowerCase();
          const aria = String(el.getAttribute('aria-label') || '');
          return /image|\\.png|\\.jpg|\\.jpeg/.test(accept) || /封面/.test(aria);
        });
        if (!target) return null;
        target.setAttribute('data-opencli-cover', '1');
        return 'input[data-opencli-cover="1"]';
      })()
    `));
    if (!imgSel) throw new CommandExecutionError('Cover file input not found.');

    const uploaded = await uploadFiles(page, [coverPath], imgSel);
    if (!uploaded?.ok) {
        throw new CommandExecutionError(`Cover upload failed: ${uploaded?.error || 'unknown'}.`);
    }
    await page.wait({ time: 4 });

    const confirmed = (await clickByText(page, '完成', 4_000)).ok
        || (await clickByText(page, '确定', 2_000)).ok
        || (await clickByText(page, '确认', 2_000)).ok;
    if (!confirmed) throw new CommandExecutionError('Cover could not be confirmed (完成 not found).');
    await page.wait({ time: 1.5 });

    // The confirm click proves nothing by itself: after confirming a cover
    // dialog, no modal may remain open on the editor page. Matching by
    // dialog text is not enough (wording varies), so any visible dialog
    // fails the cover application.
    const dialogClosed = unwrapBrowserResult(await page.evaluate(`
      (() => {
        const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const overlay = [...document.querySelectorAll('[role="dialog"], [class*="dialog"], [class*="modal"], [class*="overlay"]')]
          .filter(visible)
          .find((el) => el.innerText && el.innerText.trim().length > 0);
        return !overlay;
      })()
    `));
    if (!dialogClosed) {
        throw new CommandExecutionError('Cover dialog stayed open after confirming; the custom cover was not applied.');
    }
}

function normalizeTopicName(raw) {
    return String(raw || '')
        .replace(/^#/, '')
        .replace(/\[话题\]#?/g, '')
        .replace(/\s+/g, '')
        .trim();
}

async function readTopicNames(page) {
    const names = unwrapBrowserResult(await page.evaluate(`
      (selectors => {
        const editor = selectors
          .map(sel => Array.from(document.querySelectorAll(sel)))
          .flat()
          .find(node => node && node.offsetParent !== null && node.isContentEditable);
        if (!editor) return [];
        const chips = Array.from(editor.querySelectorAll('.tiptap-topic, a[data-topic]'))
          .map(el => el.textContent || '');
        const text = editor.innerText || editor.textContent || '';
        // Text-form topics render as "#<name>[话题]"; match on the whole text
        // (splitting on '#' first would eat the marker's trailing '#').
        const markers = [];
        const pattern = /#([^#\s[\]]+)\[话题\]/g;
        let match;
        while ((match = pattern.exec(text)) !== null) markers.push(match[1].trim());
        return chips.concat(markers);
      })(${JSON.stringify(BODY_SELECTORS)})
    `));
    return Array.isArray(names) ? names.map(normalizeTopicName).filter(Boolean) : [];
}

async function deleteLastTopic(page) {
    return unwrapBrowserResult(await page.evaluate(`
      (selectors => {
        const editor = selectors
          .map(sel => Array.from(document.querySelectorAll(sel)))
          .flat()
          .find(node => node && node.offsetParent !== null && node.isContentEditable);
        if (!editor) return false;
        const nodes = editor.querySelectorAll('.tiptap-topic, a[data-topic]');
        const el = nodes[nodes.length - 1];
        if (!el) return false;
        editor.focus();
        const range = document.createRange();
        range.selectNode(el);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return document.execCommand('delete');
      })(${JSON.stringify(BODY_SELECTORS)})
    `));
}

async function typeTopicQuery(page, topic) {
    await page.evaluate(`
      (selectors => {
        const el = selectors
          .map(sel => Array.from(document.querySelectorAll(sel)))
          .flat()
          .find(node => node && node.offsetParent !== null && node.isContentEditable);
        if (!el) return false;
        el.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      })(${JSON.stringify(BODY_SELECTORS)})
    `);
    if (typeof page.pressKey === 'function') {
        try {
            await page.pressKey('Enter');
        } catch {}
    }
    await page.insertText(`#${topic}`);
    await page.wait({ time: 1.2 });
}

/**
 * Add topics, accepting only a suggestion whose resulting chip equals the
 * requested name. The suggestion dropdown lives in a closed shadow root, so
 * its items cannot be enumerated; XHS highlights the first match, Enter
 * accepts it, and a wrong chip is deleted and retried one ArrowDown step
 * further. A topic that never matches fails the whole publish — publishing
 * under a different topic is not a fallback.
 */
async function addTopics(page, topics) {
    const added = [];
    for (const topic of topics) {
        const want = normalizeTopicName(topic);
        const before = await readTopicNames(page);
        const beforeMatches = before.filter((name) => name === want).length;
        let matched = false;
        for (let attempt = 0; attempt < 5; attempt += 1) {
            await typeTopicQuery(page, topic);
            for (let down = 0; down < attempt; down += 1) {
                if (typeof page.pressKey === 'function') {
                    await page.pressKey('ArrowDown');
                    await page.wait({ time: 0.15 });
                }
            }
            if (typeof page.pressKey === 'function') {
                await page.pressKey('Enter');
            }
            await page.wait({ time: 0.7 });
            const after = await readTopicNames(page);
            if (after.filter((name) => name === want).length > beforeMatches) {
                matched = true;
                break;
            }
            if (after.length > before.length) {
                const deleted = await deleteLastTopic(page);
                if (!deleted) {
                    throw new CommandExecutionError(
                        `Topic "${topic}" was auto-selected as a different name and could not be removed. Refusing to publish.`,
                    );
                }
                const check = await readTopicNames(page);
                if (check.length >= after.length) {
                    throw new CommandExecutionError(
                        `Topic "${topic}" could not be cleaned up before retry. Refusing to publish.`,
                    );
                }
            } else {
                if (typeof page.pressKey === 'function') {
                    for (let i = 0; i < topic.length + 2; i += 1) {
                        await page.pressKey('Backspace');
                    }
                }
                break;
            }
        }
        if (!matched) {
            throw new CommandExecutionError(
                `Topic "${topic}" could not be attached with an exact name match. Refusing to publish.`,
            );
        }
        added.push(topic);
    }
    return added;
}

cli({
    site: 'xiaohongshu',
    name: 'publish-video',
    access: 'write',
    description: '小红书发布视频笔记 (creator center UI automation)',
    domain: 'creator.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'content', required: true, positional: true, help: '笔记正文' },
        { name: 'title', required: true, help: '笔记标题 (最多20字)' },
        { name: 'video', required: true, help: '视频文件路径 (.mp4/.mov，视频内容以文件实际类型校验)' },
        { name: 'cover', required: false, help: '可选：自定义封面图片路径 (.png/.jpg)' },
        { name: 'topics', required: false, help: '话题标签，逗号分隔，不含 # 号；无法精确匹配时整体失败' },
        { name: 'draft', type: 'bool', default: false, help: '保存为草稿，不直接发布' },
    ],
    columns: ['status', 'detail'],
    func: async (page, kwargs) => {
        if (!page) throw new Error('Browser page required');
        // ── Validate everything before touching the account page ──────────────
        const title = String(kwargs.title ?? '').trim();
        if (!title) throw new ArgumentError('--title is required');
        if (title.length > MAX_TITLE_LEN) {
            throw new ArgumentError(`小红书标题限 ${MAX_TITLE_LEN} 字以内（当前 ${title.length} 字）`);
        }
        const video = validateMediaFile(kwargs.video, {
            accepted: VIDEO_ACCEPTED_MIMES,
            maxBytes: VIDEO_MAX_BYTES,
            label: 'Video',
        });
        const cover = kwargs.cover
            ? validateMediaFile(kwargs.cover, {
                accepted: COVER_ACCEPTED_MIMES,
                maxBytes: COVER_MAX_BYTES,
                label: 'Cover',
            })
            : null;
        const topics = kwargs.topics
            ? String(kwargs.topics).split(',').map((s) => s.trim()).filter(Boolean)
            : [];
        const isDraft = Boolean(kwargs.draft);

        await page.goto(PUBLISH_VIDEO_URL);
        await page.wait({ time: 3 });

        const inputSel = await videoInputSelector(page);
        if (!inputSel) {
            throw new CommandExecutionError('No video file input found on creator.xiaohongshu.com/publish/publish');
        }
        const injected = await uploadFiles(page, [video.absPath], inputSel);
        if (!injected?.ok) {
            throw new CommandExecutionError(`Video upload failed: ${injected?.error || 'unknown'}. Nothing was published.`);
        }
        await waitForVideoReady(page);

        if (cover) {
            await uploadCustomCover(page, cover.absPath);
        }

        await fillField(page, TITLE_SELECTORS, title, 'title');
        await page.wait({ time: 0.5 });
        await fillField(page, BODY_SELECTORS, String(kwargs.content ?? '').trim(), 'content');
        await page.wait({ time: 0.5 });

        const addedTopics = topics.length ? await addTopics(page, topics) : [];

        const actionLabels = isDraft ? ['暂存离开', '存草稿'] : ['发布', '发布笔记'];
        await invokePublishAction(page, isDraft, actionLabels);
        const { successMsg } = await verifyPublishSuccess(page, isDraft);

        return [
            {
                status: `✅ ${isDraft ? '暂存成功' : '发布成功'}`,
                detail: [
                    `"${title}"`,
                    path.basename(video.absPath),
                    cover ? `封面:${path.basename(cover.absPath)}` : '',
                    addedTopics.length ? `话题: ${addedTopics.join(' ')}` : '',
                    successMsg || '',
                ].filter(Boolean).join(' · '),
            },
        ];
    },
});
