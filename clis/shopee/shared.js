import { CommandExecutionError } from '@jackwener/opencli/errors';
const RANDOM_DELAY_MULTIPLIER = 1;
export const SHOPDORA_NOT_LOGGED_IN_MESSAGE = 'Shopdora 未登录';
function normalizeRange(range) {
    const [rawMin, rawMax] = range;
    const min = Number.isFinite(rawMin) ? rawMin : 0;
    const max = Number.isFinite(rawMax) ? rawMax : min;
    return min <= max ? [min, max] : [max, min];
}
function randomInRange(range) {
    const [min, max] = normalizeRange(range);
    if (min === max)
        return min;
    return min + Math.random() * (max - min);
}
function millisecondsToSeconds(value) {
    return Math.max(0, Number((value / 1000).toFixed(3)));
}
export async function waitRandomDuration(page, range) {
    const seconds = millisecondsToSeconds(randomInRange(range) * RANDOM_DELAY_MULTIPLIER);
    await page.wait({ time: seconds });
    return seconds;
}
export function buildClearLocalStorageScript(host) {
    return `
    (() => {
      if (window.location.host !== ${JSON.stringify(host)}) {
        return {
          ok: false,
          reason: 'host_mismatch',
          expectedHost: ${JSON.stringify(host)},
          actualHost: window.location.host,
        };
      }

      try {
        window.localStorage.clear();
        return { ok: true, host: window.location.host };
      } catch (error) {
        return {
          ok: false,
          reason: 'clear_failed',
          message: error instanceof Error ? error.message : String(error ?? ''),
        };
      }
    })()
  `;
}
export function buildHumanPointerScript(selector) {
    return `
    (() => {
      let target = null;
      try {
        target = document.querySelector(${JSON.stringify(selector)});
      } catch {
        return { ok: false, reason: 'invalid_selector' };
      }

      if (!(target instanceof HTMLElement)) {
        return { ok: false, reason: 'not_found' };
      }

      target.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' });
      const rect = target.getBoundingClientRect();
      const relativeX = 0.25 + Math.random() * 0.5;
      const relativeY = 0.25 + Math.random() * 0.5;
      const clientX = Math.round(rect.left + Math.max(1, rect.width * relativeX));
      const clientY = Math.round(rect.top + Math.max(1, rect.height * relativeY));

      for (const type of ['mousemove', 'mouseenter', 'mouseover']) {
        try {
          target.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX,
            clientY,
            view: window,
          }));
        } catch {}
      }

      try {
        target.focus({ preventScroll: true });
      } catch {
        try {
          target.focus();
        } catch {}
      }

      return { ok: true, tag: target.tagName.toLowerCase() };
    })()
  `;
}
export function buildHumanPointerAwayScript(selector) {
    return `
    (() => {
      let target = null;
      try {
        target = document.querySelector(${JSON.stringify(selector)});
      } catch {
        return { ok: false, reason: 'invalid_selector' };
      }

      if (!(target instanceof HTMLElement)) {
        return { ok: false, reason: 'not_found' };
      }

      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body) {
        try {
          active.blur();
        } catch {}
      }

      const rect = target.getBoundingClientRect();
      const viewportWidth = Math.max(window.innerWidth || 0, document.documentElement?.clientWidth || 0, 1);
      const viewportHeight = Math.max(window.innerHeight || 0, document.documentElement?.clientHeight || 0, 1);
      const clampX = (value) => Math.max(1, Math.min(viewportWidth - 1, Math.round(value)));
      const clampY = (value) => Math.max(1, Math.min(viewportHeight - 1, Math.round(value)));
      const targetCenterX = rect.left + rect.width / 2;
      const targetCenterY = rect.top + rect.height / 2;
      const rawFinalClientX = rect.right + 48 + Math.random() * 120;
      const rawFinalClientY = rect.top + rect.height + 24 + Math.random() * 80;
      const finalClientX = clampX(rawFinalClientX);
      const finalClientY = clampY(rawFinalClientY);
      const midClientX = clampX(
        targetCenterX + (finalClientX - targetCenterX) * (0.45 + Math.random() * 0.15),
      );
      const midClientY = clampY(
        targetCenterY + (finalClientY - targetCenterY) * (0.45 + Math.random() * 0.15),
      );
      const resolveDispatchTarget = (clientX, clientY) => {
        const nextTarget = document.elementFromPoint(clientX, clientY);
        return nextTarget instanceof HTMLElement
          ? nextTarget
          : document.body instanceof HTMLElement
            ? document.body
            : target;
      };
      const waypoints = [
        { clientX: midClientX, clientY: midClientY },
        { clientX: finalClientX, clientY: finalClientY },
      ];

      for (const type of ['mouseout', 'mouseleave']) {
        try {
          target.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: midClientX,
            clientY: midClientY,
            view: window,
          }));
        } catch {}
      }

      for (const waypoint of waypoints) {
        const dispatchTarget = resolveDispatchTarget(
          waypoint.clientX,
          waypoint.clientY,
        );
        for (const type of ['mousemove', 'mouseenter', 'mouseover']) {
          try {
            dispatchTarget.dispatchEvent(new MouseEvent(type, {
              bubbles: true,
              cancelable: true,
              composed: true,
              clientX: waypoint.clientX,
              clientY: waypoint.clientY,
              view: window,
            }));
          } catch {}
        }
      }

      const finalTarget = resolveDispatchTarget(finalClientX, finalClientY);
      return {
        ok: true,
        midClientX,
        midClientY,
        finalClientX,
        finalClientY,
        tag: finalTarget.tagName?.toLowerCase?.() || '',
      };
    })()
  `;
}
export function buildReadShopdoraLoginStateScript() {
    return `
    (() => ({
      hasShopdoraLoginPage: Boolean(document.querySelector('.shopdoraLoginPage')),
      hasPageDetailLoginTitle: Boolean(document.querySelector('.pageDetailLoginTitle')),
    }))()
  `;
}
export async function readShopdoraLoginState(page) {
    const result = await page.evaluate(buildReadShopdoraLoginStateScript());
    const raw = (result && typeof result === 'object' ? result : {});
    const hasShopdoraLoginPage = raw.hasShopdoraLoginPage === true;
    const hasPageDetailLoginTitle = raw.hasPageDetailLoginTitle === true;
    return {
        hasShopdoraLoginPage,
        hasPageDetailLoginTitle,
        loginMessage: hasShopdoraLoginPage || hasPageDetailLoginTitle ? SHOPDORA_NOT_LOGGED_IN_MESSAGE : '',
    };
}
export function appendShopdoraLoginMessage(message, loginMessage) {
    const base = String(message ?? '').trim();
    const extra = String(loginMessage ?? '').trim();
    if (!extra)
        return base;
    return base ? `${base} ${extra}。` : extra;
}
async function safeScroll(page, direction, range) {
    try {
        await page.scroll(direction, Math.round(randomInRange(range)));
    }
    catch {
        // Best-effort humanization should not block the primary workflow.
    }
}
export async function simulateHumanBehavior(page, { selector, preWaitRangeMs = [250, 850], postWaitRangeMs = [180, 650], scrollRangePx = [120, 420], allowReverseScroll = true, } = {}) {
    await waitRandomDuration(page, preWaitRangeMs);
    await safeScroll(page, 'down', scrollRangePx);
    if (selector) {
        try {
            await page.evaluate(buildHumanPointerScript(selector));
        }
        catch {
            // Keep the data collection / export flow running even if the selector is absent.
        }
    }
    if (allowReverseScroll && Math.random() < 0.35) {
        await safeScroll(page, 'up', [40, Math.max(80, scrollRangePx[0])]);
    }
    await waitRandomDuration(page, postWaitRangeMs);
}
export async function simulatePointerAway(page, selector, { preWaitRangeMs = [120, 320], postWaitRangeMs = [180, 480], } = {}) {
    await waitRandomDuration(page, preWaitRangeMs);
    try {
        await page.evaluate(buildHumanPointerAwayScript(selector));
    }
    catch {
        // Best-effort exit movement should not block the primary workflow.
    }
    await waitRandomDuration(page, postWaitRangeMs);
}
export async function clearLocalStorageForUrlHost(page, targetUrl) {
    const target = new URL(targetUrl);
    await page.goto(target.origin, { waitUntil: 'load' });
    const result = await page.evaluate(buildClearLocalStorageScript(target.host));
    if (!result || typeof result !== 'object' || !result.ok) {
        throw new CommandExecutionError(`Could not clear localStorage for ${target.host}`, JSON.stringify(result ?? {}));
    }
}
export const __test__ = {
    RANDOM_DELAY_MULTIPLIER,
    SHOPDORA_NOT_LOGGED_IN_MESSAGE,
    appendShopdoraLoginMessage,
    buildClearLocalStorageScript,
    buildHumanPointerScript,
    buildHumanPointerAwayScript,
    buildReadShopdoraLoginStateScript,
    clearLocalStorageForUrlHost,
    randomInRange,
    readShopdoraLoginState,
    simulatePointerAway,
    waitRandomDuration,
    simulateHumanBehavior,
};
