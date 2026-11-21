import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import {
    buildCaptchaEvaluateScript,
    buildSliderTrajectory,
    ensurePageVisible,
    findCaptchaTargetInPage,
    PAGE_VISIBILITY_SCRIPT,
    solveAlibabaCaptcha,
} from './captcha-solver.js';

const doms = [];
afterEach(() => {
    vi.useRealTimers();
    for (const dom of doms.splice(0)) dom.window.close();
});

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

async function flushMicrotasks(count = 10) {
    for (let index = 0; index < count; index++) await Promise.resolve();
}

function fixture(html, url = 'https://item.taobao.com/item.htm?id=123') {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    doms.push(dom);
    return dom;
}

function rect(dom, selector, { left, top, width, height }) {
    const element = dom.window.document.querySelector(selector);
    if (!element) throw new Error(`Missing fixture element: ${selector}`);
    element.getBoundingClientRect = () => ({
        left, top, width, height,
        right: left + width,
        bottom: top + height,
        x: left,
        y: top,
    });
    return element;
}

function detect(dom) {
    return dom.window.eval(`(${findCaptchaTargetInPage.toString()})()`);
}

function fakePage(targets, {
    solved = true,
    visibility = 'visible',
    cdp = vi.fn().mockResolvedValue(undefined),
    frames = [],
    frameTargets = [],
} = {}) {
    const isSolved = Array.isArray(solved) ? vi.fn() : vi.fn().mockResolvedValue(solved);
    if (Array.isArray(solved)) {
        for (const value of solved) isSolved.mockResolvedValueOnce(value);
        isSolved.mockResolvedValue(solved[solved.length - 1]);
    }
    let index = 0;
    let frameIndex = 0;
    let currentVisibility = visibility;
    const cdpMock = vi.fn(async (method, params) => {
        const result = await cdp(method, params);
        if (method === 'Page.bringToFront') currentVisibility = 'visible';
        return result;
    });
    return {
        cdp: cdpMock,
        evaluate: vi.fn(async script => {
            if (script === PAGE_VISIBILITY_SCRIPT) return currentVisibility;
            const target = targets[Math.min(index, targets.length - 1)];
            index += 1;
            return target;
        }),
        frames: vi.fn(async () => frames),
        evaluateInFrame: vi.fn(async () => {
            const target = frameTargets[Math.min(frameIndex, frameTargets.length - 1)];
            frameIndex += 1;
            return target;
        }),
        wait: vi.fn().mockResolvedValue(undefined),
        isSolved,
    };
}

describe('buildCaptchaEvaluateScript', () => {
    it('shims esbuild __name so transpiled inner helpers stay callable', () => {
        const dom = fixture('');
        const script = buildCaptchaEvaluateScript(function () {
            const inner = __name(() => 42, 'inner');
            return inner();
        });
        expect(dom.window.eval(script)).toBe(42);
    });
});

describe('ensurePageVisible', () => {
    it('asks Chrome to bring a hidden tab to the front', async () => {
        const evaluate = vi.fn()
            .mockResolvedValueOnce('hidden')
            .mockResolvedValueOnce('visible');
        const page = { evaluate, cdp: vi.fn().mockResolvedValue(undefined) };

        await expect(ensurePageVisible(page)).resolves.toBe(true);
        expect(page.cdp).toHaveBeenCalledWith('Page.bringToFront');
        expect(evaluate).toHaveBeenLastCalledWith(PAGE_VISIBILITY_SCRIPT);
    });

    it('does not touch a visible tab', async () => {
        const page = { evaluate: vi.fn().mockResolvedValue('visible'), cdp: vi.fn() };

        await expect(ensurePageVisible(page)).resolves.toBe(true);
        expect(page.cdp).not.toHaveBeenCalled();
    });

    it('reports failure instead of throwing when bringToFront is unavailable', async () => {
        const page = {
            evaluate: vi.fn().mockResolvedValue('hidden'),
            cdp: vi.fn().mockRejectedValue(new Error('CDP method not permitted')),
        };

        await expect(ensurePageVisible(page)).resolves.toBe(false);
    });
});

