import { CommandExecutionError } from '@jackwener/opencli/errors';
import type { IPage } from '@jackwener/opencli/types';

type HumanBehaviorOptions = {
  selector?: string;
  preWaitRangeMs?: readonly [number, number];
  postWaitRangeMs?: readonly [number, number];
  scrollRangePx?: readonly [number, number];
  allowReverseScroll?: boolean;
};

const RANDOM_DELAY_MULTIPLIER = 1;

function normalizeRange(range: readonly [number, number]): [number, number] {
  const [rawMin, rawMax] = range;
  const min = Number.isFinite(rawMin) ? rawMin : 0;
  const max = Number.isFinite(rawMax) ? rawMax : min;
  return min <= max ? [min, max] : [max, min];
}

function randomInRange(range: readonly [number, number]): number {
  const [min, max] = normalizeRange(range);
  if (min === max) return min;
  return min + Math.random() * (max - min);
}

function millisecondsToSeconds(value: number): number {
  return Math.max(0, Number((value / 1000).toFixed(3)));
}

export async function waitRandomDuration(
  page: IPage,
  range: readonly [number, number],
): Promise<number> {
  const seconds = millisecondsToSeconds(randomInRange(range) * RANDOM_DELAY_MULTIPLIER);
  await page.wait({ time: seconds });
  return seconds;
}

export function buildClearLocalStorageScript(host: string): string {
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

export function buildHumanPointerScript(selector: string): string {
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

async function safeScroll(page: IPage, direction: 'up' | 'down', range: readonly [number, number]): Promise<void> {
  try {
    await page.scroll(direction, Math.round(randomInRange(range)));
  } catch {
    // Best-effort humanization should not block the primary workflow.
  }
}

export async function simulateHumanBehavior(
  page: IPage,
  {
    selector,
    preWaitRangeMs = [250, 850],
    postWaitRangeMs = [180, 650],
    scrollRangePx = [120, 420],
    allowReverseScroll = true,
  }: HumanBehaviorOptions = {},
): Promise<void> {
  await waitRandomDuration(page, preWaitRangeMs);
  await safeScroll(page, 'down', scrollRangePx);

  if (selector) {
    try {
      await page.evaluate(buildHumanPointerScript(selector));
    } catch {
      // Keep the data collection / export flow running even if the selector is absent.
    }
  }

  if (allowReverseScroll && Math.random() < 0.35) {
    await safeScroll(page, 'up', [40, Math.max(80, scrollRangePx[0])]);
  }

  await waitRandomDuration(page, postWaitRangeMs);
}

export async function clearLocalStorageForUrlHost(page: IPage, targetUrl: string): Promise<void> {
  const target = new URL(targetUrl);
  await page.goto(target.origin, { waitUntil: 'load' });
  const result = await page.evaluate(buildClearLocalStorageScript(target.host));
  if (!result || typeof result !== 'object' || !(result as { ok?: boolean }).ok) {
    throw new CommandExecutionError(
      `Could not clear localStorage for ${target.host}`,
      JSON.stringify(result ?? {}),
    );
  }
}

export const __test__ = {
  RANDOM_DELAY_MULTIPLIER,
  buildClearLocalStorageScript,
  buildHumanPointerScript,
  clearLocalStorageForUrlHost,
  randomInRange,
  waitRandomDuration,
  simulateHumanBehavior,
};
