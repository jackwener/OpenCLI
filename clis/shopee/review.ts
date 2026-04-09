import {
  ArgumentError,
  CommandExecutionError,
  getErrorMessage,
} from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';

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
  'div > div:nth-of-type(5) > div:nth-of-type(2) > button:nth-of-type(2)';

function normalizeShopeeReviewUrl(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) {
    throw new ArgumentError('A Shopee product URL is required.');
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ArgumentError('Shopee review requires a valid absolute product URL.');
  }

  if (!/^https?:$/.test(parsed.protocol)) {
    throw new ArgumentError('Shopee review only supports http(s) product URLs.');
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
    throw new CommandExecutionError(`Shopee review could not ${checked ? 'enable' : 'disable'} ${label}`);
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
      `Shopee review could not click ${label}`,
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
): Promise<void> {
  await page.wait({ selector: inputSelector, timeout: 10 });
  await clickSelector(page, labelSelector, `${label} label`);
  await page.wait({ time: 0.4 });
  await ensureCheckboxState(page, inputSelector, checked, label);
  await page.wait({ time: 0.4 });
}

cli({
  site: 'shopee',
  name: 'review',
  description: 'Export Shopee reviews with the recorded good-detail review workflow',
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
  columns: ['status', 'message', 'product_url'],
  func: async (page, args) => {
    if (!page) {
      throw new CommandExecutionError(
        'Browser session required for shopee review',
        'Run the command with the browser bridge connected',
      );
    }

    const productUrl = normalizeShopeeReviewUrl(args.url);

    await page.goto(productUrl, { waitUntil: 'load' });
    await page.wait({ selector: EXPORT_REVIEW_BUTTON_SELECTOR, timeout: 15 });
    await page.wait(1);

    await clickSelector(page, EXPORT_REVIEW_BUTTON_SELECTOR, 'Export Review');
    await page.wait({ time: 1.2 });

    await applyCheckboxStep(
      page,
      DETAIL_FILTER_LABEL_SELECTOR,
      DETAIL_FILTER_INPUT_SELECTOR,
      true,
      'detail filter',
    );
    await applyCheckboxStep(
      page,
      SECONDARY_FILTER_LABEL_SELECTOR,
      SECONDARY_FILTER_INPUT_SELECTOR,
      false,
      'secondary filter',
    );

    await page.wait({ selector: CONFIRM_EXPORT_BUTTON_SELECTOR, timeout: 10 });
    await clickSelector(page, CONFIRM_EXPORT_BUTTON_SELECTOR, 'export confirm button');
    await waitForExportReviewReady(page);

    return [{
      status: 'success',
      message: 'Triggered Shopee review export with the recorded good-detail filter.',
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
  buildEnsureCheckboxStateScript,
  buildWaitForExportReviewReadyScript,
};
