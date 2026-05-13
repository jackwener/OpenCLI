/**
 * Shared reply helpers for UI-based comment replies across platforms.
 */

export function findCommentJs(opts) {
    return `
    (() => {
      var containers = document.querySelectorAll(${JSON.stringify(opts.containerSelector)});
      var commentId = ${JSON.stringify(opts.commentId)};
      var matchText = ${JSON.stringify(opts.text || '')};
      var matchAuthor = ${JSON.stringify(opts.author || '')};

      for (var i = 0; i < containers.length; i++) {
        var el = containers[i];
        var toCheck = [el].concat(Array.from(el.querySelectorAll('*')).slice(0, 50));
        for (var j = 0; j < toCheck.length; j++) {
          var attrs = Array.from(toCheck[j].attributes || []);
          for (var k = 0; k < attrs.length; k++) {
            if (String(attrs[k].value).includes(commentId)) {
              return { found: true, index: i, method: 'id' };
            }
          }
        }
      }

      if (matchText && matchText.length > 5) {
        var needle = matchText.substring(0, 80).toLowerCase();
        for (var ti = 0; ti < containers.length; ti++) {
          var text = (containers[ti].innerText || '').toLowerCase();
          if (text.includes(needle)) return { found: true, index: ti, method: 'text' };
        }
      }

      if (matchAuthor && matchAuthor.length > 1) {
        var authorNeedle = matchAuthor.toLowerCase();
        for (var ai = 0; ai < containers.length; ai++) {
          var authorText = (containers[ai].innerText || '').toLowerCase();
          if (authorText.includes(authorNeedle)) return { found: true, index: ai, method: 'author' };
        }
      }

      return { found: false, total: containers.length };
    })()
  `;
}

export function insertTextJs(inputSelector, text) {
    return `
    (() => {
      var input = ${inputSelector};
      if (!input) return { ok: false, error: 'Input element not found' };
      input.focus();
      var textToInsert = ${JSON.stringify(text)};
      if (document.execCommand('insertText', false, textToInsert)) {
        return { ok: true, method: 'execCommand' };
      }
      try {
        var dt = new DataTransfer();
        dt.setData('text/plain', textToInsert);
        input.dispatchEvent(new ClipboardEvent('paste', {
          clipboardData: dt, bubbles: true, cancelable: true
        }));
        return { ok: true, method: 'paste' };
      } catch {}
      try {
        var nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
          || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(input, textToInsert);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true, method: 'nativeSetter' };
        }
      } catch {}
      return { ok: false, error: 'All text insertion methods failed' };
    })()
  `;
}

export function findAndClickButtonJs(containerSelector, patterns) {
    return `
    (() => {
      var root = ${containerSelector};
      if (!root) return { ok: false, error: 'Container not found' };
      var patterns = ${JSON.stringify(patterns)};
      var btns = Array.from(root.querySelectorAll('button, [role="button"]'));
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (b.disabled) continue;
        var t = (b.textContent || '').trim().toLowerCase();
        var label = (b.getAttribute('aria-label') || '').toLowerCase();
        var testId = b.getAttribute('data-e2e') || b.getAttribute('data-testid') || '';
        for (var p = 0; p < patterns.length; p++) {
          var pat = patterns[p].toLowerCase();
          if (t === pat || label.includes(pat) || testId.includes(pat)) {
            b.click();
            return { ok: true, matched: patterns[p], text: t };
          }
        }
      }
      return { ok: false, error: 'No matching button found', buttonCount: btns.length };
    })()
  `;
}
