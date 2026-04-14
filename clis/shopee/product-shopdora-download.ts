import { pathToFileURL } from 'node:url';
import {
  ArgumentError,
  CommandExecutionError,
  getErrorMessage,
} from '@jackwener/opencli/errors';
import { bindCurrentTab } from '@jackwener/opencli/browser/daemon-client';
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import { clearLocalStorageForUrlHost, simulateHumanBehavior, waitRandomDuration } from './shared.js';

const EXPORT_REVIEW_BUTTON_SELECTOR =
  'div > div:nth-of-type(1) > div:nth-of-type(2) > div > div.common-btn.en_common-btn';
const DETAIL_FILTER_LABEL_SELECTOR =
  'div > div:nth-of-type(4) > div:nth-of-type(2) > label > span.t-checkbox__input:nth-of-type(1)';
const DETAIL_FILTER_INPUT_SELECTOR =
  'div > div:nth-of-type(4) > div:nth-of-type(2) > label > input.t-checkbox__former';
const SECONDARY_FILTER_LABEL_SELECTOR =
  'div:nth-of-type(1) > div:nth-of-type(2) > span:nth-of-type(2) > label > span.t-checkbox__input:nth-of-type(1)';
const SECONDARY_FILTER_INPUT_SELECTOR =
  'div:nth-of-type(1) > div:nth-of-type(2) > span:nth-of-type(2) > label > input.t-checkbox__former';
const CONFIRM_EXPORT_BUTTON_SELECTOR =
  '.review .button button:last-of-type';

const SHOPEE_WORKSPACE = 'site:shopee';

type BindCurrentTabFn = (
  workspace: string,
  opts?: { matchDomain?: string; matchPathPrefix?: string; matchUrl?: string },
) => Promise<unknown>;

function logStep(message: string): void {
  console.log(`[shopee/product-shopdora-download] ${message}`);
}

function normalizeShopeeReviewUrl(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) {
    throw new ArgumentError('A Shopee product URL is required.');
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ArgumentError('Shopee product-shopdora-download requires a valid absolute product URL.');
  }

  if (!/^https?:$/.test(parsed.protocol)) {
    throw new ArgumentError('Shopee product-shopdora-download only supports http(s) product URLs.');
  }

  return parsed.toString();
}

function buildEnsureCheckboxStateScript(selector: string, checked: boolean): string {
  return `
    (() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!(input instanceof HTMLInputElement)) {
        return { ok: false, error: 'checkbox_not_found' };
      }

      if (input.checked === ${checked ? 'true' : 'false'}) {
        return { ok: true, changed: false, checked: input.checked };
      }

      const label = input.closest('label');
      const clickable = label?.querySelector('span.t-checkbox__input') || label || input;

      if (!(clickable instanceof HTMLElement)) {
        return { ok: false, error: 'checkbox_click_target_not_found' };
      }

      clickable.click();

      return {
        ok: input.checked === ${checked ? 'true' : 'false'},
        changed: true,
        checked: input.checked,
      };
    })()
  `;
}

async function bindShopeeProductTab(
  productUrl: string,
  bindFn: BindCurrentTabFn = bindCurrentTab,
): Promise<boolean> {
  try {
    await bindFn(SHOPEE_WORKSPACE, { matchUrl: productUrl });
    return true;
  } catch {
    return false;
  }
}

async function ensureShopeeProductPage(
  page: IPage,
  productUrl: string,
  bindFn: BindCurrentTabFn = bindCurrentTab,
): Promise<boolean> {
  const reusedExistingTab = await bindShopeeProductTab(productUrl, bindFn);
  // await clearLocalStorageForUrlHost(page, productUrl);
  await page.goto(productUrl, { waitUntil: 'load' });
  return reusedExistingTab;
}

function buildWaitForExportReviewReadyScript(timeoutMs: number, pollIntervalMs: number): string {
  return `
    new Promise((resolve, reject) => {
      const timeout = ${timeoutMs};
      const pollInterval = ${pollIntervalMs};
      const selector = '.putButton .common-btn.en_common-btn';
      const normalizeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const startedAt = Date.now();
      let lastKnownText = '';

      const readButtonState = () => {
        const targets = Array.from(document.querySelectorAll(selector));
        const target =
          targets.find((element) => {
            const directText = Array.from(element.childNodes)
              .filter((node) => node.nodeType === Node.TEXT_NODE)
              .map((node) => node.textContent || '')
              .join(' ');
            return normalizeText(directText).includes('Export Review');
          }) || targets[0] || null;

        if (!target) return { found: false, text: '', done: false };

        const buttonLabel = normalizeText(
          Array.from(target.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent || '')
            .join(' '),
        );

        return {
          found: true,
          text: buttonLabel,
          done: buttonLabel === 'Export Review',
        };
      };

      const tick = () => {
        const state = readButtonState();
        if (state.done) {
          resolve({ ok: true, text: state.text || 'Export Review' });
          return;
        }

        if (state.found) {
          lastKnownText = state.text || '';
        }

        if (Date.now() - startedAt >= timeout) {
          reject(new Error(
            'Timed out waiting for Export Review button text to reset. Last text: '
            + (lastKnownText || 'unknown'),
          ));
          return;
        }

        setTimeout(tick, pollInterval);
      };

      setTimeout(tick, 2000);
    })
  `;
}

async function ensureCheckboxState(page: IPage, selector: string, checked: boolean, label: string): Promise<void> {
  const result = await page.evaluate(buildEnsureCheckboxStateScript(selector, checked));
  if (!result || typeof result !== 'object' || !(result as { ok?: boolean }).ok) {
    throw new CommandExecutionError(`Shopee product-shopdora-download could not ${checked ? 'enable' : 'disable'} ${label}`);
  }
}

