/**
 * Alibaba NoCaptcha / Baxia challenge solver.
 *
 * Taobao and Goofish both use the Alibaba "drag to the far right" behavioural
 * slider (`#nc_1_n1z` handle + `#nc_1_n1t` track), not a gap-matching puzzle.
 * The trajectory below follows the approach used by the public Taobao/Xianyu
 * slider bypass projects: roughly 20 accelerating steps, a large overshoot so
 * the handle is clamped at the end of the track, small Y drift and short random
 * delays between moves.
 *
 * References:
 * - laozuzhen/xianyu-openclaw-channel `xianyu_slider_stealth.py`: #nc_1_n1z
 *   handle / #nc_1_n1t track, trackWidth-handleWidth distance, three retries,
 *   click "验证失败，点击框体重试" to reset.
 * - bgods.cn Taobao slider notes: segmented movement and a 100%+ overshoot.
 * - kangleyao/slider-captcha-lab: slow approach, end-loaded acceleration and a
 *   settle phase rather than a perfectly smooth curve.
 */

const DISABLED_VALUES = /^(?:0|false|off|no|disabled)$/i;

function randomInt(min, max, random) {
    return min + Math.floor(random() * (max - min + 1));
}

function roundTenth(value) {
    return Math.round(value * 10) / 10;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForSettled(promise, ms) {
    let timer;
    try {
        return await Promise.race([
            promise.then(() => true, () => true),
            new Promise(resolve => {
                timer = setTimeout(() => resolve(false), ms);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

export const PAGE_VISIBILITY_SCRIPT = 'document.visibilityState';

/**
 * CDP mouse events can stall when the tab is hidden/occluded. Bring the tab to
 * the front first (requires the Browser Bridge `Page.bringToFront` allowance)
 * and report whether it actually became visible.
 */
export async function ensurePageVisible(page) {
    if (typeof page.evaluate !== 'function') return false;
    let visibility;
    try {
        visibility = await page.evaluate(PAGE_VISIBILITY_SCRIPT);
    } catch {
        return false;
    }
    if (visibility === 'visible') return true;

    if (typeof page.cdp === 'function') {
        try {
            await page.cdp('Page.bringToFront');
        } catch {
            // Older Browser Bridge builds do not allow Page.bringToFront.
        }
    }

    // Fallback for owned automation tabs: selecting the current tab activates
    // it inside its container window.
    if (typeof page.selectTab === 'function' && typeof page.getActivePage === 'function') {
        const active = page.getActivePage();
        if (active) {
            try {
                await page.selectTab(active);
            } catch {
                // Bound user tabs cannot be selected through the automation window.
            }
        }
    }

    await sleep(200);
    try {
        return (await page.evaluate(PAGE_VISIBILITY_SCRIPT)) === 'visible';
    } catch {
        return false;
    }
}

/**
 * Serialize a page-side function for `page.evaluate`.
 *
 * esbuild/tsx (used by `opencli` in source/dev mode) adds `__name(...)`
 * wrappers around arrow functions assigned to variables. The browser does not
 * know that helper, so define a no-op shim before the function is evaluated.
 */
export function buildCaptchaEvaluateScript(fn) {
    const source = typeof fn === 'function' ? fn.toString() : String(fn);
    return [
        "if (typeof globalThis.__name !== 'function') globalThis.__name = (value) => value;",
        `(${source})()`,
    ].join('\n');
}

/**
 * Build a human-like relative drag path.
 *
 * @param {number} distance Track width minus handle width, in CSS pixels.
 * @param {{ scratch?: boolean, random?: () => number }} [options]
 * @returns {Array<{ dx: number, dy: number, delayMs: number }>}
 */
export function buildSliderTrajectory(distance, options = {}) {
    const scratch = options.scratch === true;
    const random = typeof options.random === 'function' ? options.random : Math.random;
    const safeDistance = Math.max(0, Number(distance) || 0);
    const steps = randomInt(15, 25, random);

    // Normal slider: overshoot by 80-110% of the track so the handle reaches
    // the end even when rendering differs slightly between pages.
    // Scratch captcha: only a small portion of the track has to be rubbed.
    const target = scratch
        ? safeDistance * (0.25 + random() * 0.10)
        : safeDistance * (1.8 + random() * 0.3);

    const points = [];
    for (let index = 1; index <= steps; index++) {
        const progress = index / steps;
        points.push({
            dx: roundTenth(target * progress ** 1.5),
            dy: roundTenth((random() * 2 - 1) * 2),
            delayMs: Math.round(5 + random() * 15),
        });
    }
    return points;
}

/**
 * Locate a visible Alibaba challenge target. Runs inside the page, so it must
 * stay fully self-contained.
 *
 * `kind` is one of:
 * - `slider`    drag `start` horizontally by `distance`
 * - `scratch`   rub `start` horizontally by a fraction of `distance`
 * - `retry`     click `point` to reset a failed slider
 * - `click`     click `point` for one-tap smart verification
 * - `none`      no supported challenge found
 */
export function findCaptchaTargetInPage() {
    const isVisible = node => {
        if (!node || !node.isConnected) return false;
        if (node.closest('[hidden], [aria-hidden="true"]')) return false;
        for (let parent = node; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) {
                return false;
            }
        }
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    };

    const trustedCaptchaFrame = node => {
        let url;
        try {
            url = new URL(String(node.src || node.getAttribute('src') || ''), location.href);
        } catch {
            return false;
        }
        if (!/(?:^|\.)(?:taobao\.com|tmall\.com|alibaba\.com|goofish\.com)$/i.test(url.hostname)) {
            return false;
        }
        return /_____tmd_____|\/(?:punish|captcha|nocaptcha|baxia)(?:\/|$)/i.test(url.pathname)
            || url.searchParams.has('x5sec')
            || url.searchParams.has('x5secdata')
            || url.searchParams.get('action')?.toLowerCase() === 'captcha';
    };

    const textOf = node => String(node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
    const pointOf = (node, offsetX = 0, offsetY = 0) => {
        const rect = node.getBoundingClientRect();
        return {
            x: Math.round(rect.left + rect.width / 2 + offsetX),
            y: Math.round(rect.top + rect.height / 2 + offsetY),
        };
    };

    const roots = [];
    const collect = (doc, offsetX, offsetY) => {
        roots.push({ doc, offsetX, offsetY });
        for (const iframe of doc.querySelectorAll('iframe')) {
            try {
                const child = iframe.contentDocument;
                if (!child) continue;
                const rect = iframe.getBoundingClientRect();
                collect(child, offsetX + rect.left, offsetY + rect.top);
            } catch {
                // Cross-origin iframe: not inspectable from the top document.
            }
        }
    };
    collect(document, 0, 0);

    const findIn = (selector) => {
        for (const root of roots) {
            for (const node of root.doc.querySelectorAll(selector)) {
                if (isVisible(node)) return { node, root };
            }
        }
        return null;
    };

    const findFirst = (selectors) => {
        for (const selector of selectors) {
            const hit = findIn(selector);
            if (hit) return hit;
        }
        return null;
    };

    const container = findFirst([
        '#nocaptcha',
        '#baxia-dialog-content',
        '.nc-container',
        '[class*="nc-container"]',
        '.nc_wrapper',
        '[class*="nc_wrapper"]',
    ]);
    const containerText = container ? textOf(container.node) : '';

    // A failed drag replaces the prompt with "验证失败，点击框体重试". Clicking
    // the wrapper resets the widget, then the next loop can drag again.
    if (container && /验证失败|点击框体重试|重试/.test(containerText)) {
        return {
            kind: 'retry',
            point: pointOf(container.node, container.root.offsetX, container.root.offsetY),
            text: containerText.slice(0, 120),
        };
    }

    const scratch = findFirst([
        '.scratch-captcha-container',
        '[class*="scratch-captcha-container"]',
        '.scratch-captcha-question-bg',
        '[class*="scratch-captcha"]',
    ]);

    const handle = findFirst([
        '#nc_1_n1z',
        '.nc_iconfont.btn_slide',
        '[class*="nc_iconfont"][class*="btn_slide"]',
        '[class*="btn_slide"]',
        '#nc_1_wrapper [class*="btn"]',
        '[class*="scratch-captcha"] [class*="btn"]',
        '[class*="scratch-captcha"] [class*="slider"]',
    ]);

    if (handle) {
        const handleRect = handle.node.getBoundingClientRect();
        let track = handle.node.closest('#nc_1_n1t, .nc_scale, [class*="nc_scale"]');
        if (!track) track = handle.root.doc.querySelector('#nc_1_n1t, .nc_scale, [class*="nc_scale"]');
        if (!track && scratch) track = scratch.node;
        if (!track) track = handle.node.parentElement;
        const trackRect = track ? track.getBoundingClientRect() : handleRect;
        return {
            kind: scratch ? 'scratch' : 'slider',
            start: pointOf(handle.node, handle.root.offsetX, handle.root.offsetY),
            distance: Math.max(0, Math.round(trackRect.width - handleRect.width)),
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            text: textOf(container ? container.node : handle.node).slice(0, 120),
        };
    }

    if (container) {
        const direct = findIn('#rectBottom');
        if (direct) {
            return {
                kind: 'click',
                point: pointOf(direct.node, direct.root.offsetX, direct.root.offsetY),
                text: containerText.slice(0, 120),
            };
        }
        const candidates = Array.from(container.node.querySelectorAll('button, [role="button"], a, div, span'));
        const match = candidates.find(node => {
            if (!isVisible(node)) return false;
            const text = textOf(node);
            return /^(?:点击.*验证|点击完成验证|智能验证|一点即过|请点击.*|点击按钮完成验证)$/.test(text);
        });
        if (match) {
            return {
                kind: 'click',
                point: pointOf(match, container.root.offsetX, container.root.offsetY),
                text: textOf(match).slice(0, 120),
            };
        }
        if (/点击|验证/.test(containerText)) {
            return {
                kind: 'click',
                point: pointOf(container.node, container.root.offsetX, container.root.offsetY),
                text: containerText.slice(0, 120),
            };
        }
    }

    // Cross-origin punish/captcha iframes cannot be inspected from the top
    // document. Return the frame geometry so the solver can evaluate the
    // detector inside the frame and offset its coordinates.
    for (const iframe of document.querySelectorAll('iframe')) {
        if (!isVisible(iframe) || !trustedCaptchaFrame(iframe)) continue;
        const src = String(iframe.src || iframe.getAttribute('src') || '');
        try {
            if (iframe.contentDocument) continue;
        } catch {
            // A cross-origin access may throw depending on the browser.
        }
        const rect = iframe.getBoundingClientRect();
        return {
            kind: 'iframe',
            src,
            rect: {
                left: Math.round(rect.left),
                top: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
            },
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
        };
    }

    return { kind: 'none' };
}

export function isCaptchaSolverDisabled() {
    const value = process.env.OPENCLI_SOLVE_CAPTCHA;
    return value !== undefined && DISABLED_VALUES.test(String(value).trim());
}

async function clickAt(page, point) {
    if (!point) return false;
    if (typeof page.cdp === 'function') {
        try {
            await page.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
            await page.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
            await page.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
            return true;
        } catch {
            // Fall through to a DOM click.
        }
    }
    if (typeof page.nativeClick === 'function') {
        try {
            await page.nativeClick(point.x, point.y);
            return true;
        } catch {
            // Fall through to a DOM click.
        }
    }
    if (typeof page.evaluate === 'function') {
        return page.evaluate(({ x, y }) => {
            const element = document.elementFromPoint(x, y);
            if (!element) return false;
            element.click();
            return true;
        }, point);
    }
    return false;
}

function createDragControl(page, start) {
    const control = {
        cancelled: false,
        pressStarted: false,
        pressInFlight: false,
        pressed: false,
        releasePromise: null,
        releaseAttempted: false,
        releaseConfirmed: false,
        lastPoint: { ...start },
        waiters: new Set(),
        cancel() {
            if (this.cancelled) return;
            this.cancelled = true;
            for (const wake of this.waiters) wake();
            this.waiters.clear();
        },
        async wait(ms) {
            if (this.cancelled) return false;
            return new Promise(resolve => {
                let timer;
                const finish = value => {
                    clearTimeout(timer);
                    this.waiters.delete(wake);
                    resolve(value);
                };
                const wake = () => finish(false);
                timer = setTimeout(() => finish(true), ms);
                this.waiters.add(wake);
            });
        },
        async dispatch(params) {
            if (this.cancelled) return false;
            try {
                await page.cdp('Input.dispatchMouseEvent', params);
                return !this.cancelled;
            } catch (error) {
                if (this.cancelled) return false;
                throw error;
            }
        },
        async release() {
            if (!this.pressStarted || !this.pressed) return true;
            // A release issued before an unresolved mousePressed can reach the
            // page first and leave the eventual press stuck down.
            if (this.pressInFlight) return false;
            if (this.releaseAttempted) return this.releasePromise;
            this.releaseAttempted = true;
            this.releasePromise = (async () => {
                try {
                    await page.cdp('Input.dispatchMouseEvent', {
                        type: 'mouseReleased',
                        x: this.lastPoint.x,
                        y: this.lastPoint.y,
                        button: 'left',
                        clickCount: 1,
                    });
                    this.pressed = false;
                    this.releaseConfirmed = true;
                    return true;
                } catch {
                    return false;
                }
            })();
            return this.releasePromise;
        },
    };
    return control;
}

async function dragSlider(page, target, random, control) {
    const start = target.start;
    if (!start || !Number.isFinite(start.x) || !Number.isFinite(start.y)) return false;

    const points = buildSliderTrajectory(target.distance, {
        scratch: target.kind === 'scratch',
        random,
    });
    const maxX = Math.max(0, (Number(target.viewportWidth) || start.x + 2000) - 1);
    const moves = points.map(point => ({
        x: Math.min(maxX, Math.round(start.x + point.dx)),
        y: Math.round(start.y + point.dy),
        delayMs: point.delayMs,
    }));

    if (typeof page.cdp === 'function') {
        try {
            // Approach the handle the way a person would: move near it, then
            // onto it, pause briefly, then press.
            if (!await control.dispatch({
                type: 'mouseMoved',
                x: Math.max(0, start.x - 20),
                y: start.y,
            })) return false;
            if (!await control.dispatch({ type: 'mouseMoved', x: start.x, y: start.y })) return false;
            if (!await control.wait(60)) return false;

            control.pressStarted = true;
            control.pressed = true;
            control.pressInFlight = true;
            let pressed;
            try {
                pressed = await control.dispatch({
                    type: 'mousePressed',
                    x: start.x,
                    y: start.y,
                    button: 'left',
                    clickCount: 1,
                });
            } finally {
                control.pressInFlight = false;
            }
            if (!pressed) return false;

            for (const move of moves) {
                if (control.cancelled) return false;
                control.lastPoint = { x: move.x, y: move.y };
                if (!await control.dispatch({
                    type: 'mouseMoved',
                    x: move.x,
                    y: move.y,
                    button: 'left',
                    buttons: 1,
                })) return false;
                if (!await control.wait(move.delayMs)) return false;
            }
            return await control.release();
        } catch {
            if (control.cancelled) return false;
        } finally {
            // CDP calls that were already issued cannot be cancelled. Once the
            // in-flight call settles, release a button the drag had pressed.
            if (control.pressStarted && control.pressed) await control.release();
        }
    }

    if (control.cancelled || (control.pressStarted && !control.releaseConfirmed)) return false;
    if (typeof page.evaluate === 'function') {
        return page.evaluate(({ startPoint, path }) => {
            const element = document.elementFromPoint(startPoint.x, startPoint.y);
            if (!element) return false;
            const fire = (type, x, y, buttons) => element.dispatchEvent(new MouseEvent(type, {
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: y,
                button: 0,
                buttons,
            }));
            fire('mousedown', startPoint.x, startPoint.y, 1);
            for (const move of path) fire('mousemove', move.x, move.y, 1);
            const last = path[path.length - 1] || startPoint;
            fire('mouseup', last.x, last.y, 0);
            return true;
        }, { startPoint: start, path: moves });
    }
    return false;
}

function shiftCaptchaTarget(target, parentTarget) {
    if (!target) return target;
    const rect = parentTarget?.rect;
    const shifted = { ...target };
    if (rect && target.start) {
        shifted.start = {
            x: Math.round(target.start.x + rect.left),
            y: Math.round(target.start.y + rect.top),
        };
    }
    if (rect && target.point) {
        shifted.point = {
            x: Math.round(target.point.x + rect.left),
            y: Math.round(target.point.y + rect.top),
        };
    }
    if (parentTarget?.viewportWidth) shifted.viewportWidth = parentTarget.viewportWidth;
    if (parentTarget?.viewportHeight) shifted.viewportHeight = parentTarget.viewportHeight;
    return shifted;
}

async function findFrameForTarget(page, target) {
    if (typeof page.frames !== 'function' || typeof page.evaluateInFrame !== 'function') return null;
    const frames = await page.frames();
    if (!Array.isArray(frames) || frames.length === 0) return null;
    const src = String(target?.src || '');
    const exact = frames.find(frame => String(frame.url || '') === src);
    if (exact) return exact;
    for (const marker of ['_____tmd_____', 'punish', 'captcha', 'baxia', 'nocaptcha', 'verify']) {
        const match = frames.find(frame => String(frame.url || '').toLowerCase().includes(marker));
        if (match) return match;
    }
    return frames.length === 1 ? frames[0] : null;
}

const SLIDER_ATTEMPT_TIMEOUT_MS = 8000;
const SLIDER_CLEANUP_TIMEOUT_MS = 2000;

async function readVisibility(page) {
    try {
        return await page.evaluate(PAGE_VISIBILITY_SCRIPT);
    } catch {
        return null;
    }
}

async function maybeBringToFront(page, allowRefresh) {
    const before = await readVisibility(page);
    if (before !== 'hidden') {
        return { wasHidden: false, visible: before !== 'hidden', refreshed: false };
    }

    let visible = await ensurePageVisible(page);
    let refreshed = false;
    if (!visible && allowRefresh) {
        try {
            const url = typeof page.getCurrentUrl === 'function' ? await page.getCurrentUrl() : null;
            if (url && typeof page.goto === 'function') {
                await page.goto(url, { waitUntil: 'none' });
                await sleep(800);
                refreshed = true;
                visible = await ensurePageVisible(page);
            }
        } catch {
            // Refresh is best-effort; keep the original page if it fails.
        }
    }
    return { wasHidden: true, visible, refreshed };
}

async function attemptSlider(page, target, random) {
    const start = target?.start;
    if (!start || !Number.isFinite(start.x) || !Number.isFinite(start.y)) {
        return { timedOut: false, completed: false };
    }

    const control = createDragControl(page, start);
    const drag = dragSlider(page, target, random, control);
    let timeoutTimer;
    const timeout = new Promise(resolve => {
        timeoutTimer = setTimeout(() => {
            control.cancel();
            resolve('timeout');
        }, SLIDER_ATTEMPT_TIMEOUT_MS);
    });

    try {
        const outcome = await Promise.race([
            drag.then(value => ({ kind: 'done', value }), () => ({ kind: 'error', value: false })),
            timeout,
        ]);
        if (outcome !== 'timeout') {
            return {
                timedOut: false,
                completed: outcome.kind === 'done' && outcome.value === true,
                cleanupUnconfirmed: control.pressStarted && !control.releaseConfirmed,
            };
        }

        // An issued CDP command may still run in Chrome even after this promise
        // times out. Wait for it before cleanup, then bound the wait so a stuck
        // bridge cannot hold the solver forever. A late release may follow, but
        // callers stop here and never start another drag.
        const settled = await waitForSettled(drag, SLIDER_CLEANUP_TIMEOUT_MS);
        if (!settled) await waitForSettled(control.release(), SLIDER_CLEANUP_TIMEOUT_MS);
        return {
            timedOut: true,
            completed: false,
            cleanupUnconfirmed: !settled || (control.pressStarted && !control.releaseConfirmed),
        };
    } finally {
        clearTimeout(timeoutTimer);
    }
}

async function waitForSolved(page, isSolved) {
    if (typeof isSolved !== 'function') return false;
    for (const delay of [200, 300]) {
        await sleep(delay);
        try {
            if (await isSolved()) return true;
        } catch {
            // A navigation during verification can make the probe throw; keep
            // polling once before treating it as a failure.
        }
    }
    return false;
}

/**
 * Try to clear a Taobao/Goofish Alibaba challenge.
 *
 * Returns `{ attempted, solved, attempts, kind, disabled? }`. The caller owns
 * the final page-state decision: `isSolved` should re-read the site's own
 * blocked/login state after each attempt.
 */
export async function solveAlibabaCaptcha(page, options = {}) {
    if (isCaptchaSolverDisabled()) {
        return { attempted: false, solved: false, attempts: 0, kind: null, disabled: true };
    }

    const maxAttempts = Math.max(1, Number(options.maxAttempts) || 3);
    const random = typeof options.random === 'function' ? options.random : Math.random;
    const isSolved = options.isSolved;
    let dragAttempts = 0;
    let loops = 0;
    let kind = null;
    let refreshed = false;

    while (dragAttempts < maxAttempts && loops < maxAttempts * 3 + 2) {
        loops += 1;
        const target = await page.evaluate(buildCaptchaEvaluateScript(findCaptchaTargetInPage));

        if (!target || target.kind === 'none') {
            const solved = await waitForSolved(page, isSolved);
            return { attempted: dragAttempts > 0, solved, attempts: dragAttempts, kind };
        }

        kind = target.kind;

        if (target.kind === 'iframe') {
            const frame = await findFrameForTarget(page, target);
            if (!frame) break;
            let inner;
            try {
                inner = await page.evaluateInFrame(
                    buildCaptchaEvaluateScript(findCaptchaTargetInPage),
                    frame.index,
                );
            } catch {
                await sleep(300);
                continue;
            }
            if (!inner || inner.kind === 'none' || inner.kind === 'iframe') break;
            const shifted = shiftCaptchaTarget(inner, target);
            if (shifted.kind === 'retry') {
                await clickAt(page, shifted.point);
                await sleep(450);
                continue;
            }
            dragAttempts += 1;
            if (shifted.kind === 'slider' || shifted.kind === 'scratch') {
                const slider = await attemptSlider(page, shifted, random);
                if (slider.timedOut || slider.cleanupUnconfirmed) {
                    return {
                        attempted: true,
                        solved: false,
                        attempts: dragAttempts,
                        kind,
                        ...(slider.timedOut ? { timedOut: true } : {}),
                        cleanupUnconfirmed: Boolean(slider.cleanupUnconfirmed),
                    };
                }
            } else if (shifted.kind === 'click') {
                await clickAt(page, shifted.point);
            }
            if (await waitForSolved(page, isSolved)) {
                return { attempted: true, solved: true, attempts: dragAttempts, kind };
            }
            if (dragAttempts < maxAttempts && (shifted.kind === 'slider' || shifted.kind === 'scratch')) {
                const focus = await maybeBringToFront(page, !refreshed);
                if (focus.refreshed) refreshed = true;
                if (focus.wasHidden && !focus.visible) {
                    return { attempted: true, solved: false, attempts: dragAttempts, kind, hidden: true };
                }
            }
            continue;
        }

        if (target.kind === 'retry') {
            await clickAt(page, target.point);
            await sleep(450);
            continue;
        }

        const sliderAttempt = target.kind === 'slider' || target.kind === 'scratch';
        if (sliderAttempt) {
            dragAttempts += 1;
            const slider = await attemptSlider(page, target, random);
            if (slider.timedOut || slider.cleanupUnconfirmed) {
                return {
                    attempted: true,
                    solved: false,
                    attempts: dragAttempts,
                    kind,
                    ...(slider.timedOut ? { timedOut: true } : {}),
                    cleanupUnconfirmed: Boolean(slider.cleanupUnconfirmed),
                };
            }
        } else if (target.kind === 'click') {
            dragAttempts += 1;
            await clickAt(page, target.point);
        } else {
            dragAttempts += 1;
        }

        if (await waitForSolved(page, isSolved)) {
            return { attempted: true, solved: true, attempts: dragAttempts, kind };
        }

        if (sliderAttempt && dragAttempts < maxAttempts) {
            const focus = await maybeBringToFront(page, !refreshed);
            if (focus.refreshed) refreshed = true;
            if (focus.wasHidden && !focus.visible) {
                return { attempted: true, solved: false, attempts: dragAttempts, kind, hidden: true };
            }
        }
    }

    return { attempted: dragAttempts > 0, solved: false, attempts: dragAttempts, kind };
}
