import { AuthRequiredError, CliError, CommandExecutionError } from '@jackwener/opencli/errors';
import { buildCaptchaEvaluateScript, solveAlibabaCaptcha } from '../_shared/captcha-solver.js';

export function taobaoPageState() {
    const url = new URL(location.href);
    const title = (document.title || '').trim();
    const isVisible = node => {
        if (!node || !node.isConnected) return false;
        if (node.closest('[hidden], [aria-hidden="true"]')) return false;
        for (let parent = node; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) return false;
        }
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    };
    const isTrustedCaptchaFrame = frame => {
        let frameUrl;
        try {
            frameUrl = new URL(String(frame.src || frame.getAttribute('src') || ''), location.href);
        } catch {
            return false;
        }
        if (!/(?:^|\.)(?:taobao\.com|tmall\.com|alibaba\.com|goofish\.com)$/i.test(frameUrl.hostname)) {
            return false;
        }
        return /_____tmd_____|\/(?:punish|captcha|nocaptcha|baxia)(?:\/|$)/i.test(frameUrl.pathname)
            || frameUrl.searchParams.has('x5sec')
            || frameUrl.searchParams.has('x5secdata')
            || frameUrl.searchParams.get('action')?.toLowerCase() === 'captcha';
    };
    const challengeVisible = Array.from(document.querySelectorAll('#nocaptcha, #nc_1_wrapper, #nc_1_n1t, #nc_1_n1z, .nc_scale, #baxia-dialog-content, .nc-container, [class*="nc-container"]')).some(isVisible);
    const captchaFrameVisible = Array.from(document.querySelectorAll('iframe')).some(frame => {
        if (!isVisible(frame) || !isTrustedCaptchaFrame(frame)) return false;
        try {
            return !frame.contentDocument;
        } catch {
            return true;
        }
    });
    // Inspect routing and dedicated challenge UI, not product descriptions.
    if (/(?:^|\/)(?:punish|captcha|verify)(?:\/|$)/i.test(url.pathname)
        || url.searchParams.has('_____tmd_____') || url.searchParams.has('x5sec')
        || /安全验证|滑块验证|访问受限|账号异常|账户异常|captcha|security verification/i.test(title)
        || challengeVisible || captchaFrameVisible) {
        return 'blocked';
    }
    if (/^(?:login|passport)\.(?:taobao|tmall|alibaba)\.com$/i.test(url.hostname)
        || /^(?:登录|登入)(?:\s|[-_—]|$)/.test(title)
        || /\/member\/login\.jhtml$/.test(url.pathname)) return 'login';
    return 'ok';
}

export function requireTaobaoPageState(state) {
    if (state === 'blocked') throw new CliError('SECURITY_BLOCK', 'Taobao requires security verification.', 'Automatic slider attempts did not clear the challenge. Resolve it in your browser; the command was not retried.');
    if (state === 'login') throw new AuthRequiredError('taobao.com', 'Taobao requires login; the command was not retried.');
    if (state !== 'ok') throw new CommandExecutionError('Could not verify the Taobao page state.');
}

async function readTaobaoPageState(page) {
    return page.evaluate(buildCaptchaEvaluateScript(taobaoPageState));
}

export async function assertTaobaoPageUsable(page) {
    let state = await readTaobaoPageState(page);
    if (state === 'blocked') {
        const result = await solveAlibabaCaptcha(page, {
            isSolved: async () => (await readTaobaoPageState(page)) === 'ok',
        });
        if (result.solved) state = await readTaobaoPageState(page);
    }
    requireTaobaoPageState(state);
}