async function waitForExportReviewReady(page: IPage, timeoutMs = 30000, pollIntervalMs = 1000): Promise<void> {
  await page.evaluate(buildWaitForExportReviewReadyScript(timeoutMs, pollIntervalMs));
}

async function clickSelector(page: IPage, selector: string, label: string): Promise<void> {
  try {
    await page.click(selector);
  } catch (error) {
    throw new CommandExecutionError(
      `Shopee product-shopdora-download could not click ${label}`,
      getErrorMessage(error),
    );
  }
}

async function applyCheckboxStep(
  page: IPage,
  labelSelector: string,
  inputSelector: string,
  checked: boolean,
  label: string,
  opts: { allowMissing?: boolean } = {},
): Promise<boolean> {
  logStep(`waiting for ${label}`);
  try {
    await page.wait({ selector: inputSelector, timeout: 10 });
  } catch (error) {
    if (opts.allowMissing) {
      logStep(`skipping ${label}: selector not found`);
      return false;
    }
    throw error;
  }
  await simulateHumanBehavior(page, {
    selector: labelSelector,
    scrollRangePx: [30, 120],
    preWaitRangeMs: [250, 700],
    postWaitRangeMs: [150, 450],
  });
  await clickSelector(page, labelSelector, `${label} label`);
  await waitRandomDuration(page, [1500, 3500]);
  await ensureCheckboxState(page, inputSelector, checked, label);
  await waitRandomDuration(page, [2000, 5000]);
  logStep(`applied ${label}`);
  return true;
}

cli({
  site: 'shopee',
  name: 'product-shopdora-download',
  description: 'Export Shopee product Shopdora data with the recorded good-detail review workflow',
  domain: 'shopee.sg',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    {
      name: 'url',
      positional: true,
      required: true,
      help: 'Shopee product URL, e.g. https://shopee.sg/...-i.123.456',
    },
  ],
  columns: ['status', 'message', 'local_url', 'local_path', 'product_url'],
  func: async (page, args) => {
    if (!page) {
      throw new CommandExecutionError(
        'Browser session required for shopee product-shopdora-download',
        'Run the command with the browser bridge connected',
      );
    }

    const productUrl = normalizeShopeeReviewUrl(args.url);
    if (typeof page.waitForDownload !== 'function') {
      throw new CommandExecutionError(
        'Shopee product-shopdora-download requires browser download tracking support',
        'Reload the browser bridge extension/plugin to a build that supports download-wait.',
      );
    }

    await ensureShopeeProductPage(page, productUrl);
    logStep('opened product page');
    await page.wait({ selector: EXPORT_REVIEW_BUTTON_SELECTOR, timeout: 15 });
    await simulateHumanBehavior(page, {
      selector: EXPORT_REVIEW_BUTTON_SELECTOR,
      scrollRangePx: [60, 180],
      preWaitRangeMs: [500, 1200],
      postWaitRangeMs: [300, 800],
      allowReverseScroll: false,
    });
    await waitRandomDuration(page, [3000, 5000]);
    await clickSelector(page, EXPORT_REVIEW_BUTTON_SELECTOR, 'Export Review');
    await waitRandomDuration(page, [2000, 6000]);
    logStep('opened export review dialog');

    await applyCheckboxStep(
      page,
      SECONDARY_FILTER_LABEL_SELECTOR,
      SECONDARY_FILTER_INPUT_SELECTOR,
      false,
      'secondary filter',
    );

    const appliedDetailFilter = await applyCheckboxStep(
      page,
      DETAIL_FILTER_LABEL_SELECTOR,
      DETAIL_FILTER_INPUT_SELECTOR,
      true,
      'detail filter',
      { allowMissing: true },
    );

    logStep('waiting for export confirm button');
    await page.wait({ selector: CONFIRM_EXPORT_BUTTON_SELECTOR, timeout: 10 });
    await simulateHumanBehavior(page, {
      selector: CONFIRM_EXPORT_BUTTON_SELECTOR,
      scrollRangePx: [20, 100],
      preWaitRangeMs: [250, 700],
      postWaitRangeMs: [200, 500],
    });
    const downloadStartedAtMs = Date.now();
    await clickSelector(page, CONFIRM_EXPORT_BUTTON_SELECTOR, 'export confirm button');
    logStep('confirmed export; waiting for download');
    await waitForExportReviewReady(page);

    const download = await page.waitForDownload({
      startedAfterMs: downloadStartedAtMs,
      timeoutMs: 30000,
    });
    const localPath = String(download?.filename ?? '').trim();
    if (!localPath) {
      throw new CommandExecutionError('Shopee product-shopdora-download finished without a local filename');
    }
    logStep(`download completed: ${localPath}`);

    return [{
      status: 'success',
      message: appliedDetailFilter
        ? 'Downloaded Shopee product Shopdora export with the recorded good-detail filter.'
        : 'Downloaded Shopee product Shopdora export after skipping the unavailable detail filter.',
      local_url: pathToFileURL(localPath).href,
      local_path: localPath,
      product_url: productUrl,
    }];
  },
});

export const __test__ = {
  EXPORT_REVIEW_BUTTON_SELECTOR,
  DETAIL_FILTER_LABEL_SELECTOR,
  DETAIL_FILTER_INPUT_SELECTOR,
  SECONDARY_FILTER_LABEL_SELECTOR,
  SECONDARY_FILTER_INPUT_SELECTOR,
  CONFIRM_EXPORT_BUTTON_SELECTOR,
  normalizeShopeeReviewUrl,
  bindShopeeProductTab,
  ensureShopeeProductPage,
  buildEnsureCheckboxStateScript,
  buildWaitForExportReviewReadyScript,
};
