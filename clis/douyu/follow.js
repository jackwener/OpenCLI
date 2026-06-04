import { cli, Strategy } from '@jackwener/opencli/registry';
import { extractRoomSummary, gotoRoom, ensureRoomReady, wrapUiWriteError } from './utils.js';

function buildFollowStateScript() {
  return `
    (() => {
      const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const isVisible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const findFollowButton = () => Array.from(document.querySelectorAll('button'))
        .find((el) => isVisible(el) && /followButton|关注|已关注|取消关注/.test(String(el.className || '') + ' ' + clean(el.textContent)));

      const loginText = clean(document.body?.innerText || '');
      if (/登录后|请登录|立即登录/.test(loginText) && !findFollowButton()) {
        throw new Error('AUTH_REQUIRED: Douyu login is required');
      }

      const before = findFollowButton();
      if (!before) {
        throw new Error('BUTTON_NOT_FOUND: room follow button not found');
      }

      const beforeText = clean(before.textContent);
      if (/已关注|取消关注/.test(beforeText)) {
        return Object.assign(Object.create(null), { result: 'already-following', before: beforeText, after: beforeText });
      }

      document.querySelectorAll('[data-opencli-douyu-follow-target]').forEach((el) => {
        el.removeAttribute('data-opencli-douyu-follow-target');
      });
      before.setAttribute('data-opencli-douyu-follow-target', '1');
      return Object.assign(Object.create(null), { result: 'needs-follow', before: beforeText });
    })()
  `;
}

function buildFollowVerifyScript() {
  return `
    (async () => {
      const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const isVisible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const findFollowButton = () => Array.from(document.querySelectorAll('button'))
        .find((el) => isVisible(el) && /followButton|关注|已关注|取消关注/.test(String(el.className || '') + ' ' + clean(el.textContent)));
      const dismissFollowDialog = () => {
        const controls = Array.from(document.querySelectorAll('button, [role="button"], span, div'));
        const target = controls.find((el) => {
          if (!isVisible(el)) return false;
          const text = clean(el.innerText || el.textContent || '');
          return /^(保存|确定|知道了|完成)$/.test(text);
        });
        if (target) {
          target.click();
          return clean(target.innerText || target.textContent || '');
        }
        return '';
      };

      for (let i = 0; i < 40; i++) {
        await sleep(250);
        const current = findFollowButton();
        const afterText = clean(current?.textContent || '');
        const bodyText = clean(document.body?.innerText || '');
        if (/关注成功|已关注|取消关注/.test(afterText) || /关注成功|已关注/.test(bodyText)) {
          const dismissed = dismissFollowDialog();
          return Object.assign(Object.create(null), { result: 'followed', before: beforeText, after: afterText || '已关注' });
        }
        if (/登录后|请登录|立即登录/.test(bodyText)) {
          throw new Error('AUTH_REQUIRED: Douyu login is required');
        }
        if (/验证|安全校验|验证码|滑块/.test(bodyText)) {
          throw new Error('STATE_VERIFY_FAIL: Douyu opened a verification challenge');
        }
      }

      throw new Error('STATE_VERIFY_FAIL: follow button did not switch to followed state');
    })()
  `;
}

export const command = cli({
  site: 'douyu',
  name: 'follow',
  description: '关注斗鱼直播间主播',
  access: 'write',
  example: 'opencli douyu follow 6979222 -f yaml',
  domain: 'www.douyu.com',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  args: [
    { name: 'room', required: true, positional: true, help: 'Douyu room id or room URL' },
  ],
  columns: ['room', 'streamer', 'result', 'url'],
  func: async (page, kwargs) => followRoom(page, kwargs.room),
});

export async function followRoom(page, room) {
  try {
    await gotoRoom(page, room);
    await ensureRoomReady(page);
    const state = await page.evaluate(buildFollowStateScript());
    if (state.result === 'already-following') {
      const summary = await extractRoomSummary(page);
      return [{ room: summary.room, streamer: summary.streamer, result: state.result, url: summary.url }];
    }
    await page.click('[data-opencli-douyu-follow-target="1"]');
    const action = await page.evaluateWithArgs(buildFollowVerifyScript(), { beforeText: state.before || '' });
    const summary = await extractRoomSummary(page);
    return [{ room: summary.room, streamer: summary.streamer, result: action.result, url: summary.url }];
  } catch (error) {
    wrapUiWriteError(error, 'follow Douyu streamer');
  }
}

export const __test__ = { buildFollowStateScript, buildFollowVerifyScript };
