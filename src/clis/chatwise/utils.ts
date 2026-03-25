export interface ChatwiseComposerCandidate {
  index: number;
  hidden: boolean;
  role: string | null;
  classes: string;
  editorClasses: string;
  placeholder: string;
  text: string;
  rect?: {
    y: number;
    h: number;
  };
}

export function scoreChatwiseComposerCandidate(
  candidate: ChatwiseComposerCandidate,
  viewportHeight: number = 0,
): number {
  if (candidate.hidden) return -1000;

  let score = 0;
  if (candidate.role === 'textbox') score += 10;

  const normalizedEditorClasses = candidate.editorClasses.toLowerCase();
  if (normalizedEditorClasses.includes('cm-editor')) score += 30;
  if (normalizedEditorClasses.includes('simple-editor')) score -= 140;

  const searchableText = `${candidate.placeholder} ${candidate.text}`.toLowerCase();
  if (searchableText.includes('enter a message here')) score += 220;
  if (searchableText.includes('press ⏎ to send')) score += 80;
  if (searchableText.includes('press enter to send')) score += 80;
  if (searchableText.includes('optional description')) score -= 140;
  if (searchableText.includes('user context document')) score -= 220;

  if (viewportHeight > 0 && candidate.rect) {
    const bottom = candidate.rect.y + candidate.rect.h;
    const distanceFromBottom = Math.abs(viewportHeight - bottom);
    score += Math.max(0, 80 - distanceFromBottom / 8);
  }

  return score;
}

export function selectBestChatwiseComposer(
  candidates: ChatwiseComposerCandidate[],
  viewportHeight: number = 0,
): ChatwiseComposerCandidate | null {
  if (candidates.length === 0) return null;

  return [...candidates]
    .sort((left, right) => {
      const delta = scoreChatwiseComposerCandidate(right, viewportHeight)
        - scoreChatwiseComposerCandidate(left, viewportHeight);
      return delta !== 0 ? delta : left.index - right.index;
    })[0] ?? null;
}

export function buildChatwiseInjectTextJs(text: string): string {
  const scoreFn = scoreChatwiseComposerCandidate.toString();
  const selectFn = selectBestChatwiseComposer.toString();
  const textJs = JSON.stringify(text);

  return `
    (function(text) {
      const scoreChatwiseComposerCandidate = ${scoreFn};
      const selectBestChatwiseComposer = ${selectFn};

      const composers = Array.from(document.querySelectorAll('textarea, [contenteditable="true"]'));
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
          placeholder: placeholderEl?.getAttribute('aria-label') || placeholderEl?.textContent || el.getAttribute('placeholder') || '',
          text: (el.textContent || '').trim(),
          rect: { y: rect.y, h: rect.height },
        };
      });

      const best = selectBestChatwiseComposer(candidates, window.innerHeight);
      if (!best) return false;

      const composer = composers[best.index];
      composer.focus();

      if (composer.tagName === 'TEXTAREA') {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(composer, text);
        composer.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }

      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(composer);
      selection?.removeAllRanges();
      selection?.addRange(range);

      const inserted = document.execCommand('insertText', false, text);
      if (!inserted) {
        composer.textContent = text;
      }
      composer.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })(${textJs})
  `;
}
