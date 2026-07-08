import { ArgumentError } from '@jackwener/opencli/errors';

export const MESSAGE_WRAPPER_SELECTOR = '[class*="group/message"]';
export const MIN_COMPOSER_SCORE = 120;

export function requirePositiveTimeout(value) {
    const timeout = value;
    if (!Number.isInteger(timeout) || timeout <= 0) {
        throw new ArgumentError('--timeout must be a positive integer (seconds)');
    }
    return timeout;
}

export function scoreChatwiseComposerCandidate(candidate, viewportHeight = 0) {
    if (candidate.hidden) return -1000;

    let score = 0;
    const normalizedRole = String(candidate.role || '').toLowerCase();
    if (normalizedRole === 'textbox') score += 10;

    const normalizedClasses = `${candidate.classes || ''} ${candidate.editorClasses || ''} ${candidate.ariaLabel || ''}`.toLowerCase();
    if (normalizedClasses.includes('cm-content')) score += 20;
    if (normalizedClasses.includes('cm-editor')) score += 30;
    if (normalizedClasses.includes('simple-editor')) score -= 140;

    const searchableText = `${candidate.placeholder || ''} ${candidate.ariaLabel || ''} ${candidate.text || ''}`.toLowerCase();
    if (searchableText.includes('enter a message here')) score += 220;
    if (searchableText.includes('press ⏎ to send')) score += 80;
    if (searchableText.includes('press enter to send')) score += 80;
    if (searchableText.includes('message')) score += 20;
    if (searchableText.includes('optional description')) score -= 140;
    if (searchableText.includes('user context document')) score -= 220;

    if (viewportHeight > 0 && candidate.rect) {
        const bottom = candidate.rect.y + candidate.rect.h;
        const distanceFromBottom = Math.abs(viewportHeight - bottom);
        score += Math.max(0, 80 - distanceFromBottom / 8);
    }

    return score;
}

export function selectBestChatwiseComposer(candidates, viewportHeight = 0, minScore = MIN_COMPOSER_SCORE) {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    const best = [...candidates]
        .sort((left, right) => {
            const delta = scoreChatwiseComposerCandidate(right, viewportHeight)
                - scoreChatwiseComposerCandidate(left, viewportHeight);
            return delta !== 0 ? delta : left.index - right.index;
        })[0] ?? null;
    if (!best || scoreChatwiseComposerCandidate(best, viewportHeight) < minScore) return null;
    return best;
}

export function buildChatwiseInjectTextJs(text) {
    const scoreFn = scoreChatwiseComposerCandidate.toString();
    const selectFn = selectBestChatwiseComposer.toString();
    const textJs = JSON.stringify(String(text ?? ''));

    return `
      (function(text) {
        const scoreChatwiseComposerCandidate = ${scoreFn};
        const selectBestChatwiseComposer = ${selectFn};
        const MIN_COMPOSER_SCORE = ${MIN_COMPOSER_SCORE};

        const composers = Array.from(document.querySelectorAll([
          'textarea[aria-label*="message" i]',
          'textarea[placeholder*="message" i]',
          '[contenteditable="true"][role="textbox"]',
          '[contenteditable="true"]'
        ].join(',')));
        const candidates = composers.map((el, index) => {
          const rect = el.getBoundingClientRect();
          const editor = el.closest('.cm-editor');
          const placeholderEl = editor?.querySelector('.cm-placeholder');
          return {
            index,
            hidden: !(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
            role: el.getAttribute('role'),
            classes: el.className || '',
            editorClasses: editor?.className || '',
            ariaLabel: el.getAttribute('aria-label') || '',
            placeholder: placeholderEl?.getAttribute('aria-label') || placeholderEl?.textContent || el.getAttribute('placeholder') || '',
            text: (el.textContent || '').trim(),
            rect: { y: rect.y, h: rect.height },
          };
        });

        const best = selectBestChatwiseComposer(candidates, window.innerHeight, MIN_COMPOSER_SCORE);
        if (!best) return false;

        const composer = composers[best.index];
        composer.focus();

        if (composer.tagName === 'TEXTAREA') {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          if (setter) setter.call(composer, text);
          else composer.value = text;
          composer.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }

        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(composer);
        selection?.removeAllRanges();
        selection?.addRange(range);

        const inserted = document.execCommand?.('insertText', false, text);
        if (!inserted) {
          composer.textContent = text;
        }
        composer.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })(${textJs})
    `;
}

export function buildChatwiseMessageCountJs() {
    return `
      (function() {
        return Array.from(document.querySelectorAll(${JSON.stringify(MESSAGE_WRAPPER_SELECTOR)}))
          .map(node => (node.innerText || node.textContent || '').trim())
          .filter(Boolean)
          .length;
      })()
    `;
}

export function buildChatwiseResponseAfterJs(previousCount, userText) {
    return `
      (function(previousCount, userText) {
        const messages = Array.from(document.querySelectorAll(${JSON.stringify(MESSAGE_WRAPPER_SELECTOR)}))
          .map(node => (node.innerText || node.textContent || '').trim())
          .filter(Boolean);
        if (messages.length <= previousCount) return null;
        const fresh = messages.slice(previousCount)
          .filter(text => text && text !== userText);
        if (fresh.length === 0) return null;
        return fresh[fresh.length - 1];
      })(${Number(previousCount) || 0}, ${JSON.stringify(String(userText ?? ''))})
    `;
}