describe('findCaptchaTargetInPage', () => {
    it('returns the handle and track geometry for a NoCaptcha slider', () => {
        const dom = fixture('<div id="nc_1_n1t"><span id="nc_1_n1z">slide</span></div>');
        rect(dom, '#nc_1_n1t', { left: 100, top: 200, width: 300, height: 34 });
        rect(dom, '#nc_1_n1z', { left: 100, top: 202, width: 42, height: 30 });

        expect(detect(dom)).toMatchObject({
            kind: 'slider',
            start: { x: 121, y: 217 },
            distance: 258,
            viewportWidth: 1024,
        });
    });

    it('asks the caller to click the retry prompt after a failed drag', () => {
        const dom = fixture('<div id="nocaptcha"><div class="nc-lang-cnt">验证失败，点击框体重试</div></div>');
        rect(dom, '#nocaptcha', { left: 100, top: 200, width: 300, height: 34 });
        rect(dom, '.nc-lang-cnt', { left: 120, top: 210, width: 200, height: 20 });

        expect(detect(dom)).toMatchObject({
            kind: 'retry',
            point: { x: 250, y: 217 },
        });
    });

    it('returns a click point for one-tap smart verification', () => {
        const dom = fixture('<div id="nocaptcha"><button id="rectBottom">点击完成验证</button></div>');
        rect(dom, '#nocaptcha', { left: 100, top: 200, width: 300, height: 34 });
        rect(dom, '#rectBottom', { left: 150, top: 205, width: 120, height: 24 });

        expect(detect(dom)).toMatchObject({
            kind: 'click',
            point: { x: 210, y: 217 },
        });
    });

    it('returns a cross-origin punish iframe target', () => {
        const dom = fixture('<iframe src="https://h5api.m.goofish.com//h5/mtop.taobao.idle.pc.detail/1.0/_____tmd_____/punish?x5secdata=abc&x5step=2&action=captcha"></iframe>');
        rect(dom, 'iframe', { left: 296, top: 126, width: 420, height: 320 });
        Object.defineProperty(dom.window.document.querySelector('iframe'), 'contentDocument', { get: () => null });

        expect(detect(dom)).toMatchObject({
            kind: 'iframe',
            rect: { left: 296, top: 126, width: 420, height: 320 },
        });
    });

    it('ignores an ordinary trusted-host verify iframe', () => {
        const dom = fixture('<iframe src="https://www.taobao.com/verify"></iframe>');
        rect(dom, 'iframe', { left: 20, top: 30, width: 300, height: 180 });
        Object.defineProperty(dom.window.document.querySelector('iframe'), 'contentDocument', { get: () => null });

        expect(detect(dom)).toEqual({ kind: 'none' });
    });

    it('ignores a hidden cross-origin punish iframe', () => {
        const dom = fixture('<div hidden><iframe src="https://h5api.m.goofish.com/_____tmd_____/punish?x5secdata=abc"></iframe></div>');
        rect(dom, 'iframe', { left: 296, top: 126, width: 420, height: 320 });
        Object.defineProperty(dom.window.document.querySelector('iframe'), 'contentDocument', { get: () => null });

        expect(detect(dom)).toEqual({ kind: 'none' });
    });

    it('ignores hidden challenge widgets', () => {
        const dom = fixture('<div hidden><div id="nc_1_n1t"><span id="nc_1_n1z">slide</span></div></div>');
        rect(dom, '#nc_1_n1t', { left: 100, top: 200, width: 300, height: 34 });
        rect(dom, '#nc_1_n1z', { left: 100, top: 202, width: 42, height: 30 });

        expect(detect(dom)).toEqual({ kind: 'none' });
    });
});

