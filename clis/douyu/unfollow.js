import { cli, Strategy } from '@jackwener/opencli/registry';
import { extractRoomSummary, gotoRoom, ensureRoomReady, wrapUiWriteError } from './utils.js';

function buildUnfollowStateScript() {
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
      if (/^关注$|关注主播/.test(beforeText)) {
        return Object.assign(Object.create(null), { result: 'not-following', before: beforeText, after: beforeText });
      }

      document.querySelectorAll('[data-opencli-douyu-follow-target]').forEach((el) => {
        el.removeAttribute('data-opencli-douyu-follow-target');
      });
      before.setAttribute('data-opencli-douyu-follow-target', '1');
      return Object.assign(Object.create(null), { result: 'needs-unfollow', before: beforeText });
    })()
  `;
}

function buildUnfollowVerifyScript() {
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
      const clickConfirm = () => {
        const controls = Array.from(document.querySelectorAll('button, [role="button"], span, div'));
        const target = controls.find((el) => {
          if (!isVisible(el)) return false;
          const text = clean(el.innerText || el.textContent || '');
          return /^(确定|确认|取消关注)$/.test(text);
        });
        if (target) {
          target.click();
          return true;
        }
        return false;
      };

      for (let i = 0; i < 40; i++) {
        await sleep(250);
        clickConfirm();
        const current = findFollowButton();
        const afterText = clean(current?.textContent || '');
        const bodyText = clean(document.body?.innerText || '');
        if (/^关注$|关注主播/.test(afterText)) {
          return Object.assign(Object.create(null), { result: 'unfollowed', before: beforeText, after: afterText });
        }
        if (/登录后|请登录|立即登录/.test(bodyText)) {
          throw new Error('AUTH_REQUIRED: Douyu login is required');
        }
        if (/验证|安全校验|验证码|滑块/.test(bodyText)) {
          throw new Error('STATE_VERIFY_FAIL: Douyu opened a verification challenge');
        }
      }

      throw new Error('STATE_VERIFY_FAIL: follow button did not switch to unfollowed state');
    })()
  `;
}

export const command = cli({
  site: 'douyu',
  name: 'unfollow',
  description: '取消关注斗鱼直播间主播',
  access: 'write',
  example: 'opencli douyu unfollow 6979222 -f yaml',
  domain: 'www.douyu.com',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  args: [
    { name: 'room', required: true, positional: true, help: 'Douyu room id or room URL' },
  ],
  columns: ['room', 'streamer', 'result', 'url'],
  func: async (page, kwargs) => unfollowRoom(page, kwargs.room),
});

export async function unfollowRoom(page, room) {
  try {
    await gotoRoom(page, room);
    await ensureRoomReady(page);
    const state = await page.evaluate(buildUnfollowStateScript());
    if (state.result === 'not-following') {
      const summary = await extractRoomSummary(page);
      return [{ room: summary.room, streamer: summary.streamer, result: state.result, url: summary.url }];
    }
    await page.click('[data-opencli-douyu-follow-target="1"]');
    const action = await page.evaluateWithArgs(buildUnfollowVerifyScript(), { beforeText: state.before || '' });
    const summary = await extractRoomSummary(page);
    return [{ room: summary.room, streamer: summary.streamer, result: action.result, url: summary.url }];
  } catch (error) {
    wrapUiWriteError(error, 'unfollow Douyu streamer');
  }
}

export const __test__ = { buildUnfollowStateScript, buildUnfollowVerifyScript };
