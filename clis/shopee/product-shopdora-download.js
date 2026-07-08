import { pathToFileURL } from 'node:url';
import { ArgumentError, CommandExecutionError, getErrorMessage, } from '@jackwener/opencli/errors';
import { bindTab } from '@jackwener/opencli/browser/daemon-client';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { appendShopdoraLoginMessage, readShopdoraLoginState, SHOPDORA_NOT_LOGGED_IN_MESSAGE, simulateHumanBehavior, simulatePointerAway, waitRandomDuration, } from './shared.js';
const RESOLVED_TARGET_ATTRIBUTE = 'data-opencli-shopee-product-shopdora-download-target';
const EXPORT_DIALOG_SELECTOR = '.t-dialog__body .review';
const EXPORT_REVIEW_BUTTON_TEXT = 'Export Review';
const REVIEW_IMAGES_CHECKBOX_LABEL_TEXT = 'Download review images';
const TIME_PERIOD_TITLE_TEXT = 'Time Period';
const CONFIRM_EXPORT_BUTTON_TEXT = 'Download';
const EXPORT_REVIEW_BUTTON_SELECTOR = `[${RESOLVED_TARGET_ATTRIBUTE}="export-review-button"]`;
const DETAIL_FILTER_LABEL_SELECTOR = `[${RESOLVED_TARGET_ATTRIBUTE}="download-review-images-label"]`;
const DETAIL_FILTER_INPUT_SELECTOR = `[${RESOLVED_TARGET_ATTRIBUTE}="download-review-images-input"]`;
const TIME_PERIOD_START_INPUT_SELECTOR = `[${RESOLVED_TARGET_ATTRIBUTE}="time-period-start-input"]`;
const TIME_PERIOD_START_MONTH_OFFSET = -3;
const TIME_PERIOD_START_DAY_OFFSET = 7;
const CONFIRM_EXPORT_BUTTON_SELECTOR = `[${RESOLVED_TARGET_ATTRIBUTE}="confirm-export-button"]`;
const SHOPEE_WORKSPACE = 'site:shopee';
const EXPORT_DOWNLOAD_TIMEOUT_SECONDS = 1800;
const EXPORT_DOWNLOAD_TIMEOUT_MS = EXPORT_DOWNLOAD_TIMEOUT_SECONDS * 1000;
const EXPORT_REVIEW_PRE_HOVER_WAIT_SECONDS = 3;
const EXPORT_REVIEW_PRE_HOVER_SCROLL_DOWN_PX = 320;
const EXPORT_REVIEW_PRE_HOVER_SCROLL_UP_PX = 260;
const EXPORT_REVIEW_PRE_HOVER_SCROLL_SEGMENT_PX = 40;
const EXPORT_REVIEW_PRE_HOVER_SCROLL_MIN_STEPS = 6;
const EXPORT_REVIEW_PRE_HOVER_SCROLL_MIN_DURATION_MS = 2200;
const TIME_PERIOD_STEP_WAIT_SECONDS = 1;
async function bindCurrentTabCompat(session, _opts = {}) {
    return bindTab(session);
}
function normalizeShopeeReviewUrl(value) {
    const raw = String(value ?? '').trim();
    if (!raw) {
        throw new ArgumentError('A Shopee product URL is required.');
    }
    let parsed;
    try {
        parsed = new URL(raw);
    }
    catch {
        throw new ArgumentError('Shopee product-shopdora-download requires a valid absolute product URL.');
    }
    if (!/^https?:$/.test(parsed.protocol)) {
        throw new ArgumentError('Shopee product-shopdora-download only supports http(s) product URLs.');
    }
    return parsed.toString();
}
function buildEnsureCheckboxStateScript(selector, checked) {
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
function buildResolveTargetSelectorScript(target) {
    return `
    (() => {
      const target = ${JSON.stringify(target)};
      const attr = ${JSON.stringify(RESOLVED_TARGET_ATTRIBUTE)};
      const normalizeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const mark = (name, element) => {
        if (!(element instanceof HTMLElement)) return { ok: false, error: 'target_not_found' };
        element.setAttribute(attr, name);
        return { ok: true, selector: '[' + attr + '="' + name + '"]' };
      };
      const findCheckboxLabel = (labelText) => {
        const root = findDialogRoot() || document;
        const wanted = normalizeText(labelText);
        const labels = Array.from(root.querySelectorAll('label.t-checkbox'));
        return labels.find((label) => {
          const text = normalizeText(label.querySelector('.t-checkbox__label')?.textContent || label.textContent || '');
          return text === wanted;
        }) || null;
      };
      const findDialogRoot = () => {
        const roots = Array.from(document.querySelectorAll(${JSON.stringify(EXPORT_DIALOG_SELECTOR)}));
        if (roots.length === 1) return roots[0];
        return roots.find((root) => normalizeText(root.textContent).includes(${JSON.stringify(TIME_PERIOD_TITLE_TEXT)})) || null;
      };
      const findReviewBlockByTitle = (titleText) => {
        const root = findDialogRoot();
        if (!(root instanceof HTMLElement)) return null;
        const wanted = normalizeText(titleText);
        const rows = Array.from(root.querySelectorAll('.reviewText'));
        return rows.find((row) => {
          const title = normalizeText(row.querySelector('.reviewTitle')?.textContent || '');
          return title.startsWith(wanted);
        }) || null;
      };
      const findButtonByText = (scope, text) => {
        if (!(scope instanceof HTMLElement) && scope !== document) return null;
        const wanted = normalizeText(text);
        const buttons = Array.from(scope.querySelectorAll('button, .common-btn.en_common-btn, [role="button"]'));
        return buttons.find((element) => normalizeText(element.textContent).includes(wanted)) || null;
      };

      if (target === 'export-review-button') {
        const button = findButtonByText(document, ${JSON.stringify(EXPORT_REVIEW_BUTTON_TEXT)});
        return mark(target, button);
      }

      if (target === 'download-review-images-label') {
        const label = findCheckboxLabel(${JSON.stringify(REVIEW_IMAGES_CHECKBOX_LABEL_TEXT)});
        return mark(target, label);
      }

      if (target === 'download-review-images-input') {
        const label = findCheckboxLabel(${JSON.stringify(REVIEW_IMAGES_CHECKBOX_LABEL_TEXT)});
        const input = label?.querySelector('input.t-checkbox__former') || null;
        return mark(target, input);
      }

      if (target === 'time-period-start-input') {
        const row = findReviewBlockByTitle(${JSON.stringify(TIME_PERIOD_TITLE_TEXT)});
        const input = row?.querySelector('.t-range-input__inner-left input.t-input__inner') || null;
        return mark(target, input);
      }

      if (target === 'confirm-export-button') {
        const root = findDialogRoot();
        const button = findButtonByText(root || document, ${JSON.stringify(CONFIRM_EXPORT_BUTTON_TEXT)});
        return mark(target, button);
      }

      return { ok: false, error: 'unknown_target' };
    })()
  `;
}
async function resolveTargetSelector(page, target, label) {
    const result = await page.evaluate(buildResolveTargetSelectorScript(target));
    if (!result
        || typeof result !== 'object'
        || !result.ok
        || typeof result.selector !== 'string') {
        throw new CommandExecutionError(`Shopee product-shopdora-download could not resolve ${label}`);
    }
    return result.selector;
}
async function bindShopeeProductTab(productUrl, bindFn = bindCurrentTabCompat) {
    try {
        await bindFn(SHOPEE_WORKSPACE, { matchUrl: productUrl });
        return true;
    }
    catch {
        return false;
    }
}
async function ensureShopeeProductPage(page, productUrl, bindFn = bindCurrentTabCompat) {
    const reusedExistingTab = await bindShopeeProductTab(productUrl, bindFn);
    // await clearLocalStorageForUrlHost(page, productUrl);
    await page.goto(productUrl, { waitUntil: 'load' });
    return reusedExistingTab;
}
async function smoothScroll(page, direction, totalPixels, options = {}) {
    const total = Math.max(0, Math.round(totalPixels));
    if (total <= 0)
        return;
    const segmentPixels = Math.max(1, Math.round(options.segmentPixels ?? EXPORT_REVIEW_PRE_HOVER_SCROLL_SEGMENT_PX));
    const minSteps = Math.max(1, Math.round(options.minSteps ?? EXPORT_REVIEW_PRE_HOVER_SCROLL_MIN_STEPS));
    const minDurationMs = Math.max(0, Math.round(options.minDurationMs ?? EXPORT_REVIEW_PRE_HOVER_SCROLL_MIN_DURATION_MS));
    const stepCount = Math.max(minSteps, Math.ceil(total / segmentPixels));
    const baseStepPixels = Math.floor(total / stepCount);
    const remainder = total - (baseStepPixels * stepCount);
    const secondsPerStep = Math.max(0.05, Number((minDurationMs / stepCount / 1000).toFixed(3)));
    for (let index = 0; index < stepCount; index += 1) {
        const stepPixels = baseStepPixels + (index < remainder ? 1 : 0);
        await page.scroll(direction, stepPixels);
        await page.wait({ time: secondsPerStep });
    }
}
function buildWaitForExportReviewReadyScript(timeoutMs, pollIntervalMs) {
    return `
    new Promise((resolve, reject) => {
      const timeout = ${timeoutMs};
      const pollInterval = ${pollIntervalMs};
      const selector = '.putButton .common-btn.en_common-btn';
      const loginSelector = '.shopdoraLoginPage';
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
        if (document.querySelector(loginSelector)) {
          resolve({ ok: false, reason: 'shopdora_login_required' });
          return;
        }

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
async function ensureCheckboxState(page, selector, checked, label) {
    const result = await page.evaluate(buildEnsureCheckboxStateScript(selector, checked));
    if (!result || typeof result !== 'object' || !result.ok) {
        throw new CommandExecutionError(`Shopee product-shopdora-download could not ${checked ? 'enable' : 'disable'} ${label}`);
    }
}
async function waitForExportReviewReady(page, timeoutMs = EXPORT_DOWNLOAD_TIMEOUT_MS, pollIntervalMs = 1000) {
    const result = await page.evaluate(buildWaitForExportReviewReadyScript(timeoutMs, pollIntervalMs));
    if (result
        && typeof result === 'object'
        && result.ok === false
        && result.reason === 'shopdora_login_required') {
        throw new CommandExecutionError('Shopee product-shopdora-download requires Shopdora login', `${SHOPDORA_NOT_LOGGED_IN_MESSAGE}，请先登录 Shopdora 后重试。`);
    }
}
function buildReadInputValueScript(selector) {
    return `
    (() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!(input instanceof HTMLInputElement)) {
        return { ok: false, error: 'date_input_not_found' };
      }

      return { ok: true, value: input.value };
    })()
  `;
}
function buildDispatchEnterOnInputScript(selector) {
    return `
    (() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!(input instanceof HTMLInputElement)) {
        return { ok: false, error: 'date_input_not_found' };
      }

      input.focus();
      const eventInit = {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      };
      input.dispatchEvent(new KeyboardEvent('keydown', eventInit));
      input.dispatchEvent(new KeyboardEvent('keypress', eventInit));
      input.dispatchEvent(new KeyboardEvent('keyup', eventInit));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    })()
  `;
}
function computeShiftedDateFromInputValue(value, monthOffset = TIME_PERIOD_START_MONTH_OFFSET, dayOffset = TIME_PERIOD_START_DAY_OFFSET) {
    const normalized = String(value ?? '').trim();
    const match = normalized.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D.*)?$/);
    if (!match) {
        throw new CommandExecutionError('Shopee product-shopdora-download could not parse the time-period start date', `Unsupported input value: ${normalized || '(empty)'}`);
    }
    const year = Number.parseInt(match[1], 10);
    const monthIndex = Number.parseInt(match[2], 10) - 1;
    const day = Number.parseInt(match[3], 10);
    const target = new Date(Date.UTC(year, monthIndex, day));
    if (Number.isNaN(target.getTime())
        || target.getUTCFullYear() !== year
        || target.getUTCMonth() !== monthIndex
        || target.getUTCDate() !== day) {
        throw new CommandExecutionError('Shopee product-shopdora-download could not parse the time-period start date', `Invalid input value: ${normalized}`);
    }
    const originalDay = target.getUTCDate();
    target.setUTCDate(1);
    target.setUTCMonth(target.getUTCMonth() + monthOffset);
    const daysInMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(originalDay, daysInMonth));
    target.setUTCDate(target.getUTCDate() + dayOffset);
    const yyyy = target.getUTCFullYear();
    const mm = String(target.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(target.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}
async function setComputedTimePeriodStartValue(page) {
    const inputSelector = await resolveTargetSelector(page, 'time-period-start-input', 'time-period start input');
    await clickSelector(page, inputSelector, 'time-period start input');
    await page.wait({ time: TIME_PERIOD_STEP_WAIT_SECONDS });
    const inputState = await page.evaluate(buildReadInputValueScript(inputSelector));
    if (!inputState || typeof inputState !== 'object' || !inputState.ok) {
        throw new CommandExecutionError('Shopee product-shopdora-download could not read the time-period start date');
    }
    await page.wait({ time: TIME_PERIOD_STEP_WAIT_SECONDS });
    const nextValue = computeShiftedDateFromInputValue(String(inputState.value ?? ''));
    try {
        await page.typeText(inputSelector, nextValue);
    }
    catch (error) {
        throw new CommandExecutionError('Shopee product-shopdora-download could not set the time-period start date', getErrorMessage(error));
    }
    await page.wait({ time: TIME_PERIOD_STEP_WAIT_SECONDS });
    const enterDispatchResult = await page.evaluate(buildDispatchEnterOnInputScript(inputSelector));
    if (!enterDispatchResult || typeof enterDispatchResult !== 'object' || !enterDispatchResult.ok) {
        throw new CommandExecutionError('Shopee product-shopdora-download could not trigger Enter on the time-period start date');
    }
    await page.wait({ time: TIME_PERIOD_STEP_WAIT_SECONDS });
    try {
        if (typeof page.nativeKeyPress === 'function') {
            await page.nativeKeyPress('Enter');
        }
        else {
            await page.pressKey('Enter');
        }
    }
    catch (error) {
        throw new CommandExecutionError('Shopee product-shopdora-download could not submit the time-period start date', getErrorMessage(error));
    }
    await page.wait({ time: TIME_PERIOD_STEP_WAIT_SECONDS });
    return nextValue;
}
async function clickSelector(page, selector, label) {
    try {
        await page.click(selector);
    }
    catch (error) {
        throw new CommandExecutionError(`Shopee product-shopdora-download could not click ${label}`, getErrorMessage(error));
    }
}
async function applyCheckboxStep(page, checked, label, opts = {}) {
    let labelSelector;
    let inputSelector;
    try {
        labelSelector = await resolveTargetSelector(page, 'download-review-images-label', `${label} label`);
        inputSelector = await resolveTargetSelector(page, 'download-review-images-input', label);
    }
    catch (error) {
        if (opts.allowMissing) {
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
    return true;
}
cli({
    site: 'shopee',
    name: 'product-shopdora-download',
    access: 'read',
    description: 'Export Shopee product Shopdora data with the recorded good-detail review workflow',
    domain: 'shopee.sg',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    timeoutSeconds: EXPORT_DOWNLOAD_TIMEOUT_SECONDS,
    args: [
        {
            name: 'url',
            positional: true,
            required: true,
            help: 'Shopee product URL, e.g. https://shopee.sg/...-i.123.456',
        },
    ],
    columns: ['status', 'message', 'local_url', 'local_path', 'product_url', 'shopdora_login_message'],
    func: async (page, args) => {
        if (!page) {
            throw new CommandExecutionError('Browser session required for shopee product-shopdora-download', 'Run the command with the browser bridge connected');
        }
        const productUrl = normalizeShopeeReviewUrl(args.url);
        if (typeof page.waitForDownload !== 'function') {
            throw new CommandExecutionError('Shopee product-shopdora-download requires browser download tracking support', 'Reload the browser bridge extension/plugin to a build that supports download-wait.');
        }
        await ensureShopeeProductPage(page, productUrl);
        const initialShopdoraLoginState = await readShopdoraLoginState(page);
        await page.wait({ selector: '.putButton .common-btn.en_common-btn', timeout: 15 });
        const exportReviewButtonSelector = await resolveTargetSelector(page, 'export-review-button', 'Export Review button');
        await page.wait({ time: EXPORT_REVIEW_PRE_HOVER_WAIT_SECONDS });
        await smoothScroll(page, 'down', EXPORT_REVIEW_PRE_HOVER_SCROLL_DOWN_PX);
        await smoothScroll(page, 'up', EXPORT_REVIEW_PRE_HOVER_SCROLL_UP_PX);
        await simulateHumanBehavior(page, {
            selector: exportReviewButtonSelector,
            scrollRangePx: [60, 180],
            preWaitRangeMs: [500, 1200],
            postWaitRangeMs: [300, 800],
            allowReverseScroll: false,
        });
        await waitRandomDuration(page, [3000, 5000]);
        await clickSelector(page, exportReviewButtonSelector, 'Export Review');
        await simulatePointerAway(page, exportReviewButtonSelector, {
            preWaitRangeMs: [180, 420],
            postWaitRangeMs: [500, 1200],
        });
        await waitRandomDuration(page, [2000, 6000]);
        const postExportShopdoraLoginState = await readShopdoraLoginState(page);
        if (postExportShopdoraLoginState.hasShopdoraLoginPage) {
            return [{
                    status: 'not_logged_in',
                    message: `${SHOPDORA_NOT_LOGGED_IN_MESSAGE}，请先登录 Shopdora 后重试。`,
                    local_url: '',
                    local_path: '',
                    product_url: productUrl,
                    shopdora_login_message: postExportShopdoraLoginState.loginMessage,
                }];
        }
        const shopdoraLoginMessage = postExportShopdoraLoginState.loginMessage || initialShopdoraLoginState.loginMessage;
        await page.wait({ selector: EXPORT_DIALOG_SELECTOR, timeout: 10 });
        const timePeriodStartInputSelector = await resolveTargetSelector(page, 'time-period-start-input', 'time-period start input');
        await simulateHumanBehavior(page, {
            selector: timePeriodStartInputSelector,
            scrollRangePx: [20, 80],
            preWaitRangeMs: [250, 600],
            postWaitRangeMs: [150, 400],
        });
        await setComputedTimePeriodStartValue(page);
        await waitRandomDuration(page, [1000, 2500]);
        const appliedDetailFilter = await applyCheckboxStep(page, true, 'detail filter', { allowMissing: true });
        const confirmExportButtonSelector = await resolveTargetSelector(page, 'confirm-export-button', 'export confirm button');
        await simulateHumanBehavior(page, {
            selector: confirmExportButtonSelector,
            scrollRangePx: [20, 100],
            preWaitRangeMs: [250, 700],
            postWaitRangeMs: [200, 500],
        });
        const downloadStartedAtMs = Date.now();
        await clickSelector(page, confirmExportButtonSelector, 'export confirm button');
        await waitForExportReviewReady(page);
        const download = await page.waitForDownload({
            startedAfterMs: downloadStartedAtMs,
            timeoutMs: EXPORT_DOWNLOAD_TIMEOUT_MS,
        });
        const localPath = String(download?.filename ?? '').trim();
        if (!localPath) {
            throw new CommandExecutionError('Shopee product-shopdora-download finished without a local filename');
        }
        return [{
                status: 'success',
                message: appendShopdoraLoginMessage(appliedDetailFilter
                    ? 'Downloaded Shopee product Shopdora export with the recorded good-detail filter.'
                    : 'Downloaded Shopee product Shopdora export after skipping the unavailable detail filter.', shopdoraLoginMessage),
                local_url: pathToFileURL(localPath).href,
                local_path: localPath,
                product_url: productUrl,
                shopdora_login_message: shopdoraLoginMessage,
            }];
    },
});
export const __test__ = {
    EXPORT_DIALOG_SELECTOR,
    EXPORT_REVIEW_BUTTON_SELECTOR,
    DETAIL_FILTER_LABEL_SELECTOR,
    DETAIL_FILTER_INPUT_SELECTOR,
    TIME_PERIOD_START_INPUT_SELECTOR,
    TIME_PERIOD_START_MONTH_OFFSET,
    TIME_PERIOD_START_DAY_OFFSET,
    CONFIRM_EXPORT_BUTTON_SELECTOR,
    normalizeShopeeReviewUrl,
    bindShopeeProductTab,
    ensureShopeeProductPage,
    buildEnsureCheckboxStateScript,
    buildResolveTargetSelectorScript,
    buildReadInputValueScript,
    buildDispatchEnterOnInputScript,
    computeShiftedDateFromInputValue,
    buildWaitForExportReviewReadyScript,
    smoothScroll,
    setComputedTimePeriodStartValue,
};