describe('solveAlibabaCaptcha', () => {
    const slider = {
        kind: 'slider',
        start: { x: 100, y: 50 },
        distance: 200,
        viewportWidth: 1024,
        viewportHeight: 768,
    };

    it('drags the slider with trusted CDP mouse events and reports success', async () => {
        const page = fakePage([slider], { solved: true });

        const result = await solveAlibabaCaptcha(page, { isSolved: page.isSolved });

        expect(result).toMatchObject({ attempted: true, solved: true, attempts: 1, kind: 'slider' });
        const methods = page.cdp.mock.calls.map(([method, params]) => `${method}:${params.type}`);
        expect(methods).toContain('Input.dispatchMouseEvent:mousePressed');
        expect(methods).toContain('Input.dispatchMouseEvent:mouseMoved');
        expect(methods).toContain('Input.dispatchMouseEvent:mouseReleased');
        const moves = page.cdp.mock.calls
            .filter(([method, params]) => method === 'Input.dispatchMouseEvent' && params.type === 'mouseMoved')
            .map(([, params]) => params);
        expect(moves.some(params => params.buttons === 1)).toBe(true);
        expect(page.cdp.mock.calls.some(([, params]) => params.x > slider.start.x + slider.distance)).toBe(true);
    });

    it('tries the slider before changing foreground', async () => {
        const page = fakePage([slider], { solved: true, visibility: 'hidden' });

        const result = await solveAlibabaCaptcha(page, { isSolved: page.isSolved });

        expect(result).toMatchObject({ attempted: true, solved: true });
        expect(page.cdp).not.toHaveBeenCalledWith('Page.bringToFront');
    });

    it('brings a hidden tab forward after a slider attempt fails', async () => {
        const page = fakePage([slider], {
            visibility: 'hidden',
            solved: [false, false, true],
        });

        const result = await solveAlibabaCaptcha(page, { isSolved: page.isSolved });

        expect(result).toMatchObject({ attempted: true, solved: true });
        const bringIndex = page.cdp.mock.calls.findIndex(([method]) => method === 'Page.bringToFront');
        const pressIndex = page.cdp.mock.calls.findIndex(([, params]) => params?.type === 'mousePressed');
        expect(bringIndex).toBeGreaterThan(pressIndex);
    });

    it('does not change foreground for a visible tab after a failed attempt', async () => {
        const page = fakePage([slider], {
            visibility: 'visible',
            solved: [false, false, true],
        });

        const result = await solveAlibabaCaptcha(page, { isSolved: page.isSolved });

        expect(result).toMatchObject({ attempted: true, solved: true });
        expect(page.cdp).not.toHaveBeenCalledWith('Page.bringToFront');
    });

    it('clicks the retry prompt and tries again before giving up after three drags', async () => {
        vi.useFakeTimers();
        const retry = { kind: 'retry', point: { x: 250, y: 60 } };
        const page = fakePage([slider, retry, slider, retry, slider], { solved: false });
        const solving = solveAlibabaCaptcha(page, {
            isSolved: page.isSolved,
            maxAttempts: 3,
            random: () => 0.5,
        });

        await vi.runAllTimersAsync();
        const result = await solving;

        expect(result).toMatchObject({ attempted: true, solved: false, attempts: 3, kind: 'slider' });
        const presses = page.cdp.mock.calls.filter(([, params]) => params.type === 'mousePressed');
        // Three drag presses plus two retry-prompt clicks.
        expect(presses).toHaveLength(5);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('falls back to page-dispatched mouse events when CDP rejects the drag', async () => {
        const page = fakePage([slider, true], {
            solved: true,
            cdp: vi.fn().mockRejectedValue(new Error('CDP not attached')),
        });

        const result = await solveAlibabaCaptcha(page, { isSolved: page.isSolved });

        expect(result).toMatchObject({ attempted: true, solved: true, attempts: 1, kind: 'slider' });
        // top-level detection + DOM drag fallback
        expect(page.evaluate).toHaveBeenCalledTimes(2);
    });

    it('cancels a timed-out drag after the in-flight move resolves and releases the button', async () => {
        vi.useFakeTimers();
        const inFlight = deferred();
        const events = [];
        let pressed = false;
        const cdp = vi.fn((_method, params) => {
            events.push(params);
            if (params.type === 'mousePressed') pressed = true;
            if (params.type === 'mouseReleased') pressed = false;
            if (params.type === 'mouseMoved' && params.buttons === 1) return inFlight.promise;
            return Promise.resolve();
        });
        const page = fakePage([slider], { solved: true, cdp });
        const solving = solveAlibabaCaptcha(page, { isSolved: page.isSolved, maxAttempts: 3 });

        await flushMicrotasks();
        await vi.advanceTimersByTimeAsync(8_000);
        inFlight.resolve();
        await vi.advanceTimersByTimeAsync(0);

        await expect(solving).resolves.toMatchObject({
            attempted: true,
            solved: false,
            attempts: 1,
            timedOut: true,
            cleanupUnconfirmed: false,
        });
        expect(pressed).toBe(false);
        expect(events.at(-1)).toMatchObject({ type: 'mouseReleased', button: 'left' });
        expect(events.filter(event => event.type === 'mouseMoved' && event.buttons === 1)).toHaveLength(1);
        expect(page.isSolved).not.toHaveBeenCalled();
        expect(page.evaluate).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);

        const settledEventCount = events.length;
        await flushMicrotasks();
        expect(events).toHaveLength(settledEventCount);
    });

    it('handles a late in-flight move rejection during timeout cleanup', async () => {
        vi.useFakeTimers();
        const inFlight = deferred();
        const events = [];
        let pressed = false;
        const cdp = vi.fn((_method, params) => {
            events.push(params);
            if (params.type === 'mousePressed') pressed = true;
            if (params.type === 'mouseReleased') pressed = false;
            if (params.type === 'mouseMoved' && params.buttons === 1) return inFlight.promise;
            return Promise.resolve();
        });
        const page = fakePage([slider], { solved: true, cdp });
        const solving = solveAlibabaCaptcha(page, { isSolved: page.isSolved });

        await flushMicrotasks();
        await vi.advanceTimersByTimeAsync(8_000);
        inFlight.reject(new Error('late CDP failure'));
        await vi.advanceTimersByTimeAsync(0);

        await expect(solving).resolves.toMatchObject({ attempted: true, solved: false, attempts: 1, timedOut: true });
        expect(pressed).toBe(false);
        expect(events.at(-1)).toMatchObject({ type: 'mouseReleased' });
        expect(events.filter(event => event.type === 'mouseMoved' && event.buttons === 1)).toHaveLength(1);
        expect(page.evaluate).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('waits for an in-flight press before releasing the timed-out drag', async () => {
        vi.useFakeTimers();
        const inFlight = deferred();
        const events = [];
        const cdp = vi.fn((_method, params) => {
            events.push(params);
            if (params.type === 'mousePressed') return inFlight.promise;
            return Promise.resolve();
        });
        const page = fakePage([slider], { solved: true, cdp });
        const solving = solveAlibabaCaptcha(page, { isSolved: page.isSolved });

        await flushMicrotasks();
        await vi.advanceTimersByTimeAsync(8_000);
        expect(events.some(event => event.type === 'mouseReleased')).toBe(false);

        inFlight.resolve();
        await vi.advanceTimersByTimeAsync(0);

        await expect(solving).resolves.toMatchObject({ attempts: 1, timedOut: true, cleanupUnconfirmed: false });
        expect(events.filter(event => event.type === 'mousePressed')).toHaveLength(1);
        expect(events.at(-1)).toMatchObject({ type: 'mouseReleased' });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('allows only one late release when an in-flight press resolves after ten seconds', async () => {
        vi.useFakeTimers();
        const inFlight = deferred();
        const events = [];
        const cdp = vi.fn((_method, params) => {
            events.push(params);
            if (params.type === 'mousePressed') return inFlight.promise;
            return Promise.resolve();
        });
        const page = fakePage([slider], { solved: true, cdp });
        const solving = solveAlibabaCaptcha(page, { isSolved: page.isSolved, maxAttempts: 10 });

        await flushMicrotasks();
        await vi.advanceTimersByTimeAsync(10_000);

        await expect(solving).resolves.toMatchObject({
            attempted: true,
            solved: false,
            attempts: 1,
            timedOut: true,
            cleanupUnconfirmed: true,
        });
        expect(events.some(event => event.type === 'mouseReleased')).toBe(false);

        inFlight.resolve();
        await vi.advanceTimersByTimeAsync(0);

        expect(events.filter(event => event.type === 'mousePressed')).toHaveLength(1);
        expect(events.filter(event => event.type === 'mouseReleased')).toHaveLength(1);
        expect(events.filter(event => event.type === 'mouseMoved' && event.buttons === 1)).toHaveLength(0);
        expect(page.isSolved).not.toHaveBeenCalled();
        expect(page.evaluate).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not double-release or start DOM fallback when CDP release fails', async () => {
        const cdp = vi.fn((_method, params) => {
            if (params.type === 'mouseMoved' && params.buttons === 1) {
                return Promise.reject(new Error('move failed'));
            }
            if (params.type === 'mouseReleased') return Promise.reject(new Error('release failed'));
            return Promise.resolve();
        });
        const page = fakePage([slider], { solved: true, cdp });

        const result = await solveAlibabaCaptcha(page, { isSolved: page.isSolved });

        expect(result).toMatchObject({
            attempted: true,
            solved: false,
            attempts: 1,
            cleanupUnconfirmed: true,
        });
        expect(page.cdp.mock.calls.filter(([, params]) => params.type === 'mouseReleased')).toHaveLength(1);
        expect(page.evaluate).toHaveBeenCalledTimes(1);
        expect(page.isSolved).not.toHaveBeenCalled();
    });

    it('never reports solved after a timed-out drag whose cleanup release fails', async () => {
        vi.useFakeTimers();
        const inFlight = deferred();
        const cdp = vi.fn((_method, params) => {
            if (params.type === 'mouseMoved' && params.buttons === 1) return inFlight.promise;
            if (params.type === 'mouseReleased') return Promise.reject(new Error('release failed'));
            return Promise.resolve();
        });
        const page = fakePage([slider], { solved: true, cdp });
        const solving = solveAlibabaCaptcha(page, { isSolved: page.isSolved });

        await flushMicrotasks();
        await vi.advanceTimersByTimeAsync(8_000);
        inFlight.resolve();
        await vi.advanceTimersByTimeAsync(0);

        await expect(solving).resolves.toMatchObject({
            attempted: true,
            solved: false,
            attempts: 1,
            timedOut: true,
            cleanupUnconfirmed: true,
        });
        expect(page.cdp.mock.calls.filter(([, params]) => params.type === 'mouseReleased')).toHaveLength(1);
        expect(page.isSolved).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('returns after bounded cleanup when an in-flight CDP call never settles', async () => {
        vi.useFakeTimers();
        const inFlight = deferred();
        const cdp = vi.fn((_method, params) => {
            if (params.type === 'mouseMoved' && params.buttons === 1) return inFlight.promise;
            return Promise.resolve();
        });
        const page = fakePage([slider], { solved: true, cdp });
        const solving = solveAlibabaCaptcha(page, { isSolved: page.isSolved, maxAttempts: 10 });

        await flushMicrotasks();
        await vi.advanceTimersByTimeAsync(10_000);

        await expect(solving).resolves.toMatchObject({
            attempted: true,
            solved: false,
            attempts: 1,
            timedOut: true,
            cleanupUnconfirmed: true,
        });
        expect(page.cdp.mock.calls.filter(([, params]) => params.type === 'mousePressed')).toHaveLength(1);
        expect(page.cdp).toHaveBeenCalledWith('Input.dispatchMouseEvent', expect.objectContaining({ type: 'mouseReleased' }));
        expect(page.isSolved).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('solves a slider inside a cross-origin punish iframe', async () => {
        const iframe = {
            kind: 'iframe',
            src: 'https://h5api.m.goofish.com//h5/mtop.taobao.idle.pc.detail/1.0/_____tmd_____/punish?x5secdata=abc&x5step=2&action=captcha',
            rect: { left: 296, top: 126, width: 420, height: 320 },
        };
        const innerSlider = {
            kind: 'slider',
            start: { x: 62, y: 197 },
            distance: 258,
            viewportWidth: 420,
            viewportHeight: 320,
        };
        const page = fakePage([iframe], {
            solved: true,
            frames: [{ index: 0, url: iframe.src, name: '' }],
            frameTargets: [innerSlider],
        });

        const result = await solveAlibabaCaptcha(page, { isSolved: page.isSolved });

        expect(result).toMatchObject({ attempted: true, solved: true, attempts: 1, kind: 'iframe' });
        expect(page.evaluateInFrame).toHaveBeenCalled();
        expect(page.cdp).toHaveBeenCalledWith('Input.dispatchMouseEvent', expect.objectContaining({
            type: 'mousePressed',
            x: 296 + 62,
            y: 126 + 197,
        }));
    });

    it('does not touch the page when no challenge is present', async () => {
        const page = fakePage([{ kind: 'none' }]);

        const result = await solveAlibabaCaptcha(page, { isSolved: page.isSolved });

        expect(result).toMatchObject({ attempted: false, solved: true, attempts: 0, kind: null });
        expect(page.cdp).not.toHaveBeenCalled();
    });

    it('is disabled by OPENCLI_SOLVE_CAPTCHA=0', async () => {
        const previous = process.env.OPENCLI_SOLVE_CAPTCHA;
        process.env.OPENCLI_SOLVE_CAPTCHA = '0';
        try {
            const page = fakePage([slider]);
            const result = await solveAlibabaCaptcha(page, { isSolved: page.isSolved });
            expect(result).toMatchObject({ attempted: false, solved: false, disabled: true });
            expect(page.evaluate).not.toHaveBeenCalled();
        } finally {
            if (previous === undefined) delete process.env.OPENCLI_SOLVE_CAPTCHA;
            else process.env.OPENCLI_SOLVE_CAPTCHA = previous;
        }
    });
});
