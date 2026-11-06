import { AuthRequiredError, CliError } from '@jackwener/opencli/errors';

/**
 * JD login / security-verification detection shared by the browser-rendered
 * jd commands (item, search).
 *
 * JD sends an unauthenticated desktop session to passport.jd.com and a flagged
 * session to its risk_handler verification page. Neither page has the target
 * DOM, so an extractor that only looks for products silently returns nothing
 * (#2710). `detectJdGate` runs in the page — callers inject it with
 * `${detectJdGate.toString()}` — and `jdGateError` turns its result into a
 * typed error on the Node side.
 */
export function detectJdGate() {
    const href = location.href;
    const title = document.title || '';
    const bodyText = document.body?.innerText || document.body?.textContent || '';
    const isLoginPage = /passport\.jd\.com|\/login\.aspx/.test(href) || /京东-欢迎登录|京东登录/.test(title);
    const hasSecurityChallenge = /risk_handler|安全验证|安全校验|完成安全验证|滑块|captcha|访问过于频繁|验证中心|京东验证/.test(`${href}\n${title}\n${bodyText}`);
    return { href, title, bodyText, isLoginPage, hasSecurityChallenge };
}

function describeLocation(href) {
    try {
        const url = new URL(href);
        return `${url.host}${url.pathname}`;
    }
    catch {
        return String(href || 'unknown page');
    }
}

/**
 * Typed error for a gate reported by `detectJdGate`, or null when the page is
 * neither a login nor a verification page.
 */
export function jdGateError(gate, label) {
    if (gate?.isLoginPage) {
        return new AuthRequiredError('jd.com', `${label} was redirected to the JD login page (${describeLocation(gate.href)})`, 'Run `opencli jd login` (or log in to https://www.jd.com in the browser), then retry.');
    }
    if (gate?.hasSecurityChallenge) {
        return new CliError('SECURITY_BLOCK', `${label} is showing a JD security verification page (${describeLocation(gate.href)})`, 'Open the page in your browser, complete JD verification, then retry.');
    }
    return null;
}
